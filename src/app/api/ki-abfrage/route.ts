import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const SCHEMA_CONTEXT = `
Du bist ein Assistent für ein österreichisches Weinbau-ERP namens software:112.
Du hilfst dem Winzer, seine eigenen Betriebsdaten in natürlicher Sprache abzufragen.

Verfügbare Tabellen (alle automatisch nach Mandant gefiltert via RLS):

weingarten: id, name, ried(Riednamen), rebsorte, weinart(rot|weiss|rose), flaeche_ha, bewirtschaftung(biodynamisch|biologisch|in_umstellung|nachhaltig|kip|konventionell), aktiv(bool) – das sind die Rieden/Weingärten des Betriebs
grundstuecke: id, gst_nr, katastralgemeinde, rebsorte, flaeche_ha(AMA-Fläche), flaeche_ha_kataster(Katasterfläche), status(aktiv|brache|gruenbrache|gerodet), spritzbar(bool), weingarten_id – einzelne Grundstücke (GST) innerhalb einer Ried
kontakte: id, kundennummer, vorname, nachname, segment (privat|gastro|handel|export|grosshandel), email, telefon, mobil, strasse, plz, ort, land, stammkunde(bool), is_lead(bool), sonderrabatt_pct, notizen
firmen: id, kundennummer, name, segment, email, telefon, strasse, plz, ort, land, uid_nummer, zahlungsziel_tage, is_lead(bool), sonderrabatt_pct, notizen
aktivitaeten: id, art(anruf|email|besuch|notiz|angebot|verkostung|messe), betreff, datum, erledigt(bool), kontakt_id, firma_id
pipeline_eintraege: id, titel, stufe(neukontakt|interessent|angebot|verhandlung|abschluss|stammkunde|verloren|pause), kategorie, erledigt(bool), erwartetes_datum
verkaufsposten: id, datum, rechnungsnummer, bezahlt(bool), storniert(bool), kontakt_id, firma_id
fuellungen: id, name, jahrgang(zahl z.B. 2025), rebsorte, flaschengroesse_ml, bestand_flaschen, vk_preis_brutto, einstandspreis, aktiv(bool)
weinausbau: id, name, jahrgang(zahl z.B. 2025), rebsorte, menge_liter, qualitaetsstufe, status(ernte|gaerung|ausbau|abfuellung|abgeschlossen), aktiv(bool)
behandlungen: id, datum, art, menge_gesamt, menge_einheit, psm_id, weingarten_id
lagerbewegungen: (SPEZIAL) Verkäufe einer konkreten Füllung – brauchbar für "Lagerbewegungen", "was wurde verkauft", "wie viel wurde verkauft", "wer hat gekauft". Filtert über fuellungen.name_contains + optional jahrgang.

Deine Aufgabe: Analysiere die Frage des Winzers und gib eine STRUKTURIERTE ANTWORT als JSON zurück.
Antworte NUR mit validem JSON, keine Erklärungen außerhalb des JSON.

JSON-Format:
{
  "tabelle": "weingarten|grundstuecke|kontakte|firmen|verkaufsposten|fuellungen|weinausbau|behandlungen|pipeline_eintraege|lagerbewegungen",
  "filter": {
    "segment": "gastro|handel|privat|export|grosshandel (optional)",
    "ort_contains": "Stadtname (optional)",
    "plz_prefix": "12 (optional, Anfang der PLZ)",
    "land": "DE|AT|CH|IT (optional, ISO-Ländercode)",
    "name_contains": "Querfeldein (optional, Suche im Namen – bei Wein/Füllungen: Weinname; bei weingarten: Ried- oder Weingartenname)",
    "jahrgang": 2025 (optional, Zahl – filtert nach Jahrgang bei fuellungen/weinausbau/lagerbewegungen),
    "is_lead": true|false (optional),
    "stammkunde": true|false (optional),
    "bezahlt": true|false (optional, nur verkaufsposten),
    "storniert": false (optional),
    "erledigt": true|false (optional),
    "aktiv": true|false (optional),
    "datum_von": "YYYY-MM-DD (optional)",
    "datum_bis": "YYYY-MM-DD (optional)",
    "bestand_min": 1 (optional, nur fuellungen),
    "qualitaetsstufe": "spaetlese|auslese|qualitaetswein etc. (optional)",
    "weinart": "rot|weiss|rose (optional, nur weingarten)",
    "bewirtschaftung": "biodynamisch|biologisch|in_umstellung|nachhaltig|kip|konventionell (optional, nur weingarten)",
    "status": "aktiv|brache|gruenbrache|gerodet (optional, nur grundstuecke)"
  },
  "sortierung": "datum_desc|name_asc|bestand_desc|ort_asc",
  "limit": 50,
  "zusammenfassung": "Kurze deutsche Erklärung was angezeigt wird (1 Satz)",
  "empfehlung": "Optional: Handlungsempfehlung für den Winzer (1-2 Sätze)"
}

Wichtige Hinweise:
- "Rieden", "Weingärten", "meine Rieden", "alle Rieden" → tabelle: "weingarten"
- "Grundstücke", "GST", "Parzellen" → tabelle: "grundstuecke"
- "Lagerbewegungen", "was wurde verkauft", "Verkaufshistorie" → tabelle: "lagerbewegungen"
- "Weinausbau", "Chargen", "Ausbau" → tabelle: "weinausbau"
- Bei Weinnamen wie "Querfeldein Weiß" → name_contains: "Querfeldein"
- "2025" nach einem Weinnamen ist meist ein jahrgang-Filter, KEIN datum-Filter
- Jahrgänge sind immer Zahlen (2025), keine Datum-Strings
- Wenn "alle" gefragt werden: kein aktiv-Filter setzen (es sei denn Nutzer fragt explizit nach aktiven)
`

