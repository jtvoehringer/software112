import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import DacForm from '@/components/dac/DacForm'
import { createDacAntrag } from '../actions'

export const metadata: Metadata = { title: 'Neuer DAC-Antrag – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function NeuePage() {
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: raw } = await (supabase.from('weinausbau') as any)
    .select('id, name').eq('aktiv', true).order('name')
  const weinausbau = (raw ?? []) as R[]

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/dac" className="hover:text-s112-teal transition-colors">DAC & Prüfnummern</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Neuer Antrag</span>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Neuer DAC-Antrag</h1>
      <DacForm weinausbau={weinausbau} action={createDacAntrag} />
    </div>
  )
}
