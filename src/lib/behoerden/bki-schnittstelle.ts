// ── BKI-Schnittstelle: Export-Grundgerüst (KAN-50 AP13, 10.10.2026) ──────────────────────────────────────────────
//
// Eine Arbeitsmappe mit einem Blatt je Spezifikationsblatt („SchnittstelleDatenMitDefinitionTypen“, 15 Blätter, in
// dieser Reihenfolge) plus vorangestelltem Prüfbericht. Jedes Blatt ist eine Behördenmeldung des Registers – dieselbe
// Ladefunktion wie Druckseite und CSV (/meldungen/<id>/csv); diese Datei ordnet nur zu, prüft und baut die Mappe.
// Blätter ohne Umsetzung (Rückverfolgung KAN-46, Verkauf/Einkauf/TBS KAN-49) stehen im Prüfbericht als „folgt“.
//
// Formatierung (Typdefinition der Spezifikation): date → echte Excel-Datumszelle yyyy-mm-dd, decimal → Zahl mit fester
// Nachkommastellenzahl der Spalte, int → Zahl ohne Nachkommastellen, boolean → WAHR/FALSCH, varchar → Text, auf die
// Länge der Spezifikation gekürzt (mit Hinweis). Zahlen, Daten und Ja/Nein laufen über dieselbe Prüfung wie die CSV
// (csvZelleGeprueft): ungültige Werte bleiben leer und erscheinen im Prüfbericht.
//
// Annahmen (am Ticket KAN-50 dokumentiert):
//   S1 Zeitraum: ein gemeinsamer Zeitraum von–bis für Lagerbewegungen und BSM; Lagerstand zum Ende des Zeitraums (bzw.
//      zum gewählten Stichtag); besondere Konten (seit KAN-45 Blatt im Format der Spezifikation) für denselben Zeitraum.
//   S2 Mindestangaben je Blatt (die Spezifikation kennt keine Pflichtfelder): siehe MINDESTANGABEN – fehlt eine, meldet
//      der Prüfbericht die Anzahl der Zeilen.
//   S3 Längen: die in der Spezifikation kürzer als 255 Zeichen definierten Felder (LAENGEN), sonst 255 für jedes Textfeld.

import { csvZelleGeprueft, PROFIL_EXCEL_AT, STANDARD_STELLEN, type CsvProfil, type CsvSpalte } from '@/lib/csv'
import { xlsxMappe, type XlsxBlatt, type XlsxZelle } from '@/lib/xlsx'

export type BkiBlatt = {
  /** Name des Blatts in der Spezifikation */
  blatt: string
  /** Register-id der Behördenmeldung; null = noch nicht umgesetzt */
  meldung: string | null
  /** Ticket, mit dem das Blatt kommt */
  folgt?: string
  /** KAN-46: Blatt braucht eine Auswahl (Charge, Grundstück …) – nicht in der Gesamtdatei, nur einzeln */
  nurEinzeln?: string
}

export const BKI_BLAETTER: readonly BkiBlatt[] = [
  { blatt: 'Betriebsdaten', meldung: 'bki-betriebsdaten' },
  { blatt: 'Qualitätsstufen', meldung: 'bki-qualitaetsstufen' },
  { blatt: 'Weingärten', meldung: 'bki-weingaerten' },
  { blatt: 'Erzeugnisse', meldung: 'bki-erzeugnisse' },
  { blatt: 'Buchungsarten', meldung: 'bki-buchungsarten' },
  { blatt: 'GebindeVerzeichnis', meldung: 'bki-gebindeverzeichnis' },
  { blatt: 'RV zum Eingang', meldung: 'bki-rv-eingang', nurEinzeln: 'je Charge oder Grundstück unter Kellerbuch › BKI-Schnittstelle › Rückverfolgung' },
  { blatt: 'RV zum Ausgang', meldung: 'bki-rv-ausgang', nurEinzeln: 'je Charge oder Füllung unter Kellerbuch › BKI-Schnittstelle › Rückverfolgung' },
  { blatt: 'Lagerstand zum Zeitraum', meldung: 'bki-lagerstand' },
  { blatt: 'Verkauf im Zeitraum', meldung: 'bki-verkauf' },
  { blatt: 'Einkauf im Zeitraum', meldung: 'bki-einkauf' },
  { blatt: 'TBS-Aufstellung', meldung: 'bki-tbs' },
  { blatt: 'Lagerbewegungen', meldung: 'bki-lagerbewegungen' },
  { blatt: 'Besondere Konten', meldung: 'bki-besondere-konten' },
  { blatt: 'BSM', meldung: 'bsm' },
]

