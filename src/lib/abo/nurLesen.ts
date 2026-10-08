// ── Nur-Lesen-Modus im Browser (KAN-5, 25.09.2026) ───────────────────────────
//
// Ist das Abo des Betriebs gesperrt, rendert das (dashboard)-Layout den Betriebs-Wächter mit
// schreibgesperrt=true. Dessen fetch-Wrapper (components/BetriebsWaechter.tsx) behandelt
// schreibende Anfragen dann so (alles außer GET/HEAD/OPTIONS):
//
//  - Server Actions (POST mit Kopfzeile „Next-Action“ an die Seiten-URL): werden ABGESCHICKT.
//    Alle Action-Module prüfen die Sperre serverseitig und antworten in der Form, die das
//    jeweilige Formular kennt ({ error } inline bzw. AktionsFehler). Der Wächter liest nur eine
//    Kopie der Antwort mit (sperrArtImText) und meldet bei der Sperrmeldung NUR_LESEN_EREIGNIS.
//    (Ein vorzeitiges 403 text/plain würde Next als geworfenen Fehler behandeln – die
//    Fehlergrenze ersetzte dann die ganze Seite statt der Meldung im Formular.)
//  - sonstige Anfragen an die eigene Herkunft (/api …) → gar nicht erst abgeschickt, sofort
//    HTTP 403 JSON sperrAntwortKoerper() wie vom Server (KI-Routen mit der KI-Meldung).
//  - Supabase direkt aus dem Browser: Tabellen (PostgREST /rest/v1/<tabelle>) und Speicher
//    (/storage/v1/object/…) → sofort 403 in der Fehlerform von PostgREST bzw. Storage (die
//    Datenbank-Ebene sperrt zusätzlich, meldet UPDATE/DELETE aber still mit 0 Zeilen).
// Nicht angefasst: Pfade in NUR_LESEN_FREIE_PFADE (Abo, Anmeldung, Profil …), Supabase-Auth
// (/auth/v1: Abmelden, Zwei-Faktor), RPCs (/rest/v1/rpc: auch lesende Funktionen; schreibende
// RPCs sperrt die Datenbank selbst) sowie signierte Links und Listen im Speicher, fremde Herkünfte.
// In jedem Fall zeigt <NurLesenHinweis /> daraufhin einen Hinweis mit Link zum Abo. Die
// eigentliche Sperre bleibt der Server (lib/auth/sperren.ts) bzw. die Datenbank.
//
// Bewusst ohne Server- und React-Importe: genutzt von Client und node:test.

import { SCHREIBSPERRE_MELDUNG, sperrAntwortKoerper, type SperrArt } from '@/lib/abo/regeln'

export { sperrArtImText } from '@/lib/abo/regeln'

/** Ereignis an window, wenn der Server bzw. der Wächter eine Anfrage im Nur-Lesen-Modus ablehnt */
export const NUR_LESEN_EREIGNIS = 's112:nur-lesen'

/** detail von NUR_LESEN_EREIGNIS */
export type NurLesenDetail = { art: SchreibAnfrage; sperrArt: SperrArt }

/** API-Routen, die wegen der KI-Kosten gesperrt sind (eigene Meldung, siehe KI_SPERRE_MELDUNG) */
export const NUR_LESEN_KI_PFADE: readonly string[] = ['/api/ki-abfrage', '/api/assistent', '/api/nachrichten/lead-vorschlag', '/api/visitkarte']

/** Meldungsart für eine zurückgehaltene API-Anfrage */
export function sperrArtFuerPfad(pfad: string): SperrArt {
  const p = pfad.length > 1 ? pfad.replace(/\/+$/, '') : pfad
  return NUR_LESEN_KI_PFADE.some(k => p === k || p.startsWith(k + '/')) ? 'ki' : 'speichern'
}

/** Hält der Wächter diese Art von Anfrage selbst zurück? Server Actions nicht (siehe oben). */
export function zurueckhalten(art: SchreibAnfrage): boolean {
  return art !== 'aktion'
}

/**
 * Seiten und Routen, die auch im Nur-Lesen-Modus schreiben dürfen – je Eintrag mit Grund.
 * Server Actions schickt der Wächter ohnehin ab (der Server entscheidet je Aktion); die
 * Seitenpfade zählen nur für andere POSTs an diese Seiten.
 * scripts/tests/abo-nurlesen.test.mjs prüft, dass jede schreibende API-Route mit
 * „schreibsperre-ausnahme:“ hier freigegeben ist (sonst hielte der Browser zurück, was der
 * Server erlaubt).
 */
