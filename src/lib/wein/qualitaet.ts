// Österreichische Weingesetz-Qualitätsstufen (aufsteigend nach Rang)
// Enthält alle Werte die in den Formularen vorkommen können
//
// KAN-73 (25.09.2026): Jede Auswahlliste bietet genau die Werte an, die der CHECK ihrer
// Zieltabelle zulässt (scripts/tests/qualitaet.test.mjs liest die CHECKs aus den Migrationen
// und prüft je Formular, welche Liste es verwendet):
//   QUALITAET_OPTS        → weinausbau.qualitaetsstufe (Charge, Eröffnungsbestand, Datenimport,
//                           Zukauf mit Zielcharge, Pressung) – weinausbau_qualitaetsstufe_check;
//                           Charge bearbeiten: chargenStufenBis() / chargenStufenAenderungFehler()
//   LESE_QUALITAETEN      → ernte_parzellen.qualitaetsstufe (Lese) – ernte_parzellen_qualitaetsstufe_check;
//                           dieselbe Liste für die Trauben-Qualität beim Traubenverkauf
//                           (traubenverkauf.qualitaetsstufe, ohne CHECK); mit °KMW: leseStufenBeiKmw()
//   FUELLUNG_QUALITAETEN  → fuellungen.qualitaet (Füllung neu/bearbeiten) – fuellungen_qualitaet_check;
//                           mit Charge: fuellungsStufenFuer() (keine Aufstufung)
// Server Actions prüfen vor dem Schreiben mit qualitaetFehler() (verständliche Meldung statt 23514).
// Abstufungsregeln (Eiswein/Strohwein als eigene Zweige, DAC & Co. auf Qualitätswein-Niveau,
// istAufstufung) stehen in lib/weinqualitaet.ts – die einzige Abhängigkeit dieser Datei. Charge
// und Füllung bieten nie eine Stufe an, die istAufstufung sperrt (Test: qualitaet.test.mjs).

import { istAufstufung, istPraedikatsStufe, minQualitaet as minPraedikat, qualitaetsNiveau, stufeMitKmwMoeglich } from '@/lib/weinqualitaet'

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
 * Stufen der Lese (KAN-73): nur die Mostgewichts-Stufen des Weingesetzes.
 * Bewusst NICHT dabei:
 *  - DAC, Reserve, Erste Lage, Großes Gewächs, Sekt, Perlwein, Sonstiges – das sind keine
 *    Lese-Stufen, sie werden erst bei der Charge bzw. Füllung vergeben;
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

/** Lese-Stufen, die das Mostgewicht `kmw` trägt (Mindest-°KMW laut Weingesetz, Eiswein ab
 *  25 °KMW); ohne KMW-Wert alle. Server: upsertErnteParzelle prüft dieselbe Regel. */
export function leseStufenBeiKmw(kmw: number | null | undefined): readonly QualitaetsOption[] {
  return LESE_QUALITAETEN.filter(o => stufeMitKmwMoeglich(o.value, kmw))
}

/** Auswahl der Füllung zu einer Charge der Stufe `chargeStufe` – genau die Stufen, die der
 *  Server zulässt (istAufstufung, lib/weinqualitaet.ts): Abstufungen auf der Prädikats-Skala
 *  (Eiswein/Strohwein bis Beerenauslese), ab Qualitätswein-Niveau auch DAC, Reserve, Erste Lage,
 *  Großes Gewächs und Sekt (KAN-73, Runde 2: sonst ließe sich eine Pressungs-Charge – dort ist
 *  die Stufe gesperrt – nie als DAC abfüllen), dazu Perlwein und „Sonstiges“.
 *  Chargen ohne Skala-Niveau (Sekt, Perlwein, Sonstiges, Altwerte): nur die eigene Stufe und
 *  „Sonstiges“ wie bisher. Ohne Charge bzw. ohne Stufe alle. */
