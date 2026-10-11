// ── Bienenschutz in der Blüte (KAN-171, 08.10.2026) ──────────────────────────────────────────────────────
//
// Entscheidung Jörgen (08.10.2026): Mit den vorhandenen Daten beginnen. Wird ein bienengefährliches Mittel
// (pflanzenschutzmittel.bienengefaehrlich) mit einem BBCH-Stadium der Blüte (60–69) erfasst, zeigt das Formular einen
// Hinweis, und die Aufzeichnung lässt sich nur mit bestätigtem Haken speichern (Formular und Server Action prüfen dieselbe
// Regel). Die Startuhrzeit ist für bienengefährliche Mittel schon seit KAN-87 Pflicht (uhrzeitFehler).
// Ein zulässiger BBCH-Bereich je Mittel (Zulassungsdaten) folgt bei Bedarf als eigener Schritt.
// Ohne '@/'-Importe, damit node:test sie prüfen kann.

/** Formularfeld des Hakens */
export const BIENENSCHUTZ_FELD = 'bienenschutz_bestaetigt'

export const BIENENSCHUTZ_HINWEIS =
  'Bienengefährliches Mittel in der Blüte (BBCH 60–69): Bienengefährliche Mittel dürfen nicht auf blühende Pflanzen – ' +
  'auch nicht auf blühenden Unterwuchs – ausgebracht werden; es gelten die Auflagen der Zulassung und die ' +
  'Bienenschutzbestimmungen des Bundeslandes (z. B. Ausbringung nur außerhalb des Bienenflugs, Unterwuchs vorher mulchen).'

export const BIENENSCHUTZ_BESTAETIGUNG =
  'Ich habe die Bienenschutz-Auflagen geprüft und eingehalten (z. B. keine blühenden Pflanzen im Bestand, außerhalb des Bienenflugs).'

/** BBCH-Stadium der Blüte (60–69) – Codes wie „61“, „65“, „69“; leer/ungültig = nein */
export function inBluete(bbch: string | null | undefined): boolean {
  const t = String(bbch ?? '').trim()
  if (!/^\d{1,2}$/.test(t)) return false
  const n = Number(t)
  return n >= 60 && n <= 69
}

/** Hinweis nötig? (bienengefährliches Mittel in der Blüte) */
export function bienenschutzRelevant(e: { bienengefaehrlich: boolean; bbch: string | null | undefined }): boolean {
  return e.bienengefaehrlich && inBluete(e.bbch)
}

/** KAN-325: Wert für behandlungen.bienenschutz_bestaetigt_am beim Speichern – ein Zeitpunkt, wenn bestätigt (die Datenbank
 *  setzt den eigenen Zeitpunkt samt Benutzer und behält eine frühere Bestätigung), null, wenn nicht (mehr) bienenrelevant.
 *  Relevant und nicht bestätigt lehnt bienenschutzFehler vorher ab. */
export function bienenschutzBestaetigtAm(e: { bienengefaehrlich: boolean; bbch: string | null | undefined; bestaetigt: boolean }, jetzt: Date = new Date()): string | null {
  return bienenschutzRelevant(e) && e.bestaetigt ? jetzt.toISOString() : null
}

/** Fehlertext, wenn der Hinweis nötig, aber nicht bestätigt ist – sonst null */
export function bienenschutzFehler(e: { bienengefaehrlich: boolean; bbch: string | null | undefined; bestaetigt: boolean }): string | null {
  return bienenschutzRelevant(e) && !e.bestaetigt
    ? 'Bienengefährliches Mittel in der Blüte – bitte bestätigen, dass die Bienenschutz-Auflagen eingehalten wurden.'
    : null
}
