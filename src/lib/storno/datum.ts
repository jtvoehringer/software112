// Storno-Datum (KAN-379, 27.10.2026): Der Stornobeleg und die Rückbuchung des Bestands tragen das Datum, an dem storniert
// wird – nie rückwirkend in einen abgeschlossenen Zeitraum. Untergrenze ist das Beleg- bzw. Rechnungsdatum, Obergrenze
// heute; den ersten offenen Tag (Periodensperre, UVA, BMD) prüft die Datenbank (HINT storno_datum). Isomorph (Formular
// und Server Action), Daten als JJJJ-MM-TT.

const TAG = /^\d{4}-\d{2}-\d{2}$/

function deutsch(tag: string): string {
  const [j, m, t] = tag.split('-')
  return `${t}.${m}.${j}`
}

/** Fehlermeldung zum Storno-Datum oder null, wenn es passt */
export function stornoDatumFehler(datum: unknown, grenzen: { ab?: string | null; heute: string }): string | null {
  const d = typeof datum === 'string' ? datum.trim() : ''
  if (!d) return 'Bitte das Storno-Datum angeben.'
  if (!TAG.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) return 'Das Storno-Datum ist ungültig.'
  if (d > grenzen.heute) return `Das Storno-Datum (${deutsch(d)}) liegt in der Zukunft.`
  const ab = grenzen.ab?.slice(0, 10)
  if (ab && TAG.test(ab) && d < ab) return `Das Storno-Datum (${deutsch(d)}) liegt vor dem Belegdatum (${deutsch(ab)}).`
  return null
}

/** Datenbank-Ablehnung zum Storno-Datum (HINT storno_datum bzw. Periodensperre) – Meldung gehört ans Datumsfeld */
export function istStornoDatumAblehnung(hint: unknown): boolean {
  return hint === 'storno_datum' || hint === 'periodensperre'
}
