import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import type { LieferadresseZeile } from '@/components/crm/LieferadressenKarte'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import { alle } from '@/lib/supabase/alle'
import { zaehleQuellen, kontaktAusZeile, KONTAKT_SPALTEN } from '@/lib/crm/liste'
import type { Metadata } from 'next'
import KontaktDetailClient from './KontaktDetailClient'
import type { KontaktRow, AktivitaetRow, PipelineEintragRow, VerkaufRow } from '@/lib/crm/types'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  let query = (supabase.from('kontakte') as any).select('vorname, nachname').eq('id', id)
  if (membership) query = query.eq('tenant_id', membership.tenantId)
  // abfrage-ohne-fehler: nur Seitentitel (generateMetadata) – bei einem Lesefehler genügt der Ersatztitel
  const { data } = await query.single()
  const name = data ? [data.vorname, data.nachname].filter(Boolean).join(' ') : 'Kontakt'
  return { title: `${name} – software:112` }
}

export default async function KontaktDetailPage({ params }: { params: Promise<{ id: string }> }) {
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
    kRawRes,
    aRawAllRes,
    pRawRes,
    vRawRes,
    fRawRes,
    rgRawRes,
  ] = await Promise.all([
    tf((supabase.from('kontakte') as any)
      .select(`${KONTAKT_SPALTEN}, firmen:firma_id(name, segment)`)
      .eq('id', id)
      .maybeSingle()),

    tf((supabase.from('aktivitaeten') as any)
      .select('*, aktivitaet_dokumente(id, dateiname, dateityp, groesse_bytes, erstellt_am)')
      .eq('kontakt_id', id)
      .order('datum', { ascending: false })),

    tf((supabase.from('pipeline_eintraege') as any)
      .select('id, stufe, titel, kategorie, wert_euro, wahrscheinlichkeit, erwartetes_datum, ganztags, uhrzeit_von, uhrzeit_bis, erledigt, erledigt_am, notizen, kontakt_id, firma_id, aktualisiert_am')
      .eq('kontakt_id', id)
      .order('aktualisiert_am', { ascending: false })),

    // Echte Verkaufsdaten (statt des fehleranfälligen aktivitaeten-Spiegels, siehe unten)
    tf((supabase.from('verkaufsposten') as any)
      .select(`
        id, datum, rechnungsnummer, lieferscheinnummer, transaktions_nr, storniert, bezahlt,
        positionen:verkauf_positionen(menge, einheit, preis_brutto, rabatt_pct, sonderrabatt_pct)
      `)
      .eq('kontakt_id', id)
      .eq('aktiv', true)
      .order('datum', { ascending: false })),

    // Auswahllisten für das Bearbeiten-Formular (02.10.2026) – ohne sie setzte
    // Speichern auf der Detailseite Firma und Rabattgruppe auf leer
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle(tf((supabase.from('firmen') as any)
      .select('id, name, segment')
      .eq('aktiv', true)
      .order('name').order('id'))),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('rabattgruppen') as any)
      .select('id, name, rabatt_pct').order('rabatt_pct')),
  ])
  const kRaw = geladen(kRawRes, 'Kontakte')
  const aRawAll = geladen(aRawAllRes, 'Aktivitäten')
  const pRaw = geladen(pRawRes, 'Pipeline')
  const vRaw = geladen(vRawRes, 'Verkäufe')
  const fRaw = geladen(fRawRes, 'Firmen')
  const rgRaw = geladen(rgRawRes, 'Rabattgruppen')

  if (!kRaw) notFound()

  // "Nur für mich sichtbar"-Termine anderer Nutzer serverseitig herausfiltern
  const aRaw = ((aRawAll ?? []) as R[]).filter((a: R) => !a.ist_privat || a.erstellt_von === currentUserId)

  const k = kRaw as R
  const kontakt: KontaktRow = kontaktAusZeile(k)
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
    // KAN-105: nicht berechneter Lieferschein mit seiner LS-Nummer statt „ohne Belegnr.“
    rechnungsnummer: v.rechnungsnummer ?? (v.lieferscheinnummer ? `${v.lieferscheinnummer} (nicht berechnet)` : null),
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

  // Quellen-Auswahl im Bearbeiten-Formular (02.10.2026): im Betrieb verwendete Quellen
  const { data: qRaw } = tenantId
    ? await alle((supabase.from('kontakte') as any)   // eslint-disable-line @typescript-eslint/no-explicit-any
      .select('id, quelle').eq('tenant_id', tenantId).not('quelle', 'is', null).order('id'))
    : { data: [] as R[] }
  const quellen = zaehleQuellen((qRaw ?? []) as R[]).quellen.map(q => q.quelle)


  // KAN-176: Lieferadressen (wenige je Kontakt bzw. Firma)
  // alle-ausnahme: Lieferadressen eines einzelnen Kontakts bzw. einer Firma, wenige
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: laRaw } = tenantId ? await (supabase.from('lieferadressen') as any)
    .select('id, bezeichnung, empfaenger, strasse, plz, ort, land, notizen, aktiv').eq('kontakt_id', id).eq('tenant_id', tenantId)
    .order('erstellt_am').limit(200) : { data: [] }

  return <KontaktDetailClient
    kontakt={kontakt}
    lieferadressen={(laRaw ?? []) as LieferadresseZeile[]}
    quellen={quellen}
    firmen={((fRaw ?? []) as R[]).map(f => ({ id: f.id as string, name: f.name as string, segment: f.segment as string }))}
    rabattgruppen={((rgRaw ?? []) as R[]).map(r => ({ id: r.id as string, name: r.name as string, rabatt_pct: Number(r.rabatt_pct) }))}
    firmaSegment={firmaSegment}
    aktivitaeten={aktivitaeten}
    pipeline={pipeline}
    verkaeufe={verkaeufe}
    writeOk={writeOk}
  />
}
