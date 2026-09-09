import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import KellerplanEditor from './KellerplanEditor'
import PrintButton from './PrintButton'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId    = membership?.tenantId ?? null
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb.
  let query = (supabase.from('kellerplaene') as any).select('name').eq('id', id)
  if (tenantId) query = query.eq('tenant_id', tenantId)
  const { data } = await query.single()
  return { title: `${(data as R | null)?.name ?? 'Kellerplan'} – software:112` }
}

export default async function KellerplanEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const writeOk  = canWrite(role)
  const membership = await getCurrentMembership()
  const tenantId    = membership?.tenantId ?? null
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb – ohne diesen Filter könnten bei
  // Mehrfach-Mitgliedschaft Daten vom falschen Betrieb angezeigt werden.
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const [
    { data: planRaw },
    { data: posRaw },
    { data: allePositionenRaw },
    { data: behaelterRaw },
    { data: weinRaw },
  ] = await Promise.all([
    tf((supabase.from('kellerplaene') as any)
      .select('id, name, breite_m, laenge_m, notizen')
      .eq('id', id))
      .single(),

    tf((supabase.from('kellerplan_positionen') as any)
      .select('behaelter_id, pos_x_pct, pos_y_pct, breite_pct, hoehe_pct')
      .eq('kellerplan_id', id)),

    // Platzierungen auf ALLEN Kellerplänen – ein Gebinde steht nur einem
    // Standort zur Verfügung, daher dürfen anderswo platzierte Behälter hier
    // nicht als "nicht platziert" angeboten werden (sonst Mehrfachzuordnung).
    // Weiterhin auf den aktiven Tenant beschränkt (nicht auf einen einzelnen
    // Kellerplan), damit keine Positionen anderer Betriebe durchsickern.
    tf((supabase.from('kellerplan_positionen') as any)
      .select('behaelter_id, kellerplan_id')),

    tf((supabase.from('behaelter') as any)
      .select('id, name, typ, volumen_liter')
      .eq('aktiv', true)
      .order('name')),

    // Aktuelle Weinchargen je Behälter (für Beschriftung + Füllstand auf dem Plan
    // + Sprung zu "Abfüllen" im Gebinde-Dialog)
    tf((supabase.from('weinausbau') as any)
      .select('id, behaelter_id, name, jahrgang, rebsorte, menge_liter')
      .not('behaelter_id', 'is', null)
      .not('status', 'eq', 'abgeschlossen')
      .eq('aktiv', true)),
  ])

  if (!planRaw) notFound()

  const plan       = planRaw as R
  const positionen = (posRaw ?? []) as R[]

  // Auf einem ANDEREN Kellerplan platzierte Behälter aus der Auswahl ausblenden
  const anderswoPlatziert = new Set(
    ((allePositionenRaw ?? []) as R[])
      .filter(p => p.kellerplan_id !== id)
      .map(p => p.behaelter_id)
  )
  const behaelter = ((behaelterRaw ?? []) as R[]).filter(b => !anderswoPlatziert.has(b.id))

  // weinMap: behaelter_id → erste aktive Charge (für Beschriftung + Abfüllen-Sprung)
  // fillMap: behaelter_id → Summe aller menge_liter (für Füllstand-Visualisierung)
  const weinMap: Record<string, { weinausbauId: string; name: string; jahrgang: number | null; rebsorte: string | null }> = {}
  const fillMap: Record<string, number> = {}
  for (const w of (weinRaw ?? []) as R[]) {
    if (!w.behaelter_id) continue
    fillMap[w.behaelter_id] = (fillMap[w.behaelter_id] ?? 0) + (parseFloat(w.menge_liter) || 0)
    if (!weinMap[w.behaelter_id]) {
      weinMap[w.behaelter_id] = { weinausbauId: w.id, name: w.name, jahrgang: w.jahrgang ?? null, rebsorte: w.rebsorte ?? null }
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
          <Link href="/kellerbuch" className="hover:text-s112-blue-700">Kellerbuch</Link>
          <span>/</span>
          <Link href="/kellerbuch/kellerplan" className="hover:text-s112-blue-700">Kellerplan</Link>
          <span>/</span>
          <span className="text-s112-text font-medium">{plan.name}</span>
        </nav>
        <PrintButton />
      </div>

      {/* Plan-Titel für Druck */}
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-s112-text">{plan.name}</h1>
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
        fillMap={fillMap}
        writeOk={writeOk}
      />

      {/* Print-Datum */}
      <div className="print-only mt-4 text-xs text-s112-tertiary text-right" style={{ display: 'none' }}>
        Gedruckt: {new Date().toLocaleDateString('de-AT')}
      </div>
    </div>
  )
}
