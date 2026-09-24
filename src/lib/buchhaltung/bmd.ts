// ── BMD-NTCS-Schnittstelle: Kontierung + Buchungszeilen ─────────────────────
//
// Rückmeldung 3.9.2026: software:112 bleibt Vorsystem, die doppelte Buchhaltung
// macht der Steuerberater in BMD NTCS. Wir übergeben Ausgangsrechnungen,
// Eingangsbelege und Personenkonten im BMD-Standardformat (BuErf-Felder mit
// Kopfzeile, Strichpunkt-getrennt, Dezimalkomma, Datum TT.MM.JJJJ).
//
// Kontierung: Vorbelegung nach Österreichischem Einheitskontenrahmen (Klasse 4
// Erlöse, Klasse 5-7 Aufwand aus den E&A-Kategorien, Personenkonten 2xxxxx /
// 3xxxxx wie BMD-Standard). Jeder Schlüssel ist pro Mandant überschreibbar
// (Tabelle buchhaltung_kontenmapping, nur Abweichungen). Die konkreten Konten
// sind eine VORBELEGUNG und vom Steuerberater des Mandanten zu prüfen - das
// steht so auch in der Oberfläche.
//
// BMD-Steuercodes (Standard-Stammverzeichnis, kanzleispezifisch anpassbar):
//   1 = Umsatzsteuer (Satz über Feld "prozent"), 2 = Vorsteuer,
//   5 = Ausfuhrlieferung Drittland, 7 = innergemeinschaftliche Lieferung.
//
// Diese Datei ist bewusst frei von Server-Imports (Vorbelegung wird auch im
// Mapping-Screen angezeigt).
//
// CSV (24.09.2026, „Behördenmeldungen als CSV“): bmdCsv()/personenkontenCsv() erzeugen
// den Text über den gemeinsamen Baustein – csvText(…, PROFIL_BMD), byte-identisch zur
// bisherigen Ausgabe (Golden-Files scripts/tests/golden/bmd_*.csv, `npm run test:csv`).
// Der Import steht mit Dateiendung, weil scripts/tests/csv.test.mjs diese Datei direkt
// mit Node (Type-Stripping, ohne Bundler und ohne '@/'-Alias) lädt.

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den CSV-Tests ohne Bundler lädt (tsconfig ohne allowImportingTsExtensions)
import { csvText, PROFIL_BMD, type CsvSpalte } from '../csv/index.ts'

export type MappingGruppe = 'erloese' | 'personenkonten' | 'steuercodes' | 'sonstiges'

export type MappingFeld = {
  schluessel: string
  gruppe: MappingGruppe
  label: string
  standard: string
  hinweis?: string
}

