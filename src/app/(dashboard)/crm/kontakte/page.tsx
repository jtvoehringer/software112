import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
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
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const [
    { data: kRaw },
    { data: fRaw },
    { data: aRaw },
    { data: pRaw },
  ] = await Promise.all([
    tf((supabase.from('kontakte') as any)
      .select('id, accountnummer, vorname, nachname, segment, firma_id, firmen:firma_id(name), email, telefon, telefon_vorwahl, mobil, mobil_vorwahl, strasse, plz, ort, land, newsletter, newsletter_bestaetigt, stammkunde, aktiv, notizen, erstellt_am, is_lead, sonderrabatt_pct, rabattgruppe_id, rabattgruppe:rabattgruppe_id(id, name, rabatt_pct), zahlungsziel_tage')
      .eq('aktiv', true)
      .order('nachname')),

    tf((supabase.from('firmen') as any)
      .select('id, name, segment')
      .eq('aktiv', true)
      .order('name')),

    tf((supabase.from('aktivitaeten') as any)
      .select('id, art, betreff, beschreibung, datum, erledigt, kontakt_id')
      .not('kontakt_id', 'is', null)
      .order('datum', { ascending: false })),

    tf((supabase.from('pipeline_eintraege') as any)
      .select('id, stufe, titel, wert_euro, wahrscheinlichkeit, erwartetes_datum, kontakt_id')
      .not('kontakt_id', 'is', null)
      .order('aktualisiert_am', { ascending: false })),

  ])

  const kontakte: KontaktRow[] = ((kRaw ?? []) as R[]).map(k => ({
    id:                    k.id,
    accountnummer:          k.accountnummer ?? null,
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
    rabattgruppe_id:       k.rabattgruppe_id ?? null,
    rabattgruppe_name:     (k.rabattgruppe as R | null)?.name ?? null,
    rabattgruppe_pct:      (k.rabattgruppe as R | null)?.rabatt_pct ?? null,
    sonderrabatt_pct:      parseFloat(k.sonderrabatt_pct) || 0,
    zahlungsziel_tage:     k.zahlungsziel_tage ?? 14,
    is_lead:               !!(k.is_lead as boolean),
    telefon_vorwahl:       (k.telefon_vorwahl as string | null) ?? '+43',
    mobil_vorwahl:         (k.mobil_vorwahl   as string | null) ?? '+43',
    strasse:               (k.strasse          as string | null) ?? null,
    plz:                   (k.plz              as string | null) ?? null,
    aktiv:                 k.aktiv ?? true,
    erstellt_am:           k.erstellt_am,
  }))

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
        <Link href="/crm" className="hover:text-s112-teal transition-colors">CRM</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Kontakte</span>
      </div>
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
        rabattgruppen={rabattgruppen}
        aktivitaetenMap={aktivitaetenMap}
        pipelineMap={pipelineMap}
        writeOk={writeOk}
      />
    </div>
  )
}
