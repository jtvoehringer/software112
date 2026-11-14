// Weinshop-Anbindung (KAN-460, 15.11.2026): Aufrufe der WooCommerce REST API v3 – in diesem Teil nur lesend
// (Verbindungstest). Nur serverseitig verwenden (Schlüssel im Klartext); keine `@/`-Importe, damit node:test die Datei
// direkt lädt. Fehler werden nicht geworfen, sondern als Ergebnis mit verständlicher Meldung zurückgegeben – ein
// Speichervorgang in software:112 darf nie an der Shop-API scheitern.
//
// Schutz vor Aufrufen ins interne Netz: Adresse geprüft (url.ts), Namensauflösung darf nur öffentliche Adressen
// liefern, Weiterleitungen werden nicht verfolgt, Zeitlimit 15 s.
import { lookup as dnsLookup } from 'node:dns/promises'
// @ts-expect-error TS5097 – .ts-Endung für node:test (ohne Bundler)
import { istInterneAdresse, shopUrlFehler, shopUrlNormalisiert } from './url.ts'

export const WOO_ZEITLIMIT_MS = 15_000

export type WooZugang = { url: string; key: string; secret: string }

export type WooFehlerArt = 'adresse' | 'nicht_erreichbar' | 'zeit' | 'weiterleitung' | 'kein_woocommerce' | 'schluessel' | 'recht' | 'antwort'

export type WooErgebnis<T> = { ok: true; daten: T } | { ok: false; art: WooFehlerArt; meldung: string }

export type WooUmgebung = {
  fetch?: typeof fetch
  /** Namensauflösung: alle Adressen des Hosts */
  aufloesen?: (host: string) => Promise<string[]>
}

const MELDUNG: Record<WooFehlerArt, string> = {
  adresse: 'Die Shop-Adresse ist ungültig.',
  nicht_erreichbar: 'Der Shop ist unter dieser Adresse nicht erreichbar.',
  zeit: 'Der Shop hat nicht rechtzeitig geantwortet (Zeitlimit 15 Sekunden).',
  weiterleitung: 'Der Shop leitet auf eine andere Adresse weiter – bitte die endgültige Adresse eintragen (z. B. mit „www.“).',
  kein_woocommerce: 'Unter dieser Adresse antwortet keine WooCommerce-Schnittstelle (REST API v3). Ist WooCommerce installiert und sind die Permalinks aktiv?',
  schluessel: 'Der Shop hat den Schlüssel abgelehnt – bitte Consumer Key und Consumer Secret prüfen.',
  recht: 'Der Schlüssel hat keine Berechtigung, Produkte zu lesen – bitte in WooCommerce „Lesen/Schreiben“ vergeben.',
  antwort: 'Der Shop hat unerwartet geantwortet.',
}

function fehler<T>(art: WooFehlerArt, zusatz?: string): WooErgebnis<T> {
  return { ok: false, art, meldung: zusatz ? `${MELDUNG[art]} ${zusatz}` : MELDUNG[art] }
}

async function standardAufloesen(host: string): Promise<string[]> {
  return (await dnsLookup(host, { all: true })).map(a => a.address)
}

/** GET auf einen Pfad der WooCommerce-API (`/products?per_page=1`) – geprüfte Adresse, Basic Auth, ohne Weiterleitung */
async function wooGet(z: WooZugang, pfad: string, umgebung: WooUmgebung): Promise<WooErgebnis<{ json: unknown; gesamt: number | null }>> {
  const adresseFehler = shopUrlFehler(z.url)
  const basis = shopUrlNormalisiert(z.url)
  if (adresseFehler || !basis) return { ok: false, art: 'adresse', meldung: adresseFehler ?? MELDUNG.adresse }
  if (!z.key.trim() || !z.secret.trim()) return fehler('schluessel')

  const host = new URL(basis).hostname
  let adressen: string[]
  try { adressen = await (umgebung.aufloesen ?? standardAufloesen)(host) } catch { return fehler('nicht_erreichbar') }
  if (adressen.length === 0) return fehler('nicht_erreichbar')
  if (adressen.some(istInterneAdresse)) return { ok: false, art: 'adresse', meldung: 'Diese Adresse ist nicht öffentlich erreichbar.' }

  let res: Response
  try {
    res = await (umgebung.fetch ?? fetch)(`${basis}/wp-json/wc/v3${pfad}`, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${Buffer.from(`${z.key.trim()}:${z.secret.trim()}`).toString('base64')}`,
        Accept: 'application/json',
        'User-Agent': 'software112-shop/1',
      },
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(WOO_ZEITLIMIT_MS),
    })
  } catch (e) {
    const name = (e as { name?: string } | null)?.name
    return fehler(name === 'TimeoutError' || name === 'AbortError' ? 'zeit' : 'nicht_erreichbar')
  }

  if (res.status >= 300 && res.status < 400) return fehler('weiterleitung')
  if (res.status === 401) return fehler('schluessel')
  if (res.status === 403) return fehler('recht')
  if (res.status === 404) return fehler('kein_woocommerce')
  if (!res.ok) return fehler('antwort', `(HTTP ${res.status})`)
  if (!/json/i.test(res.headers.get('content-type') ?? '')) return fehler('kein_woocommerce')
  let json: unknown
  try { json = await res.json() } catch { return fehler('kein_woocommerce') }
  const total = Number.parseInt(res.headers.get('x-wp-total') ?? '', 10)
  return { ok: true, daten: { json, gesamt: Number.isFinite(total) && total >= 0 ? total : null } }
}

/**
 * Verbindungstest: liest ein Produkt. Erfolg = Adresse stimmt, WooCommerce antwortet und der Schlüssel darf Produkte
 * lesen. Ob er auch schreiben darf, zeigt sich erst beim ersten Schreibzugriff (Zuordnung, KAN-461).
 */
export async function wooVerbindungTesten(z: WooZugang, umgebung: WooUmgebung = {}): Promise<WooErgebnis<{ produkte: number | null }>> {
  const r = await wooGet(z, '/products?per_page=1&_fields=id', umgebung)
  if (!r.ok) return r
  if (!Array.isArray(r.daten.json)) return fehler('kein_woocommerce')
  return { ok: true, daten: { produkte: r.daten.gesamt } }
}

/** Erfolgstext des Verbindungstests */
export function wooVerbindungText(produkte: number | null): string {
  if (produkte === null) return 'Verbindung steht.'
  return `Verbindung steht – ${produkte} ${produkte === 1 ? 'Produkt' : 'Produkte'} im Shop.`
}
