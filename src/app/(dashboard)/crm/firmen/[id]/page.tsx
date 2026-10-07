import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { LieferadresseZeile } from '@/components/crm/LieferadressenKarte'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import FirmaDetailClient from './FirmaDetailClient'
import type { FirmaRow, KontaktRow, AktivitaetRow, PipelineEintragRow, VerkaufRow } from '@/lib/crm/types'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  let query = (supabase.from('firmen') as any).select('name').eq('id', id)
  if (membership) query = query.eq('tenant_id', membership.tenantId)
  const { data } = await query.single()
  return { title: `${(data as R | null)?.name ?? 'Firma'} – software:112` }
}

export default async function FirmaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const role    = await getCurrentUserRole()
  const writeOk = canWrite(role, 'crm')
  const { data: { user } } = await supabase.auth.getUser()
  const currentUserId = user?.id ?? null
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const [
    { data: fRaw },
    { data: kRaw },
    { data: aRawAll },
    { data: pRaw },
    { data: rgRaw },
    { data: vRaw },
  ] = await Promise.all([
    tf((supabase.from('firmen') as any)
      .select('id, accountnummer, name, segment, strasse, plz, ort, land, email, email_weitere, telefon, telefon_vorwahl, mobil, mobil_vorwahl, website, uid_nummer, betrieb_nr, debitor_nr, kreditlimit, zahlungsziel_tage, skonto_pct, skonto_tage, waehrung, notizen, aktiv, is_lead, ist_kunde, ist_lieferant, sonderrabatt_pct, rabattgruppe_id, rabattgruppe:rabattgruppe_id(id, name, rabatt_pct)')
      .eq('id', id)
      .single()),

    tf((supabase.from('kontakte') as any)
      .select('id, vorname, nachname, segment, firma_id, email, telefon, mobil, ort, land, newsletter, newsletter_bestaetigt, stammkunde, notizen, aktiv, erstellt_am, mobil, zahlungsziel_tage')
      .eq('firma_id', id)
      .eq('aktiv', true)
      .order('nachname')),

    tf((supabase.from('aktivitaeten') as any)
      .select('*, aktivitaet_dokumente(id, dateiname, dateityp, groesse_bytes, erstellt_am)')
      .eq('firma_id', id)
      .order('datum', { ascending: false })),
    // (Filterung "nur für mich sichtbar" -> siehe aRaw unten)

    tf((supabase.from('pipeline_eintraege') as any)
      .select('id, stufe, titel, kategorie, wert_euro, wahrscheinlichkeit, erwartetes_datum, ganztags, uhrzeit_von, uhrzeit_bis, erledigt, erledigt_am, notizen, kontakt_id, firma_id, aktualisiert_am')
      .eq('firma_id', id)
      .order('aktualisiert_am', { ascending: false })),

    tf((supabase.from('rabattgruppen') as any)
      .select('id, name, rabatt_pct')
      .order('rabatt_pct')),

    // Echte Verkaufsdaten (statt des fehleranfälligen aktivitaeten-Spiegels, siehe unten)
    tf((supabase.from('verkaufsposten') as any)
      .select(`
        id, datum, rechnungsnummer, transaktions_nr, storniert, bezahlt,
        positionen:verkauf_positionen(menge, einheit, preis_brutto, rabatt_pct, sonderrabatt_pct)
      `)
      .eq('firma_id', id)
      .eq('aktiv', true)
      .order('datum', { ascending: false })),
  ])

  if (!fRaw) notFound()

  // "Nur für mich sichtbar"-Termine anderer Nutzer serverseitig herausfiltern
  const aRaw = ((aRawAll ?? []) as R[]).filter((a: R) => !a.ist_privat || a.erstellt_von === currentUserId)

  const f = fRaw as R
  const firma: FirmaRow = {
    id: f.id, accountnummer: f.accountnummer ?? null, name: f.name, segment: f.segment,
    strasse: f.strasse ?? null, plz: f.plz ?? null, ort: f.ort ?? null, land: f.land ?? null,
    email: f.email ?? null, email_weitere: (f.email_weitere as string[] | null) ?? [], telefon: f.telefon ?? null, telefon_vorwahl: (f.telefon_vorwahl as string | null) ?? '+43',
    mobil: f.mobil ?? null, mobil_vorwahl: (f.mobil_vorwahl as string | null) ?? '+43', website: f.website ?? null,
    uid_nummer: f.uid_nummer ?? null, betrieb_nr: f.betrieb_nr ?? null, debitor_nr: f.debitor_nr ?? null, kreditlimit: f.kreditlimit ?? null,
    zahlungsziel_tage: f.zahlungsziel_tage ?? 30, skonto_pct: f.skonto_pct ?? 0, skonto_tage: f.skonto_tage ?? 10,
    waehrung: f.waehrung ?? null,
    notizen: f.notizen ?? null, aktiv: f.aktiv ?? true,
    is_lead: f.is_lead ?? false,
    ist_kunde: f.ist_kunde ?? true, ist_lieferant: f.ist_lieferant ?? false,
    rabattgruppe_id: f.rabattgruppe_id ?? null,
    rabattgruppe_name: (f.rabattgruppe as R | null)?.name ?? null,
    rabattgruppe_pct: (f.rabattgruppe as R | null)?.rabatt_pct ?? null,
  }

  const kontakte: KontaktRow[] = ((kRaw ?? []) as R[]).map(k => ({
    id: k.id, accountnummer: k.accountnummer ?? null, vorname: k.vorname ?? null, nachname: k.nachname,
    segment: k.segment, firma_id: k.firma_id ?? null, firma_name: firma.name,
    email: k.email ?? null, telefon: k.telefon ?? null, mobil: k.mobil ?? null,
    strasse: k.strasse ?? null, plz: k.plz ?? null,
    ort: k.ort ?? null, land: k.land ?? null,
    newsletter: k.newsletter ?? false, newsletter_bestaetigt: k.newsletter_bestaetigt ?? false,
    stammkunde: k.stammkunde ?? false, notizen: k.notizen ?? null,
    rabattgruppe_id: null, rabattgruppe_name: null, rabattgruppe_pct: null,
    zahlungsziel_tage: k.zahlungsziel_tage ?? 14,
    aktiv: k.aktiv ?? true, erstellt_am: k.erstellt_am,
  }))

  const aktivitaeten: AktivitaetRow[] = ((aRaw ?? []) as R[]).map(a => ({
    id: a.id, art: a.art, betreff: a.betreff ?? null,
    beschreibung: a.beschreibung ?? null, datum: a.datum,
    ganztags: a.ganztags ?? true, uhrzeit_von: a.uhrzeit_von ?? null, uhrzeit_bis: a.uhrzeit_bis ?? null,
    erledigt: a.erledigt, kontakt_id: a.kontakt_id ?? null, firma_id: a.firma_id ?? null,
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

  const rabattgruppen = ((rgRaw ?? []) as R[]).map(r => ({ id: r.id, name: r.name, rabatt_pct: r.rabatt_pct }))

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


  // KAN-176: Lieferadressen (wenige je Kontakt bzw. Firma)
  // alle-ausnahme: Lieferadressen eines einzelnen Kontakts bzw. einer Firma, wenige
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: laRaw } = tenantId ? await (supabase.from('lieferadressen') as any)
    .select('id, bezeichnung, empfaenger, strasse, plz, ort, land, notizen, aktiv').eq('firma_id', id).eq('tenant_id', tenantId)
    .order('erstellt_am').limit(200) : { data: [] }

  return <FirmaDetailClient
    firma={firma}
    lieferadressen={(laRaw ?? []) as LieferadresseZeile[]}
    kontakte={kontakte}
    aktivitaeten={aktivitaeten}
    pipeline={pipeline}
    rabattgruppen={rabattgruppen}
    verkaeufe={verkaeufe}
    writeOk={writeOk}
  />
}
