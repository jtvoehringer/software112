import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import WeinausbauForm from '@/components/kellerbuch/WeinausbauForm'
import { createWeinausbau } from '../../actions'
import { kmwZuQualitaet } from '@/lib/weinqualitaet'

export const metadata: Metadata = { title: 'Neue Charge – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function NeuePage({ searchParams }: { searchParams: Promise<{ pressung_id?: string }> }) {
  const { pressung_id } = await searchParams
  const supabase = await createSupabaseServerClient()

  const [{ data: wgRaw }, { data: bhRaw }, { data: pressungRaw }] = await Promise.all([
    (supabase.from('weingarten') as any).select('id, name').eq('aktiv', true).order('name'),
    (supabase.from('behaelter') as any).select('id, name').eq('aktiv', true).order('name'),
    pressung_id
      ? (supabase.from('pressungen') as any).select('kmw_grad').eq('id', pressung_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  type NameRow = { id: string; name: string }
  const weingaerten = (wgRaw ?? []) as NameRow[]
  const behaelter   = (bhRaw ?? []) as NameRow[]

  const kmw = parseFloat((pressungRaw as R | null)?.kmw_grad)
  const maxQualitaetsstufe = !isNaN(kmw) && kmw > 0 ? kmwZuQualitaet(kmw) : null

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/kellerbuch" className="hover:text-s112-teal transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Neue Charge</span>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Neue Weinausbau-Charge</h1>
      <WeinausbauForm
        weingaerten={weingaerten}
        behaelter={behaelter}
        maxQualitaetsstufe={maxQualitaetsstufe}
        action={createWeinausbau}
      />
    </div>
  )
}
