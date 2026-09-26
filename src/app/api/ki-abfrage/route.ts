import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getCurrentMembership, canSeeAuswertungen } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'
import { sperrAntwortKoerper } from '@/lib/abo/regeln'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// "Frag dein Weingut" – Claude schreibt eine echte (rein lesende) SQL-Abfrage statt aus
// einer festen Tabellen-/Filter-Vorlage zu wählen. Damit werden Verknüpfungen (JOINs) und
// Summenbildung (SUM/COUNT/GROUP BY) möglich, siehe Klärung 7.8.2026 ("KI auf alle Tabellen
// und Inhalte loslassen"). Ausführung + Sicherheitsdesign: ki_readonly_query, seit KAN-52
// (24.09.2026) gehärtet – SECURITY DEFINER der Rolle ki_abfrage (kein BYPASSRLS, erbt
// authenticated → RLS greift wie beim Benutzer, Rollenwechsel unmöglich), Prüfung des
// geparsten Abfragebaums gegen eine Tabellen- und Funktions-Allowlist, Schreibschutz
// während der Ausführung, Nachkontrolle von role/JWT-Claims. Die Funktion bekommt den
// aktiv gewählten Betrieb (p_tenant_id) mit und setzt app.active_tenant_id, was
// get_user_tenant_ids() (und damit jede darauf aufbauende RLS-Policy) auf genau diesen
// einen Mandanten einschränkt.

// ── Erlaubnisliste: nur diese Tabellen werden der KI im Prompt bekannt gemacht ────────────
// Muss eine Teilmenge von ki_erlaubte_tabellen() (Datenbank) sein: ki_schema_info liefert
// nur für diese Tabellen Spalten, und ki_readonly_query lehnt jede Abfrage auf eine andere
// Tabelle ab (z. B. tenants, tenant_memberships, user_email_connections,
// bestandsprotokoll), auch wenn die KI diese Liste ignoriert.
const ERLAUBTE_TABELLEN = [
  // Rieden / Weingärten
  'weingarten', 'grundstuecke', 'rebsorten', 'weingarten_rebsorten', 'lagen', 'weinbaugebiete_custom',
  // Behandlungen / Pflanzenschutz / Düngung
  'behandlungen', 'behandlung_grundstuecke', 'saetze_massnahmen', 'pflanzenschutzmittel',
  'duengemittel', 'duengemittel_lager_bewegungen', 'psm_lager_bewegungen',
  // Ernte / Jahrgänge
  'ernte_parzellen', 'weinjahrgaenge', 'ama_erntemeldungen', 'ama_meldepositionen',
  // Kellerbuch / Weinausbau
  'weinausbau', 'weinausbau_weingaerten', 'pressungen', 'pressung_behaelter', 'pressung_weingaerten',
  'keller_umzuege', 'keller_behandlungen', 'keller_behandlungstypen', 'weinanalysen',
  'verschneidungen', 'verschneidung_quellen', 'behaelter', 'kellerplaene', 'kellerplan_positionen',
  'dac_antrag', 'pruefnummernantraege', 'transportbescheinigungen',
  // Füllungen / Lager
  'fuellungen', 'fuellung_chargen', 'fuellung_bewegungen',
  // CRM
  'kontakte', 'firmen', 'kontakt_firmen', 'kontakt_praeferenzen', 'aktivitaeten',
  'aktivitaet_dokumente', 'pipeline_eintraege', 'pipeline_verlauf', 'rabattgruppen',
  // Verkauf
  'verkaufsposten', 'verkauf_positionen', 'sonstige_artikel',
  'bestellungen', 'bestellung_positionen',
  // Einkauf
  'zukauf_posten', 'traubenverkauf',
  // Export
  'exportauftraege', 'exportauftrag_positionen', 'export_dokumente',
  // Controlling
  'kostenstellen', 'kostenarten', 'kosteneintraege', 'kosteneintrag_behaelter', 'kosteneintrag_weingaerten',
  // Buchhaltung
  'ea_transaktionen', 'ea_kategorien', 'ea_dauerauftraege', 'ea_uva',
  'zahlungen',
  // Sonstiges
  'zeiterfassung', 'release_notes',
]

