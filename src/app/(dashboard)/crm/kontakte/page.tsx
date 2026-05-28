import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import KontakteClient from './KontakteClient'
import type { KontaktRow } from '@/lib/crm/types'
import type { AktivitaetRow, PipelineRow } from './KontakteClient'

export const metadata: Metadata = { title: 'Kontakte – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function KontaktePage() {
  const supabase = await createSupabaseServerClient()
  const role    = await getCurrentUserRole()
  const writeOk = canWrite(role)

  const [
    { data: kRaw },
    { data: fRaw },
    { data: aRaw },
    { data: pRaw },
  ] = await Promise.all([
    (supabase.from('kontakte') as any)
      .select('id, vorname, nachname, segment, firma_id, firmen:firma_id(name), email, telefon, mobil, ort, land, newsletter, newsletter_bestaetigt, stammkunde, aktiv, notizen, erstellt_am')
      .eq('aktiv', true)
      .order('nachname'),

    (supabase.from('firmen') as any)
      .select('id, name, segment')
      .eq('aktiv', true)
      .order('name'),

    (supabase.from('aktivitaeten') as any)
      .select('id, art, betreff, beschreibung, datum, erledigt, kontakt_id')
      .not('kontakt_id', 'is', null)
      .order('datum', { ascending: false }),

    (supabase.from('pipeline_eintraege') as any)
      .select('id, stufe, titel, wert_euro, wahrscheinlichkeit, erwartetes_datum, kontakt_id')
      .not('kontakt_id', 'is', null)
      .order('aktualisiert_am', { ascending: false }),
  ])

  const kontakte: KontaktRow[] = ((kRaw ?? []) as R[]).map(k => ({
    id:                    k.id,
    vorname:               k.vorname ?? null,
    nachname:              k.nachname,
    segment:               k.segment,
    firma_id:              k.firma_id ?? null,
    firma_name:            (k.firmen as R | null)?.name ?? null,
    email:                 k.email ?? null,
    telefon:               k.telefon ?? null,
    mobil:                 k.mobil ?? null,
    ort:                   k.ort ?? null,
    land:                  k.land ?? null,
    newsletter:            k.newsletter ?? false,
    newsletter_bestaetigt: k.newsletter_bestaetigt ?? false,
    stammkunde:            k.stammkunde ?? false,
    notizen:               k.notizen ?? null,
    aktiv:                 k.aktiv ?? true,
    erstellt_am:           k.erstellt_am,
  }))

  const firmen = ((fRaw ?? []) as R[]).map(f => ({
    id: f.id, name: f.name, segment: f.segment,
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Kontakte</h1>
          <p className="text-sm text-s112-muted mt-0.5">Kunden, Ansprechpartner & Interessenten</p>
        </div>
        <span className="text-sm text-s112-muted">{kontakte.length} Kontakte</span>
      </div>

      <KontakteClient
        kontakte={kontakte}
        firmen={firmen}
        aktivitaetenMap={aktivitaetenMap}
        pipelineMap={pipelineMap}
        writeOk={writeOk}
      />
    </div>
  )
}
