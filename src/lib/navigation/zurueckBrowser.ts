// ── Zurück-Navigation im Browser (KAN-224) ──
// Seitenverlauf des Tabs in sessionStorage (Lesen/Schreiben abgesichert – privates Fenster, gesperrter Speicher) und das
// Ziel „dorthin, woher man kam“: Parameter zurueck → vorherige Seite im Verlauf → Standard. Nur im Client aufrufen.

import { sicheresZiel, verlaufNach, vorherigeSeite, zielImBereich, zielNachAbschluss, VERLAUF_SCHLUESSEL, ZURUECK_PARAM, type ERLEDIGT_TEXT } from './zurueck'
import { bereichsPfade } from './index'

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

/**
 * Ziel nach dem Speichern (KAN-334): zurueck-Parameter immer, die vorherige Seite im Verlauf nur im selben Bereich
 * wie das Formular, sonst `standard` (Liste des Bereichs). Dashboard und die Seite, auf der Strg K geöffnet wurde,
 * sind damit nie Ziel, außer das Formular liegt selbst dort.
 */
export function zielNachSpeichern(standard: string): string {
  const q = sicheresZiel(new URLSearchParams(window.location.search).get(ZURUECK_PARAM), '')
  if (q) return q
  return zielImBereich(bereichsPfade(), vorherigeSeite(leseVerlauf(), aktuelleSeite()), aktuelleSeite(), standard)
}

/** Ziel nach dem Abschluss eines Vorgangs (mit Bestätigung) – für Client-Formulare nach erfolgreicher Server Action */
export function zielNachVorgang(standard: string, erledigt?: keyof typeof ERLEDIGT_TEXT | null): string {
  return zielNachAbschluss(zielNachSpeichern(standard), standard, erledigt)
}

/**
 * Auf derselben Seite bleiben (KAN-334): Bearbeiten auf einer Detailseite (Charge, Ried, Behälter, DAC, Anlage)
 * führt nicht weg – aktuelle Seite mit Bestätigung; danach router.refresh() für frische Serverdaten.
 */
export function hierBleiben(erledigt: keyof typeof ERLEDIGT_TEXT = 'gespeichert'): string {
  return zielNachAbschluss(aktuelleSeite(), window.location.pathname, erledigt)
}
