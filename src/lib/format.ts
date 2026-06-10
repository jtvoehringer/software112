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
