// lib/herkunft importiert bkiRebsorteKuerzel (Sortenspiegel) – deshalb hier nur zur Aufrufzeit auf den Katalog
// zugreifen (kein Zugriff beim Laden des Moduls, sonst bricht der Import-Zyklus je nach Ladereihenfolge)
import { herkunftKnoten, HERKUNFT_LABEL } from '@/lib/herkunft'

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

/**
 * Mapping Qualitätsstufe (DB-Wert aus lib/wein/qualitaet.ts) → amtliches BKI-Kürzel.
 *
 * KAN-36 (24.09.2026): Die vorherige Tabelle enthielt erfundene Kürzel (LW, SPT, AUS,
 * BA, ESS) und fehlte für 'wein', 'trockenbeerenauslese' und 'strohwein' – unbekannte
 * Werte wurden still per toUpperCase().slice(0, 4) zu Fantasie-Codes („TROC“,
 * „AUSB“) und landeten so im BKI-Datenblatt. Jetzt gilt nur noch die amtliche Liste;
 * alles andere liefert qualitaetBki() leer plus Hinweis (→ X-Warnungen der CSV).
 */
export const QUALITAET_BKI: Record<string, string> = {
  'wein':                 'WEI',
  'landwein':             'LDW',
  'qualitaetswein':       'QUW',
  'dac':                  'DAC',
  'kabinett':             'KAB',
  'spaetlese':            'SPL',
  'auslese':              'ALW',
  'beerenauslese':        'BAL',
  'trockenbeerenauslese': 'TBA',
  'tba':                  'TBA',
  'eiswein':              'EIW',
  'strohwein':            'STW',
}

/** Zusatzbezeichnungen ohne eigenes BKI-Kürzel, die als Qualitätswein gemeldet werden */
const QUALITAET_GRUNDSTUFE_QUW: Record<string, string> = {
  'reserve':         'Reserve',
  'erste_lage':      'Erste Lage (ÖTW)',
  'grosses_gewachs': 'Großes Gewächs',
}

/**
 * Vorläufige Kürzel für Stufen, die in der BKI-Kürzelliste (Stand 01.10.2024) fehlen – eigener
 * Vorschlag, kein amtlicher Code; der Hinweis landet in den X-Warnungen der CSV.
 * Ausbruch → AUB (Vorgabe 25.09.2026, KAN-36): „Ausbruch“ darf ohnehin erst nach der
 * Prüfnummernvergabe versorgt werden; sobald das BKI ein Kürzel festlegt, hier nachziehen.
 */
const QUALITAET_VORSCHLAG: Record<string, { kuerzel: string; name: string }> = {
  'ausbruch': { kuerzel: 'AUB', name: 'Ausbruch' },
}

/** Werte ohne passende Stufe in der BKI-Kürzelliste – Feld bleibt leer.
 *  KAN-73 (25.09.2026): der frühere Lese-Wert für „Wein ohne Herkunft“ heißt jetzt überall
 *  'wein' und hat mit WEI ein amtliches Kürzel (QUALITAET_BKI oben) – der alte Eintrag hier
 *  entfällt; ein solcher Altwert käme nur noch als unbekannte Stufe (leer mit Hinweis) an. */
const QUALITAET_OHNE_BKI: Record<string, string> = {
  'sekt':      'Sekt b.A.',
  'perlwein':  'Perlwein',
  'sonstiges': 'Sonstiges',
}

/** Bekannte Rotwein-Rebsorten für Farberkennung (Altbestand – maßgeblich ist jetzt bkiFarbe()) */
export const ROTE_REBSORTEN = new Set([
  'Zweigelt', 'Blaufränkisch', 'Pinot Noir', 'Blauburgunder',
  'Cabernet Sauvignon', 'Merlot', 'Blauer Portugieser', 'Blauer Wildbacher',
  'Sankt Laurent', 'St. Laurent', 'Syrah', 'Blauburger',
])