// Reihenfolge = Anzeige im Mapping-Screen
export const MAPPING_FELDER: MappingFeld[] = [
  // Erlöskonten (Gegenkonto bei Ausgangsrechnungen)
  { schluessel: 'erloes_wein_20',      gruppe: 'erloese', label: 'Erlöse Flaschenwein Inland 20 %',        standard: '4000' },
  { schluessel: 'erloes_wein_13',      gruppe: 'erloese', label: 'Erlöse Wein Ab Hof 13 % (Pauschalierung)', standard: '4001' },
  { schluessel: 'erloes_wein_10',      gruppe: 'erloese', label: 'Erlöse Wein 10 %',                      standard: '4005' },
  { schluessel: 'erloes_tank_20',      gruppe: 'erloese', label: 'Erlöse Fasswein / Most 20 %',           standard: '4020' },
  { schluessel: 'erloes_tank_13',      gruppe: 'erloese', label: 'Erlöse Fasswein / Most 13 %',           standard: '4021' },
  { schluessel: 'erloes_trauben_13',   gruppe: 'erloese', label: 'Erlöse Traubenverkauf 13 %',            standard: '4100' },
  { schluessel: 'erloes_trauben_20',   gruppe: 'erloese', label: 'Erlöse Traubenverkauf 20 %',            standard: '4101' },
  { schluessel: 'erloes_sonstiges_20', gruppe: 'erloese', label: 'Erlöse sonstige Artikel 20 %',          standard: '4800' },
  { schluessel: 'erloes_sonstiges_13', gruppe: 'erloese', label: 'Erlöse sonstige Artikel 13 %',          standard: '4801' },
  { schluessel: 'erloes_sonstiges_10', gruppe: 'erloese', label: 'Erlöse sonstige Artikel 10 %',          standard: '4802' },
  { schluessel: 'erloes_export',       gruppe: 'erloese', label: 'Erlöse Ausfuhr Drittland (0 %)',        standard: '4010', hinweis: 'Kunde mit Land außerhalb der EU' },
  { schluessel: 'erloes_ig',           gruppe: 'erloese', label: 'Erlöse innergemeinschaftliche Lieferung (0 %)', standard: '4011', hinweis: 'Kunde mit EU-Land außer AT' },
  { schluessel: 'erloes_steuerfrei',   gruppe: 'erloese', label: 'Erlöse steuerfrei Inland (0 %)',        standard: '4003' },
  // Personenkonten
  { schluessel: 'debitor_basis',       gruppe: 'personenkonten', label: 'Nummernkreis Debitoren – Basis', standard: '200000', hinweis: 'Erste vergebene Nummer = Basis + 1' },
  { schluessel: 'kreditor_basis',      gruppe: 'personenkonten', label: 'Nummernkreis Kreditoren – Basis', standard: '300000' },
  { schluessel: 'debitor_diverse',     gruppe: 'personenkonten', label: 'Sammelkonto „Diverse Debitoren"', standard: '299999', hinweis: 'Für Einnahmen ohne zugeordneten Kunden' },
  { schluessel: 'kreditor_diverse',    gruppe: 'personenkonten', label: 'Sammelkonto „Diverse Kreditoren"', standard: '399999', hinweis: 'Für Ausgaben ohne zugeordneten Lieferanten' },
  // Steuercodes (BMD-Stammverzeichnis der Kanzlei)
  { schluessel: 'steuercode_ust',      gruppe: 'steuercodes', label: 'Steuercode Umsatzsteuer Inland', standard: '1' },
  { schluessel: 'steuercode_vst',      gruppe: 'steuercodes', label: 'Steuercode Vorsteuer Inland',    standard: '2' },
  { schluessel: 'steuercode_export',   gruppe: 'steuercodes', label: 'Steuercode Ausfuhrlieferung',    standard: '5' },
  { schluessel: 'steuercode_ig',       gruppe: 'steuercodes', label: 'Steuercode ig Lieferung',        standard: '7' },
  { schluessel: 'steuercode_frei',     gruppe: 'steuercodes', label: 'Steuercode steuerfrei / 0 %',    standard: '' , hinweis: 'leer = kein Steuercode' },
  // Sonstiges
  { schluessel: 'aufwand_fallback',    gruppe: 'sonstiges', label: 'Aufwandskonto, wenn E&A-Kategorie ohne Konto', standard: '7990', hinweis: 'Aufwandskonten kommen aus den E&A-Kategorien (Kontonummer je Kategorie)' },
  { schluessel: 'ertrag_fallback',     gruppe: 'sonstiges', label: 'Ertragskonto, wenn E&A-Kategorie ohne Konto', standard: '4800' },
  { schluessel: 'buchsymbol_ar',       gruppe: 'sonstiges', label: 'Buchungssymbol Ausgangsrechnung', standard: 'AR' },
  { schluessel: 'buchsymbol_er',       gruppe: 'sonstiges', label: 'Buchungssymbol Eingangsrechnung', standard: 'ER' },
]

export const MAPPING_GRUPPEN: { key: MappingGruppe; label: string }[] = [
  { key: 'erloese',        label: 'Erlöskonten (Ausgangsrechnungen)' },
  { key: 'personenkonten', label: 'Personenkonten (Debitoren / Kreditoren)' },
  { key: 'steuercodes',    label: 'BMD-Steuercodes' },
  { key: 'sonstiges',      label: 'Sonstiges' },
]

export type Mapping = Record<string, string>

/** Vorbelegung + gespeicherte Abweichungen zusammenführen */
export function mappingAufloesen(overrides: Record<string, string | null | undefined>): Mapping {
  const m: Mapping = {}
  for (const f of MAPPING_FELDER) {
    const o = overrides[f.schluessel]
    m[f.schluessel] = (o !== undefined && o !== null && String(o).trim() !== '') ? String(o).trim() : f.standard
  }
  return m
}

// ── Länder / Steuer-Einordnung ──────────────────────────────────────────────
const EU = new Set(['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'])

export type Steuerfall = 'inland' | 'ig' | 'export' | 'steuerfrei'

/** Einordnung einer Position nach USt-Satz und Kundenland */
export function steuerfall(ustSatz: number, kundenLand: string | null | undefined): Steuerfall {
  if (ustSatz > 0) return 'inland'
  const land = (kundenLand ?? 'AT').toUpperCase()
  if (land === 'AT') return 'steuerfrei'
  return EU.has(land) ? 'ig' : 'export'
}

/** Erlöskonto-Schlüssel für eine Verkaufsposition */
export function erloesSchluessel(posTyp: string | null | undefined, istTraubenverkauf: boolean, ustSatz: number, fall: Steuerfall): string {
  if (fall === 'export') return 'erloes_export'
  if (fall === 'ig') return 'erloes_ig'
  if (fall === 'steuerfrei') return 'erloes_steuerfrei'
  const gruppe = istTraubenverkauf ? 'trauben' : posTyp === 'tank' ? 'tank' : posTyp === 'sonstiges' ? 'sonstiges' : 'wein'
  const satz = ustSatz === 20 ? '20' : ustSatz === 13 ? '13' : ustSatz === 10 ? '10' : '20'
  const key = `erloes_${gruppe}_${satz}`
  // nicht jede Kombination hat ein eigenes Konto -> auf die Wein-Konten zurückfallen
  return MAPPING_FELDER.some(f => f.schluessel === key) ? key : `erloes_wein_${satz}`
}