const TABELLEN_KONTEXT = `
- weingarten / grundstuecke: Rieden (weingarten) und einzelne Grundstücke (GST, grundstuecke.weingarten_id → weingarten.id) mit Rebsorte, Fläche, Bewirtschaftungsart.
- behandlungen ↔ behandlung_grundstuecke (Junction, m:n) ↔ grundstuecke: Pflanzenschutz-/Düngemaßnahmen. Kupfer-Bilanzen über den Cu-Gehalt (Regel „Reinkupfer“ unten).
  ARTEN (behandlungen.art, KAN-143): 'spritzung' (Spritzung), 'duengung' (Düngung), 'bodenbearbeitung'
  (Bodenbearbeitung), 'schnitt' (Schnitt), 'laubarbeit' (Laubarbeit, Unterart in laubarbeit_art), 'laubschneiden'
  (Laubschneiden = maschinelles Laubschneiden an Seiten und Gipfel, ohne laubarbeit_art), 'lese' (Lese),
  'sonstiges' (Sonstiges). Die Art 'laubschneiden' gibt es erst seit 26.09.2026 – bei Einträgen mit created_at
  vor dem 26.09.2026 (erfasst vor der Unterscheidung; maßgeblich ist created_at, nicht datum – nachgetragene
  Maßnahmen mit älterem datum sind eindeutig) kann auch eine 'laubarbeit' maschinelles Laubschneiden bzw.
  Gipfeln sein.
  UNTERARTEN (behandlungen.laubarbeit_art, nur bei art='laubarbeit'): 'entblaettern' (Entblättern), 'ausgeizen'
  (Ausgeizen), 'gipfeln' (Gipfeln; bei created_at ab 26.09.2026 Gipfeln von Hand, davor offen), 'heften'
  (Heften), 'sonstige' (Sonstige). Ältere Einträge enthalten Freitext (z.B. 'Heften / Einstricken') – nach einer
  Unterart deshalb immer über einen Wortstamm ohne Umlaut suchen, der Code und Freitext trifft: laubarbeit_art
  ILIKE '%entbl%', '%geiz%', '%heft%' bzw. '%gipfel%'. In Antworten die Bezeichnung in Klammern (ohne den Zusatz
  nach einem Strichpunkt) zeigen, nicht den Rohwert. Fragt der User allgemein nach Gipfeln bzw. Laubschnitt,
  beide Arten berücksichtigen (laubschneiden sowie laubarbeit mit laubarbeit_art ILIKE '%gipfel%') und getrennt
  ausweisen. saetze_massnahmen.art (Hektarsätze je Art für den Kosten-Vorschlag): dieselben Werte ohne 'lese'.
  MENGEN IN behandlungen – die Bedeutung hängt von art ab (KAN-133):
  art='spritzung': menge_gesamt ist die gesamte SPRITZBRÜHE in Liter (Mittel + Wasser), NIEMALS die Mittelmenge –
  auch nicht bei alten Einträgen mit menge_einheit kg oder g. Die MITTELMENGE (eingesetztes Pflanzenschutzmittel)
  kommt nur aus aufwandmenge und aufwandmenge_einheit: 'kg_ha' bzw. 'l_ha' → aufwandmenge * Fläche (kg bzw. l);
  'kg' bzw. 'l' → aufwandmenge (gesamt); 'g_hl' bzw. 'ml_hl' (Konzentration im Tank) → aufwandmenge * Spritzbrühe_l
  / 100 / 1000 (kg bzw. l), mit Spritzbrühe_l = menge_gesamt (menge_einheit 'l'; bei 'ml' / 1000), sonst
  wasseraufwand_l_ha * Fläche. Fläche = SUM(behandlung_grundstuecke.flaeche_ha) der Maßnahme. Ohne aufwandmenge
  ist die Mittelmenge unbekannt (NULL) – dann NICHT menge_gesamt und NICHT konzentration verwenden.
  art='duengung': menge_gesamt ist die Düngermenge in kg (bzw. l, wenn duengemittel.einheit = 'l'); fehlt sie,
  aufwandmenge * Fläche bei 'kg_ha' bzw. aufwandmenge bei 'kg' ('l_ha' bzw. 'l' nur bei duengemittel.einheit = 'l').
  Reinkupfer (kg) = Mittelmenge * Cu-Gehalt / 100 (Mittel in l wie die Cu-Bilanz mit 1 kg/l). Cu-Gehalt wie die
  Cu-Bilanz: pflanzenschutzmittel.cu_gehalt_pct, wenn > 0; sonst wirkstoffgehalt_pct, wenn wirkstoff ILIKE '%kupfer%'
  (Näherung); sonst kein Kupfermittel. In SQL: COALESCE(NULLIF(cu_gehalt_pct, 0), CASE WHEN wirkstoff ILIKE
  '%kupfer%' THEN NULLIF(wirkstoffgehalt_pct, 0) END).
  Die Spritzbrühe NIE über mehrere Maßnahmen summieren: eine Tankmischung steht als mehrere Maßnahmen (je Mittel
  eine) mit derselben Brühe. Summen über Maßnahmen nur für die Mittelmenge, getrennt je Mittel und Einheit (kg und
  l nie addieren). Beim JOIN auf behandlung_grundstuecke wiederholt sich jede Maßnahme je Grundstück – die Fläche
  daher zuerst je behandlung_id summieren (Unterabfrage/CTE), Werte der Maßnahme nicht über die Join-Zeilen summieren.
- ernte_parzellen: Lesedaten je Grundstück und Jahrgang (jahrgang_id → weinjahrgaenge.id), menge_kg, oechsle, klosterneuburger (°KMW).
- weinausbau: Kellerbuch-Chargen (der "Keller-Bestand"). DREI VERSCHIEDENE, oft unterschiedliche Textfelder –
  name = frei vergebener Produkt-/Chargenname (z.B. "Partywein Kängaru", oft eine Fantasiebezeichnung, KEINE
  verlässliche Sortenangabe); rebsorte = die tatsächliche Rebsorte ODER bei Verschnitten der Verschnitt-Typ
  selbst (z.B. "Zierfandler", aber auch "Sortenverschnitt", "Cuvée" stehen HIER, nicht in name!);
  qualitaetsstufe = Prädikat (z.B. "Spätlese"). jahrgang, menge_liter = aktueller Bestand in Liter, status
  (ernte|gaerung|ausbau|abfuellung|abgeschlossen – abgeschlossen bedeutet IMMER menge_liter=0), behaelter_id
  → behaelter.name.
- keller_umzuege: Umzüge/Schwundbuchungen zwischen Behältern, von_weinausbau_id/nach_weinausbau_id.
- weinanalysen: Laboranalysen je Charge (weinausbau_id), alkohol_vol, restzucker_gl, gesamtsaeure_gl, ph_wert usw.
- verschneidungen ↔ verschneidung_quellen: Blends – ziel_weinausbau_id ist die entstandene Charge, verschneidung_quellen.quell_weinausbau_id die Ausgangschargen.
- fuellungen: abgefüllte, verkaufsfertige Weine (Flaschen-Lager). Wie bei weinausbau DREI VERSCHIEDENE
  Textfelder, NICHT verwechseln – name = Produkt-/Handelsname (z.B. "Partywein Kängaru"); rebsorte = die
  Rebsorte ODER bei Verschnitten der Verschnitt-Typ (z.B. "Zierfandler", "Sortenverschnitt", "Cuvée Rot" –
  wenn der User eine Sorte, einen Verschnitt- oder Cuvée-Namen nennt, ist das FAST IMMER dieses Feld, NICHT
  bezeichnung!); bezeichnung = zusätzliches Prädikat/Zusatzbezeichnung (z.B. "Reserve"), ist bei sehr vielen
  Weinen leer/NULL. bestand_flaschen = aktueller Lagerbestand, flaschengroesse_ml, vk_preis_brutto,
  einstandspreis. fuellung_chargen verknüpft eine Füllung mit ihrer/ihren Ursprungs-Charge(n) aus weinausbau.
- fuellung_bewegungen: Flaschenbewegungen je Füllung (fuellung_id → fuellungen.id) AUSSERHALB von Verkauf/Storno,
  art (inventur|bruch|eigenverbrauch|schwund|korrektur|anfangsbestand), datum, menge_stk = Veränderung in Stück
  (Abgänge wie Bruch/Eigenverbrauch/Schwund negativ), bestand_vorher/bestand_nachher, grund. Verkaufte Flaschen
  stehen NICHT hier, sondern in verkauf_positionen.
- kontakte / firmen: Kunden (auch is_lead=true für Leads), segment (privat|gastro|handel|export|grosshandel), stammkunde, plz/ort/land.
- verkaufsposten (Rechnungskopf) ↔ verkauf_positionen (Zeilen): datum, kontakt_id/firma_id, bezahlt, storniert. verkauf_positionen.typ (flasche|tank|sonstiges|trauben), fuellung_id/weinausbau_id/zukauf_id verknüpfen zur verkauften Sache, menge, preis_brutto, rabatt_pct, sonderrabatt_pct (Netto-Betrag = preis_brutto*menge*(1-rabatt_pct/100)*(1-sonderrabatt_pct/100)).
  WICHTIG bei typ='flasche': menge ist die ANZAHL FLASCHEN (Stück, einheit='Stk'), NICHT Liter! Um die
  verkaufte Menge in LITER zu berechnen, IMMER über fuellung_id mit fuellungen verknüpfen und
  "menge * f.flaschengroesse_ml / 1000.0" rechnen (flaschengroesse_ml ist die Flaschengröße in ml je
  Flasche, z.B. 750 – NICHT einfach menge summieren und als Liter ausgeben, das ergibt eine falsche Zahl,
  da 11 verkaufte Flaschen à 0,75L z.B. 8,25L sind, nicht 11L). Bei typ='tank' ist menge bereits in Liter
  (Direktverkauf aus einer Weinausbau-Charge, einheit='L').
- zukauf_posten: zugekaufte Trauben/Most/Wein von Lieferanten. traubenverkauf: verkaufte (nicht zugekaufte) Trauben.
- kosteneintraege ↔ kostenstellen/kostenarten, kosteneintrag_weingaerten/kosteneintrag_behaelter: Kostenrechnung, Kosten auf Weingärten/Behälter aufgeteilt.
- ea_transaktionen ↔ ea_kategorien: einfache Einnahmen-Ausgaben-Rechnung.
- zahlungen: eingegangene Zahlungen (z.B. via SumUp), meist mit Bezug zu verkaufsposten.
`.trim()

