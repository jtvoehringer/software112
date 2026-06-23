/**
 * Liter-Mengen einheitlich mit 2 Dezimalstellen formatieren (de-AT).
 * Negative Werte werden mit Minuszeichen dargestellt.
 */
export function fmtLiter(n: number | null | undefined, opts?: { noUnit?: boolean }): string {
  if (n == null) return '–'
  const s = n.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return opts?.noUnit ? s : `${s} L`
}

/**
 * Mengen-Zahl ohne Einheit (z.B. für Tabellenfelder wo die Einheit in der Spaltenüberschrift steht).
 */
export function fmtMenge(n: number | null | undefined): string {
  if (n == null) return '–'
  return n.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Fläche in ha – trailing zeros werden entfernt (de-AT, max. 4 Stellen).
 */
export function fmtHa(n: number | null | undefined, digits = 4): string {
  if (n == null) return '–'
  return n.toLocaleString('de-AT', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/**
 * Euro-Betrag mit genau 2 Dezimalstellen (de-AT, Tausender-Punkt).
 */
export function fmtEuro(n: number | null | undefined): string {
  if (n == null) return '–'
  return n.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Prozentzahl (de-AT). digits = Nachkommastellen (Standard 1).
 */
export function fmtProzent(n: number | null | undefined, digits = 1): string {
  if (n == null) return '–'
  return n.toLocaleString('de-AT', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/**
 * Generische Zahl (de-AT). Trailing zeros werden entfernt.
 */
export function fmtZahl(n: number | null | undefined, maxDigits = 3): string {
  if (n == null) return '–'
  return n.toLocaleString('de-AT', { maximumFractionDigits: maxDigits })
}