export function fuellungsStufenFuer(chargeStufe: string | null | undefined): readonly QualitaetsOption[] {
  if (!chargeStufe) return FUELLUNG_QUALITAETEN
  if (qualitaetsNiveau(chargeStufe) == null) {
    return FUELLUNG_QUALITAETEN.filter(o => o.value === chargeStufe || o.value === 'sonstiges')
  }
  return FUELLUNG_QUALITAETEN.filter(o => !istAufstufung(chargeStufe, o.value))
}

/** Auswahl der Charge (Kellerbuch, Charge bearbeiten): Obergrenze `basis` (gespeicherte Stufe
 *  bzw. Ableitung aus den °KMW), alles mit höchstens gleichem Rang, aber nie eine Stufe, die
 *  istAufstufung sperrt – dieselbe Regel wie bei der Füllung. Damit weder Eiswein/Strohwein nach
 *  Ausbruch, TBA oder zueinander noch DAC, Reserve, Erste Lage, Großes Gewächs auf ein Prädikat
 *  (KAN-73, Runde 2: DAC → Kabinett, dann Füllung „Kabinett“ umging die Sperre der Füllung).
 *  Ohne Obergrenze alle. updateWeinausbau prüft dieselbe Regel (chargenStufenAenderungFehler). */
export function chargenStufenBis(basis: string | null | undefined): readonly QualitaetsOption[] {
  if (!basis) return QUALITAET_OPTS
  const maxRang = QUALITAET_OPTS.find(o => o.value === basis)?.rang ?? 99
  return QUALITAET_OPTS.filter(o => o.value === basis || (o.rang <= maxRang && !istAufstufung(basis, o.value)))
}

/**
 * Serverprüfung „Charge bearbeiten“ (updateWeinausbau; Pressungs-Chargen sperrt die Action
 * vorher ganz): Meldung, wenn die Stufe von `alt` nicht auf `neu` geändert werden darf, sonst
 * null. Eine festgelegte Stufe lässt sich nur abstufen (chargenStufenBis), nicht entfernen –
 * über „leer“ ließe sich sonst danach jede Stufe setzen bzw. jede Stufe abfüllen (KAN-73,
 * Runde 2). Eine Charge ohne Stufe bekommt ihre erste Stufe frei.
 */
export function chargenStufenAenderungFehler(alt: string | null | undefined, neu: string | null | undefined): string | null {
  const a = alt || null
  const n = neu || null
  if (a === n || a == null) return null
  if (n == null) {
    return `Die Qualitätsstufe „${qualitaetLabel(a)}“ ist festgelegt und lässt sich nur abstufen, nicht entfernen – die niedrigsten Stufen sind „${qualitaetLabel('wein')}“ und „${qualitaetLabel('sonstiges')}“.`
  }
  if (chargenStufenBis(a).some(o => o.value === n)) return null
  return `Die Qualitätsstufe kann nicht von „${qualitaetLabel(a)}“ auf „${qualitaetLabel(n)}“ geändert werden – bei einer Charge sind nur Abstufungen zulässig.`
}

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
    zusatz: ` Bei der Lese sind nur diese Stufen vorgesehen: ${LESE_QUALITAETEN.map(o => o.label).join(', ')}. Strohwein und Ausbruch derzeit nicht (Entscheidung offen); DAC, Reserve, Erste Lage, Großes Gewächs, Sekt, Perlwein und Sonstiges werden bei der Charge bzw. Füllung vergeben.`,
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

/** Gibt die niedrigere der beiden Qualitätsstufen zurück (Zusammenführung per Umziehen).
 *  Zwei Stufen der Prädikats-Skala: wie lib/weinqualitaet.ts (Eiswein + TBA → Beerenauslese,
 *  KAN-73); sonst nach Rang in QUALITAET_OPTS wie bisher. */
export function minQualitaet(a: string | null, b: string | null): string | null {
  if (!a && !b) return null
  if (!a) return b
  if (!b) return a
  if (istPraedikatsStufe(a) && istPraedikatsStufe(b)) return minPraedikat([a, b])
  const ra = QUALITAET_OPTS.find(o => o.value === a)?.rang ?? 99
  const rb = QUALITAET_OPTS.find(o => o.value === b)?.rang ?? 99
  return ra <= rb ? a : b
}
