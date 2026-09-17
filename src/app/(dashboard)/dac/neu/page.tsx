import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import DacForm from '@/components/dac/DacForm'
import { createDacAntrag } from '../actions'

export const metadata: Metadata = { title: 'Neuer Prüfnummern-Antrag – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function NeuePage({
  searchParams,
}: {
  searchParams: Promise<{ charge?: string }>
}) {
  const { charge: preCharge } = await searchParams
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null

  const [{ data: raw }, { data: anRaw }] = await Promise.all([
    (supabase.from('weinausbau') as any).select('id, name').eq('aktiv', true).eq('tenant_id', tenantId).order('name'),
    preCharge
      ? (supabase.from('weinanalysen') as any)
          .select('analyse_datum, labor, alkohol_vol, restzucker_gl, gesamtsaeure_gl, ph_wert, flüchtige_saeure_gl, freie_so2_mgl, gesamt_so2_mgl')
          .eq('weinausbau_id', preCharge)
          .eq('tenant_id', tenantId)
          .order('analyse_datum', { ascending: false })
      : Promise.resolve({ data: [] }),
  ])

  type NameRow = { id: string; name: string }
  const weinausbau = (raw ?? []) as NameRow[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const analysen   = (anRaw ?? []) as R[]

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/dac" className="hover:text-s112-blue-700 transition-colors">DAC & Prüfnummern</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Neuer Antrag</span>
      </div>
      <h1 className="text-2xl font-semibold text-s112-text mb-6">Neuer Prüfnummern-Antrag</h1>
      <DacForm
        weinausbau={weinausbau}
        analysen={analysen}
        preChargeId={preCharge ?? null}
        action={createDacAntrag}
      />
    </div>
  )
}
