/** Mapping Rebsorten-Freitext → offizielles BKI-Kürzel */
export const REBSORTE_KUERZEL: Record<string, string> = {
  'Grüner Veltliner':   'GV',
  'Zweigelt':           'ZW',
  'Welschriesling':     'WR',
  'Riesling':           'RX',
  'Morillon':           'MO',
  'Chardonnay':         'MO',
  'Sauvignon Blanc':    'SB',
  'Grauburgunder':      'GR',
  'Pinot Gris':         'GR',
  'Weißburgunder':      'WB',
  'Pinot Blanc':        'WB',
  'Pinot Noir':         'PN',
  'Blauburgunder':      'PN',
  'Blaufränkisch':      'BF',
  'Cabernet Sauvignon': 'CS',
  'Merlot':             'ME',
  'Neuburger':          'NB',
  'Roter Veltliner':    'RD',
  'Muskat Ottonel':     'MO2',
  'Traminer':           'TR',
  'Müller-Thurgau':     'MT',
  'Scheurebe':          'SL',
  'Blauer Portugieser': 'PT',
  'Blauer Wildbacher':  'WI',
  'Sankt Laurent':      'LA',
  'St. Laurent':        'LA',
  'Syrah':              'SY',
  'Gemischter Satz':    'GS',
  'Muskateller':        'MU',
  'Blauburger':         'BB',
}

/** Mapping Qualitätsstufe (DB-Wert) → BKI-Kürzel */
export const QUALITAET_BKI: Record<string, string> = {
  'landwein':       'LW',
  'qualitaetswein': 'QUW',
  'kabinett':       'KAB',
  'spaetlese':      'SPT',
  'auslese':        'AUS',
  'beerenauslese':  'BA',
  'tba':            'TBA',
  'eiswein':        'ESS',
  'dac':            'DAC',
}

/** Bekannte Rotwein-Rebsorten für Farberkennung */
export const ROTE_REBSORTEN = new Set([
  'Zweigelt', 'Blaufränkisch', 'Pinot Noir', 'Blauburgunder',
  'Cabernet Sauvignon', 'Merlot', 'Blauer Portugieser', 'Blauer Wildbacher',
  'Sankt Laurent', 'St. Laurent', 'Syrah', 'Blauburger',
])

export function getRebsorteKuerzel(rebsorte: string | null | undefined): string {
  if (!rebsorte) return ''
  return REBSORTE_KUERZEL[rebsorte] ?? rebsorte.slice(0, 4).toUpperCase()
}

export function getQualitaetBki(q: string | null | undefined): string {
  if (!q) return ''
  return QUALITAET_BKI[q.toLowerCase()] ?? q.toUpperCase().slice(0, 4)
}

export function isRotwein(rebsorte: string | null | undefined): boolean {
  if (!rebsorte) return false
  return ROTE_REBSORTEN.has(rebsorte)
}
