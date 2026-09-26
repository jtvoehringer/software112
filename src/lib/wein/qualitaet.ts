// Österreichische Weingesetz-Qualitätsstufen (aufsteigend nach Rang)
// Enthält alle Werte die in den Formularen vorkommen können
//
// KAN-73 (25.09.2026): Jede Auswahlliste bietet genau die Werte an, die der CHECK ihrer
// Zieltabelle zulässt (scripts/tests/qualitaet.test.mjs liest die CHECKs aus den Migrationen):
//   QUALITAET_OPTS        → weinausbau.qualitaetsstufe (Charge, Eröffnungsbestand, Datenimport,
//                           Zukauf mit Zielcharge, Pressung) – weinausbau_qualitaetsstufe_check
//   LESE_QUALITAETEN      → ernte_parzellen.qualitaetsstufe (Lese) – ernte_parzellen_qualitaetsstufe_check;
//                           dieselbe Liste für die Trauben-Qualität beim Traubenverkauf
//                           (traubenverkauf.qualitaetsstufe, ohne CHECK)
//   FUELLUNG_QUALITAETEN  → fuellungen.qualitaet (Füllung neu/bearbeiten) – fuellungen_qualitaet_check
// Server Actions prüfen vor dem Schreiben mit qualitaetFehler() (verständliche Meldung statt 23514).
// Die Datei bleibt bewusst ohne Importe, damit node:test sie direkt laden kann.

export const QUALITAET_OPTS = [
  { value: 'wein',                 label: 'Wein (ohne Herkunft)',           rang: 0 },
  { value: 'landwein',             label: 'Landwein',                       rang: 1 },
  { value: 'qualitaetswein',       label: 'Qualitätswein',                  rang: 2 },
  { value: 'kabinett',             label: 'Kabinett',                       rang: 3 },
  { value: 'spaetlese',            label: 'Spätlese',                       rang: 4 },
  { value: 'auslese',              label: 'Auslese',                        rang: 5 },
  { value: 'beerenauslese',        label: 'Beerenauslese (BA)',             rang: 6 },
  { value: 'ausbruch',             label: 'Ausbruch',                       rang: 7 },
  { value: 'trockenbeerenauslese', label: 'Trockenbeerenauslese (TBA)',     rang: 8 },
  { value: 'eiswein',              label: 'Eiswein',                        rang: 9 },
  { value: 'strohwein',            label: 'Strohwein / Schilfwein',         rang: 9 },
  // Ergänzende Bezeichnungen (in Füllungsformular wählbar)
  { value: 'dac',                  label: 'DAC',                            rang: 3 },
  { value: 'reserve',              label: 'Reservé / Reserve',              rang: 4 },
  { value: 'erste_lage',           label: 'Erste Lage (ÖTW)',               rang: 5 },
  { value: 'grosses_gewachs',      label: 'Großes Gewächs',                 rang: 6 },
  { value: 'sekt',                 label: 'Sekt b.A.',                      rang: 2 },
  { value: 'perlwein',             label: 'Perlwein',                       rang: 1 },
  { value: 'sonstiges',            label: 'Sonstiges',                      rang: 0 },
] as const

export type Qualitaetsstufe = typeof QUALITAET_OPTS[number]['value']

/** Eine Option einer Qualitäts-Auswahlliste */
export type QualitaetsOption = { readonly value: string; readonly label: string; readonly rang: number }

/**
 * Stufen der Lese (KAN-73): Wein bis Trockenbeerenauslese und Eiswein.
 * Bewusst NICHT dabei:
 *  - DAC, Reserve, Erste Lage, Großes Gewächs, Sekt, Perlwein, Sonstiges – das sind keine
 *    Lese-Stufen, es gibt sie nur an Charge bzw. Füllung (weinausbau/fuellungen);
 *  - Strohwein und Ausbruch – vorerst draußen, Entscheidung nach AP0 (KAN-38).
 */
const LESE_WERTE = [
  'wein', 'landwein', 'qualitaetswein', 'kabinett', 'spaetlese',
  'auslese', 'beerenauslese', 'trockenbeerenauslese', 'eiswein',
] as const satisfies readonly Qualitaetsstufe[]

export type LeseQualitaet = typeof LESE_WERTE[number]

/** Auswahlliste der Lese (ernte_parzellen) und der Trauben-Qualität – aufsteigend nach Rang */
export const LESE_QUALITAETEN: readonly QualitaetsOption[] = QUALITAET_OPTS
  .filter(o => (LESE_WERTE as readonly string[]).includes(o.value))
  .sort((a, b) => a.rang - b.rang)

