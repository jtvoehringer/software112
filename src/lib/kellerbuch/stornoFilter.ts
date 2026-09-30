// KAN-145 (30.09.2026): Stornierte Buchungen bleiben stehen (storniert_am) und zählen nirgends. Umzüge und Verschnitte
// filtern die Abfragen direkt (.is('storniert_am', null)); Verschnitt-Quellen (verschneidung_quellen, ohne eigenes
// Kennzeichen) über die eingebettete Verschneidung – im Code, nicht per !inner, damit Zeilen ohne Einbettung nicht
// still verschwinden.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/** Quellzeilen ohne die stornierter Verschnitte (Einbettung „verschneidung“ mit storniert_am) */
export function ohneStornierteVerschnitte<T extends R>(zeilen: readonly T[]): T[] {
  return zeilen.filter(z => !(z.verschneidung as R | null | undefined)?.storniert_am)
}
