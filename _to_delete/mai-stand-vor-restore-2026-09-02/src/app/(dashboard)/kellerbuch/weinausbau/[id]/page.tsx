import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import WeinausbauForm from '@/components/kellerbuch/WeinausbauForm'
import { updateWeinausbau } from '../../actions'

export const metadata: Metadata = { title: 'Charge bearbeiten – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function WeinausbauEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ data: rows }, { data: wgRaw }, { data: bhRaw }] = await Promise.all([
    (supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, weingarten_id, behaelter_id, menge_liter, status, qualitaetsstufe, notizen, aktiv')
      .eq('id', id).limit(1),
    (supabase.from('weingarten') as any).select('id, name').eq('aktiv', true).order('name'),
    (supabase.from('behaelter') as any).select('id, name').eq('aktiv', true).order('name'),
  ])

  type WeinausbauRow = { id: string; name: string; jahrgang: number | null; rebsorte: string | null; weingarten_id: string | null; behaelter_id: string | null; menge_liter: number | null; status: string; qualitaetsstufe: string | null; notizen: string | null; aktiv: boolean }
  type NameRow = { id: string; name: string }
  const weinausbau  = (((rows ?? []) as R[])[0] ?? null) as WeinausbauRow | null
  if (!weinausbau) notFound()
  const weingaerten = (wgRaw ?? []) as NameRow[]
  const behaelter   = (bhRaw ?? []) as NameRow[]

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/kellerbuch" className="hover:text-s112-teal transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{weinausbau.name}</span>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{weinausbau.name}</h1>
      <WeinausbauForm
        weinausbau={weinausbau}
        weingaerten={weingaerten}
        behaelter={behaelter}
        action={updateWeinausbau.bind(null, id)}
      />
    </div>
  )
}