// ── Parameter ───────────────────────────────────────────────────────────────

export type BkiZeitraum = { von: string; bis: string; stichtag: string }

/** Weinwirtschaftsjahr (Beginn 01.08.) eines Tages: 2026-07-31 → 2025, 2026-08-01 → 2026 */
export function weinwirtschaftsjahr(tag: string): number {
  const j = Number(tag.slice(0, 4))
  return Number(tag.slice(5, 7)) >= 8 ? j : j - 1
}

/** S1: Query-Parameter der einzelnen Meldung aus dem gemeinsamen Zeitraum */
export function parameterFuer(meldung: string, z: BkiZeitraum): URLSearchParams {
  switch (meldung) {
    case 'bki-lagerstand': return new URLSearchParams({ stichtag: z.stichtag })
    case 'bki-lagerbewegungen':
    case 'bki-besondere-konten':
    case 'bki-verkauf':
    case 'bki-einkauf':
    case 'bki-tbs':
    case 'bsm': return new URLSearchParams({ von: z.von, bis: z.bis })
    case 'besondere-konten': return new URLSearchParams({ jahr: String(weinwirtschaftsjahr(z.bis)) })
    default: return new URLSearchParams()
  }
}

// ── Prüfung ─────────────────────────────────────────────────────────────────

/** S3: Feldlängen laut Spezifikation (varchar), soweit kürzer als 255; Schlüssel = Spaltenkopf der Meldung */
export const LAENGEN: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  'bki-betriebsdaten': { PLZ: 8, Hausnummer: 20 },
  'bki-gebindeverzeichnis': { Bezeichnung: 50 },
  'bki-lagerstand': { 'Erzeugnis lt. Liste': 8, Farbe: 8, 'Länderkürzel': 4, 'Qualitätsstufe': 8 },
  'bki-lagerbewegungen': { 'Erzeugnis lt. Liste': 8, Farbe: 8, 'Länderkürzel': 4, 'Qualitätsstufe': 8, 'Buchungsart BSM': 50 },
  'bki-qualitaetsstufen': { 'Kürzel': 8 },
  'bki-erzeugnisse': { 'Kürzel': 8 },
  'bki-buchungsarten': { 'Kürzel': 50 },
  'bki-besondere-konten': { Buchungsart: 50, Art: 50, 'Los-Nr': 50, Empfangscharge: 50 },
  'bki-verkauf': { 'Erzeugnis lt. Liste': 8, Farbe: 8, 'Länderkürzel': 4, 'Qualitätsstufe': 8, 'Buchungsart BSM': 50, Buchungsart: 50 },
  'bki-einkauf': { 'Erzeugnis lt. Liste': 8, Farbe: 8, 'Länderkürzel': 4, 'Qualitätsstufe': 8, 'Buchungsart BSM': 50, Buchungsart: 50 },
}
const MAX_TEXT = 255