async function getTenantId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient()
  const { data } = await (supabase.from('tenant_memberships') as any)
    .select('tenant_id').limit(1).single()
  return (data as R | null)?.tenant_id ?? null
}

async function executeQuery(supabase: any, params: R): Promise<R[]> {
  const { tabelle, filter = {}, sortierung = 'datum_desc', limit = 20 } = params

  // ── SPEZIALFALL: Lagerbewegungen ───────────────────────────────────────────
  if (tabelle === 'lagerbewegungen') {
    // 1) Passende Füllung(en) finden
    let fuellungQ = (supabase.from('fuellungen') as any).select('id, name, jahrgang, rebsorte')
    if (filter.name_contains) fuellungQ = fuellungQ.ilike('name', `%${filter.name_contains}%`)
    if (filter.jahrgang) fuellungQ = fuellungQ.eq('jahrgang', filter.jahrgang)
    const { data: fuellungen } = await fuellungQ.limit(10)
    if (!fuellungen || fuellungen.length === 0) return []

    const fuellungIds = (fuellungen as R[]).map(f => f.id)
    const fuellungMap: Record<string, string> = {}
    for (const f of fuellungen as R[]) fuellungMap[f.id] = `${f.name}${f.jahrgang ? ` ${f.jahrgang}` : ''}`

    // 2) Verkaufspositionen für diese Füllungen holen
    let posQ = (supabase.from('verkauf_positionen') as any)
      .select('id, menge, einheit, preis_brutto, rabatt_pct, sonderrabatt_pct, fuellung_id, erstellt_am, verkaufsposten:verkaufsposten_id(id, datum, rechnungsnummer, storniert, bezahlt, kontakt:kontakte!kontakt_id(vorname, nachname), firma:firmen(name))')
      .in('fuellung_id', fuellungIds)
    if (filter.datum_von) posQ = posQ.gte('erstellt_am', filter.datum_von)
    if (filter.datum_bis) posQ = posQ.lte('erstellt_am', filter.datum_bis)
    posQ = posQ.order('erstellt_am', { ascending: false }).limit(Number(limit) || 30)

    const { data: positionen } = await posQ
    if (!positionen) return []

    return (positionen as R[]).map(pos => {
      const vp = pos.verkaufsposten as R | null
      const nettoPreis = (Number(pos.preis_brutto) || 0)
        * (1 - (Number(pos.rabatt_pct) || 0) / 100)
        * (1 - (Number(pos.sonderrabatt_pct) || 0) / 100)
      const kunde = vp?.kontakt
        ? [vp.kontakt.vorname, vp.kontakt.nachname].filter(Boolean).join(' ')
        : vp?.firma?.name ?? '–'
      return {
        datum:           vp?.datum ?? null,
        rechnungsnummer: vp?.rechnungsnummer ?? '–',
        wein:            fuellungMap[pos.fuellung_id] ?? '–',
        kunde,
        menge:           Number(pos.menge) || 0,
        einheit:         pos.einheit ?? 'Fl.',
        preis_netto:     nettoPreis,
        umsatz:          nettoPreis * (Number(pos.menge) || 0),
        storniert:       vp?.storniert ?? false,
        bezahlt:         vp?.bezahlt ?? false,
      }
    })
  }

  // ── Standard-Tabellen ─────────────────────────────────────────────────────
  const selectMap: Record<string, string> = {
    weingarten:        'name, ried, rebsorte, weinart, flaeche_ha, bewirtschaftung, aktiv',
    grundstuecke:      'gst_nr, katastralgemeinde, rebsorte, flaeche_ha, flaeche_ha_kataster, status, spritzbar, weingarten:weingarten_id(name)',
    kontakte:          'kundennummer, segment, vorname, nachname, email, telefon, telefon_vorwahl, mobil, mobil_vorwahl, plz, ort, strasse, land, stammkunde, is_lead, notizen, firma:firma_id(name)',
    firmen:            'kundennummer, segment, name, email, telefon, plz, ort, strasse, land, uid_nummer, zahlungsziel_tage, is_lead, notizen',
    verkaufsposten:    'datum, rechnungsnummer, bezahlt, storniert, kontakt:kontakte!kontakt_id(vorname, nachname), firma:firmen(name)',
    fuellungen:        'name, jahrgang, rebsorte, flaschengroesse_ml, bestand_flaschen, vk_preis_brutto, einstandspreis',
    weinausbau:        'name, jahrgang, rebsorte, menge_liter, qualitaetsstufe, status',
    behandlungen:      'datum, art, menge_gesamt, menge_einheit, psm:psm_id(name), weingarten:weingarten_id(name)',
    pipeline_eintraege:'titel, stufe, kategorie, erledigt, erwartetes_datum, kontakt:kontakte!kontakt_id(vorname, nachname), firma:firmen(name)',
  }
  let query = supabase.from(tabelle).select(selectMap[tabelle] ?? '*')

  // Filter anwenden
  if (filter.segment)   query = query.eq('segment', filter.segment)
  if (filter.ort_contains) query = query.ilike('ort', `%${filter.ort_contains}%`)
  if (filter.plz_prefix) query = query.like('plz', `${filter.plz_prefix}%`)
  if (filter.is_lead !== undefined) query = query.eq('is_lead', filter.is_lead)
  if (filter.stammkunde !== undefined) query = query.eq('stammkunde', filter.stammkunde)
  if (filter.bezahlt !== undefined) query = query.eq('bezahlt', filter.bezahlt)
  if (filter.storniert !== undefined) query = query.eq('storniert', filter.storniert)
  if (filter.erledigt !== undefined) query = query.eq('erledigt', filter.erledigt)
  if (filter.aktiv !== undefined) query = query.eq('aktiv', filter.aktiv)
  if (filter.datum_von) query = query.gte('datum', filter.datum_von)
  if (filter.datum_bis) query = query.lte('datum', filter.datum_bis)
  if (filter.bestand_min !== undefined) query = query.gte('bestand_flaschen', filter.bestand_min)
  if (filter.qualitaetsstufe) query = query.eq('qualitaetsstufe', filter.qualitaetsstufe)
  if (filter.land) query = query.eq('land', filter.land)
  if (filter.jahrgang) query = query.eq('jahrgang', filter.jahrgang)
  if (filter.weinart) query = query.eq('weinart', filter.weinart)
  if (filter.bewirtschaftung) query = query.eq('bewirtschaftung', filter.bewirtschaftung)
  if (filter.status) query = query.eq('status', filter.status)

  // name_contains: table-aware
  if (filter.name_contains) {
    const nameOnly = ['fuellungen', 'weinausbau', 'firmen', 'weingarten']
    if (tabelle === 'weingarten') {
      query = query.or(`name.ilike.%${filter.name_contains}%,ried.ilike.%${filter.name_contains}%`)
    } else if (tabelle === 'grundstuecke') {
      query = query.ilike('gst_nr', `%${filter.name_contains}%`)
    } else if (nameOnly.includes(tabelle)) {
      query = query.ilike('name', `%${filter.name_contains}%`)
    } else {
      query = query.or(`nachname.ilike.%${filter.name_contains}%,vorname.ilike.%${filter.name_contains}%,name.ilike.%${filter.name_contains}%`)
    }
  }

  // Sortierung
  const [sortCol, sortDir] = sortierung.split('_')
  const sortColumn = sortCol === 'datum' ? 'datum'
    : sortCol === 'name' ? (['firmen', 'fuellungen', 'weinausbau', 'weingarten'].includes(tabelle) ? 'name' : 'nachname')
    : sortCol === 'bestand' ? 'bestand_flaschen'
    : sortCol === 'ort' ? 'ort'
    : 'id'
  query = query.order(sortColumn, { ascending: sortDir !== 'desc' }).limit(Number(limit) || 20)

  const { data } = await query
  return (data ?? []) as R[]
}

