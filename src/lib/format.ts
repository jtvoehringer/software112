// ── Zahlenformat nach hohenstein CD-Manual (04 Typografie) ───────────────────
// „Zahlen, Beträge: IBM Plex Mono … immer rechtsbündig, zwei Nachkommastellen“,
// Beispiel „€ 48.320,00 · 1.284 hl · 14,2 ha“: Tausenderpunkt, Dezimalkomma,
// Euro-Zeichen vorne. Die Locale 'de-AT' liefert in Browser und Node ein
// schmales Leerzeichen als Tausendertrennung („10 583“), deshalb formatieren
// alle Helfer hier mit 'de-DE'. Datumsformate bleiben bei 'de-AT' (identisch).

export const ZAHL_LOCALE = 'de-DE'

export type Stellen = number | { min?: number; max?: number }

function stellenOpts(st: Stellen | undefined): Intl.NumberFormatOptions {
  if (st === undefined) return { maximumFractionDigits: 3 }            // wie toLocaleString() ohne Optionen
  if (typeof st === 'number') return { minimumFractionDigits: st, maximumFractionDigits: st }
  const min = st.min ?? 0
  const max = st.max ?? Math.max(min, 3)
  return { minimumFractionDigits: min, maximumFractionDigits: Math.max(min, max) }
}

/** Zahl mit Tausenderpunkt/Dezimalkomma. `stellen`: feste Anzahl Nachkommastellen oder { min, max } */
export function fmtNum(v: number, stellen?: Stellen): string {
  return v.toLocaleString(ZAHL_LOCALE, stellenOpts(stellen))
}

/** Betrag „€ 1.234,50“ – laut Manual zwei Nachkommastellen (abweichend nur, wenn explizit gesetzt) */
export function fmtEur(v: number, stellen: Stellen = 2): string {
  return `€ ${fmtNum(v, stellen)}`
}

/**
 * Liter-Mengen einheitlich mit 2 Dezimalstellen formatieren (Tausenderpunkt).
 * Negative Werte werden mit Minuszeichen dargestellt.
 */
export function fmtLiter(n: number | null | undefined, opts?: { noUnit?: boolean }): string {
  if (n == null) return '–'
  const s = n.toLocaleString(ZAHL_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return opts?.noUnit ? s : `${s} L`
}

/**
 * Mengen-Zahl ohne Einheit (z.B. für Tabellenfelder wo die Einheit in der Spaltenüberschrift steht).
 */
export function fmtMenge(n: number | null | undefined): string {
  if (n == null) return '–'
  return n.toLocaleString(ZAHL_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Fläche in ha – trailing zeros werden entfernt (max. 4 Stellen).
 */
export function fmtHa(n: number | null | undefined, digits = 4): string {
  if (n == null) return '–'
  return n.toLocaleString(ZAHL_LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/**
 * Euro-Betrag mit genau 2 Dezimalstellen (Tausenderpunkt, ohne €-Zeichen).
 */
export function fmtEuro(n: number | null | undefined): string {
  if (n == null) return '–'
  return n.toLocaleString(ZAHL_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Prozentzahl (Tausenderpunkt). digits = Nachkommastellen (Standard 1).
 */
export function fmtProzent(n: number | null | undefined, digits = 1): string {
  if (n == null) return '–'
  return n.toLocaleString(ZAHL_LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/**
 * Generische Zahl (Tausenderpunkt). Trailing zeros werden entfernt.
 */
export function fmtZahl(n: number | null | undefined, maxDigits = 3): string {
  if (n == null) return '–'
  return n.toLocaleString(ZAHL_LOCALE, { maximumFractionDigits: maxDigits })
}

// ── Eingaben lesen ────────────────────────────────────────────────────────────
// Bugreport 21.9.2026 (Offene Posten): der vorbelegte Betrag „36.125,00“ wurde über
// replace(',', '.') zu „36.125.00“ → parseFloat → 36,13 € statt 36.125,00 €. Dieselbe
// Zeile stand an 71 Stellen. dezimal() macht aus jeder üblichen Schreibweise eine
// JS-lesbare Zahl: „36.125,00“ → „36125.00“, „1,5“ → „1.5“, „1.250“ → „1250“,
// „0.125“ → „0.125“, „1250.5“ → „1250.5“, „€ 48.320,00“ → „48320.00“.
// Ein Punkt gilt als Tausenderpunkt, wenn genau drei Ziffern folgen und keine
// weitere Ziffer – außer die Zahl beginnt mit „0.“ (dann Dezimalpunkt).
const TAUSENDERPUNKT = /\b(?!0\.)(\d+)\.(?=\d{3}(?!\d))/g

/** Zahleneingabe (deutsch oder englisch) → String, den parseFloat/Number korrekt lesen. */
export function dezimal(s: unknown): string {
  const t = (s == null ? '' : String(s)).replace(/[\s€]/g, '')
  if (t.includes(',')) return t.replace(/\./g, '').replace(',', '.')
  return t.replace(TAUSENDERPUNKT, '$1')
}

/** Zahleneingabe → number oder null (leer/ungültig). Eine 0 bleibt 0 – Vorgabe mit `zahlAus(x) ?? 13`, nie
 *  `parseFloat(x) || 13` (Sweep 85: 0 % USt wurde 13 %, Wächter check-null-vorgabe). */
export function zahlAus(s: unknown): number | null {
  const t = dezimal(s)
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Ganzzahl-Eingabe (Tage, Prozent ohne Komma) → ganze Zahl (abgeschnitten wie parseInt) oder null. 0 bleibt 0. */
export function ganzzahlAus(s: unknown): number | null {
  const n = zahlAus(s)
  return n === null ? null : Math.trunc(n)
}

/** Wert aus der Datenbank (number oder numeric-String „13.00“) → number oder null; ohne Tausenderpunkt-Deutung
 *  (anders als zahlAus: „12.500“ aus numeric(…,3) ist 12,5). 0 bleibt 0. */
export function zahlWert(v: unknown): number | null {
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
