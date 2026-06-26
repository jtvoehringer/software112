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
 *  Ignoriert null und 'sonstiges'. Gibt null zurück wenn keine bekannte Stufe dabei ist. */
export function minQualitaet(stufen: (string | null | undefined)[]): string | null {
  let minIdx = Infinity
  let minVal: string | null = null
  for (const s of stufen) {
    if (!s || s === 'sonstiges') continue
    const idx = QUALITAET_ORDER.indexOf(s as typeof QUALITAET_ORDER[number])
    if (idx !== -1 && idx < minIdx) { minIdx = idx; minVal = s }
  }
  return minVal
}

/** Leitet die Qualitätsstufe aus dem KMW-Grad (Klosterneuburger Mostwaage) ab.
 *  Quelle: Österreichisches Weingesetz (oesterreichwein.at)
 *  Eiswein / Strohwein / Ausbruch werden NICHT auto-abgeleitet (Sonderbedingungen). */
export function kmwZuQualitaet(kmw: number): string {
  if (kmw >= 30) return 'trockenbeerenauslese'
  if (kmw >= 25) return 'beerenauslese'
  if (kmw >= 21) return 'auslese'
  if (kmw >= 19) return 'spaetlese'
  if (kmw >= 17) return 'kabinett'
  if (kmw >= 15) return 'qualitaetswein'
  return 'landwein'
}

/** Gibt den höchsten Qualitätslevel unter den übergebenen zurück.
 *  Ignoriert null und 'sonstiges'. Gibt null zurück wenn keine bekannte Stufe dabei ist. */
export function maxQualitaet(stufen: (string | null | undefined)[]): string | null {
  let maxIdx = -1
  let maxVal: string | null = null
  for (const s of stufen) {
    if (!s || s === 'sonstiges') continue
    const idx = QUALITAET_ORDER.indexOf(s as typeof QUALITAET_ORDER[number])
    if (idx !== -1 && idx > maxIdx) { maxIdx = idx; maxVal = s }
  }
  return maxVal
}

/** Prüft ob Stufe `a` im Qualitätsrang niedriger ist als Stufe `b`.
 *  Gibt false zurück wenn eine der Stufen unbekannt ist. */
export function istNiedrigerAls(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const idxA = QUALITAET_ORDER.indexOf(a as typeof QUALITAET_ORDER[number])
  const idxB = QUALITAET_ORDER.indexOf(b as typeof QUALITAET_ORDER[number])
  if (idxA === -1 || idxB === -1) return false
  return idxA < idxB
}
