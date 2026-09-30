// KAN-145 (30.09.2026): Stornierte Buchungen bleiben stehen (storniert_am) und zählen nirgends. Umzüge und Verschnitte
// filtern die Abfragen direkt (.is('storniert_am', null)); Verschnitt-Quellen (verschneidung_quellen, ohne eigenes
// Kennzeichen) über die eingebettete Verschneidung – im Code, nicht per !inner, damit Zeilen ohne Einbettung nicht
// still verschwinden.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/** Storno-Angaben einer Zeile (bzw. ihrer eingebetteten Verschneidung) – null, wenn nicht storniert */
export function stornoAngaben(z: R | null | undefined): { am: string; grund: string | null; von: string | null } | null {
  const q = (z?.storniert_am ? z : (z?.verschneidung as R | null | undefined)) ?? null
  if (!q?.storniert_am) return null
  return { am: String(q.storniert_am), grund: q.storno_grund ? String(q.storno_grund) : null, von: q.storniert_von_name ? String(q.storniert_von_name) : null }
}

/** Zeile storniert? (eigene Spalte oder eingebettete Verschneidung) */
export function istStorniert(z: R | null | undefined): boolean {
  return stornoAngaben(z) !== null
}

/** Quellzeilen ohne die stornierter Verschnitte (Einbettung „verschneidung“ mit storniert_am) */
export function ohneStornierteVerschnitte<T extends R>(zeilen: readonly T[]): T[] {
  return zeilen.filter(z => !(z.verschneidung as R | null | undefined)?.storniert_am)
}
