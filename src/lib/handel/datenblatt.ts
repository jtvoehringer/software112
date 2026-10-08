// KAN-220 (07.10.2026): Produktdatenblatt je Füllung – Bilder (Flasche, Etikett), Analysewerte für Datenblatt und
// Händler-Sammelexport (CSV). Isomorph und ohne '@/'-Importe (node:test lädt die Datei direkt).

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { csvDatei, PROFIL_EXCEL_AT, STELLEN, type CsvSpalte, type CsvErgebnis } from '../csv/index.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export const BILD_BUCKET = 'fuellung-bilder'
export const BILD_ARTEN = ['flasche', 'etikett'] as const
export type BildArt = (typeof BILD_ARTEN)[number]
export const BILD_LABEL: Record<BildArt, string> = { flasche: 'Flasche', etikett: 'Etikett' }
/** JPEG/PNG – @react-pdf/renderer bettet kein WebP ein (Bucket-Einstellung gleich) */
export const BILD_TYPEN: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png' }
export const BILD_MAX_BYTES = 4 * 1024 * 1024   // Vercel nimmt höchstens 4,5 MB je Anfrage an

export function istBildArt(x: unknown): x is BildArt {
  return typeof x === 'string' && (BILD_ARTEN as readonly string[]).includes(x)
}

/** Ablagepfad: <tenant>/<fuellung>/<art>.<ext> – der erste Ordner ist der Betrieb (Storage-Policies) */
export function bildPfad(tenantId: string, fuellungId: string, art: BildArt, typ: string): string {
  return `${tenantId}/${fuellungId}/${art}.${BILD_TYPEN[typ] ?? 'jpg'}`
}

/** Art aus einem Dateinamen des Ordners („flasche.png“ → flasche); sonst null */
export function bildArtAusName(name: string): BildArt | null {
  const art = name.split('.')[0]
  return istBildArt(art) ? art : null
}

/** Prüfung vor dem Hochladen; null = in Ordnung */
export function bildFehler(datei: { type: string; size: number } | null | undefined): string | null {
  if (!datei || datei.size === 0) return 'Bitte eine Bilddatei wählen.'
  if (!BILD_TYPEN[datei.type]) return 'Nur JPEG- oder PNG-Bilder sind möglich.'
  if (datei.size > BILD_MAX_BYTES) return 'Das Bild ist zu groß (höchstens 4 MB).'
  return null
}

const zahl = (x: unknown): number | null => {
  if (x === null || x === undefined || x === '') return null
  const n = typeof x === 'number' ? x : parseFloat(String(x))
  return Number.isFinite(n) ? n : null
}

export type AnalyseWerte = {
  alkohol: number | null
  restzucker: number | null
  saeure: number | null
  /** Herkunft der Werte: freigegebenes E-Label, jüngste Analyse (Datum JJJJ-MM-TT) oder keine */
  quelle: { art: 'elabel' } | { art: 'analyse'; datum: string } | null
}

/**
 * Analysewerte fürs Datenblatt: zuerst das freigegebene E-Label (dieselben Werte wie auf dem Etikett), sonst die
 * jüngste nicht stornierte Analyse der Chargen der Füllung.
 */
export function analyseWerte(elabel: R | null | undefined, analysen: readonly R[]): AnalyseWerte {
  if (elabel && elabel.status === 'freigegeben' && zahl(elabel.alkohol_vol) !== null) {
    return { alkohol: zahl(elabel.alkohol_vol), restzucker: zahl(elabel.restzucker_gl), saeure: zahl(elabel.gesamtsaeure_gl), quelle: { art: 'elabel' } }
  }
  const a = [...analysen].filter(x => !x.storniert_am)
    .sort((x, y) => String(y.analyse_datum ?? '').localeCompare(String(x.analyse_datum ?? '')))[0]
  if (!a) return { alkohol: null, restzucker: null, saeure: null, quelle: null }
  return { alkohol: zahl(a.alkohol_vol), restzucker: zahl(a.restzucker_gl), saeure: zahl(a.gesamtsaeure_gl), quelle: { art: 'analyse', datum: String(a.analyse_datum ?? '') } }
}

/** Zahl für Datenblatt/Anzeige: deutsches Komma, feste Stellen; null → „–“ */
export function wertText(n: number | null, stellen: number, einheit: string): string {
  return n === null ? '–' : `${n.toLocaleString('de-DE', { minimumFractionDigits: stellen, maximumFractionDigits: stellen })} ${einheit}`
}

/** Dateiname des Datenblatts: datenblatt-<name>-<jahrgang>.pdf (nur sichere Zeichen) */
export function datenblattDateiname(name: string | null | undefined, jahrgang: unknown): string {
  const teil = String(name ?? 'wein').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'wein'
  return `datenblatt-${teil}${jahrgang ? `-${jahrgang}` : ''}.pdf`
}

// ── Händler-Sammelexport (CSV) ───────────────────────────────────────────────────────────────────────────────

export type DatenblattExportZeile = {
  name: string | null
  jahrgang: number | null
  rebsorte: string | null
  qualitaet: string | null
  herkunft: string | null
  flaschengroesse: string | null
  alkohol: number | null
  restzucker: number | null
  saeure: number | null
  pruefnummer: string | null
  chargennummer: string | null
  elabel: string | null
}

export const SPALTEN_DATENBLATT: CsvSpalte<DatenblattExportZeile>[] = [
  { kopf: 'Name', typ: 'text', wert: z => z.name },
  { kopf: 'Jahrgang', typ: 'ganzzahl', stellen: STELLEN.ganzzahl, wert: z => z.jahrgang },
  { kopf: 'Rebsorte', typ: 'text', wert: z => z.rebsorte },
  { kopf: 'Qualität', typ: 'text', wert: z => z.qualitaet },
  { kopf: 'Herkunft', typ: 'text', wert: z => z.herkunft },
  { kopf: 'Flaschengröße', typ: 'text', wert: z => z.flaschengroesse },
  { kopf: 'Alkohol (% vol)', typ: 'dezimal', stellen: 1, wert: z => z.alkohol },
  { kopf: 'Restzucker (g/l)', typ: 'dezimal', stellen: 1, wert: z => z.restzucker },
  { kopf: 'Säure (g/l)', typ: 'dezimal', stellen: 1, wert: z => z.saeure },
  { kopf: 'Prüfnummer', typ: 'code', wert: z => z.pruefnummer },
  { kopf: 'Chargennummer', typ: 'code', wert: z => z.chargennummer },
  { kopf: 'E-Label', typ: 'text', wert: z => z.elabel },
]

export function datenblattCsv(zeilen: readonly DatenblattExportZeile[]): CsvErgebnis {
  return csvDatei(zeilen, SPALTEN_DATENBLATT, PROFIL_EXCEL_AT)
}
