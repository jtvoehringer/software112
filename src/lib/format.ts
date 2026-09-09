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
