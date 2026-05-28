import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import FirmaDetailClient from './FirmaDetailClient'
import type { FirmaRow, KontaktRow, AktivitaetRow, PipelineEintragRow } from '@/lib/crm/types'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data } = await (supabase.from('firmen') as any).select('name').eq('id', id).single()
  return { title: `${(data as R | null)?.name ?? 'Firma'} – software:112` }
}

export default async function FirmaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const role    = await getCurrentUserRole()
  const writeOk = canWrite(role)

  const [
    { data: fRaw },
    { data: kRaw },
    { data: aRaw },
    { data: pRaw },
  ] = await Promise.all([
    (supabase.from('firmen') as any)
      .select('id, kundennummer, name, segment, strasse, plz, ort, land, email, telefon, website, uid_nummer, kreditlimit, zahlungsziel_tage, waehrung, notizen, aktiv')
      .eq('id', id)
      .single(),

    (supabase.from('kontakte') as any)
      .select('id, vorname, nachname, segment, firma_id, email, telefon, mobil, ort, land, newsletter, newsletter_bestaetigt, stammkunde, notizen, aktiv, erstellt_am, mobil')
      .eq('firma_id', id)
      .eq('aktiv', true)
      .order('nachname'),

    (supabase.from('aktivitaeten') as any)
      .select('id, art, betreff, beschreibung, datum, erledigt, kontakt_id, firma_id')
      .eq('firma_id', id)
      .order('datum', { ascending: false }),

    (supabase.from('pipeline_eintraege') as any)
      .select('id, stufe, titel, wert_euro, wahrscheinlichkeit, erwartetes_datum, notizen, kontakt_id, firma_id, aktualisiert_am')
      .eq('firma_id', id)
      .order('aktualisiert_am', { ascending: false }),
  ])

  if (!fRaw) notFound()

  const f = fRaw as R
  const firma: FirmaRow = {
    id: f.id, kundennummer: f.kundennummer ?? null, name: f.name, segment: f.segment,
    strasse: f.strasse ?? null, plz: f.plz ?? null, ort: f.ort ?? null, land: f.land ?? null,
    email: f.email ?? null, telefon: f.telefon ?? null, website: f.website ?? null,
    uid_nummer: f.uid_nummer ?? null, kreditlimit: f.kreditlimit ?? null,
    zahlungsziel_tage: f.zahlungsziel_tage ?? null, waehrung: f.waehrung ?? null,
    notizen: f.notizen ?? null, aktiv: f.aktiv ?? true,
  }

  const kontakte: KontaktRow[] = ((kRaw ?? []) as R[]).map(k => ({
    id: k.id, kundennummer: k.kundennummer ?? null, vorname: k.vorname ?? null, nachname: k.nachname,
    segment: k.segment, firma_id: k.firma_id ?? null, firma_name: firma.name,
    email: k.email ?? null, telefon: k.telefon ?? null, mobil: k.mobil ?? null,
    ort: k.ort ?? null, land: k.land ?? null,
    newsletter: k.newsletter ?? false, newsletter_bestaetigt: k.newsletter_bestaetigt ?? false,
    stammkunde: k.stammkunde ?? false, notizen: k.notizen ?? null,
    aktiv: k.aktiv ?? true, erstellt_am: k.erstellt_am,
  }))

  const aktivitaeten: AktivitaetRow[] = ((aRaw ?? []) as R[]).map(a => ({
    id: a.id, art: a.art, betreff: a.betreff ?? null,
    beschreibung: a.beschreibung ?? null, datum: a.datum,
    erledigt: a.erledigt, kontakt_id: a.kontakt_id ?? null, firma_id: a.firma_id ?? null,
  }))

  const pipeline: PipelineEintragRow[] = ((pRaw ?? []) as R[]).map(p => ({
    id: p.id, stufe: p.stufe, titel: p.titel,
    wert_euro: p.wert_euro ?? null, wahrscheinlichkeit: p.wahrscheinlichkeit ?? null,
    erwartetes_datum: p.erwartetes_datum ?? null, notizen: p.notizen ?? null,
    kontakt_id: p.kontakt_id ?? null, firma_id: p.firma_id ?? null,
    aktualisiert_am: p.aktualisiert_am,
  }))

  return (
    <FirmaDetailClient
      firma={firma}
      kontakte={kontakte}
      aktivitaeten={aktivitaeten}
      pipeline={pipeline}
      writeOk={writeOk}
    />
  )
}
