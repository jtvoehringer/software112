import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import KellerplanEditor from './KellerplanEditor'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data } = await (supabase.from('kellerplaene') as any).select('name').eq('id', id).single()
  return { title: `${(data as R | null)?.name ?? 'Kellerplan'} – software:112` }
}

export default async function KellerplanEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const writeOk  = canWrite(role)

  const [
    { data: planRaw },
    { data: posRaw },
    { data: behaelterRaw },
    { data: weinRaw },
  ] = await Promise.all([
    (supabase.from('kellerplaene') as any)
      .select('id, name, breite_m, laenge_m, notizen')
      .eq('id', id)
      .single(),

    (supabase.from('kellerplan_positionen') as any)
      .select('behaelter_id, pos_x_pct, pos_y_pct, breite_pct, hoehe_pct')
      .eq('kellerplan_id', id),

    (supabase.from('behaelter') as any)
      .select('id, name, typ, volumen_liter')
      .eq('aktiv', true)
      .order('name'),

    // Aktuelle Weinchargen je Behälter (für Beschriftung auf dem Plan)
    (supabase.from('weinausbau') as any)
      .select('behaelter_id, name, jahrgang, rebsorte')
      .not('behaelter_id', 'is', null)
      .not('status', 'eq', 'abgeschlossen')
      .eq('aktiv', true),
  ])

  if (!planRaw) notFound()

  const plan       = planRaw as R
  const positionen = (posRaw ?? []) as R[]
  const behaelter  = (behaelterRaw ?? []) as R[]

  // weinMap: behaelter_id → erste aktive Charge
  const weinMap: Record<string, { name: string; jahrgang: number | null; rebsorte: string | null }> = {}
  for (const w of (weinRaw ?? []) as R[]) {
    if (w.behaelter_id && !weinMap[w.behaelter_id]) {
      weinMap[w.behaelter_id] = { name: w.name, jahrgang: w.jahrgang ?? null, rebsorte: w.rebsorte ?? null }
    }
  }

  // Positionen als Map für den Editor
  const posMap: Record<string, { pos_x_pct: number; pos_y_pct: number; breite_pct: number; hoehe_pct: number }> = {}
  for (const p of positionen) {
    posMap[p.behaelter_id] = {
      pos_x_pct: p.pos_x_pct,
      pos_y_pct: p.pos_y_pct,
      breite_pct: p.breite_pct,
      hoehe_pct: p.hoehe_pct,
    }
  }

  return (
    <div>
      {/* Breadcrumb + Header */}
      <div className="flex items-center justify-between mb-5 no-print">
        <nav className="flex items-center gap-2 text-sm text-s112-muted">
          <Link href="/kellerbuch" className="hover:text-s112-teal">Kellerbuch</Link>
          <span>/</span>
          <Link href="/kellerbuch/kellerplan" className="hover:text-s112-teal">Kellerplan</Link>
          <span>/</span>
          <span className="text-gray-800 font-medium">{plan.name}</span>
        </nav>
        <button
          onClick={() => window.print()}
          className="text-xs font-medium text-s112-teal border border-s112-teal/30 rounded-full px-3 py-1 hover:bg-s112-teal hover:text-white transition-colors"
        >
          🖨️ Drucken / PDF
        </button>
      </div>

      {/* Plan-Titel für Druck */}
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">{plan.name}</h1>
        <p className="text-xs text-s112-muted">{plan.breite_m} × {plan.laenge_m} m</p>
      </div>

      <KellerplanEditor
        plan={{ id: plan.id, name: plan.name, breite_m: plan.breite_m, laenge_m: plan.laenge_m }}
        initialPositions={posMap}
        behaelter={behaelter.map((b: R) => ({
          id: b.id,
          name: b.name,
          typ: b.typ ?? 'sonstiges',
          volumen_liter: b.volumen_liter ?? null,
        }))}
        weinMap={weinMap}
        writeOk={writeOk}
      />

      {/* Print-Datum */}
      <div className="print-only mt-4 text-xs text-gray-400 text-right" style={{ display: 'none' }}>
        Gedruckt: {new Date().toLocaleDateString('de-AT')}
      </div>
    </div>
  )
}
