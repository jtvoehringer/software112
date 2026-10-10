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
import { istPaketKey, paketFromPriceId, paketPriceId, paketAusPlan, PAKETE, type PaketKey } from '@/lib/pakete'
import { wendePaketAn } from '@/lib/pakete-server'
import { revalidatePath } from 'next/cache'
import { tenantKopfInvalidieren } from '@/lib/tenant/kopf'
import { stripeKundennummerSync } from '@/lib/stripe/kundennummer'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { paketEntscheidung, paketwechselParameter, testphaseTage } from '@/lib/abo/regeln'
import { schreibSperreFehler } from '@/lib/auth/sperren'
import { aboPositionAus, paketPosition, paketwechselVerbundFehler } from '@/lib/abo/verbund'
import { buchenFehler, premiumPositionFuer, PREMIUM_ART } from '@/lib/abo/premiumStripe'
import { heuteWien, kuendigungZumMonatsende, premiumSupportStand } from '@/lib/abo/premiumSupport'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// schreibsperre-ausnahme: Stripe-Kundenportal (Zahlungsdaten, Rechnungen, Kündigung) – der Weg aus der Sperre (KAN-5)
export async function createOwnStripePortalSession() {
  const membership = await getCurrentMembership()
  if (!membership) return { error: 'Kein Betrieb gefunden' }
  if (!canAdmin(membership.role)) {
    return { error: 'Nur der Betriebs-Manager bzw. Super-Admin kann die Zahlungsdaten verwalten.' }
  }

  const supabase = await createSupabaseServerClient()
  const { data: tenantRow, error: tenantErr } = await (supabase.from('tenants') as any)
    .select('stripe_customer_id, abrechnung_ueber')
    .eq('id', membership.tenantId)
    .maybeSingle()
  if (tenantErr) return { error: dbFehlerText(tenantErr, 'Betrieb konnte nicht geladen werden') }

  // KAN-215: Nebenmandanten teilen sich den Stripe-Kunden des Hauptmandanten – dessen Zahlungsdaten und Rechnungen
  // verwaltet nur der Hauptmandant
  if ((tenantRow as R | null)?.abrechnung_ueber) {
    return { error: 'Ihr Betrieb wird über einen anderen Betrieb abgerechnet (Abrechnungsverbund) – Zahlungsdaten und Rechnungen verwaltet der Hauptmandant.' }
  }
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
// KAN-5: Auch nach einer Kündigung (stripe_subscription_id wieder leer) ist das der Weg zurück
// aus dem Nur-Lesen-Modus – dann aber OHNE neue Testphase (testphaseTage: nur, wenn der
// Stripe-Kunde noch nie ein Abo hatte), sonst ließe sich die Sperre beliebig oft umgehen.
// schreibsperre-ausnahme: Checkout für ein neues Abo – der Weg aus der Sperre (KAN-5)
export async function starteZahlungAction(paketWunsch?: string, buchhaltungsart?: string) {
  const membership = await getCurrentMembership()
  if (!membership) return { error: 'Kein Betrieb gefunden' }
  if (!canAdmin(membership.role)) {
    return { error: 'Nur der Betriebs-Manager bzw. Super-Admin kann die Zahlungsdaten hinterlegen.' }
  }

  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: tenantRow, error: tenantErr } = await (supabase.from('tenants') as R)
    .select('name, stripe_customer_id, stripe_subscription_id, stripe_status, abrechnung_ueber')
    .eq('id', membership.tenantId)
    .maybeSingle()
  // KAN-251: sonst „kein Kunde, kein Abo, kein Verbund“ – ein zweiter Stripe-Kunde bzw. ein Abo am Verbund vorbei
  if (tenantErr) return { error: dbFehlerText(tenantErr, 'Betrieb konnte nicht geladen werden') }

  const t = tenantRow as R | null
  if (!t) return { error: 'Betrieb nicht gefunden.' }
  if (t.abrechnung_ueber) return { error: 'Ihr Betrieb wird über einen anderen Betrieb abgerechnet (Abrechnungsverbund).' }
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
      { const { error: e } = await (admin.from('tenants') as R).update({ stripe_customer_id: customerId }).eq('id', membership.tenantId)
        if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (tenants): ${e.message}`) }
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
    // Testphase nur für Kunden ohne bisheriges Abo (auch gekündigte/abgelaufene zählen)
    const bisherige = await getStripe().subscriptions.list({ customer: customerId, status: 'all', limit: 1 })
    // KAN-215: auch ein gekündigter bzw. aus einem Verbund ausgetretener Betrieb (eigener neuer Stripe-Kunde) bekommt
    // keine neue Testphase – Testphase gibt es nur einmal
    const gekuendigt = ['cancelled', 'canceled'].includes(String(t.stripe_status ?? ''))
    const trialTage = testphaseTage({ bisherigeAbos: bisherige.data.length + (gekuendigt ? 1 : 0), tage: TRIAL_TAGE })
    const session = await getStripe().checkout.sessions.create({
      customer:    customerId,
      mode:        'subscription',
      line_items:  [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/signup/willkommen`,
      cancel_url:  `${baseUrl}/abo`,
      metadata:    { tenant_id: membership.tenantId },
      subscription_data: {
        ...(trialTage ? { trial_period_days: trialTage } : {}),
        metadata: { tenant_id: membership.tenantId },
      },
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
// sofort geschrieben - der Webhook bestätigt dasselbe Ergebnis. KAN-5: nur, wenn
// der Status des Abos das erlaubt (paketEntscheidung, dieselbe Regel wie im
// Webhook) - bei gesperrtem Abo bzw. offener Zahlung kein Upgrade ohne Zahlung. Downgrade
// schaltet hart ab (Daten bleiben); sind mehr Benutzer aktiv als das neue
// Paket erlaubt, bleiben sie aktiv, es können nur keine neuen eingeladen
// werden.
// schreibsperre-ausnahme: Paketwechsel läuft über Stripe (auch ein günstigeres Paket kann der Weg aus der Sperre sein); Module nur nach paketEntscheidung (KAN-5)
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
  const { data: tenantRow, error: tenantErr } = await (admin.from('tenants') as R)
    .select('stripe_subscription_id, stripe_plan, abrechnung_ueber')
    .eq('id', membership.tenantId)
    .maybeSingle()
  // KAN-251: sonst wäre ein Nebenmandant (Abrechnungsverbund) nicht erkannt worden
  if (tenantErr) return { error: dbFehlerText(tenantErr, 'Betrieb konnte nicht geladen werden') }
  const t = tenantRow as R | null
  // KAN-215: Nebenmandanten wechseln nicht selbst, Hauptmandanten mit Verbund nur innerhalb Premium
  if (t?.abrechnung_ueber) return { error: 'Ihr Betrieb wird über einen anderen Betrieb abgerechnet (Abrechnungsverbund) – das Paket ist dort festgelegt.' }
  { const { count, error: verbundErr } = await (admin.from('tenants') as R).select('id', { count: 'exact', head: true }).eq('abrechnung_ueber', membership.tenantId)
    // Sweep 90 (KAN-282): Lesefehler hieß „keine Submandanten“ – Paketwechsel trotz Abrechnungsverbund
    if (verbundErr) return { error: dbFehlerText(verbundErr, 'Abrechnungsverbund konnte nicht geprüft werden') }
    const vf = paketwechselVerbundFehler(paket, count ?? 0)
    if (vf) return { error: vf } }
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

  let aboStatus: string | null = null
  let zahlungAusstehend = false
  try {
    const stripe = getStripe()
    const sub = await stripe.subscriptions.retrieve(t.stripe_subscription_id)
    // KAN-215: Paket-Position statt der ersten (Zusatzmandanten-Positionen bleiben unverändert)
    const pos = paketPosition(sub.items.data.map(i => aboPositionAus(i as unknown as R)), paketFromPriceId)
    const item = pos ? sub.items.data.find(i => i.id === pos.id) : sub.items.data[0]
    if (!item) return { error: 'Abo ohne Position – bitte kontaktieren Sie uns.' }
    if (sub.metadata?.tenant_id !== membership.tenantId) {
      // metadata nicht im Upgrade-Aufruf (pending_if_incomplete erlaubt sie nicht) – vorab eigens setzen
      await stripe.subscriptions.update(sub.id, { metadata: { ...(sub.metadata ?? {}), tenant_id: membership.tenantId } })
    }
    // KAN-8: Upgrade sofort abrechnen und nur bei bezahlter Rechnung umstellen, Downgrade wie bisher
    const aktualisiert = await stripe.subscriptions.update(sub.id, {
      items: [{ id: item.id, price: priceId }],
      ...paketwechselParameter(altesPaket, paket),
    })
    aboStatus = aktualisiert.status ?? null
    zahlungAusstehend = !!aktualisiert.pending_update
  } catch (err) {
    return { error: `Stripe-Fehler: ${(err as Error).message}` }
  }

  if (istBuchhaltungsart(buchhaltungsart)) {
    const f2 = await speichereBuchhaltungsart(admin, membership.tenantId, buchhaltungsart)
    if (f2) return { error: f2 }
  }

  // KAN-5: Paket nur sofort freischalten, wenn das Abo bezahlt bzw. in der Testphase ist –
  // sonst übernimmt der Webhook den Wechsel, sobald Stripe die Zahlung bestätigt
  const entscheidung = paketEntscheidung({ ereignis: 'aktualisiert', status: aboStatus, neuesPaket: paket, bisherigesPaket: altesPaket })
  // KAN-8: Rechnung des Upgrades (noch) nicht bezahlt – Stripe hat den Wechsel zurückgestellt (pending_update)
  if (zahlungAusstehend || !entscheidung.moduleAnwenden) {
    // Die Buchhaltungsart ist oben schon gespeichert – Menü und Seiten sofort nachziehen
    revalidatePath('/abo')
    revalidatePath('/', 'layout')
    tenantKopfInvalidieren(membership.tenantId)
    return {
      ok: true, paket,
      hinweisArt: 'warnung' as const,
      hinweis: zahlungAusstehend
        ? `Die Rechnung über den Differenzbetrag für ${PAKETE[paket].label} ist noch nicht bezahlt – bis dahin bleibt das bisherige Paket aktiv. Bitte die Zahlungsdaten unter „Zahlungsdaten verwalten“ prüfen; Stripe hält den Wechsel etwa 23 Stunden offen, danach bitte erneut wechseln.`
        : `Der Wechsel auf ${PAKETE[paket].label} ist bei Stripe beauftragt. Freigeschaltet wird das Paket, sobald die Zahlung bestätigt ist – bitte die Zahlungsdaten unter „Zahlungsdaten verwalten“ prüfen.`,
    }
  }

  { const { error: e } = await (admin.from('tenants') as R).update({ stripe_plan: paket }).eq('id', membership.tenantId)
    if (e) return { error: `Paket konnte nicht gespeichert werden (tenants): ${dbFehlerText(e)}` } }
  const fehler = await wendePaketAn(admin, membership.tenantId, paket)
  if (fehler) return { error: fehler }

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

// KAN-5: fachliche Einstellung (E&A oder Doppik) – im Nur-Lesen-Modus gesperrt. Beim Abschluss
// bzw. Paketwechsel speichern starteZahlungAction/wechslePaketAction die Wahl ohnehin mit.
export async function setzeBuchhaltungsartAction(art: string) {
  const membership = await getCurrentMembership()
  if (!membership) return { error: 'Kein Betrieb gefunden' }
  const gesperrt = await schreibSperreFehler(membership)
  if (gesperrt) return { error: gesperrt }
  if (!canAdmin(membership.role)) return { error: 'Nur der Betriebs-Manager bzw. Super-Admin kann die Buchhaltungsart ändern.' }
  if (!istBuchhaltungsart(art)) return { error: 'Ungültige Buchhaltungsart.' }
  const fehler = await speichereBuchhaltungsart(createSupabaseAdminClient(), membership.tenantId, art)
  if (fehler) return { error: fehler }
  revalidatePath('/abo')
  revalidatePath('/', 'layout')
  tenantKopfInvalidieren(membership.tenantId)
  return { ok: true }
}

// ── Premium-Support buchen und kündigen (KAN-226 Teil 2, 08.10.2026) ─────────────────────────────────────
// Zusätzliche Position im bestehenden Stripe-Abo (STRIPE_PRICE_PREMIUM_SUPPORT, 79 € netto/Monat, anteilig ab heute);
// Kündigen entfernt die Position ohne Gutschrift, Premium-Support bleibt bis zum Monatsende. Das Kennzeichen am Betrieb
// wird sofort gesetzt (Service-Role, Paketfelder-Schutz) – der Webhook bestätigt denselben Stand (lib/abo/premiumStripe).
// Nur die Betriebsleitung; im Nur-Lesen-Modus gesperrt (fachliche Buchung, kein Weg aus der Sperre).

function premiumSupportPreisId(): string | null {
  return (process.env.STRIPE_PRICE_PREMIUM_SUPPORT ?? '').trim() || null
}

async function premiumKontext() {
  const membership = await getCurrentMembership()
  if (!membership) return { error: 'Kein Betrieb gefunden' } as const
  const gesperrt = await schreibSperreFehler(membership)
  if (gesperrt) return { error: gesperrt } as const
  const admin = createSupabaseAdminClient()
  const { data, error } = await (admin.from('tenants') as R)
    .select('stripe_subscription_id, abrechnung_ueber, premium_support_seit, premium_support_bis').eq('id', membership.tenantId).maybeSingle()
  if (error) return { error: dbFehlerText(error, 'Betrieb konnte nicht geladen werden') } as const
  const t = (data ?? {}) as R
  const stand = premiumSupportStand({ seit: t.premium_support_seit ?? null, bis: t.premium_support_bis ?? null })
  return { membership, admin, t, stand } as const
}

export async function premiumSupportBuchenAction() {
  const k = await premiumKontext()
  if ('error' in k) return { error: k.error }
  const preisId = premiumSupportPreisId()
  const fehler = buchenFehler({
    darfVerwalten: canAdmin(k.membership.role), preisId, hatAbo: !!k.t.stripe_subscription_id, abrechnungUeber: !!k.t.abrechnung_ueber,
    aktivUnbefristet: k.stand.status === 'aktiv' && !k.stand.bis,
  })
  if (fehler) return { error: fehler }
  try {
    const stripe = getStripe()
    const sub = await stripe.subscriptions.retrieve(k.t.stripe_subscription_id)
    const vorhanden = premiumPositionFuer(sub.items.data.map(i => aboPositionAus(i as unknown as R)), k.membership.tenantId, preisId)
    if (!vorhanden) {
      await stripe.subscriptions.update(sub.id, {
        items: [{ price: preisId as string, quantity: 1, metadata: { s112_art: PREMIUM_ART, s112_tenant_id: k.membership.tenantId } }],
        proration_behavior: 'create_prorations',
      })
    }
  } catch (err) {
    return { error: `Stripe-Fehler: ${(err as Error).message}` }
  }
  const heute = heuteWien()
  const seit = k.stand.status === 'aktiv' ? (k.stand as { seit: string }).seit : heute
  const { error } = await (k.admin.from('tenants') as R).update({ premium_support_seit: seit, premium_support_bis: null }).eq('id', k.membership.tenantId)
  if (error) return { error: `Premium-Support ist bei Stripe gebucht, das Kennzeichen konnte nicht gesetzt werden: ${dbFehlerText(error)}` }
  revalidatePath('/abo')
  revalidatePath('/hilfe/support')
  tenantKopfInvalidieren(k.membership.tenantId)
  return { ok: true }
}

export async function premiumSupportKuendigenAction() {
  const k = await premiumKontext()
  if ('error' in k) return { error: k.error }
  if (!canAdmin(k.membership.role)) return { error: 'Nur die Betriebsleitung kann Premium-Support buchen oder kündigen.' }
  if (k.stand.status !== 'aktiv' || k.stand.bis) return { error: 'Premium-Support ist nicht (mehr) gebucht.' }
  const preisId = premiumSupportPreisId()
  if (k.t.stripe_subscription_id) {
    try {
      const stripe = getStripe()
      const sub = await stripe.subscriptions.retrieve(k.t.stripe_subscription_id)
      const pos = premiumPositionFuer(sub.items.data.map(i => aboPositionAus(i as unknown as R)), k.membership.tenantId, preisId)
      // ohne Gutschrift: der laufende Monat ist bezahlt, Premium-Support bleibt bis zum Monatsende
      if (pos) await stripe.subscriptionItems.del(pos.id, { proration_behavior: 'none' })
    } catch (err) {
      return { error: `Stripe-Fehler: ${(err as Error).message}` }
    }
  }
  const { error } = await (k.admin.from('tenants') as R)
    .update({ premium_support_bis: kuendigungZumMonatsende(heuteWien()) }).eq('id', k.membership.tenantId)
  if (error) return { error: `Kündigung bei Stripe erfasst, das Kennzeichen konnte nicht gesetzt werden: ${dbFehlerText(error)}` }
  revalidatePath('/abo')
  revalidatePath('/hilfe/support')
  tenantKopfInvalidieren(k.membership.tenantId)
  return { ok: true }
}
