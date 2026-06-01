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

kontakte: id, kundennummer, vorname, nachname, segment (privat|gastro|handel|export|grosshandel), email, telefon, mobil, strasse, plz, ort, land, stammkunde(bool), is_lead(bool), sonderrabatt_pct, notizen
firmen: id, kundennummer, name, segment, email, telefon, strasse, plz, ort, land, uid_nummer, zahlungsziel_tage, is_lead(bool), sonderrabatt_pct, notizen
aktivitaeten: id, art(anruf|email|besuch|notiz|angebot|verkostung|messe), betreff, datum, erledigt(bool), kontakt_id, firma_id
pipeline_eintraege: id, titel, stufe(neukontakt|interessent|angebot|verhandlung|abschluss|stammkunde|verloren|pause), kategorie, erledigt(bool), erwartetes_datum
verkaufsposten: id, datum, rechnungsnummer, bezahlt(bool), storniert(bool), kontakt_id, firma_id
fuellungen: id, name, jahrgang, rebsorte, flaschengroesse_ml, bestand_flaschen, vk_preis_brutto
weinausbau: id, name, jahrgang, rebsorte, menge_liter, qualitaetsstufe, status, aktiv(bool)
behandlungen: id, datum, art, menge_gesamt, menge_einheit, psm_id, weingarten_id

Deine Aufgabe: Analysiere die Frage des Winzers und gib eine STRUKTURIERTE ANTWORT als JSON zurück.
Antworte NUR mit validem JSON, keine Erklärungen außerhalb des JSON.

JSON-Format:
{
  "tabelle": "kontakte|firmen|verkaufsposten|fuellungen|weinausbau|behandlungen|pipeline_eintraege",
  "filter": {
    "segment": "gastro|handel|privat|export|grosshandel (optional)",
    "ort_contains": "Stadtname (optional)",
    "plz_prefix": "12 (optional, Anfang der PLZ)",
    "land": "DE|AT|CH|IT (optional, ISO-Ländercode, z.B. DE für Deutschland, AT für Österreich)",
    "name_contains": "Müller (optional, Suche in Vor- und Nachname/Firmenname)",
    "is_lead": true|false (optional),
    "stammkunde": true|false (optional),
    "bezahlt": true|false (optional, nur verkaufsposten)",
    "storniert": true|false (optional)",
    "erledigt": true|false (optional)",
    "aktiv": true|false (optional)",
    "datum_von": "YYYY-MM-DD (optional)",
    "datum_bis": "YYYY-MM-DD (optional)",
    "bestand_min": 1 (optional, nur fuellungen)",
    "qualitaetsstufe": "spaetlese|auslese|qualitaetswein etc. (optional)"
  },
  "sortierung": "datum_desc|name_asc|bestand_desc|ort_asc",
  "limit": 20,
  "zusammenfassung": "Kurze deutsche Erklärung was angezeigt wird (1 Satz)",
  "empfehlung": "Optional: Handlungsempfehlung für den Winzer (1-2 Sätze)"
}
`

async function getTenantId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient()
  const { data } = await (supabase.from('tenant_memberships') as any)
    .select('tenant_id').limit(1).single()
  return (data as R | null)?.tenant_id ?? null
}

async function executeQuery(supabase: any, params: R): Promise<R[]> {
  const { tabelle, filter = {}, sortierung = 'datum_desc', limit = 20 } = params

  // Tabellen-spezifische Selects mit Joins
  const selectMap: Record<string, string> = {
    kontakte:          'kundennummer, vorname, nachname, email, telefon, telefon_vorwahl, mobil, mobil_vorwahl, plz, ort, land, segment, strasse, stammkunde, is_lead, notizen, firma:firma_id(name)',
    firmen:            'kundennummer, name, segment, email, telefon, strasse, plz, ort, land, uid_nummer, zahlungsziel_tage, is_lead, notizen',
    verkaufsposten:    'datum, rechnungsnummer, bezahlt, storniert, kontakt:kontakte(vorname, nachname), firma:firmen(name)',
    fuellungen:        'name, jahrgang, rebsorte, flaschengroesse_ml, bestand_flaschen, vk_preis_brutto',
    weinausbau:        'name, jahrgang, rebsorte, menge_liter, qualitaetsstufe, status',
    behandlungen:      'datum, art, menge_gesamt, menge_einheit, psm:psm_id(name), weingarten:weingarten_id(name)',
    pipeline_eintraege:'titel, stufe, kategorie, erledigt, erwartetes_datum, kontakt:kontakte(vorname, nachname), firma:firmen(name)',
  }
  let query = supabase.from(tabelle).select(selectMap[tabelle] ?? '*')

  // Filter anwenden
  if (filter.segment) query = query.eq('segment', filter.segment)
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
  if (filter.name_contains) query = query.or(`nachname.ilike.%${filter.name_contains}%,vorname.ilike.%${filter.name_contains}%,name.ilike.%${filter.name_contains}%`)

  // Sortierung
  const [sortCol, sortDir] = sortierung.split('_')
  const sortColumn = sortCol === 'datum' ? 'datum'
    : sortCol === 'name' ? (tabelle === 'firmen' ? 'name' : 'nachname')
    : sortCol === 'bestand' ? 'bestand_flaschen'
    : sortCol === 'ort' ? 'ort'
    : 'id'
  query = query.order(sortColumn, { ascending: sortDir !== 'desc' }).limit(Number(limit) || 20)

  const { data } = await query
  return (data ?? []) as R[]
}

export async function POST(req: NextRequest) {
  try {
    const { frage } = await req.json()
    if (!frage?.trim()) return NextResponse.json({ fehler: 'Keine Frage angegeben' }, { status: 400 })

    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb gefunden' }, { status: 401 })

    // API-Key prüfen
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ fehler: 'ANTHROPIC_API_KEY nicht gesetzt – bitte in Vercel Environment Variables eintragen.' }, { status: 500 })
    }

    // Limit prüfen
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

    // Claude Haiku aufrufen
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: `${SCHEMA_CONTEXT}\n\nFrage des Winzers: "${frage}"` }],
    })

    const rawText = (msg.content[0] as any).text as string
    let queryParams: R
    try {
      // JSON aus Antwort extrahieren (manchmal kommt es in ```json ... ```)
      const match = rawText.match(/\{[\s\S]*\}/)
      queryParams = JSON.parse(match?.[0] ?? rawText)
    } catch {
      return NextResponse.json({ fehler: 'KI-Antwort konnte nicht verarbeitet werden', roh: rawText }, { status: 500 })
    }

    // Abfrage ausführen
    const rohdaten = await executeQuery(supabase, queryParams)

    // Telefonnummer + Vorwahl kombinieren (nur wenn Nummer vorhanden)
    const ergebnisse = rohdaten.map((row: R) => {
      const r = { ...row }
      if ('telefon' in r) {
        r.telefon = r.telefon ? `${r.telefon_vorwahl ?? '+43'} ${r.telefon}`.trim() : null
        delete r.telefon_vorwahl
      }
      if ('mobil' in r) {
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