/** Farbe je amtlichem Sortenkürzel (BKI-Datenblatt: Spalten Weiss/Rot). Rosé-Verschnitt
 *  stammt aus roten Trauben. DT (Direktträger) und SP (gleichgepresst) sind nicht eindeutig. */
const ROTE_KUERZEL = new Set(['ZW', 'BF', 'CS', 'CF', 'ME', 'BB', 'BL', 'BP', 'BW', 'SL', 'SH', 'RH', 'RL', 'CJ', 'PI', 'RE', 'SO', 'SR'])
const WEISSE_KUERZEL = new Set([
  'GV', 'WR', 'RR', 'CH', 'SB', 'GR', 'WB', 'NB', 'RV', 'FV', 'MO', 'TR', 'MT', 'SA', 'SY', 'MU', 'ZF', 'RG',
  'BO', 'FU', 'GB', 'GL', 'BM', 'DR', 'DV', 'JU', 'SG', 'MC', 'GW', 'BN', 'CB', 'JO', 'OR', 'SI', 'SW',
])

/** Vergleichsschlüssel: NFC, Leerzeichen, Groß-/Kleinschreibung; KAN-89: ß = ss („Weisser Riesling“ = „Weißer Riesling“) */
function sortenSchluessel(s: string): string {
  return s.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de').replace(/ß/g, 'ss')
}

/**
 * KAN-89 (Vorgabe BKI 05.10.2026: neben der Sorte auch das Sortenkürzel übermitteln): Kürzel zu einem Sortenfeld, auch
 * mit mehreren Sorten („Grüner Veltliner, Riesling“ → „GV, RR“, Trenner , / ; + & „und“) und mit schon angehängtem
 * Kürzel („Zierfandler (ZF)“). Nur wenn JEDE Sorte ein amtliches Kürzel hat, sonst null (kein halbes Kürzel in Meldungen).
 */
export function sortenKuerzel(sorten: string | null | undefined): string | null {
  const t = (sorten ?? '').trim()
  if (!t) return null
  const direkt = bkiRebsorteKuerzel(t)
  if (direkt) return direkt
  const teile = t.split(/\s*(?:,|\/|;|\+|&|\bund\b)\s*/i).map(s => s.replace(/\s*\([A-Z]{2,3}\)\s*$/, '').trim()).filter(Boolean)
  if (teile.length === 0) return null
  const kz = teile.map(s => bkiRebsorteKuerzel(s))
  return kz.every(Boolean) ? [...new Set(kz)].join(', ') : null
}

/**
 * KAN-89: amtliche Sortennamen für Auswahllisten (Prüfseite „Rebsorten ohne Kürzel“) – je Kürzel der erste Name aus
 * REBSORTE_KUERZEL, alphabetisch; die Sortenverschnitte (SW/SO/SR/SP) stehen am Ende.
 */
export function amtlicheSorten(): { name: string; kuerzel: string }[] {
  const je = new Map<string, string>()
  for (const [name, k] of Object.entries(REBSORTE_KUERZEL)) if (!je.has(k)) je.set(k, name)
  const liste = [...je].map(([kuerzel, name]) => ({ name, kuerzel }))
  const vs = (n: string) => /^Sortenverschnitt/.test(n) ? 1 : 0
  return liste.sort((a, b) => vs(a.name) - vs(b.name) || a.name.localeCompare(b.name, 'de'))
}

let kuerzelNormalisiert: Map<string, string> | null = null

/**
 * Amtliches BKI-Kürzel oder null – OHNE Ersatzkürzel. Für Behördenmeldungen (CSV,
 * BKI-Datenblatt): eine unbekannte Sorte bleibt leer und wird als Warnung gemeldet.
 * Schreibweisen werden tolerant verglichen (Groß-/Kleinschreibung, Leerzeichen, NFC).
 */
export function bkiRebsorteKuerzel(rebsorte: string | null | undefined): string | null {
  if (!rebsorte || !rebsorte.trim()) return null
  const direkt = REBSORTE_KUERZEL[rebsorte]
  if (direkt) return direkt
  if (!kuerzelNormalisiert) {
    kuerzelNormalisiert = new Map(Object.entries(REBSORTE_KUERZEL).map(([name, k]) => [sortenSchluessel(name), k]))
  }
  return kuerzelNormalisiert.get(sortenSchluessel(rebsorte)) ?? null
}

