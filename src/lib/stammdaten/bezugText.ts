// Stammdaten mit Bezug (KAN-150, 01.10.2026): Formatierung der Bezugszähler aus s112_stammdaten_bezuege – isomorph
// (Server Action und Client), ohne '@/'-Importe (node:test).

/** Zähler je Bezeichnung, z. B. { 'Maßnahmen': 48, 'Chargen': 2 } – nur Werte > 0 */
export type Bezuege = Record<string, number>

/** „2 Chargen, 48 Maßnahmen“ – nach Bezeichnung sortiert wie die Meldung der Datenbank */
export function bezugsText(b: Bezuege): string {
  return Object.entries(b)
    .filter(([, n]) => Number(n) > 0)
    .sort(([a], [c]) => a.localeCompare(c, 'de'))
    .map(([k, n]) => `${n} ${k}`)
    .join(', ')
}

/** Summe mehrerer Zählerlisten (z. B. alle Datensätze einer Ried) */
export function bezuegeSumme(liste: Bezuege[]): Bezuege {
  const s: Bezuege = {}
  for (const b of liste) for (const [k, n] of Object.entries(b)) s[k] = (s[k] ?? 0) + Number(n)
  return s
}

export function hatBezug(b: Bezuege): boolean {
  return Object.values(b).some(n => Number(n) > 0)
}

/** Meldung, wenn ein Stammdatum wegen Bezug nicht gelöscht werden kann – die App bietet dann „Deaktivieren“ an */
export function bezugsMeldung(name: string, b: Bezuege, was = 'Der Datensatz'): string {
  return `„${name}“ hat noch ${bezugsText(b)} – ${was} kann nicht gelöscht, aber deaktiviert werden.`
}
