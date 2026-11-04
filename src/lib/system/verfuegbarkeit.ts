// ── Verfügbarkeitsprüfung für den externen Monitor (KAN-401, 04.11.2026) ─────────────────────────────────────────────
//
// Anlage 3, Punkt 3.3 der Vertragsunterlagen sagt eine Überwachung von Anmeldung und Datenbank mindestens alle fünf
// Minuten samt Ausfallprotokoll zu. Der externe Monitor ruft dafür GET /api/health auf; diese Datei enthält die Prüfung
// ohne Next.js-Abhängigkeiten (node:test lädt sie direkt).
//
// Geprüft wird mit dem öffentlichen Anon-Schlüssel, ohne Service-Role und ohne Mandantendaten:
//  - db:   PostgREST liest eine Zeile aus `rebsorten` (bewusst öffentlich lesbar, siehe CLAUDE.md „RLS-Policies“) –
//          läuft damit durch PostgREST, den Pre-Request-Hook und Postgres
//  - auth: Health-Endpunkt des Supabase-Auth-Servers (GoTrue) – ohne ihn ist keine Anmeldung möglich
// Die Antwort verrät weder Fehlermeldungen noch Versionen; nur „ok“/„fehler“ je Teil.

export type TeilStatus = 'ok' | 'fehler'
export interface Verfuegbarkeit {
  ok: boolean
  teile: { app: TeilStatus; db: TeilStatus; auth: TeilStatus }
}

export interface PruefOptionen {
  url: string | undefined
  anonKey: string | undefined
  fetchFn?: typeof fetch
  zeitlimitMs?: number
}

export const ZEITLIMIT_MS = 5000

async function teilPruefen(fetchFn: typeof fetch, ziel: string, anonKey: string, zeitlimitMs: number): Promise<TeilStatus> {
  const abbruch = new AbortController()
  const uhr = setTimeout(() => abbruch.abort(), zeitlimitMs)
  try {
    const res = await fetchFn(ziel, {
      method: 'GET',
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: abbruch.signal,
    })
    // Inhalt verwerfen, damit die Verbindung frei wird
    await res.arrayBuffer().catch(() => undefined)
    return res.ok ? 'ok' : 'fehler'
  } catch {
    return 'fehler'
  } finally {
    clearTimeout(uhr)
  }
}

/** Prüft Datenbank und Anmeldedienst parallel; ok nur, wenn beide antworten. */
export async function pruefeVerfuegbarkeit(o: PruefOptionen): Promise<Verfuegbarkeit> {
  const fetchFn = o.fetchFn ?? fetch
  const zeitlimit = o.zeitlimitMs ?? ZEITLIMIT_MS
  if (!o.url || !o.anonKey) {
    return { ok: false, teile: { app: 'ok', db: 'fehler', auth: 'fehler' } }
  }
  const basis = o.url.replace(/\/+$/, '')
  const [db, auth] = await Promise.all([
    teilPruefen(fetchFn, `${basis}/rest/v1/rebsorten?select=id&limit=1`, o.anonKey, zeitlimit),
    teilPruefen(fetchFn, `${basis}/auth/v1/health`, o.anonKey, zeitlimit),
  ])
  return { ok: db === 'ok' && auth === 'ok', teile: { app: 'ok', db, auth } }
}
