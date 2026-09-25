// Weinbau-Betriebsnummer (tenant_einstellungen.betrieb_betriebsnummer) – Pflichtfeld seit 25.09.2026
// (Vorgabe Jörgen). Sie steht auf Transportbescheinigung und Prüfnummernantrag und bildet den Anfang
// der Dateinamen der BKI-Berichte („Betriebsnummer_Jahr_Berichtsname.csv“). Die BKI-Schnittstelle
// führt Betriebsnummern als Ganzzahl – daher nur Ziffern (Leerzeichen werden entfernt), höchstens
// 10 Stellen (int(10) der Spezifikation).
//
// Reine Funktion ohne '@/'-Importe (node:test, scripts/tests/betriebsnummer.test.mjs).

export const BETRIEBSNUMMER_MAX_STELLEN = 10

/** Muster für das pattern-Attribut der Eingabefelder (Leerzeichen erlaubt, werden beim Speichern entfernt) */
export const BETRIEBSNUMMER_MUSTER = '[0-9 ]{1,20}'

export const BETRIEBSNUMMER_ZWECK = 'Pflichtfeld – für Transportbescheinigung, Prüfnummernantrag und die Dateinamen der BKI-Berichte'

export type BetriebsnummerPruefung = { ok: true; wert: string } | { ok: false; fehler: string }

export function weinbauBetriebsnummerPruefen(roh: unknown): BetriebsnummerPruefung {
  const wert = typeof roh === 'string' || typeof roh === 'number' ? String(roh).replace(/\s+/g, '') : ''
  if (!wert) return { ok: false, fehler: 'Die Weinbau-Betriebsnummer ist ein Pflichtfeld.' }
  if (!/^\d+$/.test(wert)) return { ok: false, fehler: 'Die Weinbau-Betriebsnummer darf nur Ziffern enthalten (z. B. 4489781).' }
  if (wert.length > BETRIEBSNUMMER_MAX_STELLEN) {
    return { ok: false, fehler: `Die Weinbau-Betriebsnummer hat höchstens ${BETRIEBSNUMMER_MAX_STELLEN} Stellen.` }
  }
  return { ok: true, wert }
}

/** Fehlt die Nummer (leer oder nur Leerzeichen)? – für Hinweise (Formular, Morgenbericht) */
export function weinbauBetriebsnummerFehlt(wert: string | null | undefined): boolean {
  return !wert || !wert.trim()
}
