import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import { alle } from '@/lib/supabase/alle'
import { ladeBehaelter } from '@/lib/keller/behaelter'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import KellerplanEditor from './KellerplanEditor'
import { schreibSperre } from '@/lib/auth/sperren'
import type { PlanCharge } from '@/lib/keller/kellerplanZiehen'
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
  // abfrage-ohne-fehler: nur Seitentitel (generateMetadata) – bei einem Lesefehler genügt der Ersatztitel
  const { data } = await query.single()
  return { title: `${(data as R | null)?.name ?? 'Kellerplan'}` }
}

export default async function KellerplanEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const membership = await getCurrentMembership()
  // KAN-106: im Nur-Lesen-Modus (Abo, KAN-5) kein Ziehen und kein Buchen – nur der Gebinde-Dialog
  const nurLesen = canWrite(role, 'kellerbuch') && !!(await schreibSperre(membership))
  const writeOk  = canWrite(role, 'kellerbuch') && !nurLesen
  const tenantId    = membership?.tenantId ?? null
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb – ohne diesen Filter könnten bei
  // Mehrfach-Mitgliedschaft Daten vom falschen Betrieb angezeigt werden.
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const [
    planRawRes,
    posRawRes,
    allePositionenRawRes,
    behaelterRows,
    weinRawRes,
  ] = await Promise.all([
    tf((supabase.from('kellerplaene') as any)
      .select('id, name, breite_m, laenge_m, notizen')
      .eq('id', id))
      .maybeSingle(),

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

    // Eigene + freigegebene Gebinde (Kellergemeinschaft, Migration 203)
    ladeBehaelter(supabase, tenantId, { nurAktiv: true }),

    // Aktuelle Weinchargen je Behälter (für Beschriftung + Füllstand auf dem Plan
    // + Sprung zu "Abfüllen" im Gebinde-Dialog)
    alle(tf((supabase.from('weinausbau') as any)
      .select('id, behaelter_id, name, jahrgang, rebsorte, menge_liter, weinart, qualitaetsstufe, zusatzbezeichnung, erzeugnis, herkunft_code')
      .not('behaelter_id', 'is', null)
      .not('status', 'eq', 'abgeschlossen')
      .eq('aktiv', true).order('id'))),
  ])
  const planRaw = geladen(planRawRes, 'Kellerpläne')
  const posRaw = geladen(posRawRes, 'Kellerplan-Positionen')
  const allePositionenRaw = geladen(allePositionenRawRes, 'Kellerplan-Positionen')
  const weinRaw = geladen(weinRawRes, 'Chargen')

  if (!planRaw) notFound()

  const plan       = planRaw as R
  const positionen = (posRaw ?? []) as R[]

  // Auf einem ANDEREN Kellerplan platzierte Behälter aus der Auswahl ausblenden
  const anderswoPlatziert = new Set(
    ((allePositionenRaw ?? []) as R[])
      .filter(p => p.kellerplan_id !== id)
      .map(p => p.behaelter_id)
  )
  const behaelter = behaelterRows
    .filter(b => !anderswoPlatziert.has(b.id))
    .map(b => ({ id: b.id, name: b.anzeigeName, typ: b.typ, volumen_liter: b.volumen_liter, fremd: b.fremd, fremd_liter: b.fremd_liter, fremd_betrieb: b.fremd_betrieb })) as R[]

  // weinMap: behaelter_id → erste aktive Charge (für Beschriftung + Abfüllen-Sprung)
  // fillMap: behaelter_id → Summe aller menge_liter (für Füllstand-Visualisierung)
  const weinMap: Record<string, { weinausbauId: string; name: string; jahrgang: number | null; rebsorte: string | null }> = {}
  const fillMap: Record<string, number> = {}
  // Fremd belegte Liter eines Partnerbetriebs zählen zum Füllstand (ohne Chargendetails)
  for (const b of behaelter) if (b.fremd_liter > 0) { fillMap[b.id] = b.fremd_liter; weinMap[b.id] = { weinausbauId: '', name: `belegt · ${b.fremd_betrieb ?? 'Partner'}`, jahrgang: null, rebsorte: null } }
  for (const w of (weinRaw ?? []) as R[]) {
    if (!w.behaelter_id) continue
    fillMap[w.behaelter_id] = (fillMap[w.behaelter_id] ?? 0) + (parseFloat(w.menge_liter) || 0)
    if (!weinMap[w.behaelter_id]) {
      weinMap[w.behaelter_id] = { weinausbauId: w.id, name: w.name, jahrgang: w.jahrgang ?? null, rebsorte: w.rebsorte ?? null }
    }
  }

  // KAN-114: alle eigenen Chargen je Gebinde (größte zuerst) mit Merkmalen – Quelle und Ziel beim Ziehen
  const chargen: Record<string, PlanCharge[]> = {}
  for (const w of (weinRaw ?? []) as R[]) {
    const menge = parseFloat(w.menge_liter) || 0
    if (!w.behaelter_id || menge <= 0.005) continue
    ;(chargen[w.behaelter_id] ??= []).push({
      id: w.id, name: w.name, menge_liter: menge, jahrgang: w.jahrgang ?? null, rebsorte: w.rebsorte ?? null, weinart: w.weinart ?? null,
      qualitaetsstufe: w.qualitaetsstufe ?? null, zusatzbezeichnung: w.zusatzbezeichnung ?? null, erzeugnis: w.erzeugnis ?? null,
      herkunft_code: w.herkunft_code ?? null,
    })
  }
  for (const l of Object.values(chargen)) l.sort((a, b) => b.menge_liter - a.menge_liter)
  const gebindeInfo: Record<string, { gesperrt: boolean; fremd_betrieb: string | null }> = {}
  for (const b of behaelterRows) gebindeInfo[b.id] = { gesperrt: !!b.gesperrt, fremd_betrieb: b.fremd_betrieb ?? null }

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
        nurLesen={nurLesen}
        chargen={chargen}
        gebindeInfo={gebindeInfo}
      />

      {/* Print-Datum */}
      <div className="print-only mt-4 text-xs text-s112-tertiary text-right" style={{ display: 'none' }}>
        Gedruckt: {new Date().toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}
      </div>
    </div>
  )
}