let schemaCache: { text: string; stamp: number } | null = null
const SCHEMA_CACHE_MS = 10 * 60 * 1000 // 10 Minuten

async function ladeSchemaText(supabase: R): Promise<string> {
  if (schemaCache && Date.now() - schemaCache.stamp < SCHEMA_CACHE_MS) return schemaCache.text
  const { data, error } = await (supabase.rpc as any)('ki_schema_info', { p_tabellen: ERLAUBTE_TABELLEN })
  if (error || !data) return '(Spalten-Details aktuell nicht verfügbar – bitte anhand der Tabellennamen sinnvolle Standard-Spalten annehmen.)'
  const byTable: Record<string, string[]> = {}
  for (const row of data as R[]) {
    if (!byTable[row.tabelle]) byTable[row.tabelle] = []
    byTable[row.tabelle].push(`${row.spalte} (${row.typ})`)
  }
  const text = Object.entries(byTable).map(([t, cols]) => `${t}: ${cols.join(', ')}`).join('\n')
  schemaCache = { text, stamp: Date.now() }
  return text
}

function systemPrompt(schemaText: string): string {
  const heute = new Date()
  const heuteIso = heute.toISOString().slice(0, 10)
  return `Du bist ein SQL-Assistent für ein österreichisches Weinbau-ERP namens software:112 (PostgreSQL/Supabase).
Du hilfst dem Winzer, seine eigenen Betriebsdaten in natürlicher Sprache abzufragen, indem du EINE einzelne,
rein lesende SQL-Abfrage (SELECT, optional mit WITH/CTE) formulierst.

Heutiges Datum: ${heuteIso}. "Dieses Jahr"/"heuer" bezieht sich auf ${heute.getFullYear()}, "letztes Jahr" auf ${heute.getFullYear() - 1}.

ERLAUBTE TABELLEN UND SPALTEN (nur diese darfst du verwenden, alle automatisch nach Mandant gefiltert –
darum musst und darfst du dich NICHT selbst kümmern):
${schemaText}

FACHLICHER KONTEXT (Bedeutung/Verknüpfungen, die aus den Spaltennamen allein nicht ersichtlich sind):
${TABELLEN_KONTEXT}

REGELN für die SQL-Abfrage:
- NUR SELECT (ggf. mit WITH/CTE) – niemals INSERT/UPDATE/DELETE/DROP/ALTER/CREATE o.ä.
- NUR die oben gelisteten Tabellen und Spalten verwenden, keine anderen Tabellen erfinden oder raten.
- NUR Standardfunktionen verwenden: Aggregate (SUM, COUNT, AVG, MIN, MAX, STRING_AGG …), Fensterfunktionen,
  Datums- (DATE_TRUNC, EXTRACT, TO_CHAR, AGE …), Text- (LOWER, CONCAT, SPLIT_PART …), Mathe- (ROUND, ABS …),
  Array- und JSON-Funktionen sowie Typumwandlungen (::numeric, ::date). Keine System- oder
  Verwaltungsfunktionen (z.B. set_config, current_setting, pg_…), keine XML-Funktionen, keine Views.
- Wenn die Frage nach einer GESAMTMENGE/SUMME/ANZAHL fragt ("wie viel", "wie viele", "gesamt", "insgesamt"),
  schreibe eine Aggregat-Abfrage (SUM/COUNT/AVG) – gib NICHT nur die Einzelzeilen zurück, die der User dann
  selbst zusammenzählen müsste.
- Wenn die Frage nach einer LISTE fragt ("zeig mir", "welche", "liste"), gib die Einzelzeilen zurück
  (sinnvoll sortiert, LIMIT nicht nötig – das System begrenzt ohnehin auf maximal 500 Zeilen).
- Wenn die Frage BEIDES verlangt (z.B. "wie viel ... UND liste mir die Rechnungen/Positionen dazu"), gib die
  Einzelzeilen zurück (wie bei einer Liste) und ergänze zusätzlich eine Gesamtsumme als eigene Spalte mit einer
  Fenster-Funktion (z.B. "SUM(...) OVER () AS gesamt_liter", in der korrekten Einheit – siehe nächster Punkt)
  – NICHT versuchen, eine reine Aggregat-Zeile und eine Liste in zwei getrennten Antworten oder JSON-Objekten
  unterzubringen, es gibt immer nur EIN JSON-Objekt mit genau einer SQL-Abfrage. WICHTIG: Eine solche über
  eine Fenster-Funktion OHNE PARTITION BY gebildete, im GESAMTEN Ergebnis (über alle Zeilen hinweg) identische
  Gesamtsumme MUSS als Spalten-Alias mit "gesamt_" beginnen (z.B. "gesamt_liter", "gesamt_menge") – das UI
  erkennt diese Namenskonvention automatisch und zeigt sie einmalig als Zusammenfassung oberhalb der Liste an,
  statt sie verwirrenderweise in jeder Zeile zu wiederholen. Verwende den "gesamt_"-Alias-Präfix NUR für
  diesen Fall (ein einziger, für das ganze Ergebnis geltender Summenwert) – NICHT für GROUP-BY-Summen, die je
  Gruppe/Zeile unterschiedlich sind (z.B. Summe je Kunde, je Sorte, je Monat) – dafür normale Aliase wie
  "summe_liter" oder "menge_liter" verwenden, da diese Werte pro Zeile tatsächlich unterschiedlich und daher
  KEINE Gesamtsumme im Sinne dieser Konvention sind.
- Wenn nach einer Menge in LITER gefragt wird, aber die zugrundeliegende Spalte in einer anderen Einheit
  vorliegt (z.B. verkauf_positionen.menge bei typ='flasche' = Anzahl Flaschen, nicht Liter), IMMER korrekt in
  Liter umrechnen (siehe fachlicher Kontext oben, z.B. über fuellungen.flaschengroesse_ml) – niemals eine
  Stückzahl ungeprüft 1:1 als Literangabe ausgeben.
- Verwende sprechende Spalten-Aliase auf Deutsch (z.B. "AS anzahl_flaschen", "AS summe_liter") – diese werden
  dem User als Tabellenüberschriften angezeigt. Zum "gesamt_"-Präfix siehe eigene Regel oben.
- Bei Textsuche IMMER ILIKE mit %...% verwenden (Groß-/Kleinschreibung ignorieren), nie exaktes "=" bei
  Namen/Bezeichnungen.
- Wenn der User einen Sorten-, Verschnitt-/Cuvée- oder sonstigen Bezeichnungs-Begriff nennt (z.B. "Zierfandler",
  "Sortenverschnitt", "Reserve") und aus dem fachlichen Kontext oben NICHT eindeutig hervorgeht, in welcher
  einzelnen Spalte dieser Begriff steht, suche IMMER mit ILIKE über ALLE plausiblen Textspalten gleichzeitig,
  verbunden mit OR (z.B. "WHERE name ILIKE '%Reserve%' OR rebsorte ILIKE '%Reserve%' OR bezeichnung ILIKE
  '%Reserve%'") statt dich auf eine einzelne Spalte festzulegen – eine zu enge Spaltenwahl liefert sonst
  fälschlich "keine Ergebnisse", obwohl passende Daten in einer anderen Spalte stehen.
- "abgeschlossene" Weinausbau-Chargen haben immer menge_liter=0 – wenn nach aktuellem Kellerbestand
  gefragt wird, ist meist status <> 'abgeschlossen' UND menge_liter > 0 gemeint (aber nicht blind
  hinzufügen, wenn die Frage explizit auch abgeschlossene/historische Chargen einschließen will).
- VERLINKUNG DER ERGEBNISSE (Rückmeldung 18.9.2026: "wir müssen auf die Ergebnisse klicken können"): Bei
  jeder LISTEN-Abfrage, deren Zeilen Datensätze darstellen (Kunden, Firmen, Chargen, Füllungen, Verkäufe,
  Behälter, Rieden, Behandlungen, Zukäufe, Exportaufträge …), gib ZUSÄTZLICH zu den sichtbaren Spalten die
  Primärschlüssel dieser Datensätze als eigene Spalten zurück – mit dem Alias GENAU nach diesem Muster:
  firma_id, kontakt_id, weinausbau_id, fuellung_id, verkaufsposten_id, behaelter_id, weingarten_id,
  behandlung_id, zukauf_posten_id, exportauftrag_id, dac_antrag_id, lage_id, ama_erntemeldung_id,
  keller_umzug_id, kellerplan_id (immer <tabelle im Singular>_id, UUID-Wert, NIE nur "id").
  Die ID der HAUPT-Entität der Zeile (das, was der User aufgelistet haben will) steht dabei als ERSTE
  ID-Spalte; weitere verknüpfte IDs (z.B. die Firma eines Kontakts, die Charge einer Füllung) dürfen danach
  folgen. Das UI blendet alle *_id-Spalten aus und macht die Zeile anklickbar (Sprung in die Detailseite).
  Bei GROUP BY die ID mit in die Gruppierung aufnehmen (z.B. GROUP BY f.id, f.name), bei UNION von Kontakten
  und Firmen beide Spalten (kontakt_id, firma_id) führen und jeweils die nicht zutreffende NULL setzen.
  Bei reinen Summen-/Kennzahl-Abfragen ohne Einzeldatensätze keine ID-Spalten.
- Keine Kommentare (--) und kein Semikolon außer optional ganz am Ende.

Antworte IMMER mit GENAU EINEM validen JSON-Objekt, ohne Markdown-Codeblock (keine \`\`\`), ohne Text davor
oder danach, ohne mehrere JSON-Objekte hintereinander. Halte "zusammenfassung" und "empfehlung" kurz und
knapp, auch bei komplexeren Abfragen mit mehreren Aspekten:
{
  "sql": "SELECT ...",
  "zusammenfassung": "Kurze deutsche Erklärung was die Abfrage zeigt (1 Satz)",
  "empfehlung": "Optional: Handlungsempfehlung für den Winzer (1-2 Sätze), sonst weglassen"
}`
}

