// Storno-Grund (KAN-145, 30.09.2026): Pflicht beim Stornieren, mindestens 10 Zeichen – dieselbe Regel prüft die
// Datenbank (CHECK *_storno_chk). Isomorph (Formular und Server Action).

export const STORNO_GRUND_MIN = 10

/** Fehlermeldung zum Grund oder null, wenn er reicht */
export function stornoGrundFehler(grund: unknown): string | null {
  const t = typeof grund === 'string' ? grund.trim() : ''
  if (t.length < STORNO_GRUND_MIN) return `Bitte einen Grund für den Storno angeben (mindestens ${STORNO_GRUND_MIN} Zeichen).`
  return null
}

/** Grund, wenn gültig (getrimmt) – sonst null */
export function stornoGrund(grund: unknown): string | null {
  return stornoGrundFehler(grund) ? null : String(grund).trim()
}

/** Automatischer Grund beim Bearbeiten (Storno + Neuanlage) – Bearbeiten braucht keinen eigenen Grund */
export const GRUND_BEARBEITET = 'Korrektur über „Bearbeiten“ – ersetzt durch die geänderte Buchung'