/** Farbe der Trauben laut Kürzelliste – null, wenn die Sorte kein Kürzel hat oder nicht eindeutig ist */
export function bkiFarbe(rebsorte: string | null | undefined): 'weiss' | 'rot' | null {
  const k = bkiRebsorteKuerzel(rebsorte)
  if (!k) return null
  if (ROTE_KUERZEL.has(k)) return 'rot'
  if (WEISSE_KUERZEL.has(k)) return 'weiss'
  return null
}

/** Anzeige-Kürzel: amtlich, sonst (nur für die Oberfläche) die ersten vier Buchstaben.
 *  Für Behördenmeldungen bkiRebsorteKuerzel() verwenden. */
export function getRebsorteKuerzel(rebsorte: string | null | undefined): string {
  if (!rebsorte) return ''
  return bkiRebsorteKuerzel(rebsorte) ?? rebsorte.slice(0, 4).toUpperCase()
}

/**
 * Formatiert eine Rebsorte für die Anzeige inkl. amtlichem Kürzel,
 * z.B. "Zierfandler (ZF)". Für die systemweite Ausrollung der
 * Kürzel-Anzeige (siehe REBSORTE_KUERZEL) gedacht - einheitliche
 * Stelle statt an jeder UI-Stelle "${name} (${kuerzel})" neu zu bauen.
 *
 * KAN-36 (25.09.2026): nur noch mit AMTLICHEM Kürzel – eine Sorte ohne Eintrag in der
 * BKI-Kürzelliste erscheint ohne Klammer („Uhudler“ statt „Uhudler (UHUD)“). Die Funktion
 * steckt auch in Behördenmeldungen (Transportbescheinigung „Traubensorte(n)“,
 * Prüfnummernantrag, Weinbuch, Bewegungsbuch) – dort darf kein Fantasiekürzel stehen.
 */
export function formatRebsorteMitKuerzel(rebsorte: string | null | undefined): string {
  if (!rebsorte) return '–'
  const kuerzel = bkiRebsorteKuerzel(rebsorte)
  return kuerzel ? `${rebsorte} (${kuerzel})` : rebsorte
}

/**
 * Hinweise für Behörden-CSVs mit einer Spalte „BKI-Kürzel“: je Rebsorte ohne amtliches
 * Kürzel ein Eintrag (Spalte bleibt dort leer) – zusammengefasst mit Anzahl der Zeilen.
 */
export function fehlendeKuerzelHinweise(
  sorten: readonly (string | null | undefined)[],
  opts: { spalte?: string; einheit?: readonly [string, string]; stammdaten?: string } = {},
): string[] {
  const spalte = opts.spalte ?? 'BKI-Kürzel'
  const [eins, mehr] = opts.einheit ?? ['Zeile', 'Zeilen']
  const fehlend = new Map<string, number>()
  for (const s of sorten) {
    const t = typeof s === 'string' ? s.trim() : ''
    if (!t || bkiRebsorteKuerzel(t)) continue
    fehlend.set(t, (fehlend.get(t) ?? 0) + 1)
  }
  return [...fehlend]
    .sort(([a], [b]) => a.localeCompare(b, 'de'))
    .map(([s, n]) => `Rebsorte „${s}“ steht nicht in der BKI-Kürzelliste – Spalte „${spalte}“ leer gelassen (${n} ${n === 1 ? eins : mehr}).${opts.stammdaten ? ` Schreibweise in den Stammdaten (${opts.stammdaten}) prüfen.` : ''}`)
}

