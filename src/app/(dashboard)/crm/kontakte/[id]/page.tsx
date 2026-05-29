import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import KontaktDetailClient from './KontaktDetailClient'
import type { KontaktRow, AktivitaetRow, PipelineEintragRow } from '@/lib/crm/types'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data } = await (supabase.from('kontakte') as any).select('vorname, nachname').eq('id', id).single()
  const name = data ? [data.vorname, data.nachname].filter(Boolean).join(' ') : 'Kontakt'
  return { title: `${name} – software:112` }
}

export default async function KontaktDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const role    = await getCurrentUserRole()
  const writeOk = canWrite(role)

  const [
    { data: kRaw },
    { data: aRaw },
    { data: pRaw },
  ] = await Promise.all([
    (supabase.from('kontakte') as any)
      .select('id, kundennummer, vorname, nachname, segment, firma_id, firmen:firma_id(name, segment), email, telefon, mobil, ort, land, newsletter, newsletter_bestaetigt, stammkunde, notizen, aktiv, erstellt_am')
      .eq('id', id)
      .single(),

    (supabase.from('aktivitaeten') as any)
      .select('id, art, betreff, beschreibung, datum, ganztags, uhrzeit_von, uhrzeit_bis, erledigt, kontakt_id, firma_id')
      .eq('kontakt_id', id)
      .order('datum', { ascending: false }),

    (supabase.from('pipeline_eintraege') as any)
      .select('id, stufe, titel, kategorie, wert_euro, wahrscheinlichkeit, erwartetes_datum, ganztags, uhrzeit_von, uhrzeit_bis, erledigt, erledigt_am, notizen, kontakt_id, firma_id, aktualisiert_am')
      .eq('kontakt_id', id)
      .order('aktualisiert_am', { ascending: false }),
  ])

  if (!kRaw) notFound()

  const k = kRaw as R
  const kontakt: KontaktRow = {
    id:                    k.id,
    kundennummer:          k.kundennummer ?? null,
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
  }
  const firmaSegment: string | null = (k.firmen as R | null)?.segment ?? null

  const aktivitaeten: AktivitaetRow[] = ((aRaw ?? []) as R[]).map(a => ({
    id: a.id, art: a.art, betreff: a.betreff ?? null,
    beschreibung: a.beschreibung ?? null, datum: a.datum,
    ganztags: a.ganztags ?? true, uhrzeit_von: a.uhrzeit_von ?? null, uhrzeit_bis: a.uhrzeit_bis ?? null,
    erledigt: a.erledigt, kontakt_id: a.kontakt_id, firma_id: a.firma_id ?? null,
  }))

  const pipeline: PipelineEintragRow[] = ((pRaw ?? []) as R[]).map(p => ({
    id: p.id, stufe: p.stufe, titel: p.titel,
    kategorie: p.kategorie ?? null,
    wert_euro: p.wert_euro ?? null, wahrscheinlichkeit: p.wahrscheinlichkeit ?? null,
    erwartetes_datum: p.erwartetes_datum ?? null,
    ganztags: p.ganztags ?? true, uhrzeit_von: p.uhrzeit_von ?? null, uhrzeit_bis: p.uhrzeit_bis ?? null,
    erledigt: p.erledigt ?? false, erledigt_am: p.erledigt_am ?? null,
    notizen: p.notizen ?? null,
    kontakt_id: p.kontakt_id ?? null, firma_id: p.firma_id ?? null,
    aktualisiert_am: p.aktualisiert_am,
  }))

  return (
    <KontaktDetailClient
      kontakt={kontakt}
      firmaSegment={firmaSegment}
      aktivitaeten={aktivitaeten}
      pipeline={pipeline}
      writeOk={writeOk}
    />
  )
}
