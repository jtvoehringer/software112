/**
 * CSV-Utility für Listen-Exporte im Browser (Reports, Keller-Auswertungen, Import-Duplikate, KI).
 *
 * Seit 24.09.2026 ein dünner Wrapper um den CSV-Baustein src/lib/csv mit dem Profil
 * PROFIL_EXCEL_AT: Semikolon, CRLF (auch nach der letzten Zeile), UTF-8 mit BOM (setzt
 * csvText – hier steht bewusst kein BOM-Zeichen), Dezimalkomma ohne Tausenderpunkt,
 * TT.MM.JJJJ, Formelschutz (Apostroph) für Text. Vorher: Komma, LF, keine Typisierung –
 * in Excel mit österreichischer Regionseinstellung landete alles in einer Spalte.
 *
 * Behördenmeldungen laufen NICHT hierüber, sondern über das Register (src/lib/behoerden)
 * und die zentrale Route /meldungen/<id>/csv mit dem CsvExportKnopf.
 *
 * Signaturen wie bisher (toCSV, downloadCSV, exportCSV). Eine Spalte kann zusätzlich
 * `typ` und `stellen` angeben (siehe CsvTyp in src/lib/csv). Ohne `typ` wird der Typ je
 * SPALTE aus den Werten erkannt (leere Werte null/undefined/'' zählen nicht):
 *   nur endliche Zahlen (number)         → 'ganzzahl' bzw. 'dezimal' mit so vielen Stellen, wie die
 *                                          Werte der Spalte brauchen (höchstens 6) – keine stumme
 *                                          Rundung (Review 25.09.2026: vorher fest 2, 0,1234 ha → 0,12)
 *   nur boolean                          → 'janein' (Ja/Nein)
 *   nur Kalendertage 'JJJJ-MM-TT'        → 'datum' (TT.MM.JJJJ, ohne Zeitzone)
 *   nur Zeitpunkte mit Zone (ISO)        → 'zeitpunkt' (Wiener Zeit)
 *   sonst                                → 'text' (Formelschutz, Umbrüche → Leerzeichen)
 * Neue Aufrufer geben `typ` ausdrücklich an; Zahlen als number übergeben, nicht als
 * vorformatierten Text („12.50“ wäre Text, Excel-AT läse es als Datum).
 */

import { csvText, PROFIL_EXCEL_AT, rundeText, type CsvSpalte, type CsvTyp } from '@/lib/csv'

/** Höchstzahl Nachkommastellen bei erkannten Dezimalspalten */
const MAX_STELLEN_ERKANNT = 6

/** Nachkommastellen, die n braucht (Float-Artefakte wie 0,1 + 0,2 zählen nicht), höchstens MAX_STELLEN_ERKANNT */
export function noetigeStellen(n: number): number {
  for (let d = 0; d < MAX_STELLEN_ERKANNT; d++) {
    if (Math.abs(Number(rundeText(n, d)) - n) <= 1e-9 * Math.max(1, Math.abs(n))) return d
  }
  return MAX_STELLEN_ERKANNT
}

export type CsvSpalteDef = {
  key: string
  header: string
  /** Spaltentyp (Standard: aus den Werten erkannt) */
  typ?: CsvTyp
  /** Nachkommastellen dieser Spalte (Standard je Typ: ganzzahl 0, dezimal/betrag/prozent 2) */
  stellen?: number
}

const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/
const ZEITPUNKT_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?\s*(?:Z|[+-]\d{2}(?::?\d{2})?)$/i

function leer(v: unknown): boolean {
  return v === null || v === undefined || v === ''
}

/** Spaltentyp aus allen Werten einer Spalte (nie je Zelle – eine Spalte hat ein Format) */
export function spaltentypErkennen(werte: readonly unknown[]): { typ: CsvTyp; stellen?: number } {
  const w = werte.filter(v => !leer(v))
  if (w.length === 0) return { typ: 'text' }
  if (w.every(v => typeof v === 'number' && Number.isFinite(v))) {
    const stellen = Math.max(...(w as number[]).map(noetigeStellen))
    return stellen === 0 ? { typ: 'ganzzahl' } : { typ: 'dezimal', stellen }
  }
  if (w.every(v => typeof v === 'boolean')) return { typ: 'janein' }
  if (w.every(v => typeof v === 'string' && DATUM_RE.test(v))) return { typ: 'datum' }
  if (w.every(v => typeof v === 'string' && ZEITPUNKT_RE.test(v.trim()))) return { typ: 'zeitpunkt' }
  return { typ: 'text' }
}

/** Typisierte Spalten für csvText aus der bisherigen { key, header }-Schreibweise */
export function csvSpalten(rows: readonly Record<string, unknown>[], columns: readonly CsvSpalteDef[]): CsvSpalte<Record<string, unknown>>[] {
  return columns.map(c => {
    const erkannt = c.typ ? { typ: c.typ } : spaltentypErkennen(rows.map(r => r[c.key]))
    const stellen = c.stellen ?? ('stellen' in erkannt ? erkannt.stellen : undefined)
    return { kopf: c.header, typ: erkannt.typ, ...(stellen !== undefined ? { stellen } : {}), wert: (r: Record<string, unknown>) => r[c.key] }
  })
}

/** CSV-Text im Standardprofil EXCEL_AT (BOM, Semikolon, CRLF, Kopfzeile auch bei 0 Zeilen) */
export function toCSV(rows: Record<string, unknown>[], columns: CsvSpalteDef[]): string {
  return csvText(rows, csvSpalten(rows, columns), PROFIL_EXCEL_AT)
}

/** Fertigen CSV-Text herunterladen: Anker im DOM, Object-URL erst verzögert freigeben
 *  (sofortiges revokeObjectURL bricht den Download in Safari/Firefox teils ab). */
export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' }) // csv-ignore: Download des mit csvText() erzeugten Texts (Wrapper für Listen-Exporte)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function exportCSV(rows: Record<string, unknown>[], columns: CsvSpalteDef[], filename: string): void {
  downloadCSV(toCSV(rows, columns), filename)
}
