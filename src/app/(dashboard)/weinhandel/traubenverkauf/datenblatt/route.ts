import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { NextResponse } from 'next/server'
import { getRebsorteKuerzel, getQualitaetBki, isRotwein } from '@/lib/wein/bki_kuerzel'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

function esc(v: unknown): string {
  if (v == null) return ''
  const s = String(v).replace(/"/g, '""')
  return s.includes(',') || s.includes('"') || s.includes('\n') || s.includes(';')
    ? `"${s}"`
    : s
}

export async function GET(req: Request) {
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership) return new NextResponse('Nicht angemeldet', { status: 401 })

  const { searchParams } = new URL(req.url)
  const jahrgangFilter   = searchParams.get('jahrgang')

  // Tenant-Betriebsdaten
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: einst } = await (supabase.from('tenant_einstellungen') as any)
    .select('betrieb_betriebsnummer, betrieb_name, betrieb_strasse, betrieb_hausnr, betrieb_plz, betrieb_ort, betrieb_vorname, betrieb_nachname')
    .eq('tenant_id', membership.tenantId)
    .maybeSingle()
  const te = (einst ?? {}) as R

  // Verkäufe laden
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase.from('traubenverkauf') as any)
    .select(`
      id, datum, menge_kg, preis_per_kg, kmw_grad, qualitaetsstufe, herkunft_code,
      weingarten:weingarten_id(id, name, rebsorte, trauben_herkunft_code),
      kontakt:kontakt_id(id, betrieb_nr, vorname, nachname, strasse, hausnr, plz, ort),
      firma:firma_id(id, betrieb_nr, firmenname, strasse, hausnr, plz, ort),
      jahrgang:jahrgang_id(id, jahrgang)
    `)
    .eq('tenant_id', membership.tenantId)
    .order('datum', { ascending: true })

  if (jahrgangFilter) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: jg } = await (supabase.from('weinjahrgaenge') as any)
      .select('id')
      .eq('tenant_id', membership.tenantId)
      .eq('jahrgang', Number(jahrgangFilter))
      .maybeSingle()
    if (jg) query = query.eq('jahrgang_id', (jg as R).id)
  }

  const { data: rowsRaw } = await query
  const rows = (rowsRaw ?? []) as R[]

  const versenderBetriebNr = te.betrieb_betriebsnummer ?? ''
  const versenderName      = te.betrieb_name    ?? ''
  const versenderVorname   = te.betrieb_vorname ?? ''
  const versenderStrasse   = te.betrieb_strasse ?? ''
  const versenderHausnr    = te.betrieb_hausnr  ?? ''
  const versenderPlz       = te.betrieb_plz     ?? ''
  const versenderOrt       = te.betrieb_ort     ?? ''

  // BKI-Spalten-Header (gem. Datenblatt-Struktur)
  const headers = [
    // Empfänger
    'Betriebsnr_Empf', 'Name_Empf', 'Vorname_Empf', 'Strasse_Empf', 'Hausnr_Empf', 'PLZ_Empf', 'Ort_Empf',
    // Versender
    'Betriebsnr_Vers', 'Name_Vers', 'Vorname_Vers', 'Strasse_Vers', 'Hausnr_Vers', 'PLZ_Vers', 'Ort_Vers',
    // Transport
    'Datum_Lieferung', 'Menge_kg', 'Art',
    'Weiss', 'Rot',
    'Sorte1', 'Sorte2', 'Sorte3',
    'Qualitaetsstufe', 'Jahrgang', 'Herkunft', 'KMW_Grad', 'Oechsle',
  ]

  const lines: string[] = [
    // Titelzeile (BKI-Konvention)
    esc('EDV-Liste zum automatischen Einlesen in die Weindatenbank'),
    '',
    // Spalten-Header
    headers.map(esc).join(';'),
  ]

  rows.forEach(v => {
    let empfBetriebNr = '', empfName = '', empfVorname = '', empfStrasse = '', empfHausnr = '', empfPlz = '', empfOrt = ''
    if (v.kontakt) {
      const k = v.kontakt as R
      empfBetriebNr = k.betrieb_nr ?? ''
      empfName      = k.nachname   ?? ''
      empfVorname   = k.vorname    ?? ''
      empfStrasse   = k.strasse    ?? ''
      empfHausnr    = k.hausnr     ?? ''
      empfPlz       = k.plz        ?? ''
      empfOrt       = k.ort        ?? ''
    } else if (v.firma) {
      const f = v.firma as R
      empfBetriebNr = f.betrieb_nr  ?? ''
      empfName      = f.firmenname  ?? ''
      empfStrasse   = f.strasse     ?? ''
      empfHausnr    = f.hausnr      ?? ''
      empfPlz       = f.plz         ?? ''
      empfOrt       = f.ort         ?? ''
    }

    const rebsorte   = (v.weingarten as R | null)?.rebsorte ?? null
    const rebKuerzel = getRebsorteKuerzel(rebsorte)
    const qualBki    = getQualitaetBki(v.qualitaetsstufe)
    const herkunft   = v.herkunft_code ?? (v.weingarten as R | null)?.trauben_herkunft_code ?? ''
    const jahrgang   = (v.jahrgang as R | null)?.jahrgang ?? ''
    const rot        = isRotwein(rebsorte)
    const datumStr   = v.datum ? new Date(v.datum).toLocaleDateString('de-AT') : ''

    const cols = [
      empfBetriebNr,
      empfName, empfVorname, empfStrasse, empfHausnr, empfPlz, empfOrt,
      versenderBetriebNr,
      versenderName, versenderVorname, versenderStrasse, versenderHausnr, versenderPlz, versenderOrt,
      datumStr,
      String(v.menge_kg ?? ''),
      'TB',         // Art = Transportbeleg (BKI-Konvention)
      rot ? '' : 'J',  // Weiß
      rot ? 'J' : '',  // Rot
      rebKuerzel,
      '',           // Sorte2
      '',           // Sorte3
      qualBki,
      String(jahrgang),
      herkunft,
      v.kmw_grad  != null ? String(v.kmw_grad).replace('.', ',')  : '',
      '',           // °Oe – Pflicht-Spalte im BKI-Format (leer wenn KMW angegeben)
    ]
    lines.push(cols.map(esc).join(';'))
  })

  const csv = '\uFEFF' + lines.join('\r\n')
  const dateiname = `BKI_Traubenverkauf${jahrgangFilter ? '_' + jahrgangFilter : ''}_${new Date().toISOString().split('T')[0]}.csv`

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${dateiname}"`,
    },
  })
}
