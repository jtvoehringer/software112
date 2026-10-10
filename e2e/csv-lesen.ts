// ── CSV der Behördenmeldungen in den E2E-Tests lesen (Profil Excel-AT) ─────────
//
// UTF-8 mit BOM, Semikolon, CRLF, Dezimalkomma ohne Tausenderpunkt, Text ggf. in Anführungszeichen ("" = ").
// Für den Abgleich Druckseite = CSV (e2e/druck-csv.spec.ts).

export type CsvTabelle = { kopf: string[]; zeilen: string[][] }

/** Eine CSV-Zeile in Felder zerlegen (Anführungszeichen beachtet) */
function felder(zeile: string): string[] {
  const out: string[] = []
  let feld = '', q = false
  for (let i = 0; i < zeile.length; i++) {
    const c = zeile[i]
    if (q) {
      if (c === '"' && zeile[i + 1] === '"') { feld += '"'; i++ }
      else if (c === '"') q = false
      else feld += c
    } else if (c === '"') q = true
    else if (c === ';') { out.push(feld); feld = '' }
    else feld += c
  }
  out.push(feld)
  return out
}

export function csvTabelle(text: string): CsvTabelle {
  const ohneBom = text.replace(/^﻿/, '')
  const zeilen = ohneBom.split('\r\n').filter(z => z.length > 0).map(felder)
  return { kopf: zeilen[0] ?? [], zeilen: zeilen.slice(1) }
}

/** Zahl im österreichischen Format („1.234,5678“, „-0,5“, „12“) bzw. aus der CSV („1234,5678“); leer = 0 */
export function zahlDe(s: string): number {
  const t = s.replace(/\s|kg\/ha|kg|ha|€|%/g, '').replace(/\./g, '').replace(',', '.')
  if (t === '' || t === '–' || t === '-') return 0
  const n = Number(t)
  if (!Number.isFinite(n)) throw new Error(`keine Zahl: „${s}“`)
  return n
}

/** Summe einer Spalte (nach Kopfzeile); wirft, wenn es die Spalte nicht gibt */
export function spaltenSumme(t: CsvTabelle, kopf: string): number {
  const i = t.kopf.indexOf(kopf)
  if (i < 0) throw new Error(`Spalte „${kopf}“ fehlt – vorhanden: ${t.kopf.join(' | ')}`)
  return t.zeilen.reduce((s, z) => s + zahlDe(z[i] ?? ''), 0)
}
