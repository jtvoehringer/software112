import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, getCurrentMembership } from '@/lib/auth/roles'
import { aboStandBerechnen } from '@/lib/abo/regeln'
import type { Metadata } from 'next'
import Kreisel from '@/components/ui/Kreisel'

export const metadata: Metadata = { title: 'Willkommen' }

// ── Zwischenseite nach erfolgreichem Stripe-Checkout ─────────────────────────
// Rückmeldung 31.8.2026: der Webhook (customer.subscription.created), der
// stripe_status auf 'trialing' setzt, trifft manchmal erst 1-2 Sekunden NACH
// dem Redirect zurück aus Stripe ein - ohne diese Zwischenseite würde die
// Person kurz auf /abo als "gesperrt" landen, obwohl der Checkout gerade
// erfolgreich war. Pollt per Meta-Refresh, bis die Sperre weg ist.

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function WillkommenPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const role       = await getCurrentUserRole()
  const membership = await getCurrentMembership()
  if (!membership) redirect('/dashboard')

  // abfrage-ohne-fehler: nur der Hinweis zur Testphase auf der Willkommensseite – ohne ihn bleibt der Einstieg nutzbar
  const { data: tenantRow } = await (supabase.from('tenants') as R)
    .select('stripe_status, stripe_trial_ends_at')
    .eq('id', membership.tenantId)
    .maybeSingle()
  const t = tenantRow as R | null
  const status      = (t?.stripe_status ?? null) as string | null
  const trialEndsAt = (t?.stripe_trial_ends_at ?? null) as string | null

  // Dieselbe Regel wie Layout und Schreibsperre (KAN-5, lib/abo/regeln.ts)
  const nochGesperrt = aboStandBerechnen({ tenantId: membership.tenantId, stripeStatus: status, trialEndsAt, role }).gesperrt

  if (!nochGesperrt) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-s112-bg flex items-center justify-center p-4">
      <meta httpEquiv="refresh" content="2" />
      <div className="w-full max-w-md text-center">
        <div className="card space-y-3">
          <Kreisel className="w-8 h-8 mx-auto" />
          <h1 className="text-lg font-semibold text-s112-text">Vielen Dank! Ihr Konto wird eingerichtet …</h1>
          <p className="text-sm text-s112-muted">Das dauert nur wenige Sekunden.</p>
          <a href="/login" className="text-xs text-s112-blue-700 hover:underline block pt-2">Dauert es zu lange? Hier einloggen</a>
        </div>
      </div>
    </div>
  )
}
