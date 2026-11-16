import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { ladeKellergemeinschaft } from '@/lib/keller/behaelter'
import TankForm from '@/components/kellerbuch/TankForm'
import { createTank } from '../../../actions'

export const metadata: Metadata = { title: 'Neuer geteilter Tank' }
export const dynamic = 'force-dynamic'

// KAN-466: Tank mit übereinander liegenden Kammern – jede Kammer wird ein eigenes Gebinde
export default async function NeuerTankPage() {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const gemeinschaft = await ladeKellergemeinschaft(supabase, membership?.tenantId ?? null)
  const partner = gemeinschaft.alsEigentuemer.length ? gemeinschaft.alsEigentuemer.map(p => p.name).join(', ') : null

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700 transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Neuer geteilter Tank</span>
      </div>
      <h1 className="text-2xl font-semibold text-s112-text mb-2">Neuer geteilter Tank</h1>
      <p className="text-sm text-s112-text-2 mb-6">
        Für Tanks, die in übereinander liegende Kammern geteilt sind – jede Kammer wird ein eigenes Gebinde. Ein Gebinde ohne Kammern legst du über{' '}
        <Link href="/kellerbuch/behaelter/neu" className="text-s112-blue-700 hover:underline">Neues Gebinde</Link> an.
      </p>
      <TankForm action={createTank} partner={partner} />
    </div>
  )
}
