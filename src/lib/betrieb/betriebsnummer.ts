// Weinbau-Betriebsnummer (tenant_einstellungen.betrieb_betriebsnummer) – Pflichtfeld seit 25.09.2026
// (Vorgabe Jörgen). Sie steht auf Transportbescheinigung und Prüfnummernantrag und bildet den Anfang
// der Dateinamen der BKI-Berichte („Betriebsnummer_Jahr_Berichtsname.csv“). Die BKI-Schnittstelle
// führt Betriebsnummern als Ganzzahl – daher nur Ziffern (Leerzeichen werden entfernt), höchstens
// 10 Stellen (int(10) der Spezifikation).
//
// KAN-261 (09.10.2026): Pflicht nur für Weinproduzenten (tenant_einstellungen.betriebsart). Weinhändler gelten nicht
// als landwirtschaftlicher Betrieb und haben meist keine Weinbau-Betriebsnummer – für sie ist das Feld optional
// („falls vorhanden“, z. B. eine LFBIS-Nummer für Weindatenbank oder Prüfnummernantrag). Nur Nullen („0“, wie bei
// Spaetrot als Platzhalter eingetragen) sind keine Betriebsnummer.
//
// Reine Funktion ohne '@/'-Importe (node:test, scripts/tests/betriebsnummer.test.mjs).

export const BETRIEBSNUMMER_MAX_STELLEN = 10

export type Betriebsart = 'weinproduzent' | 'weinhaendler'

export const BETRIEBSARTEN: readonly { wert: Betriebsart; label: string; hinweis: string }[] = [
  { wert: 'weinproduzent', label: 'Weinproduzent', hinweis: 'Weinbaubetrieb mit eigener Erzeugung – Weinbau-Betriebsnummer Pflicht' },
  { wert: 'weinhaendler', label: 'Weinhändler', hinweis: 'Handelsbetrieb ohne eigenen Weinbau – Weinbau-Betriebsnummer nur, falls vorhanden' },
]

/** Betriebsart aus DB- oder Formularwert; Unbekanntes und leer gelten als Weinproduzent (Standard der Spalte) */
export function betriebsartAus(roh: unknown): Betriebsart {
  return roh === 'weinhaendler' ? 'weinhaendler' : 'weinproduzent'
}

/** Ist die Weinbau-Betriebsnummer für diese Betriebsart Pflicht? */
export function betriebsnummerPflicht(art: unknown): boolean {
  return betriebsartAus(art) === 'weinproduzent'
}

/** Muster für das pattern-Attribut der Eingabefelder: 1 bis 10 Ziffern, Leerzeichen dazwischen erlaubt
 *  (werden beim Speichern entfernt), mindestens eine Ziffer ungleich 0 – deckungsgleich mit
 *  weinbauBetriebsnummerPruefen(), damit der Browser schon vor dem Absenden meldet, was der Server ablehnen
 *  würde. Browser werten es mit v-Flag aus; ein leeres Feld prüft der Browser nicht gegen das Muster. */
export const BETRIEBSNUMMER_MUSTER = ` *(?=[0 ]*[1-9])(?:[0-9] *){1,${BETRIEBSNUMMER_MAX_STELLEN}}`

export const BETRIEBSNUMMER_ZWECK = 'Pflichtfeld – für Transportbescheinigung, Prüfnummernantrag und die Dateinamen der BKI-Berichte'
export const BETRIEBSNUMMER_ZWECK_HAENDLER = 'Nur falls vorhanden – Weinhändler brauchen keine Weinbau-Betriebsnummer'

/** Hinweistext unter dem Feld je Betriebsart */
export function betriebsnummerZweck(art: unknown): string {
  return betriebsnummerPflicht(art) ? BETRIEBSNUMMER_ZWECK : BETRIEBSNUMMER_ZWECK_HAENDLER
}

export type BetriebsnummerPruefung = { ok: true; wert: string | null } | { ok: false; fehler: string }

/** Prüft die Eingabe; leer ist nur für Weinhändler erlaubt (wert = null) */
export function weinbauBetriebsnummerPruefen(roh: unknown, art: unknown = 'weinproduzent'): BetriebsnummerPruefung {
  const wert = typeof roh === 'string' || typeof roh === 'number' ? String(roh).replace(/\s+/g, '') : ''
  if (!wert) {
    return betriebsnummerPflicht(art)
      ? { ok: false, fehler: 'Die Weinbau-Betriebsnummer ist für Weinproduzenten ein Pflichtfeld.' }
      : { ok: true, wert: null }
  }
  if (!/^\d+$/.test(wert)) return { ok: false, fehler: 'Die Weinbau-Betriebsnummer darf nur Ziffern enthalten (z. B. 4489781).' }
  if (wert.length > BETRIEBSNUMMER_MAX_STELLEN) {
    return { ok: false, fehler: `Die Weinbau-Betriebsnummer hat höchstens ${BETRIEBSNUMMER_MAX_STELLEN} Stellen.` }
  }
  if (/^0+$/.test(wert)) {
    return { ok: false, fehler: betriebsnummerPflicht(art)
      ? '„0“ ist keine Weinbau-Betriebsnummer – bitte die Nummer des Betriebs eintragen.'
      : '„0“ ist keine Weinbau-Betriebsnummer – ohne Nummer das Feld bitte leer lassen.' }
  }
  return { ok: true, wert }
}

/** Fehlt eine Pflicht-Nummer (leer oder nur Leerzeichen bei einem Weinproduzenten)? – für Hinweise (Formular, Morgenbericht) */
export function weinbauBetriebsnummerFehlt(wert: string | null | undefined, art: unknown = 'weinproduzent'): boolean {
  return betriebsnummerPflicht(art) && (!wert || !wert.trim())
}
