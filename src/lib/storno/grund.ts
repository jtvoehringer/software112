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

// Grund einer Änderung (KAN-378, 23.10.2026): dieselbe Regel wie beim Storno – mindestens 10 Zeichen, höchstens 500.
// Dieselben Grenzen prüft die Datenbank (s112_fuellung_aendern); der Grund steht im Bestandsprotokoll.
export const AENDERUNG_GRUND_MAX = 500

/** Fehlermeldung zum Grund einer Änderung oder null, wenn er reicht */
export function aenderungGrundFehler(grund: unknown): string | null {
  const t = typeof grund === 'string' ? grund.trim() : ''
  if (t.length < STORNO_GRUND_MIN) return `Bitte einen Grund für die Änderung angeben (mindestens ${STORNO_GRUND_MIN} Zeichen).`
  if (t.length > AENDERUNG_GRUND_MAX) return `Der Grund der Änderung ist zu lang (höchstens ${AENDERUNG_GRUND_MAX} Zeichen).`
  return null
}

/** Automatischer Grund beim Bearbeiten (Storno + Neuanlage) – Bearbeiten braucht keinen eigenen Grund */
export const GRUND_BEARBEITET = 'Korrektur über „Bearbeiten“ – ersetzt durch die geänderte Buchung'