export async function POST(req: NextRequest) {
  try {
    const { frage: frageRaw } = await req.json()
    if (!frageRaw?.trim()) return NextResponse.json({ fehler: 'Keine Frage angegeben' }, { status: 400 })
    const frage = String(frageRaw).slice(0, 500).replace(/[`\\]/g, '')

    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb gefunden' }, { status: 401 })

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ fehler: 'ANTHROPIC_API_KEY nicht gesetzt – bitte in Vercel Environment Variables eintragen.' }, { status: 500 })
    }

    const { data: limitCheck } = await (supabase.rpc as any)('check_und_increment_ki_abfrage', {
      p_tenant_id: tenantId,
    })
    const check = limitCheck as R | null
    if (check && check.erlaubt === false) {
      return NextResponse.json({
        fehler: `Abfrage-Limit erreicht (${check.verbraucht}/${check.limit} im Paket ${check.paket}). Bitte upgraden.`,
        limit_erreicht: true,
      }, { status: 429 })
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: `${SCHEMA_CONTEXT}\n\nFrage des Winzers: "${frage}"` }],
    })

    await (supabase.rpc as any)('increment_ki_tokens', {
      p_tenant_id:     tenantId,
      p_input_tokens:  msg.usage.input_tokens,
      p_output_tokens: msg.usage.output_tokens,
    })

    const rawText = (msg.content[0] as any).text as string
    let queryParams: R
    try {
      const match = rawText.match(/\{[\s\S]*\}/)
      queryParams = JSON.parse(match?.[0] ?? rawText)
    } catch {
      return NextResponse.json({ fehler: 'KI-Antwort konnte nicht verarbeitet werden', roh: rawText }, { status: 500 })
    }

    const rohdaten = await executeQuery(supabase, queryParams)

    // Telefonnummer + Vorwahl kombinieren
    const ergebnisse = rohdaten.map((row: R) => {
      const r = { ...row }
      if ('telefon' in r && 'telefon_vorwahl' in r) {
        r.telefon = r.telefon ? `${r.telefon_vorwahl ?? '+43'} ${r.telefon}`.trim() : null
        delete r.telefon_vorwahl
      }
      if ('mobil' in r && 'mobil_vorwahl' in r) {
        r.mobil = r.mobil ? `${r.mobil_vorwahl ?? '+43'} ${r.mobil}`.trim() : null
        delete r.mobil_vorwahl
      }
      return r
    })

    return NextResponse.json({
      ergebnisse,
      anzahl: ergebnisse.length,
      zusammenfassung: queryParams.zusammenfassung ?? null,
      empfehlung: queryParams.empfehlung ?? null,
      tabelle: queryParams.tabelle,
      verbraucht: check?.verbraucht ?? 1,
    })
  } catch (err) {
    console.error('ki-abfrage error:', err)
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
