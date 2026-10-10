// Sweep 86 (KAN-278, 10.10.2026): Ergebnis einer Abfrage auf einer Seite (Server Component) – bei einem Datenbankfehler
// werfen, damit die Fehlergrenze (error.tsx) eine Meldung zeigt, statt still eine leere Liste bzw. „nicht vorhanden“
// anzuzeigen (z. B. E-Label ohne Zutaten und Allergene, Erntemeldung ohne Lesedaten). Wächter: check-einzelabfrage.

type Ergebnis = { data: unknown; error: { message?: string } | null }

/**
 * data der Abfrage; wirft bei error mit „<was> konnte nicht geladen werden (…)“. Der Typ ist der des data-Felds
 * (Sweep 88: bei untypisierten Abfragen `any` wie bei `const { data } = …`, nicht `unknown`).
 */
export function geladen<E extends Ergebnis>(res: E, was: string): E['data'] {
  if (res.error) throw new Error(`${was} konnte nicht geladen werden (${res.error.message ?? 'unbekannter Fehler'})`)
  return res.data
}
