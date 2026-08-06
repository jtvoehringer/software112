import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import KontaktDetailClient from './KontaktDetailClient'
import type { KontaktRow, AktivitaetRow, PipelineEintragRow, VerkaufRow } from '@/lib/crm/types'

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
  const { data: { user } } = await supabase.auth.getUser()
  const currentUserId = user?.id ?? null

  const [
    { data: kRaw },
    { data: aRawAll },
    { data: pRaw },
    { data: vRaw },
  ] = await Promise.all([
    (supabase.from('kontakte') as any)
      .select('id, kundennummer, vorname, nachname, segment, firma_id, firmen:firma_id(name, segment), email, telefon, telefon_vorwahl, mobil, mobil_vorwahl, strasse, plz, ort, land, newsletter, newsletter_bestaetigt, stammkunde, notizen, aktiv, erstellt_am, is_lead, sonderrabatt_pct, rabattgruppe_id, rabattgruppe:rabattgruppe_id(id, name, rabatt_pct), zahlungsziel_tage')
      .eq('id', id)
      .single(),

    (supabase.from('aktivitaeten') as any)
      .select('*, aktivitaet_dokumente(id, dateiname, dateityp, groesse_bytes, erstellt_am)')
      .eq('kontakt_id', id)
      .order('datum', { ascending: false }),

    (supabase.from('pipeline_eintraege') as any)
      .select('id, stufe, titel, kategorie, wert_euro, wahrscheinlichkeit, erwartetes_datum, ganztags, uhrzeit_von, uhrzeit_bis, erledigt, erledigt_am, notizen, kontakt_id, firma_id, aktualisiert_am')
      .eq('kontakt_id', id)
      .order('aktualisiert_am', { ascending: false }),

    // Echte Verkaufsdaten (statt des fehleranfälligen aktivitaeten-Spiegels, siehe unten)
    (supabase.from('verkaufsposten') as any)
      .select(`
        id, datum, rechnungsnummer, transaktions_nr, storniert, bezahlt,
        positionen:verkauf_positionen(menge, einheit, preis_brutto, rabatt_pct, sonderrabatt_pct)
      `)
      .eq('kontakt_id', id)
      .eq('aktiv', true)
      .order('datum', { ascending: false }),
  ])

  if (!kRaw) notFound()

  // "Nur für mich sichtbar"-Termine anderer Nutzer serverseitig herausfiltern
  const aRaw = ((aRawAll ?? []) as R[]).filter((a: R) => !a.ist_privat || a.erstellt_von === currentUserId)

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
  }
  const firmaSegment: string | null = (k.firmen as R | null)?.segment ?? null

  const aktivitaeten: AktivitaetRow[] = ((aRaw ?? []) as R[]).map(a => ({
    id: a.id, art: a.art, betreff: a.betreff ?? null,
    beschreibung: a.beschreibung ?? null, datum: a.datum,
    ganztags: a.ganztags ?? true, uhrzeit_von: a.uhrzeit_von ?? null, uhrzeit_bis: a.uhrzeit_bis ?? null,
    erledigt: a.erledigt, kontakt_id: a.kontakt_id, firma_id: a.firma_id ?? null,
    email_id: a.email_id ?? null,
    email_conversation_id: a.email_conversation_id ?? null,
    email_von: a.email_von ?? null,
    email_von_name: a.email_von_name ?? null,
    email_an: a.email_an ?? null,
    email_body: a.email_body ?? null,
    email_body_html: a.email_body_html ?? null,
    ist_privat: a.ist_privat ?? null,
    dokumente: (a.aktivitaet_dokumente ?? []).map((d: R) => ({
      id: d.id, aktivitaet_id: a.id, dateiname: d.dateiname, dateityp: d.dateityp,
      groesse_bytes: d.groesse_bytes ?? null, storage_pfad: '', erstellt_am: d.erstellt_am,
    })),
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

  const verkaeufe: VerkaufRow[] = ((vRaw ?? []) as R[]).map(v => ({
    id: v.id, datum: v.datum,
    rechnungsnummer: v.rechnungsnummer ?? null,
    transaktions_nr: v.transaktions_nr ?? null,
    storniert: v.storniert ?? false,
    bezahlt: v.bezahlt ?? false,
    positionen: ((v.positionen ?? []) as R[]).map(p => ({
      menge: p.menge, einheit: p.einheit,
      preis_brutto: p.preis_brutto ?? null,
      rabatt_pct: p.rabatt_pct ?? null,
      sonderrabatt_pct: p.sonderrabatt_pct ?? null,
    })),
  }))

  return <KontaktDetailClient
    kontakt={kontakt}
    firmaSegment={firmaSegment}
    aktivitaeten={aktivitaeten}
    pipeline={pipeline}
    verkaeufe={verkaeufe}
    writeOk={writeOk}
  />
}
