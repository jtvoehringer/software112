'use server'

// Rückmeldung 31.8.2026 ("die Plattform soll sich selber abrechnen können,
// damit wir zu unserem Geld kommen"): Selbstverwaltungs-Pendant zu
// createStripePortalSession() aus admin/mandanten/[id]/actions.ts - dort ist
// der Zugriff bewusst assertSystemAdmin(tenantId)-gesperrt (Plattformbetreiber-
// Only). Hier darf der Betriebsleiter (tenant_admin) bzw. system_admin
// AUSSCHLIESSLICH für den eigenen, aktiven Mandanten ein Stripe-Portal öffnen.

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { getStripe, TRIAL_TAGE } from '@/lib/stripe/client'
import { istPaketKey, paketPriceId, paketAusPlan, PAKETE, type PaketKey } from '@/lib/pakete'
import { wendePaketAn } from '@/lib/pakete-server'
import { revalidatePath } from 'next/cache'
import { tenantKopfInvalidieren } from '@/lib/tenant/kopf'
import { stripeKundennummerSync } from '@/lib/stripe/kundennummer'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function createOwnStripePortalSession() {
  const membership = await getCurrentMembership()
  if (!membership) return { error: 'Kein Betrieb gefunden' }
  if (!canAdmin(membership.role)) {
    return { error: 'Nur der Betriebs-Manager bzw. Super-Admin kann die Zahlungsdaten verwalten.' }
  }

  const supabase = await createSupabaseServerClient()
  const { data: tenantRow } = await (supabase.from('tenants') as any)
    .select('stripe_customer_id')
    .eq('id', membership.tenantId)
    .maybeSingle()

  const customerId = (tenantRow as R | null)?.stripe_customer_id as string | null | undefined
  if (!customerId) {
    return { error: 'Für Ihren Betrieb ist noch kein Zahlungskonto hinterlegt. Bitte kontaktieren Sie uns, damit wir Ihr Abo einrichten.' }
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://software112.icp-consultants.at'

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer:   customerId,
      return_url: `${baseUrl}/abo`,
    })
    return { url: session.url }
  } catch (err) {
    return { error: `Stripe-Fehler: ${(err as Error).message}` }
  }
}

