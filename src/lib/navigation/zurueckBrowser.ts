// ── Zurück-Navigation im Browser (KAN-224) ──
// Seitenverlauf des Tabs in sessionStorage (Lesen/Schreiben abgesichert – privates Fenster, gesperrter Speicher) und das
// Ziel „dorthin, woher man kam“: Parameter zurueck → vorherige Seite im Verlauf → Standard. Nur im Client aufrufen.

import { sicheresZiel, verlaufNach, vorherigeSeite, zielNachAbschluss, VERLAUF_SCHLUESSEL, ZURUECK_PARAM, type ERLEDIGT_TEXT } from './zurueck'

export function leseVerlauf(): string[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(VERLAUF_SCHLUESSEL) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function merkeSeite(eintrag: string): void {
  try {
    sessionStorage.setItem(VERLAUF_SCHLUESSEL, JSON.stringify(verlaufNach(leseVerlauf(), eintrag)))
  } catch {
    // ohne Speicher: Zurück fällt auf die übergeordnete Seite zurück
  }
}

const aktuelleSeite = () => `${window.location.pathname}${window.location.search}`

/** Woher man kam: zurueck-Parameter, sonst vorherige Seite im Verlauf, sonst `standard` */
export function zurueckZiel(standard: string): string {
  const q = new URLSearchParams(window.location.search).get(ZURUECK_PARAM)
  return sicheresZiel(q, '') || vorherigeSeite(leseVerlauf(), aktuelleSeite()) || standard
}

/** Ziel nach dem Abschluss eines Vorgangs (mit Bestätigung) – für Client-Formulare nach erfolgreicher Server Action */
export function zielNachVorgang(standard: string, erledigt?: keyof typeof ERLEDIGT_TEXT | null): string {
  return zielNachAbschluss(zurueckZiel(standard), standard, erledigt)
}
