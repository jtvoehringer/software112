// Weinshop-Anbindung (KAN-463, 15.11.2026): Regeln der Warteschlange – rein, ohne Importe (Tests, Cron, Oberfläche).
//
// Entscheidungen Jörgen 15.11.2026 (Plan KAN-463): Abarbeitung alle 10 Minuten, je Lauf höchstens 100 Einträge; ein
// Fehlversuch wird nach 10 min, 30 min, 1 h, 3 h und danach alle 6 h wiederholt, höchstens 10 Versuche – dann bleibt
// der Eintrag als Fehler stehen, bis eine neue Änderung (oder „jetzt übertragen“) ihn zurücksetzt.

export const WARTESCHLANGE_JE_LAUF = 100
export const MAX_VERSUCHE = 10
export const LAUF_BUDGET_MS = 60_000

const ABSTAND_MIN = [10, 30, 60, 180, 360]

/** Zeitpunkt des nächsten Versuchs nach dem n-ten Fehlversuch (n ≥ 1) */
export function naechsterVersuch(fehlversuche: number, jetztMs: number): Date {
  const i = Math.min(Math.max(1, Math.floor(fehlversuche)), ABSTAND_MIN.length) - 1
  return new Date(jetztMs + ABSTAND_MIN[i] * 60_000)
}

export type WarteArt = 'bestand' | 'weindaten'

export type Lauf = {
  /** fällige Einträge dieses Laufs */
  geholt: number
  uebertragen: number
  fehler: number
  /** ohne Übertragung entfernt: Zuordnung gelöst, Modul bzw. Schalter aus, Füllung fehlt */
  entfernt: number
  /** aus Zeitmangel nicht mehr begonnen – bleiben für den nächsten Lauf */
  offen: number
  /** die ersten Fehlermeldungen (für den Systembericht) */
  meldungen: string[]
}

export const leererLauf = (): Lauf => ({ geholt: 0, uebertragen: 0, fehler: 0, entfernt: 0, offen: 0, meldungen: [] })

/** Kurztext eines Laufs für den Systembericht */
export function laufText(l: Lauf): string {
  const teile = [`${l.uebertragen} übertragen`]
  if (l.fehler) teile.push(`${l.fehler} Fehler`)
  if (l.entfernt) teile.push(`${l.entfernt} entfernt`)
  if (l.offen) teile.push(`${l.offen} offen (Zeit)`)
  return `Shop-Warteschlange: ${l.geholt} fällig, ${teile.join(', ')}`
}

/** Anzeige je Zuordnung: wartet ein Eintrag, und mit welchem Stand */
export type BestandAnzeige = { menge: number | null; am: string | null; fehler: string | null; wartet: boolean; versuche: number }