/** Auswahlliste der Füllung (fuellungen) – seit KAN-73 dieselben 18 Stufen wie die Charge,
 *  damit jede Charge ohne Umweg abgefüllt werden kann (vorher fehlten „Wein“ und „Ausbruch“). */
export const FUELLUNG_QUALITAETEN: readonly QualitaetsOption[] = QUALITAET_OPTS

function inListe(liste: readonly QualitaetsOption[], wert: unknown): boolean {
  return typeof wert === 'string' && liste.some(o => o.value === wert)
}

/** Zulässig für ernte_parzellen.qualitaetsstufe? */
export function istLeseQualitaet(wert: unknown): wert is LeseQualitaet {
  return inListe(LESE_QUALITAETEN, wert)
}

/** Zulässig für weinausbau.qualitaetsstufe (Charge)? */
export function istChargenQualitaet(wert: unknown): wert is Qualitaetsstufe {
  return inListe(QUALITAET_OPTS, wert)
}

/** Zulässig für fuellungen.qualitaet? */
export function istFuellungQualitaet(wert: unknown): wert is Qualitaetsstufe {
  return inListe(FUELLUNG_QUALITAETEN, wert)
}

export type QualitaetsZiel = 'lese' | 'charge' | 'fuellung'

const ZIELE: Record<QualitaetsZiel, { liste: readonly QualitaetsOption[]; wo: string; zusatz: string }> = {
  lese: {
    liste: LESE_QUALITAETEN,
    wo: 'bei der Lese',
    zusatz: ` Bei der Lese sind nur diese Stufen vorgesehen: ${LESE_QUALITAETEN.map(o => o.label).join(', ')}. Strohwein und Ausbruch derzeit nicht (Entscheidung offen); DAC, Reserve, Erste Lage, Großes Gewächs, Sekt, Perlwein und Sonstiges gehören nicht zur Lese (nur Charge bzw. Füllung).`,
  },
  charge:   { liste: QUALITAET_OPTS,       wo: 'bei einer Kellerbuch-Charge', zusatz: ' Bitte eine Stufe aus der Auswahlliste wählen.' },
  fuellung: { liste: FUELLUNG_QUALITAETEN, wo: 'bei einer Füllung',           zusatz: ' Bitte eine Stufe aus der Auswahlliste wählen.' },
}

/**
 * Serverprüfung vor dem Schreiben (KAN-73): Meldung, wenn `wert` für das Ziel nicht zulässig
 * ist, sonst null. Leer (null, undefined, '') liefert null – ob ein leerer Wert erlaubt ist,
 * entscheidet der Aufrufer wie bisher.
 *
 *   const fehler = qualitaetFehler('lese', wert)
 *   if (fehler) throw new AktionsFehler(fehler)
 */
export function qualitaetFehler(ziel: QualitaetsZiel, wert: string | null | undefined): string | null {
  if (wert == null || wert === '') return null
  const z = ZIELE[ziel]
  if (inListe(z.liste, wert)) return null
  const bekannt = inListe(QUALITAET_OPTS, wert)
  return `Die Qualitätsstufe „${bekannt ? qualitaetLabel(wert) : wert}“ ist ${z.wo} ${bekannt ? 'nicht zulässig' : 'unbekannt'}.${z.zusatz}`
}

/**
 * Optionen für Bearbeitungsformulare: Steht der gespeicherte Wert nicht (mehr) in `liste`,
 * bleibt er als eigene Option vorne sichtbar – sonst spränge die Auswahl beim Öffnen still
 * auf die erste Option und das Speichern änderte die Stufe unbemerkt.
 */
export function mitGespeichertemWert(
  liste: readonly QualitaetsOption[],
  gespeichert: string | null | undefined,
): readonly QualitaetsOption[] {
  if (!gespeichert || liste.some(o => o.value === gespeichert)) return liste
  return [{ value: gespeichert, label: `${qualitaetLabel(gespeichert)} (bisheriger Wert)`, rang: 99 }, ...liste]
}

export function qualitaetLabel(value: string | null | undefined): string {
  if (!value) return '–'
  return QUALITAET_OPTS.find(o => o.value === value)?.label ?? value
}

/** Gibt die niedrigere der beiden Qualitätsstufen zurück (Verschnitt-Regel) */
export function minQualitaet(a: string | null, b: string | null): string | null {
  if (!a && !b) return null
  if (!a) return b
  if (!b) return a
  const ra = QUALITAET_OPTS.find(o => o.value === a)?.rang ?? 99
  const rb = QUALITAET_OPTS.find(o => o.value === b)?.rang ?? 99
  return ra <= rb ? a : b
}
