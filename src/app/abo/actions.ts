'use server'

// Rückmeldung 31.8.2026 ("die Plattform soll sich selber abrechnen können,
// damit wir zu unserem Geld kommen"): Selbstverwaltungs-Pendant zu
// createStripePortalSession() aus admin/mandanten/[id]/actions.ts - dort ist
// der Zugriff bewusst assertSystemAdmin(tenantId)-gesperrt (Plattformbetreiber-
// Only). Hier darf der Betriebsleiter (tenant_admin) bzw. system_admin
// AUSSCHLIESSLICH für den eigenen, aktiven Mandanten ein Stripe-Portal öffnen.

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { getStripe } from '@/lib/stripe/client'

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