/** S2: Mindestangaben je Blatt (Spaltenkopf der Meldung) */
export const MINDESTANGABEN: Readonly<Record<string, readonly string[]>> = {
  'bki-betriebsdaten': ['Betriebsnummer', 'Nachname/Firmenname', 'PLZ', 'Ort'],
  'bki-weingaerten': ['KG-Nr.', 'Grundstücksnummer'],
  'bki-gebindeverzeichnis': ['Bezeichnung', 'Nenninhalt (l)'],
  'bki-lagerstand': ['Erzeugnis lt. Liste', 'Farbe', 'Qualitätsstufe', 'IST-Menge in lt.'],
  'bki-lagerbewegungen': ['Datum', 'BelegNr.', 'Erzeugnis lt. Liste', 'Buchungsart BSM'],
  'bki-besondere-konten': ['Datum', 'Buchungsart', 'Bezeichnung', 'Art', 'Menge'],
  'bki-verkauf': ['Datum', 'BelegNr.', 'Erzeugnis lt. Liste', 'Buchungsart BSM'],
  'bki-einkauf': ['Datum', 'BelegNr.', 'Erzeugnis lt. Liste', 'Buchungsart BSM'],
  'bki-tbs': ['Datum', 'TBS Nummer', 'Menge'],
}

/** BelegNr. ist laut Spezifikation int(10) */
const INT10 = /^\d{1,10}$/

export type PruefHinweis = { blatt: string; art: 'fehlt' | 'warnung' | 'fehler' | 'info'; text: string }

/** XLSX-Profil: Formatierung wie die CSV (gerundet, NFC, Steuerzeichen), aber Datum ISO und kein Formelschutz –
 *  Textzellen sind in XLSX nie Formeln, ein Apostroph wäre Teil des Werts. */
const PROFIL_XLSX: CsvProfil = Object.freeze({ ...PROFIL_EXCEL_AT, name: 'XLSX', dezimal: '.', datum: 'JJJJ-MM-TT', formelschutz: false })

type ZellPruefung = { zelle: XlsxZelle; fehler?: string; gekuerzt?: boolean }

function zelleFuer(wert: unknown, s: CsvSpalte<unknown>, maxLaenge: number): ZellPruefung {
  const e = csvZelleGeprueft(wert, s.typ, PROFIL_XLSX, s.stellen)
  if (e.text === '') return { zelle: null, fehler: e.fehler }
  switch (s.typ) {
    case 'ganzzahl': case 'dezimal': case 'betrag': case 'prozent': {
      const stellen = s.stellen === 'roh' ? undefined : (s.stellen ?? STANDARD_STELLEN[s.typ])
      return { zelle: { t: 'n', v: Number(e.text), stellen } }
    }
    case 'datum': return { zelle: { t: 'd', v: e.text } }
    case 'janein': return { zelle: { t: 'b', v: e.text === PROFIL_XLSX.janein[0] } }
    default: {
      if (e.text.length > maxLaenge) return { zelle: { t: 's', v: e.text.slice(0, maxLaenge) }, gekuerzt: true }
      return { zelle: { t: 's', v: e.text } }
    }
  }
}

export type BlattErgebnis = {
  blatt: BkiBlatt
  /** null = nicht umgesetzt, nicht erlaubt oder Fehler (Grund in hinweise) */
  daten: { spalten: readonly CsvSpalte<unknown>[]; zeilen: readonly unknown[]; warnungen: readonly string[] } | null
  hinweise: PruefHinweis[]
}

