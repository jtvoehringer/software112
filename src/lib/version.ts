// ── Version und Stand von software:112 (13.10.2026) ──
// Eine Quelle für Login-Seite und Fußzeile der App (vorher fest eingetragen: Login „v2.1.0 · Juni 2026“, Fußzeile
// „v2.3.0 · August 2026“). Bei jeder neuen Release Note (Tabelle release_notes, System › Neuerungen) hier nachziehen:
// APP_VERSION_NR = release_notes.version der neuesten aktiven Note, APP_STAND = Monat ihrer Veröffentlichung.
// Ohne '@/'-Importe (Tests laden die Datei direkt).

/** Versionsnummer wie in release_notes.version (ohne „v“) */
export const APP_VERSION_NR = '2.4.0'

/** Monat und Jahr der Veröffentlichung */
export const APP_STAND = 'Oktober 2026'

/** Anzeige „v2.4.0 · Oktober 2026“ */
export const APP_VERSION = `v${APP_VERSION_NR} · ${APP_STAND}`