function extraheJson(rawText: string): R {
  const match = rawText.match(/\{[\s\S]*\}/)
  return JSON.parse(match?.[0] ?? rawText)
}

export async function POST(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  try {
    const { frage: frageRaw } = await req.json()
    if (!frageRaw?.trim()) return NextResponse.json({ fehler: 'Keine Frage angegeben' }, { status: 400 })
    const frage = String(frageRaw).slice(0, 500).replace(/[`\\]/g, '')

    const supabase = await createSupabaseServerClient()
    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb gefunden' }, { status: 401 })
    const gesperrt = await schreibSperreKonflikt(membership, 'ki')   // KAN-5: Nur-Lesen-Modus – KI gesperrt (Kosten)
    if (gesperrt) return gesperrt
    if (!canSeeAuswertungen(membership)) return NextResponse.json({ fehler: 'Keine Berechtigung für Frag dein Weingut' }, { status: 403 })

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ fehler: 'ANTHROPIC_API_KEY nicht gesetzt – bitte in Vercel Environment Variables eintragen.' }, { status: 500 })
    }

    const { data: limitCheck, error: limitFehler } = await (supabase.rpc as any)('check_und_increment_ki_abfrage', {
      p_tenant_id: tenantId,
    })
    // KAN-5: Fehler NICHT überspringen (fail-closed) – sonst liefe die Anthropic-Abfrage ungezählt
    // weiter, etwa wenn die Datenbank das Abo sperrt (HINT 'abo_gesperrt') oder die Zählung scheitert
    if (limitFehler) {
      if ((limitFehler as R).hint === 'abo_gesperrt') {
        return NextResponse.json(sperrAntwortKoerper('ki'), { status: 403, headers: { 'Cache-Control': 'no-store', 'X-S112-Nur-Lesen': '1' } })
      }
      console.error('ki-abfrage: KI-Kontingent nicht prüfbar:', (limitFehler as R).message)
      return NextResponse.json({ fehler: 'Das KI-Kontingent konnte nicht geprüft werden – bitte später erneut versuchen.' }, { status: 503 })
    }
    const check = limitCheck as R | null
    if (check && check.erlaubt === false) {
      return NextResponse.json({
        fehler: `Abfrage-Limit erreicht (${check.verbraucht}/${check.limit} im Paket ${check.paket}). Bitte upgraden.`,
        limit_erreicht: true,
      }, { status: 429 })
    }

    const schemaText = await ladeSchemaText(supabase)
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const model = process.env.KI_ABFRAGE_MODEL || 'claude-sonnet-4-5-20250929'

    let inputTokens = 0, outputTokens = 0
    let queryParams: R | null = null
    let rohdaten: R[] | null = null
    let letzterFehler: string | null = null

    // Bis zu 2 Versuche: 1. Versuch generiert die SQL. Sowohl bei einem Ausführungsfehler
    // (z.B. Tippfehler in einem Spaltennamen) als auch bei einer nicht als JSON verwertbaren
    // Antwort (z.B. bei komplexeren/zusammengesetzten Fragen durch ein abgeschnittenes oder
    // unsauber formatiertes Antwortende) bekommt Claude eine Rückmeldung und darf die Abfrage
    // EINMAL korrigieren, bevor wir aufgeben.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messages: any[] = [{ role: 'user', content: `Frage des Winzers: "${frage}"` }]
    for (let versuch = 0; versuch < 2; versuch++) {
      const msg = await client.messages.create({
        model,
        max_tokens: 1200,
        system: systemPrompt(schemaText),
        messages,
      })
      inputTokens += msg.usage.input_tokens
      outputTokens += msg.usage.output_tokens

      const rawText = (msg.content[0] as R).text as string
      try {
        queryParams = extraheJson(rawText)
      } catch {
        queryParams = null
        letzterFehler = 'KI-Antwort konnte nicht als JSON verarbeitet werden'
        if (versuch === 0) {
          messages.push({ role: 'assistant', content: rawText })
          messages.push({
            role: 'user',
            content: 'Deine letzte Antwort war kein gültiges, vollständiges JSON-Objekt. Antworte erneut mit GENAU EINEM validen JSON-Objekt im vorgegebenen Format, ohne Text davor/danach und ohne Markdown-Codeblock. Halte "zusammenfassung" und "empfehlung" kurz.',
          })
        }
        continue
      }
      if (!queryParams?.sql) {
        letzterFehler = 'KI hat keine SQL-Abfrage geliefert'
        break
      }

      // p_tenant_id wird server-seitig gesetzt (app.active_tenant_id, siehe Migration 161)
      // und schränkt get_user_tenant_ids() für die Dauer dieser einen Abfrage auf den aktiv
      // gewählten Betrieb ein - sonst würde RLS (die einzige Schranke für dieses frei generierte
      // SQL) bei Mehrfach-Mitgliedschaft Daten ALLER Mandanten des Users zurückgeben.
      const { data: rows, error: sqlError } = await (supabase.rpc as any)('ki_readonly_query', { p_sql: queryParams.sql, p_tenant_id: tenantId })
      if (!sqlError) {
        rohdaten = (rows ?? []) as R[]
        letzterFehler = null
        break
      }
      letzterFehler = sqlError.message ?? String(sqlError)
      if (versuch === 0) {
        messages.push({ role: 'assistant', content: rawText })
        messages.push({
          role: 'user',
          content: `Diese SQL-Abfrage hat folgenden Fehler ausgelöst: "${letzterFehler}". Bitte korrigiere die Abfrage und antworte erneut nur mit dem JSON-Objekt.`,
        })
      }
    }

    await (supabase.rpc as any)('increment_ki_tokens', {
      p_tenant_id:     tenantId,
      p_input_tokens:  inputTokens,
      p_output_tokens: outputTokens,
    })

    if (letzterFehler || !queryParams || rohdaten === null) {
      return NextResponse.json({
        fehler: letzterFehler ?? 'Abfrage konnte nicht ausgeführt werden',
        sql: queryParams?.sql ?? null,
      }, { status: 500 })
    }

    return NextResponse.json({
      ergebnisse: rohdaten,
      anzahl: rohdaten.length,
      zusammenfassung: queryParams.zusammenfassung ?? null,
      empfehlung: queryParams.empfehlung ?? null,
      sql: queryParams.sql,
      verbraucht: check?.verbraucht ?? 1,
    })
  } catch (err) {
    console.error('ki-abfrage error:', err)
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
