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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function createOwnStripePortalSession() {
  const membership = await getCurrentMembership()
  if (!membership) return { error: 'Kein Betrieb gefunden' }
  if (!canAdmin(membership.role)) {
    return { error: 'Nur der Betriebsleiter bzw. System-Admin kann die Zahlungsdaten verwalten.' }
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
export async function starteZahlungAction() {
  const membership = await getCurrentMembership()
  if (!membership) return { error: 'Kein Betrieb gefunden' }
  if (!canAdmin(membership.role)) {
    return { error: 'Nur der Betriebsleiter bzw. System-Admin kann die Zahlungsdaten hinterlegen.' }
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

  const priceId = process.env.NEXT_PUBLIC_STRIPE_PRICE_PROFESSIONAL ?? ''
  if (!priceId) return { error: 'Kein Plan konfiguriert – bitte kontaktieren Sie uns.' }

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
    } catch (err) {
      return { error: `Stripe-Fehler: ${(err as Error).message}` }
    }
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