export function steuercodeFuer(fall: Steuerfall, m: Mapping): string {
  switch (fall) {
    case 'inland':     return m.steuercode_ust
    case 'ig':         return m.steuercode_ig
    case 'export':     return m.steuercode_export
    case 'steuerfrei': return m.steuercode_frei
  }
}

// ── BMD-Zeilen ──────────────────────────────────────────────────────────────
export type BmdZeile = {
  satzart: '0'
  konto: string          // Personenkonto (Debitor/Kreditor)
  gkonto: string         // Sachkonto (Erlös/Aufwand)
  belegnr: string
  belegdatum: string     // TT.MM.JJJJ
  buchdatum: string      // TT.MM.JJJJ
  buchsymbol: string     // AR / ER
  buchcode: '1' | '2'    // 1 = Sollbuchung (Debitor), 2 = Habenbuchung (Kreditor)
  prozent: number
  steuercode: string
  betrag: number         // brutto
  steuer: number
  text: string
  kost: string
  extbelegnr: string
  nettodatum: string     // Fälligkeit TT.MM.JJJJ
  skontopz: number
  dokument: string
}

export const BMD_SPALTEN: (keyof BmdZeile)[] = [
  'satzart', 'konto', 'gkonto', 'belegnr', 'belegdatum', 'buchdatum', 'buchsymbol', 'buchcode',
  'prozent', 'steuercode', 'betrag', 'steuer', 'text', 'kost', 'extbelegnr', 'nettodatum', 'skontopz', 'dokument',
]

export function bmdDatum(iso: string | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}

export function datumPlusTage(iso: string, tage: number): string {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + tage)
  return d.toISOString().slice(0, 10)
}

export function bmdBetrag(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',')
}

/** Spalten des Buchungsstapels für csvText(…, PROFIL_BMD): Kopf = BMD-Feldname,
 *  Betrag/Steuer mit 2 Stellen (Altrundung), Prozent/Skonto roh (String(n) mit Komma). */
export const BMD_CSV_SPALTEN: CsvSpalte<BmdZeile>[] = BMD_SPALTEN.map((k): CsvSpalte<BmdZeile> =>
  k === 'prozent' || k === 'skontopz' ? { kopf: k, typ: 'dezimal', stellen: 'roh', wert: z => z[k] }
    : k === 'betrag' || k === 'steuer' ? { kopf: k, typ: 'betrag', wert: z => z[k] }
      : { kopf: k, typ: 'text', wert: z => z[k] })

/** Buchungsstapel als CSV-Text (BOM + CRLF, Excel-/BMD-tauglich) */
export function bmdCsv(zeilen: BmdZeile[]): string {
  return csvText(zeilen, BMD_CSV_SPALTEN, PROFIL_BMD)
}

/** Text auf BMD-taugliche Länge kürzen */
export function bmdText(s: string, max = 255): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

// ── Stammdaten (Personenkonten) ─────────────────────────────────────────────
export type PersonenkontoZeile = {
  kontonummer: string
  kontoart: 'D' | 'K'
  name: string
  strasse: string
  plz: string
  ort: string
  land: string
  uid: string
  email: string
  telefon: string
  zahlungsziel: number | ''
  skontopz: number | ''
  skontotage: number | ''
  extnummer: string   // unsere Accountnummer
}

export const PERSONENKONTO_SPALTEN: (keyof PersonenkontoZeile)[] = [
  'kontonummer', 'kontoart', 'name', 'strasse', 'plz', 'ort', 'land', 'uid', 'email', 'telefon', 'zahlungsziel', 'skontopz', 'skontotage', 'extnummer',
]

/** Spalten der Personenkonten für csvText(…, PROFIL_BMD): Zahlen roh (String(n) mit Komma), '' bleibt leer. */
export const PERSONENKONTO_CSV_SPALTEN: CsvSpalte<PersonenkontoZeile>[] = PERSONENKONTO_SPALTEN.map((k): CsvSpalte<PersonenkontoZeile> =>
  k === 'zahlungsziel' || k === 'skontotage' ? { kopf: k, typ: 'ganzzahl', stellen: 'roh', wert: z => z[k] }
    : k === 'skontopz' ? { kopf: k, typ: 'dezimal', stellen: 'roh', wert: z => z[k] }
      : { kopf: k, typ: 'text', wert: z => z[k] })

export function personenkontenCsv(zeilen: PersonenkontoZeile[]): string {
  return csvText(zeilen, PERSONENKONTO_CSV_SPALTEN, PROFIL_BMD)
}