export const NUR_LESEN_FREIE_PFADE: readonly { pfad: string; grund: string }[] = [
  { pfad: '/abo', grund: 'Abo & Zahlung, Stripe-Checkout und -Portal (Server Actions der Seite /abo)' },
  { pfad: '/api/stripe', grund: 'Stripe (Checkout und Portal selbst laufen über die Server Actions von /abo)' },
  { pfad: '/auth', grund: 'Anmeldung, Einladung, Betrieb wechseln (/auth/betrieb)' },
  { pfad: '/api/auth', grund: 'Anmeldung und Microsoft-365-Verbindung' },
  { pfad: '/login', grund: 'Anmeldung' },
  { pfad: '/signup', grund: 'Registrierung' },
  { pfad: '/betrieb-waehlen', grund: 'Betrieb wechseln' },
  { pfad: '/zwei-faktor', grund: 'Zwei-Faktor-Anmeldung einrichten' },
  { pfad: '/profil', grund: 'eigenes Profil' },
  { pfad: '/api/profil', grund: 'eigenes Profil' },
  { pfad: '/benutzer', grund: 'Benutzerverwaltung: Zugriff entziehen bleibt möglich – der Server prüft jede Aktion' },
  { pfad: '/betrieb/einstellungen', grund: 'enthält die Benutzerverwaltung – der Server prüft jede Aktion (Einstellungen melden die Sperre als { error })' },
  { pfad: '/api/benachrichtigungen', grund: 'eigene Benachrichtigungen als gelesen markieren (Lesestatus)' },
  { pfad: '/api/release-notes', grund: 'Release Note als gesehen markieren (Lesestatus)' },
  { pfad: '/api/system/ereignis', grund: 'Fehlerprotokoll (Fehlergrenze des Arbeitsbereichs)' },
  { pfad: '/api/besuchsplanung', grund: 'nur lesend (Besuchsliste, Filter im POST-Körper)' },
  { pfad: '/api/nachrichten/disconnect', grund: 'gespeicherte Postfach-Zugangsdaten entfernen (Datenschutz)' },
  { pfad: '/api/betrieb/aktiv', grund: 'Betriebs-Wächter (nur lesend)' },
  { pfad: '/api/me', grund: 'Sitzungsdaten (nur lesend)' },
  { pfad: '/api/support/anfragen', grund: 'Support-Anfrage an Jira (KAN-230) – keine Betriebsdaten, Support muss gerade im Nur-Lesen-Modus erreichbar sein' },
]

/**
 * Tabellen, die auch die Datenbank-Sperre (Migration kan5_abo_schreibsperre, v_ausnahmen) im
 * Nur-Lesen-Modus schreiben lässt – muss zu den freien Pfaden oben passen (z. B.
 * /api/benachrichtigungen → benachrichtigungen, /api/nachrichten/disconnect → user_email_connections,
 * Benutzer entfernen → tenant_memberships). scripts/tests/abo-nurlesen.test.mjs gleicht das mit der
 * Migration ab, sobald sie unter supabase/migrations liegt.
 */
export const NUR_LESEN_DB_AUSNAHMEN: readonly string[] = ['tenant_memberships', 'user_email_connections', 'benachrichtigungen']

/** Pfad (ohne Query) auch im Nur-Lesen-Modus frei? Exakt oder darunter („/abo“, „/abo/…“). */
export function nurLesenFreierPfad(pfad: string): boolean {
  const p = pfad.length > 1 ? pfad.replace(/\/+$/, '') : pfad
  return NUR_LESEN_FREIE_PFADE.some(({ pfad: frei }) => p === frei || p.startsWith(frei + '/'))
}

export type SchreibAnfrage = 'aktion' | 'api' | 'datenbank' | 'speicher'

type RequestAehnlich = { url: string; method?: unknown; headers?: unknown }

function requestAehnlich(input: unknown): input is RequestAehnlich {
  return !!input && typeof input === 'object' && !(input instanceof URL) && typeof (input as { url?: unknown }).url === 'string'
}

function urlVon(input: unknown): string | null {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  if (requestAehnlich(input)) return input.url
  return null
}