// ── Zahlung nachholen (abgebrochener Self-Service-Signup) ────────────────────
// Rückmeldung 31.8.2026 ("Abbruch-Fall: ja, Zahlung nachholen können"): wer
// beim Self-Service-Signup (app/signup/actions.ts) den Stripe-Checkout
// abgebrochen hat, landet gesperrt hier (stripe_status='incomplete', noch
// KEINE stripe_subscription_id). Das Customer-Portal (oben) funktioniert dafür
// nicht - es verwaltet nur ein BESTEHENDES Abo. Diese Funktion startet einen
// neuen Checkout für genau diesen Mandanten, inkl. der vollen 14-tägigen
// Testphase (die ja nie begonnen hat). Existiert bereits eine
// stripe_subscription_id, ist das NICHT der richtige Weg (dann: Portal oben).
export async function starteZahlungAction(paketWunsch?: string, buchhaltungsart?: string) {
  const membership = await getCurrentMembership()
  if (!membership) return { error: 'Kein Betrieb gefunden' }
  if (!canAdmin(membership.role)) {
    return { error: 'Nur der Betriebs-Manager bzw. Super-Admin kann die Zahlungsdaten hinterlegen.' }
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: tenantRow } = await (supabase.from('tenants') as R)
    .select('name, stripe_customer_id, stripe_subscription_id')
    .eq('id', membership.tenantId)
    .maybeSingle()

  const t = tenantRow as R | null
  if (!t) return { error: 'Betrieb nicht gefunden.' }
  if (t.stripe_subscription_id) {
    return { error: 'Für Ihren Betrieb existiert bereits ein Abo – bitte „Zahlungsdaten verwalten" verwenden.' }
  }

  // Paketmodell (2.9.2026): Paket aus der Auswahl auf /abo, sonst Standard.
  const paket: PaketKey = istPaketKey(paketWunsch) ? paketWunsch : 'standard'
  const priceId = paketPriceId(paket)
  if (!priceId) return { error: `Für das Paket ${PAKETE[paket].label} ist noch kein Stripe-Preis hinterlegt – bitte kontaktieren Sie uns.` }
  if (PAKETE[paket].module.modul_ea && !istBuchhaltungsart(buchhaltungsart)) {
    return { error: `Das Paket ${PAKETE[paket].label} enthält die E&A-Rechnung – bitte wählen Sie, ob Sie die E&A-Rechnung in software:112 führen oder Ihr Steuerberater die doppelte Buchhaltung (BMD) macht.` }
  }

  // tenants darf ein Betriebsleiter per RLS i.d.R. nicht selbst schreiben
  // (stripe_customer_id ist bewusst dem Webhook/Admin-Bereich vorbehalten) -
  // hier ausnahmsweise mit Service-Role, weil das explizit der vorgesehene
  // Self-Service-Weg für den EIGENEN, oben geprüften Mandanten ist.
  const admin = createSupabaseAdminClient()
  let customerId = t.stripe_customer_id as string | null
  if (!customerId) {
    try {
      const customer = await getStripe().customers.create({
        name: t.name, email: user?.email ?? undefined, metadata: { tenant_id: membership.tenantId },
      })
      customerId = customer.id
      await (admin.from('tenants') as R).update({ stripe_customer_id: customerId }).eq('id', membership.tenantId)
      await stripeKundennummerSync(membership.tenantId)
    } catch (err) {
      return { error: `Stripe-Fehler: ${(err as Error).message}` }
    }
  }

  // Buchhaltungsart schon jetzt merken (Migration 197) - der Webhook schaltet
  // nach dem Checkout nur die Module, die Entscheidung kommt von hier.
  if (istBuchhaltungsart(buchhaltungsart)) {
    const fehler = await speichereBuchhaltungsart(admin, membership.tenantId, buchhaltungsart)
    if (fehler) return { error: fehler }
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://software112.icp-consultants.at'
  try {
    const session = await getStripe().checkout.sessions.create({
      customer:    customerId,
      mode:        'subscription',
      line_items:  [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/signup/willkommen`,
      cancel_url:  `${baseUrl}/abo`,
      metadata:    { tenant_id: membership.tenantId },
      subscription_data: { trial_period_days: TRIAL_TAGE, metadata: { tenant_id: membership.tenantId } },
    })
    return { url: session.url }
  } catch (err) {
    return { error: `Stripe-Fehler: ${(err as Error).message}` }
  }
}

// ── Paketwechsel (Selbstservice, Entscheidung 2.9.2026) ─────────────────────
// Betriebsleiter wechselt das Paket direkt auf /abo. Der Wechsel läuft über
// Stripe (Subscription-Item auf den neuen Preis, anteilige Verrechnung ab
// sofort); das Webhook-Event customer.subscription.updated setzt danach
// Modul-Flags und Benutzerlimit (lib/pakete-server.ts). Damit die Oberfläche
// nicht auf den Webhook warten muss, werden Paket und Vorgaben hier zusätzlich
// sofort geschrieben - der Webhook bestätigt dasselbe Ergebnis. Downgrade
// schaltet hart ab (Daten bleiben); sind mehr Benutzer aktiv als das neue
// Paket erlaubt, bleiben sie aktiv, es können nur keine neuen eingeladen
// werden.
export async function wechslePaketAction(paketWunsch: string, buchhaltungsart?: string) {
  const membership = await getCurrentMembership()
  if (!membership) return { error: 'Kein Betrieb gefunden' }
  if (!canAdmin(membership.role)) {
    return { error: 'Nur der Betriebs-Manager bzw. Super-Admin kann das Paket wechseln.' }
  }
  if (!istPaketKey(paketWunsch)) return { error: 'Unbekanntes Paket.' }
  const paket = paketWunsch
  const priceId = paketPriceId(paket)
  if (!priceId) return { error: `Für das Paket ${PAKETE[paket].label} ist noch kein Stripe-Preis hinterlegt – bitte kontaktieren Sie uns.` }

  const admin = createSupabaseAdminClient()
  const { data: tenantRow } = await (admin.from('tenants') as R)
    .select('stripe_subscription_id, stripe_plan')
    .eq('id', membership.tenantId)
    .maybeSingle()
  const t = tenantRow as R | null
  if (!t?.stripe_subscription_id) {
    return { error: 'Für Ihren Betrieb existiert noch kein Abo – bitte zuerst „Zahlungsdaten hinterlegen" verwenden.' }
  }
  if (paketAusPlan(t.stripe_plan) === paket) return { error: 'Dieses Paket ist bereits aktiv.' }
  // Migration 197: kommt E&A neu dazu, muss die Buchhaltungsart gewählt sein
  const altesPaket = paketAusPlan(t.stripe_plan)
  const eaNeu = PAKETE[paket].module.modul_ea && !(altesPaket && PAKETE[altesPaket].module.modul_ea)
  if (eaNeu && !istBuchhaltungsart(buchhaltungsart)) {
    return { error: `Das Paket ${PAKETE[paket].label} enthält die E&A-Rechnung – bitte wählen Sie, ob Sie die E&A-Rechnung in software:112 führen oder Ihr Steuerberater die doppelte Buchhaltung (BMD) macht.` }
  }

  try {
    const stripe = getStripe()
    const sub = await stripe.subscriptions.retrieve(t.stripe_subscription_id)
    const item = sub.items.data[0]
    if (!item) return { error: 'Abo ohne Position – bitte kontaktieren Sie uns.' }
    await stripe.subscriptions.update(sub.id, {
      items: [{ id: item.id, price: priceId }],
      proration_behavior: 'create_prorations',
      metadata: { ...(sub.metadata ?? {}), tenant_id: membership.tenantId },
    })
  } catch (err) {
    return { error: `Stripe-Fehler: ${(err as Error).message}` }
  }

  await (admin.from('tenants') as R).update({ stripe_plan: paket }).eq('id', membership.tenantId)
  const fehler = await wendePaketAn(admin, membership.tenantId, paket)
  if (fehler) return { error: fehler }
  if (istBuchhaltungsart(buchhaltungsart)) {
    const f2 = await speichereBuchhaltungsart(admin, membership.tenantId, buchhaltungsart)
    if (f2) return { error: f2 }
  }

  revalidatePath('/abo')
  revalidatePath('/', 'layout')
  tenantKopfInvalidieren(membership.tenantId)
  return { ok: true, paket }
}

// ── Buchhaltungsart (Migration 197, Rückmeldung 4.9.2026) ───────────────────
// Pakete mit E&A (Standard, Premium) verlangen die Entscheidung, wer die
// Buchhaltung führt: 'ea' = E&A-Rechnung in software:112, 'doppik' = doppelte
// Buchhaltung beim Steuerberater (BMD-Übergabe, UVA nur Vorschau). Wird beim
// Paketwechsel/-kauf mit abgefragt und kann hier vom Betriebsleiter jederzeit
// umgestellt werden (gleiche Einstellung wie Administration → Mandanten).
export type Buchhaltungsart = 'ea' | 'doppik'
const istBuchhaltungsart = (v: unknown): v is Buchhaltungsart => v === 'ea' || v === 'doppik'

async function speichereBuchhaltungsart(admin: R, tenantId: string, art: Buchhaltungsart): Promise<string | null> {
  const { error } = await admin.from('tenant_einstellungen')
    .upsert({ tenant_id: tenantId, buchhaltungsart: art }, { onConflict: 'tenant_id' })
  return error ? `Buchhaltungsart konnte nicht gespeichert werden: ${(error as R).message}` : null
}

export async function setzeBuchhaltungsartAction(art: string) {
  const membership = await getCurrentMembership()
  if (!membership) return { error: 'Kein Betrieb gefunden' }
  if (!canAdmin(membership.role)) return { error: 'Nur der Betriebs-Manager bzw. Super-Admin kann die Buchhaltungsart ändern.' }
  if (!istBuchhaltungsart(art)) return { error: 'Ungültige Buchhaltungsart.' }
  const fehler = await speichereBuchhaltungsart(createSupabaseAdminClient(), membership.tenantId, art)
  if (fehler) return { error: fehler }
  revalidatePath('/abo')
  revalidatePath('/', 'layout')
  tenantKopfInvalidieren(membership.tenantId)
  return { ok: true }
}
