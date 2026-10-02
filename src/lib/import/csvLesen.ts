// ── CSV-Datei für den Datenimport lesen (aus admin/import/ImportClient.tsx, KAN-42 02.10.2026) ──────────
//
// Isomorph, ohne '@/'-Importe (node:test: scripts/tests/kan42-eroeffnung.test.mjs).

/**
 * Quote-bewusster CSV-Parser (RFC4180-artig). Ein Feld in Anführungszeichen darf das Trennzeichen (oder einen
 * Zeilenumbruch) enthalten, z. B. "gumpoldskirchen.zierfandler thermenregion DAC;  bio-demeter" bei einer mit ';'
 * getrennten Datei – der frühere naive line.split(';') hat solche Felder mitten im Wert aufgetrennt und dadurch ALLE
 * nachfolgenden Spalten dieser Zeile um eine Position verschoben (Rückmeldung 2.9.2026: Füllungen-Import).
 * Escaped-Quotes ("") innerhalb eines Feldes werden zu einem literalen " aufgelöst; ein führendes BOM (Excel-Export
 * unter Windows) wird entfernt. Trennzeichen: ';', wenn die erste Zeile eines enthält, sonst ','.
 */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const src = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const sep = firstLine.includes(';') ? ';' : ','

  const table: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === sep) {
      row.push(field); field = ''
    } else if (c === '\r') {
      // ignorieren, das folgende '\n' beendet die Zeile
    } else if (c === '\n') {
      row.push(field); table.push(row); row = []; field = ''
    } else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); table.push(row) }

  const trimmed = table.map(r => r.map(v => v.trim())).filter(r => r.some(v => v !== ''))
  if (trimmed.length < 2) return { headers: [], rows: [] }
  const headers = trimmed[0]
  const rows = trimmed.slice(1).map(vals => Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ''])))
  return { headers, rows }
}

/**
 * Dateiinhalt als Text: UTF-8 (mit oder ohne BOM); ist die Datei kein gültiges UTF-8 (Excel „CSV (Trennzeichen-
 * getrennt)“ speichert unter Windows ANSI), als Windows-1252 – sonst würden Umlaute zu „�“.
 */
export function csvDekodieren(bytes: ArrayBuffer | Uint8Array): string {
  const daten = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(daten)
  } catch {
    return new TextDecoder('windows-1252').decode(daten)
  }
}