/**
 * Qualitätsstufe → BKI-Kürzel samt Hinweis für die Warnliste der CSV (KAN-36).
 *  - amtliche Stufe → Kürzel, kein Hinweis
 *  - Reserve / Erste Lage / Großes Gewächs → QUW (Grundstufe Qualitätswein) mit Hinweis
 *  - Ausbruch → vorläufig AUB (Vorschlag, nicht in der Liste) mit Hinweis
 *  - Sekt, Perlwein, Sonstiges, unbekannte Werte → leer mit Hinweis
 *  - Wein (ohne Herkunft) → WEI (amtlich, auch bei der Lese seit KAN-73)
 *  - leer → leer, kein Hinweis
 */
export function qualitaetBki(q: string | null | undefined): { kuerzel: string; hinweis: string | null } {
  const wert = (q ?? '').trim().toLowerCase()
  if (!wert) return { kuerzel: '', hinweis: null }
  // Nur eigene Einträge – sonst lieferte z. B. „constructor“ die Funktion des Object-Prototyps
  const eigen = <T,>(tabelle: Record<string, T>): T | undefined =>
    Object.prototype.hasOwnProperty.call(tabelle, wert) ? tabelle[wert] : undefined
  const kuerzel = eigen(QUALITAET_BKI)
  if (kuerzel) return { kuerzel, hinweis: null }
  const vorschlag = eigen(QUALITAET_VORSCHLAG)
  if (vorschlag) return { kuerzel: vorschlag.kuerzel, hinweis: `„${vorschlag.name}“ steht nicht in der BKI-Kürzelliste – vorläufig als ${vorschlag.kuerzel} gemeldet (Vorschlag, kein amtliches Kürzel)` }
  const zusatz = eigen(QUALITAET_GRUNDSTUFE_QUW)
  if (zusatz) return { kuerzel: 'QUW', hinweis: `„${zusatz}“ hat kein eigenes BKI-Kürzel – als Qualitätswein (QUW) gemeldet` }
  const ohne = eigen(QUALITAET_OHNE_BKI)
  if (ohne) return { kuerzel: '', hinweis: `„${ohne}“ steht nicht in der BKI-Kürzelliste – Qualitätsstufe leer gelassen` }
  return { kuerzel: '', hinweis: `Qualitätsstufe „${q}“ ist unbekannt – Qualitätsstufe leer gelassen` }
}

/** Nur das Kürzel (leer, wenn es keines gibt – kein Ersatzkürzel mehr, KAN-36) */
export function getQualitaetBki(q: string | null | undefined): string {
  return qualitaetBki(q).kuerzel
}

/**
 * Herkunft → amtliches BKI-Kürzel (KAN-36, 25.09.2026): Bezeichnung → Kürzel.
 *
 * Quelle: dieselbe amtliche „Kürzelliste für Weinformulare“ (Stand 01.10.2024, siehe oben),
 * Abschnitt „Herkunft“ – vollständig und in der Reihenfolge der Liste. Vorher ging der
 * gespeicherte Wert ungeprüft in die Spalte „Herkunft“ des BKI-Datenblatts: interne
 * Herkunftsstufen („wlnoe“), eigene Weinbaugebiete und der Freitext des Zukaufs.
 */
export const HERKUNFT_BKI: Record<string, string> = {
  'Ausland':               'AUSL',
  'Bergland':              'BLXX',
  'Burgenland':            'WLBL',
  'Carnuntum':             'WLCA',
  'Eisenberg':             'WLEB',
  'Kamptal':               'WLKA',
  'Kärnten':               'BLKA',
  'Kremstal':              'WLKT',
  'Leithaberg':            'WLLB',
  'Mittelburgenland':      'WLMB',
  'Neusiedlersee':         'WLNS',
  'Niederösterreich':      'WLNO',
  'Oberösterreich':        'BLOO',
  'Österreich':            'OEST',
  'Rosalia':               'WLRO',
  'Ruster Ausbruch':       'WLRU',
  'Salzburg':              'BLSB',
  'Steiermark':            'SLST',
  'Steirerland':           'SLXX',
  'Südsteiermark':         'SLSS',
  'Thermenregion':         'WLTH',
  'Tirol':                 'BLTI',
  'Traisental':            'WLTT',
  'Verschnitt von mehreren Weinen der EU': 'EUXX',
  'Vorarlberg':            'BLVO',
  'Vulkanland Steiermark': 'SLVL',
  'Wachau':                'WLWA',
  'Wagram':                'WLWG',
  'Weinland':              'WLXX',
  'Weinviertel':           'WLWV',
  'Weststeiermark':        'SLWS',
  'Wien':                  'WIEN',
}