/** Kopfzeile vorhanden? Für Headers-Objekt, Liste von Paaren und einfaches Objekt – ohne new Headers() (wirft bei Nicht-ASCII) */
function hatKopf(kopf: unknown, name: string): boolean {
  if (!kopf || typeof kopf !== 'object') return false
  const gesucht = name.toLowerCase()
  if (typeof (kopf as { has?: unknown }).has === 'function' && typeof (kopf as { get?: unknown }).get === 'function') {
    try { return (kopf as Headers).has(gesucht) } catch { return false }
  }
  if (Array.isArray(kopf)) return kopf.some(p => Array.isArray(p) && String(p[0]).toLowerCase() === gesucht)
  return Object.keys(kopf).some(k => k.toLowerCase() === gesucht)
}

function herkunft(url: string | null | undefined): string | null {
  if (!url) return null
  try { return new URL(url).origin } catch { return null }
}

/**
 * Würde diese fetch-Anfrage im Nur-Lesen-Modus etwas speichern? → Art der Anfrage, sonst null
 * (durchlassen). origin = window.location.origin, supabaseUrl = NEXT_PUBLIC_SUPABASE_URL.
 */
export function schreibAnfrageArt(
  input: unknown,
  init: RequestInit | undefined,
  origin: string,
  supabaseUrl?: string | null,
): SchreibAnfrage | null {
  const req = requestAehnlich(input) ? input : null
  const methode = String(init?.method ?? (typeof req?.method === 'string' ? req.method : 'GET')).toUpperCase()
  if (methode === 'GET' || methode === 'HEAD' || methode === 'OPTIONS') return null
  const url = urlVon(input)
  if (url === null) return null
  let ziel: URL
  try { ziel = new URL(url, origin) } catch { return null }

  if (ziel.origin === origin) {
    // Server Actions immer erkennen – auch auf freien Seiten (z. B. /betrieb/einstellungen): sie
    // gehen ohnehin an den Server, der Wächter liest nur mit und zeigt bei Ablehnung den Hinweis.
    // init.headers ersetzt die Kopfzeilen eines Request-Objekts (wie bei fetch)
    if (hatKopf(init?.headers ?? req?.headers, 'next-action')) return 'aktion'
    return nurLesenFreierPfad(ziel.pathname) ? null : 'api'
  }

  if (ziel.origin === herkunft(supabaseUrl)) {
    const p = ziel.pathname
    if (p.startsWith('/rest/v1/') && !p.startsWith('/rest/v1/rpc/')) return 'datenbank'
    if (p.startsWith('/storage/v1/object/')
      && !p.startsWith('/storage/v1/object/sign/')
      && !p.startsWith('/storage/v1/object/list/')
      && !p.startsWith('/storage/v1/object/info/')) return 'speicher'
  }
  return null
}

export type SperrAntwort = { status: number; headers: Record<string, string>; body: string }

/**
 * Antwort, die der Wächter statt des Absendens liefert – in der Form, die der jeweilige
 * Aufrufer auch vom Server bzw. von Supabase bekäme (siehe Kopf dieser Datei). Für Server
 * Actions ('aktion') gibt es keine: die gehen immer an den Server (zurueckhalten() = false).
 * pfad = Zielpfad der API-Anfrage (für die KI-Meldung).
 */
export function sperrAntwort(art: Exclude<SchreibAnfrage, 'aktion'>, pfad = ''): SperrAntwort {
  const json = { 'content-type': 'application/json', 'x-s112-nur-lesen': '1' }
  switch (art) {
    case 'datenbank':
      // PostgREST-Fehlerform; 42501 reicht dbFehlerText() unverändert durch
      return { status: 403, headers: json, body: JSON.stringify({ code: '42501', message: SCHREIBSPERRE_MELDUNG, details: null, hint: 'abo_gesperrt' }) }
    case 'speicher':
      return { status: 403, headers: json, body: JSON.stringify({ statusCode: '403', error: 'Forbidden', message: SCHREIBSPERRE_MELDUNG }) }
    default:
      return { status: 403, headers: json, body: JSON.stringify(sperrAntwortKoerper(sperrArtFuerPfad(pfad))) }
  }
}

/** Meldungsart einer zurückgehaltenen Anfrage (für den Hinweis) */
export function sperrArtFuer(art: Exclude<SchreibAnfrage, 'aktion'>, pfad = ''): SperrArt {
  return art === 'api' ? sperrArtFuerPfad(pfad) : 'speichern'
}

/** Pfad einer fetch-Anfrage (für sperrAntwort) – leer, wenn nicht lesbar */
export function anfragePfad(input: unknown, origin: string): string {
  const url = urlVon(input)
  if (url === null) return ''
  try { return new URL(url, origin).pathname } catch { return '' }
}

