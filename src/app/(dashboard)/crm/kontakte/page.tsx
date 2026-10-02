import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { filterAusParams, ladeKontakteSeite, ladeZaehler, zaehleQuellen, kontaktAusZeile } from '@/lib/crm/liste'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import KontakteClient from './KontakteClient'
import type { KontaktRow } from '@/lib/crm/types'
import type { AktivitaetRow, PipelineRow } from './KontakteClient'

export const metadata: Metadata = { title: 'Kontakte – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function KontaktePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams
  const filter = filterAusParams(sp, 'kontakt')
  const supabase = await createSupabaseServerClient()
  const role    = await getCurrentUserRole()
  const writeOk = canWrite(role, 'crm')
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  // Serverseitig gefiltert und seitenweise (17.9.2026, lib/crm/liste.ts):
  // Filter aus der URL, eine Abfrage mit Zähler; Firmen (für das Formular) und
  // Zähler je Segment parallel dazu.
  // Quellen (02.10.2026): ohne RPC – nur die Spalte quelle der Kontakte des
  // Betriebs laden (inaktive nur bei ?inaktiv=1, wie die Liste) und zählen.
  const quellenAbfrage = (() => {
    if (!tenantId) return Promise.resolve({ data: [] as R[] })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase.from('kontakte') as any).select('id, quelle').eq('tenant_id', tenantId)
    if (!filter.inaktiv) q = q.eq('aktiv', true)
    return alle(q.order('id'))
  })()
  const [{ rows: kRaw, gesamt }, zaehler, { data: fRaw }, { data: qRaw }] = await Promise.all([
    ladeKontakteSeite(supabase, tenantId, filter),
    ladeZaehler(supabase, tenantId, 'kontakt'),
    alle(tf((supabase.from('firmen') as any)
      .select('id, name, segment')
      .eq('aktiv', true)
      .order('name').order('id'))),
    quellenAbfrage,
  ])
  const quellenZaehler = zaehleQuellen((qRaw ?? []) as R[])
  const ids = kRaw.map(k => k.id as string)
  const [{ data: aRaw }, { data: pRaw }] = ids.length === 0 ? [{ data: [] }, { data: [] }] : await Promise.all([
    tf((supabase.from('aktivitaeten') as any)
      .select('id, art, betreff, beschreibung, datum, erledigt, kontakt_id')
      .in('kontakt_id', ids)
      .order('datum', { ascending: false })),
    tf((supabase.from('pipeline_eintraege') as any)
      .select('id, stufe, titel, wert_euro, wahrscheinlichkeit, erwartetes_datum, kontakt_id')
      .in('kontakt_id', ids)
      .order('aktualisiert_am', { ascending: false })),
  ])

  const kontakte: KontaktRow[] = ((kRaw ?? []) as R[]).map(kontaktAusZeile)

  const firmen = ((fRaw ?? []) as R[]).map(f => ({
    id: f.id, name: f.name, segment: f.segment,
  }))

  // Rabattgruppen (non-fatal – Tabelle existiert erst nach Migration 031)
  let rRaw: R[] = []
  try {
    const { data: r } = await tf((supabase.from('rabattgruppen') as any)
      .select('id, name, rabatt_pct').order('rabatt_pct'))
    rRaw = (r ?? []) as R[]
  } catch { /* Tabelle noch nicht vorhanden */ }

  const rabattgruppen = rRaw.map(r => ({
    id: r.id as string,
    name: r.name as string,
    rabatt_pct: Number(r.rabatt_pct),
  }))

  // Aktivitäten nach kontakt_id gruppieren
  const aktivitaetenMap: Record<string, AktivitaetRow[]> = {}
  for (const a of (aRaw ?? []) as R[]) {
    if (!a.kontakt_id) continue
    if (!aktivitaetenMap[a.kontakt_id]) aktivitaetenMap[a.kontakt_id] = []
    aktivitaetenMap[a.kontakt_id].push({
      id: a.id, art: a.art, betreff: a.betreff ?? null,
      beschreibung: a.beschreibung ?? null, datum: a.datum, erledigt: a.erledigt,
    })
  }

  // Pipeline nach kontakt_id gruppieren
  const pipelineMap: Record<string, PipelineRow[]> = {}
  for (const p of (pRaw ?? []) as R[]) {
    if (!p.kontakt_id) continue
    if (!pipelineMap[p.kontakt_id]) pipelineMap[p.kontakt_id] = []
    pipelineMap[p.kontakt_id].push({
      id: p.id, stufe: p.stufe, titel: p.titel,
      wert_euro: p.wert_euro ?? null,
      wahrscheinlichkeit: p.wahrscheinlichkeit ?? null,
      erwartetes_datum: p.erwartetes_datum ?? null,
    })
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-4">
        <Link href="/crm" className="hover:text-s112-blue-700 transition-colors">CRM</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Kontakte</span>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Kontakte</h1>
          <p className="text-sm text-s112-muted mt-0.5">Kunden, Ansprechpartner & Interessenten</p>
        </div>
        <span className="text-sm text-s112-muted">{zaehler.gesamt} Kontakte</span>
      </div>

      <KontakteClient
        kontakte={kontakte}
        firmen={firmen}
        rabattgruppen={rabattgruppen}
        aktivitaetenMap={aktivitaetenMap}
        pipelineMap={pipelineMap}
        writeOk={writeOk}
        filter={filter}
        gesamt={gesamt}
        zaehler={zaehler}
        quellenZaehler={quellenZaehler}
      />
    </div>
  )
}