/** Prüft ein geladenes Blatt und baut die XLSX-Zeilen (Kürzungen, ungültige Werte, Mindestangaben, BelegNr.) */
export function blattPruefen(meldung: string, blattName: string, spalten: readonly CsvSpalte<unknown>[], zeilen: readonly unknown[]): { xlsx: XlsxZelle[][]; hinweise: PruefHinweis[] } {
  const laengen = LAENGEN[meldung] ?? {}
  const mindest = new Set(MINDESTANGABEN[meldung] ?? [])
  const fehlerJeSpalte = new Map<string, number>(), gekuerztJeSpalte = new Map<string, number>(), leerJeSpalte = new Map<string, number>()
  let belegFalsch = 0
  const plus = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
  const xlsx = zeilen.map(z => spalten.map(s => {
    const wert = s.wert(z)
    const p = zelleFuer(wert, s, laengen[s.kopf] ?? MAX_TEXT)
    if (p.fehler) plus(fehlerJeSpalte, s.kopf)
    if (p.gekuerzt) plus(gekuerztJeSpalte, s.kopf)
    if (p.zelle === null && mindest.has(s.kopf)) plus(leerJeSpalte, s.kopf)
    if (s.kopf === 'BelegNr.' && p.zelle?.t === 's' && !INT10.test(p.zelle.v)) belegFalsch++
    return p.zelle
  }))
  const hinweise: PruefHinweis[] = []
  for (const [k, n] of leerJeSpalte) hinweise.push({ blatt: blattName, art: 'fehler', text: `${n} Zeile(n) ohne „${k}“ (Mindestangabe)` })
  for (const [k, n] of fehlerJeSpalte) hinweise.push({ blatt: blattName, art: 'fehler', text: `${n} ungültige(r) Wert(e) in „${k}“ – Zelle leer gelassen` })
  for (const [k, n] of gekuerztJeSpalte) hinweise.push({ blatt: blattName, art: 'warnung', text: `${n} Wert(e) in „${k}“ auf ${laengen[k] ?? MAX_TEXT} Zeichen gekürzt (Länge laut Spezifikation)` })
  if (belegFalsch) hinweise.push({ blatt: blattName, art: 'warnung', text: `${belegFalsch} BelegNr. nicht rein numerisch bzw. länger als 10 Stellen (Spezifikation: int(10))` })
  return { xlsx, hinweise }
}

/** Prüfbericht als Liste (Reihenfolge der Spezifikation), inkl. fehlender Blätter */
export function pruefbericht(ergebnisse: readonly BlattErgebnis[]): PruefHinweis[] {
  return ergebnisse.flatMap(e => {
    if (!e.blatt.meldung) return [{ blatt: e.blatt.blatt, art: 'fehlt' as const, text: `noch nicht umgesetzt – folgt mit ${e.blatt.folgt}` }]
    if (e.blatt.nurEinzeln) return [{ blatt: e.blatt.blatt, art: 'info' as const, text: `nicht in der Gesamtdatei – braucht eine Auswahl: ${e.blatt.nurEinzeln}` }]
    const anzahl = e.daten ? [{ blatt: e.blatt.blatt, art: 'info' as const, text: `${e.daten.zeilen.length} Zeile(n)` }] : []
    const laden = (e.daten?.warnungen ?? []).map(w => ({ blatt: e.blatt.blatt, art: 'warnung' as const, text: w }))
    return [...anzahl, ...e.hinweise, ...laden]
  })
}

const ART_TEXT: Record<PruefHinweis['art'], string> = { fehlt: 'fehlt', fehler: 'Fehler', warnung: 'Hinweis', info: 'Info' }

/** Arbeitsmappe: Prüfbericht + ein Blatt je umgesetztem Spezifikationsblatt (Reihenfolge der Spezifikation) */
export function bkiMappe(ergebnisse: readonly BlattErgebnis[], kopf: { betrieb: string; zeitraum: BkiZeitraum }): Uint8Array {
  const bericht = pruefbericht(ergebnisse)
  const blaetter: XlsxBlatt[] = [{
    name: 'Prüfbericht',
    kopf: ['Blatt', 'Art', 'Hinweis'],
    zeilen: [
      [{ t: 's', v: 'Betrieb' }, null, { t: 's', v: kopf.betrieb }],
      [{ t: 's', v: 'Zeitraum' }, null, { t: 's', v: `${kopf.zeitraum.von} bis ${kopf.zeitraum.bis}, Lagerstand zum ${kopf.zeitraum.stichtag}` }],
      ...bericht.map(h => [{ t: 's', v: h.blatt }, { t: 's', v: ART_TEXT[h.art] }, { t: 's', v: h.text }] as XlsxZelle[]),
    ],
  }]
  for (const e of ergebnisse) {
    if (!e.blatt.meldung || !e.daten) continue
    const { xlsx } = blattPruefen(e.blatt.meldung, e.blatt.blatt, e.daten.spalten, e.daten.zeilen)
    blaetter.push({ name: e.blatt.blatt, kopf: e.daten.spalten.map(s => s.kopf), zeilen: xlsx })
  }
  return xlsxMappe(blaetter)
}
