// ── Sitzungsende nach Inaktivität und beim Schließen des Browsers (KAN-286, 10.10.2026) ────────────────────────────
//
// Befund: Die Abmeldung nach Inaktivität war ein reiner Timer im offenen Tab (SessionTimeout). Wurde der Tab geschlossen,
// lief nichts ab – das Anmelde-Cookie von Supabase ist dauerhaft, ein neuer Tab am nächsten Tag war sofort angemeldet.
// Bei Betrieben ohne eingestellte Zeitspanne (Gebeshuber, Spaetrot, Sandbox) lief die Sitzung nie ab.
//
// Entscheidung Jörgen 10.10.2026: Standard 60 Minuten Inaktivität (Betriebe stellen 5–480 Minuten ein) und Ende der
// Sitzung beim Schließen des Browsers.
// Umsetzung: Cookie „s112-sitzung“ OHNE Ablaufdatum (Sitzungs-Cookie, fällt beim Schließen des Browsers weg) mit dem
// Zeitpunkt der letzten Aktivität und der Zeitspanne des Betriebs. Der Proxy prüft es bei jedem Seitenaufruf, der Client
// (SessionTimeout) schreibt es bei Aktivität nach. Fehlt es (neuer Browser) oder ist es abgelaufen, meldet der Proxy ab –
// außer die Anmeldung (last_sign_in_at) ist jünger als die letzte Aktivität bzw. frisch (gerade angemeldet).
// Isomorph (node:test).

export const SITZUNG_COOKIE = 's112-sitzung'
/** Entscheidung Jörgen 10.10.2026: ohne Einstellung des Betriebs */
export const STANDARD_TIMEOUT_MIN = 60
export const TIMEOUT_MIN_MIN = 5
export const TIMEOUT_MAX_MIN = 480
/** Wie lange eine Anmeldung als „gerade erfolgt“ gilt (Weg über Zwei-Faktor und Betriebswahl) */
export const FRISCH_ANGEMELDET_MS = 10 * 60 * 1000

/** Zeitspanne in Minuten: 5–480, sonst der Standard (60) */
export function timeoutMinuten(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n <= 0) return STANDARD_TIMEOUT_MIN
  return Math.min(TIMEOUT_MAX_MIN, Math.max(TIMEOUT_MIN_MIN, Math.round(n)))
}

/** Wert des Cookies: „<letzte Aktivität ms>.<Minuten>“ */
export function sitzungWert(jetztMs: number, minuten: unknown): string {
  return `${Math.floor(jetztMs)}.${timeoutMinuten(minuten)}`
}

export function leseSitzung(wert: string | null | undefined): { zuletzt: number; minuten: number } | null {
  const m = /^(\d{10,16})\.(\d{1,4})$/.exec(wert ?? '')
  if (!m) return null
  return { zuletzt: Number(m[1]), minuten: timeoutMinuten(Number(m[2])) }
}

export type SitzungsPruefung =
  | { ergebnis: 'ok'; minuten: number }
  | { ergebnis: 'neu'; minuten: number }
  | { ergebnis: 'abgelaufen' }
  | { ergebnis: 'browser' }

/**
 * Prüfung bei jedem Seitenaufruf eines angemeldeten Benutzers.
 *  - Anmeldung jünger als die letzte Aktivität (bzw. ohne Cookie: frisch) → 'neu' (Sitzung beginnt)
 *  - Cookie da und innerhalb der Zeitspanne → 'ok'
 *  - Cookie da, Zeitspanne überschritten → 'abgelaufen'
 *  - Cookie fehlt, Anmeldung nicht frisch → 'browser' (Browser wurde geschlossen bzw. neues Gerät mit altem Cookie)
 */
export function pruefeSitzung(p: { cookie: string | null | undefined; jetztMs: number; letzteAnmeldung: string | null | undefined }): SitzungsPruefung {
  const s = leseSitzung(p.cookie)
  const anmeldung = p.letzteAnmeldung ? Date.parse(p.letzteAnmeldung) : NaN
  if (s) {
    if (Number.isFinite(anmeldung) && anmeldung > s.zuletzt) return { ergebnis: 'neu', minuten: s.minuten }
    return p.jetztMs - s.zuletzt > s.minuten * 60_000 ? { ergebnis: 'abgelaufen' } : { ergebnis: 'ok', minuten: s.minuten }
  }
  if (Number.isFinite(anmeldung) && p.jetztMs - anmeldung <= FRISCH_ANGEMELDET_MS) return { ergebnis: 'neu', minuten: STANDARD_TIMEOUT_MIN }
  return { ergebnis: 'browser' }
}

/** Grund für /login?grund=… */
export const ABMELDE_GRUND = { abgelaufen: 'timeout', browser: 'browser' } as const

/** Hinweis auf der Login-Seite */
export function abmeldeHinweis(grund: string | null | undefined): string | null {
  if (grund === 'timeout') return 'Du wurdest wegen Inaktivität abgemeldet. Bitte melde dich neu an.'
  if (grund === 'browser') return 'Die Sitzung endet mit dem Schließen des Browsers. Bitte melde dich neu an.'
  return null
}
