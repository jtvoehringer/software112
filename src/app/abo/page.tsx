import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { STRIPE_BLOCKED_STATUSES, STRIPE_PLAN_LABELS, STRIPE_STATUS_META } from '@/lib/stripe/client'
import AboClient from './AboClient'

// Rückmeldung 31.8.2026 ("die Plattform soll sich selber abrechnen können,
// damit wir zu unserem Geld kommen"): Ziel-/Hinweisseite der neuen
// Zugriffssperre in (dashboard)/layout.tsx. Bewusst AUSSERHALB der
// (dashboard)-Route-Gruppe angesiedelt, damit ein gesperrter Mandant die
// Seite überhaupt erreichen kann (sonst Redirect-Schleife).

export const metadata: Metadata = { title: 'Abo & Zahlung – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function AboPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const role       = await getCurrentUserRole()
  const membership = await getCurrentMembership()
  if (!membership) redirect('/betrieb-waehlen')

  const { data: tenantRow } = await (supabase.from('tenants') as any)
    .select('name, stripe_status, stripe_plan, stripe_customer_id')
    .eq('id', membership.tenantId)
    .maybeSingle()

  const t = tenantRow as R | null
  const isSandbox    = t?.name === 'Sandbox'
  const stripeStatus = (t?.stripe_status ?? null) as string | null
  const stripePlan   = (t?.stripe_plan ?? null) as string | null
  const hasCustomer  = !!t?.stripe_customer_id

  const exempt      = role === 'system_admin' || isSandbox
  const hardBlocked = !exempt && !!stripeStatus && STRIPE_BLOCKED_STATUSES.includes(stripeStatus)
  const warned      = !exempt && stripeStatus === 'past_due'

  const planLabel   = stripePlan ? (STRIPE_PLAN_LABELS[stripePlan] ?? stripePlan) : null
  const statusMeta  = stripeStatus ? STRIPE_STATUS_META[stripeStatus] : undefined

  return (
    <AboClient
      hardBlocked={hardBlocked}
      warned={warned}
      darfVerwalten={canAdmin(role)}
      hasCustomer={hasCustomer}
      planLabel={planLabel}
      statusLabel={statusMeta?.label ?? null}
    />
  )
}
