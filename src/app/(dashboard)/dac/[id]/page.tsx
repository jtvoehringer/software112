import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import DacForm from '@/components/dac/DacForm'
import { updateDacAntrag } from '../actions'

export const metadata: Metadata = { title: 'Prüfnummern-Antrag bearbeiten – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function DacEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data: rows }, { data: waRaw }] = await Promise.all([
    (supabase.from('dac_antrag') as any)
      .select('id, weinausbau_id, bezeichnung, dac_region, jahrgang, rebsorte, menge_liter, alkohol_prozent, status, pruefnummer, eingereicht_am, bescheid_am, notizen, aktiv')
      .eq('id', id).limit(1),
    (supabase.from('weinausbau') as any).select('id, name').eq('aktiv', true).order('name'),
  ])

  type DacRow = { id: string; weinausbau_id: string | null; bezeichnung: string; dac_region: string; jahrgang: number | null; rebsorte: string | null; menge_liter: number | null; alkohol_prozent: number | null; status: string; pruefnummer: string | null; eingereicht_am: string | null; bescheid_am: string | null; notizen: string | null; aktiv: boolean }
  type NameRow = { id: string; name: string }

  const dac       = (((rows ?? []) as R[])[0] ?? null) as DacRow | null
  if (!dac) notFound()
  const weinausbau = (waRaw ?? []) as NameRow[]

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/dac" className="hover:text-s112-teal transition-colors">DAC & Prüfnummern</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{dac.bezeichnung}</span>
      </div>
      <div className="flex items-start justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{dac.bezeichnung}</h1>
        {dac.pruefnummer && (
          <span className="bg-green-50 text-green-700 text-sm font-mono px-3 py-1 rounded-lg border border-green-200">
            {dac.pruefnummer}
          </span>
        )}
      </div>
      <DacForm dac={dac} weinausbau={weinausbau} action={updateDacAntrag.bind(null, id)} />
    </div>
  )
}
