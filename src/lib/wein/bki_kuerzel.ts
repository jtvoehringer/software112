/**
 * Mapping Rebsorten-Freitext → offizielles BKI-Kürzel.
 *
 * Quelle: Bundeskellereiinspektion, "Kürzelliste für Weinformulare",
 * Stand: 01.10.2024 (https://www.bundeskellereiinspektion.at/downloads/allgemein/kuerzel.pdf).
 *
 * WICHTIG (22.8.2026): Diese Tabelle wurde vollständig anhand der amtlichen
 * Liste überprüft und korrigiert. Die vorherige Version enthielt mehrere
 * Kürzel, die NICHT den amtlichen Codes entsprachen (u.a. Riesling, Scheurebe,
 * Sankt/St. Laurent, Syrah, Roter Veltliner, Blauer Portugieser, Blauer
 * Wildbacher, Muskat Ottonel, Chardonnay/Morillon sowie Blauburger/Blauburgunder
 * waren vertauscht) - das betraf auch den amtlichen BKI-Datenblatt-Export unter
 * weinhandel/traubenverkauf/datenblatt. Diese Datei ist jetzt die korrigierte,
 * einheitliche Quelle für alle Stellen im System, die ein Rebsorten-Kürzel
 * anzeigen oder exportieren.
 *
 * Mehrere Schreibweisen/Synonyme derselben Sorte (inkl. der in der Praxis in
 * software:112 verwendeten Freitext-Varianten) zeigen bewusst auf denselben Code.
 */
export const REBSORTE_KUERZEL: Record<string, string> = {
  // Weißweinsorten
  'Grüner Veltliner':     'GV',
  'Weißgipfler':          'GV',
  'Welschriesling':       'WR',
  'Riesling':             'RR',
  'Weißer Riesling':      'RR',
  'Rheinriesling':        'RR',
  'Roter Riesling':       'RR',
  'Morillon':             'CH',
  'Chardonnay':           'CH',
  'Sauvignon Blanc':      'SB',
  'Grauburgunder':        'GR',
  'Grauer Burgunder':     'GR',
  'Pinot Gris':           'GR',
  'Ruländer':             'GR',
  'Weißburgunder':        'WB',
  'Weißer Burgunder':     'WB',
  'Pinot Blanc':          'WB',
  'Klevner':              'WB',
  'Neuburger':            'NB',
  'Roter Veltliner':      'RV',
  'Frühroter Veltliner':  'FV',
  'Malvasier':            'FV',
  'Muskat Ottonel':       'MO',
  'Muscato':              'MO',
  'Traminer':             'TR',
  'Gewürztraminer':       'TR',
  'Roter Traminer':       'TR',
  'Gelber Traminer':      'TR',
  'Müller-Thurgau':       'MT',
  'Müller Thurgau':       'MT',
  'Rivaner':              'MT',
  'Scheurebe':            'SA',
  'Sämling 88':           'SA',
  'Sylvaner':             'SY',
  'Grüner Sylvaner':      'SY',
  'Muskateller':          'MU',
  'Gelber Muskateller':   'MU',
  'Roter Muskateller':    'MU',
  'Zierfandler':          'ZF',
  'Spätrot':              'ZF',
  'Rotgipfler':           'RG',
  'Bouvier':              'BO',
  'Furmint':              'FU',
  'Goldburger':           'GB',
  'Goldmuskateller':      'GL',
  'Blütenmuskateller':    'BM',
  'Rosenmuskateller':     'RM',
  'Donauriesling':        'DR',
  'Donauveltliner':       'DV',
  'Jubiläumsrebe':        'JU',
  'Rathay':               'RH',
  'Roesler':              'RL',
  'Souvignier gris':      'SG',
  'Muscaris':             'MC',
  'Gemischter Satz':      'GW',
  'Gemischter Satz weiß': 'GW',

  // Rotweinsorten
  'Zweigelt':             'ZW',
  'Blauer Zweigelt':      'ZW',
  'Rotburger':            'ZW',
  'Blaufränkisch':        'BF',
  'Frankovka':            'BF',
  'Cabernet Sauvignon':   'CS',
  'Cabernet Franc':       'CF',
  'Merlot':               'ME',
  'Blauburgunder':        'BB',
  'Blauer Burgunder':     'BB',
  'Blauer Spätburgunder': 'BB',
  'Pinot Noir':           'BB',
  'Blauburger':           'BL',
  'Blauer Portugieser':   'BP',
  'Blauer Wildbacher':    'BW',
  'Sankt Laurent':        'SL',
  'St. Laurent':          'SL',
  'St.Laurent':           'SL',
  'Syrah':                'SH',
  'Shiraz':                'SH',

  // "Rebsortenwein" (PIWI-Sorten)
  'Bronner':              'BN',
  'Cabernet blanc':       'CB',
  'Cabernet Jura':        'CJ',
  'Johanniter':           'JO',
  'Orangetraube':         'OR',
  'Pinot Nova':           'PI',
  'Regent':               'RE',
  'Solaris':              'SI',

  // Sonstiges
  'Direktträger':               'DT',
  'Sortenverschnitt gleichgepresst': 'SP',
  'Sortenverschnitt Rosé':      'SR',
  'Sortenverschnitt rot':       'SO',
  'Sortenverschnitt weiß':      'SW',
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

/**
 * Formatiert eine Rebsorte für die Anzeige inkl. amtlichem Kürzel,
 * z.B. "Zierfandler (ZF)". Für die systemweite Ausrollung der
 * Kürzel-Anzeige (siehe REBSORTE_KUERZEL) gedacht - einheitliche
 * Stelle statt an jeder UI-Stelle "${name} (${kuerzel})" neu zu bauen.
 */
export function formatRebsorteMitKuerzel(rebsorte: string | null | undefined): string {
  if (!rebsorte) return '–'
  const kuerzel = getRebsorteKuerzel(rebsorte)
  return kuerzel ? `${rebsorte} (${kuerzel})` : rebsorte
}

export function getQualitaetBki(q: string | null | undefined): string {
  if (!q) return ''
  return QUALITAET_BKI[q.toLowerCase()] ?? q.toUpperCase().slice(0, 4)
}

export function isRotwein(rebsorte: string | null | undefined): boolean {
  if (!rebsorte) return false
  return ROTE_REBSORTEN.has(rebsorte)
}
