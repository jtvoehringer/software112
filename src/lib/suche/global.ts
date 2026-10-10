// Hilfen der globalen Suche (Strg K, /api/global-search) – ohne Server-Importe, damit node:test sie laden kann.
//
// E2E-Ausbau 3 (11.10.2026): Die Suche filterte Jahrgänge über eine Umwandlung der Spalte in Text (ilike). PostgREST kennt keine
// Typumwandlung in Filtern und antwortet mit 400 – die Route meldete dann 500, die ganze Suche blieb leer. Jahrgänge
// werden jetzt nur bei einer Zahl gesucht, als Bereich („202“ → 2020–2029).

/** Suchtext für einen or()-Filter: Zeichen mit Bedeutung in PostgREST bzw. LIKE (% _ , ( ) * \ ") werden zu Leerzeichen */
export function sucheSicher(q: string): string {
  return q.replace(/[%_,()*\\"]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Jahrgänge, die zu einem Zahlen-Suchtext passen (1–4 Ziffern als Anfang der Jahreszahl), sonst null */
export function jahrgangBereich(q: string): { von: number; bis: number } | null {
  const t = q.trim()
  if (!/^\d{1,4}$/.test(t)) return null
  const faktor = 10 ** (4 - t.length)
  const von = Number(t) * faktor
  return { von, bis: von + faktor - 1 }
}

/** Teil eines or()-Filters für die Spalte jahrgang (Ganzzahl), oder null, wenn der Suchtext keine Jahreszahl sein kann */
export function jahrgangFilter(q: string, spalte = 'jahrgang'): string | null {
  const b = jahrgangBereich(q)
  if (!b) return null
  return b.von === b.bis ? `${spalte}.eq.${b.von}` : `and(${spalte}.gte.${b.von},${spalte}.lte.${b.bis})`
}
