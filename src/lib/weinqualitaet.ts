// Österreichische Weinqualitätsstufen – aufsteigend nach Qualität
// Wird für Verschneidungs-Abstufung (niedrigste Stufe gewinnt) verwendet.

export const QUALITAET_ORDER = [
  'wein', 'landwein', 'qualitaetswein',
  'kabinett', 'spaetlese', 'auslese',
  'beerenauslese', 'ausbruch', 'trockenbeerenauslese',
  'eiswein', 'strohwein',
  'dac', 'reserve', 'erste_lage', 'grosses_gewachs',
  'sekt', 'perlwein',
] as const

export type Qualitaetsstufe = typeof QUALITAET_ORDER[number] | 'sonstiges' | null

// Kurzbezeichnungen für Fließtexte (Abstufungs-Hinweise, Badges, Notizen). Bewusst kürzer
// als die Listen-Labels in lib/wein/qualitaet.ts (dort „Wein (ohne Herkunft)“): umziehen()
// schreibt diese Texte in Notizen/Bewegungsbuch, und lib/kellerbuch/storno.ts
// (qualitaetsCode) liest sie beim Storno wieder zurück – ein geändertes Label träfe
// gespeicherte Texte nicht mehr. Werte = QUALITAET_OPTS (Test: scripts/tests/qualitaet.test.mjs).
export const QUALITAET_LABEL: Record<string, string> = {
  wein:                    'Wein',
  landwein:                'Landwein',
  qualitaetswein:          'Qualitätswein',
  kabinett:                'Kabinett',
  spaetlese:               'Spätlese',
  auslese:                 'Auslese',
  beerenauslese:           'Beerenauslese',
  ausbruch:                'Ausbruch',
  trockenbeerenauslese:    'Trockenbeerenauslese',
  eiswein:                 'Eiswein',
  strohwein:               'Strohwein',
  dac:                     'DAC',
  reserve:                 'Reserve',
  erste_lage:              'Erste Lage',
  grosses_gewachs:         'Großes Gewächs',
  sekt:                    'Sekt',
  perlwein:                'Perlwein',
  sonstiges:               'Sonstiges',
}

/** Gibt den niedrigsten Qualitätslevel unter den übergebenen zurück.
 *  Berücksichtigt NUR die Prädikatswein-Stufen (keine DAC, Reserve etc.).
 *  Gibt null zurück wenn keine bekannte Prädikatswein-Stufe dabei ist. */
export function minQualitaet(stufen: (string | null | undefined)[]): string | null {
  let minIdx = Infinity
  let minVal: string | null = null
  for (const s of stufen) {
    if (!s || s === 'sonstiges') continue
    const idx = PRAEDIKATSWEIN_ORDER.indexOf(s as typeof PRAEDIKATSWEIN_ORDER[number])
    if (idx !== -1 && idx < minIdx) { minIdx = idx; minVal = s }
  }
  return minVal
}

/** Leitet die Qualitätsstufe aus dem KMW-Grad (Klosterneuburger Mostwaage) ab.
 *  Quelle: Österreichisches Weingesetz (oesterreichwein.at) – Mindest-Mostgewichte:
 *  Landwein 14, Qualitätswein 15, Kabinett 17, Spätlese 19, Auslese 21,
 *  Beerenauslese 25, Trockenbeerenauslese 30 °KMW; darunter „Wein“ (ohne Herkunft).
 *  KAN-73 (25.09.2026): unter 14 °KMW jetzt 'wein' statt 'landwein' – Landwein verlangt
 *  mindestens 14 °KMW. Das Ergebnis ist immer ein Wert aus LESE_QUALITAETEN
 *  (lib/wein/qualitaet.ts), also für ernte_parzellen und weinausbau speicherbar.
 *  Eiswein / Strohwein / Ausbruch werden NICHT auto-abgeleitet (Sonderbedingungen).
 *  Aufrufer übergeben nur gültige Zahlen (NaN/leer vorher abfangen – NaN ergäbe 'wein'). */
export function kmwZuQualitaet(kmw: number): string {
  if (kmw >= 30) return 'trockenbeerenauslese'
  if (kmw >= 25) return 'beerenauslese'
  if (kmw >= 21) return 'auslese'
  if (kmw >= 19) return 'spaetlese'
  if (kmw >= 17) return 'kabinett'
  if (kmw >= 15) return 'qualitaetswein'
  if (kmw >= 14) return 'landwein'
  return 'wein'
}

// Nur diese Stufen werden für die Abstufungs-Prüfung beim Verschneiden herangezogen.
// DAC, Reserve, Erste Lage, Sekt etc. sind eigenständige Kategorien und nicht mit
// der Prädikatswein-Skala vergleichbar.
export const PRAEDIKATSWEIN_ORDER = [
  'wein', 'landwein', 'qualitaetswein',
  'kabinett', 'spaetlese', 'auslese',
  'beerenauslese', 'ausbruch', 'trockenbeerenauslese',
  'eiswein', 'strohwein',
] as const

/** Gibt den höchsten Qualitätslevel unter den übergebenen zurück.
 *  Berücksichtigt NUR die Prädikatswein-Stufen (keine DAC, Reserve etc.).
 *  Gibt null zurück wenn keine bekannte Stufe dabei ist. */
export function maxQualitaet(stufen: (string | null | undefined)[]): string | null {
  let maxIdx = -1
  let maxVal: string | null = null
  for (const s of stufen) {
    if (!s || s === 'sonstiges') continue
    const idx = PRAEDIKATSWEIN_ORDER.indexOf(s as typeof PRAEDIKATSWEIN_ORDER[number])
    if (idx !== -1 && idx > maxIdx) { maxIdx = idx; maxVal = s }
  }
  return maxVal
}

/** Prüft ob Stufe `a` im Prädikatswein-Rang niedriger ist als Stufe `b`.
 *  Gibt false zurück wenn eine der Stufen nicht auf der Prädikatswein-Skala liegt. */
export function istNiedrigerAls(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const idxA = PRAEDIKATSWEIN_ORDER.indexOf(a as typeof PRAEDIKATSWEIN_ORDER[number])
  const idxB = PRAEDIKATSWEIN_ORDER.indexOf(b as typeof PRAEDIKATSWEIN_ORDER[number])
  if (idxA === -1 || idxB === -1) return false
  return idxA < idxB
}