/**
 * Herkunftsstufen aus lib/herkunft.ts (gespeichert in grundstuecke, ernte_parzellen, weinausbau, fuellungen
 * und als Kopie in traubenverkauf.herkunft_code) sind KEINE BKI-Kürzel. Seit KAN-165 trägt jeder Katalogeintrag
 * sein Kürzel selbst (HerkunftKnoten.bki) – „wein“ = Österreich (OEST), Landwein = Region (…XX). Eigene
 * Weinbaugebiete und „sonstiges“ bleiben leer.
 */
// Maps statt Objekt-Lookup: Freitext wie „constructor“ darf keinen Prototyp-Eintrag treffen
const HERKUNFT_KUERZEL = new Set(Object.values(HERKUNFT_BKI))
let herkunftNachName: Map<string, string> | null = null

/**
 * Herkunftswert → amtliches Kürzel; sonst leer und der Grund als Satzteil für Hinweise.
 *  - amtliches Kürzel (Groß-/Kleinschreibung egal) → unverändert
 *  - Herkunftsstufe mit eindeutigem Weinbaugebiet (HERKUNFT_STUFE_BKI) → dessen Kürzel
 *  - Bezeichnung laut Kürzelliste („Weinviertel“, „Kamptal“) → Kürzel (tolerant wie die Rebsorten)
 *  - alles andere – Freitext, eigene Weinbaugebiete wie „Kremstal DAC“, „wein“, „sonstiges“ → leer
 *  - leer → leer, kein Grund
 * `quelle` (z. B. „Grundstück“) erscheint im Grund hinter dem Wert.
 */
export function herkunftPruefen(wert: string | null | undefined, quelle?: string): { kuerzel: string; grund: string | null } {
  const roh = typeof wert === 'string' ? wert.trim() : ''
  if (!roh) return { kuerzel: '', grund: null }
  const gross = roh.toUpperCase()
  if (HERKUNFT_KUERZEL.has(gross)) return { kuerzel: gross, grund: null }
  const stufe = herkunftKnoten(roh.toLowerCase())?.bki
  if (stufe) return { kuerzel: stufe, grund: null }
  if (!herkunftNachName) {
    herkunftNachName = new Map(Object.entries(HERKUNFT_BKI).map(([name, k]) => [sortenSchluessel(name), k]))
  }
  const nachName = herkunftNachName.get(sortenSchluessel(roh))
  if (nachName) return { kuerzel: nachName, grund: null }
  const anzeige = Object.prototype.hasOwnProperty.call(HERKUNFT_LABEL, roh) ? HERKUNFT_LABEL[roh] : roh
  const bezug = `Herkunft „${anzeige}“${quelle ? ` (${quelle})` : ''}`
  return { kuerzel: '', grund: `${bezug} ist kein BKI-Herkunftskürzel` }
}

/**
 * Herkunft → BKI-Kürzel samt Hinweis für die Warnliste der CSV (KAN-36, analog qualitaetBki):
 * gültig → Kürzel ohne Hinweis; Freitext/unbekannt → leer mit Hinweis; leer → leer ohne Hinweis.
 */
export function herkunftBki(wert: string | null | undefined): { kuerzel: string; hinweis: string | null } {
  const p = herkunftPruefen(wert)
  return { kuerzel: p.kuerzel, hinweis: p.grund ? `${p.grund} – Spalte leer gelassen` : null }
}

export function isRotwein(rebsorte: string | null | undefined): boolean {
  if (!rebsorte) return false
  const farbe = bkiFarbe(rebsorte)
  return farbe ? farbe === 'rot' : ROTE_REBSORTEN.has(rebsorte)
}
