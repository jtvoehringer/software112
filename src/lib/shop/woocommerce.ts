// Weinshop-Anbindung (KAN-460/KAN-461, 15.11.2026): Aufrufe der WooCommerce REST API v3 – Verbindungstest, Produkte
// lesen und (einziger Schreibzugriff) die SKU eines Produkts setzen. Nur serverseitig verwenden (Schlüssel im Klartext); keine `@/`-Importe, damit node:test die Datei
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
  | 'schreibrecht' | 'sku_vergeben' | 'produkt_fehlt'

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
  schreibrecht: 'Der Schlüssel darf im Shop nicht schreiben – bitte in WooCommerce die Berechtigung „Lesen/Schreiben“ vergeben.',
  sku_vergeben: 'Diese Artikelnummer (SKU) ist im Shop schon bei einem anderen Produkt vergeben.',
  produkt_fehlt: 'Das Produkt gibt es im Shop nicht mehr.',
}

function fehler<T>(art: WooFehlerArt, zusatz?: string): WooErgebnis<T> {
  return { ok: false, art, meldung: zusatz ? `${MELDUNG[art]} ${zusatz}` : MELDUNG[art] }
}

async function standardAufloesen(host: string): Promise<string[]> {
  return (await dnsLookup(host, { all: true })).map(a => a.address)
}

/** Aufruf eines Pfads der WooCommerce-API (`/products?per_page=1`) – geprüfte Adresse, Basic Auth, ohne Weiterleitung */
async function wooAufruf(z: WooZugang, pfad: string, umgebung: WooUmgebung, schreiben?: { methode: 'PUT'; daten: Record<string, unknown> }): Promise<WooErgebnis<{ json: unknown; gesamt: number | null; seiten: number | null }>> {
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
      method: schreiben ? schreiben.methode : 'GET',
      ...(schreiben ? { body: JSON.stringify(schreiben.daten) } : {}),
      headers: {
        ...(schreiben ? { 'Content-Type': 'application/json' } : {}),
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
  if (schreiben && !res.ok) {
    // WooCommerce meldet Schreibfehler mit { code, message }: fehlendes Schreibrecht, vergebene SKU, gelöschtes Produkt
    let code = ''
    try { code = String(((await res.json()) as { code?: unknown } | null)?.code ?? '') } catch { /* kein JSON */ }
    if (res.status === 401 || res.status === 403 || /cannot_edit|cannot_create/.test(code)) return fehler(res.status === 401 && !/cannot_/.test(code) ? 'schluessel' : 'schreibrecht')
    if (/invalid_sku|sku_already|duplicate/.test(code)) return fehler('sku_vergeben')
    if (res.status === 404 || /invalid_id/.test(code)) return fehler('produkt_fehlt')
    return fehler('antwort', `(HTTP ${res.status})`)
  }
  if (res.status === 401) return fehler('schluessel')
  if (res.status === 403) return fehler('recht')
  if (res.status === 404) return fehler('kein_woocommerce')
  if (!res.ok) return fehler('antwort', `(HTTP ${res.status})`)
  if (!/json/i.test(res.headers.get('content-type') ?? '')) return fehler('kein_woocommerce')
  let json: unknown
  try { json = await res.json() } catch { return fehler('kein_woocommerce') }
  const zahl = (kopf: string) => { const n = Number.parseInt(res.headers.get(kopf) ?? '', 10); return Number.isFinite(n) && n >= 0 ? n : null }
  return { ok: true, daten: { json, gesamt: zahl('x-wp-total'), seiten: zahl('x-wp-totalpages') } }
}

/**
 * Verbindungstest: liest ein Produkt. Erfolg = Adresse stimmt, WooCommerce antwortet und der Schlüssel darf Produkte
 * lesen. Ob er auch schreiben darf, zeigt sich erst beim ersten Schreibzugriff (Zuordnung, KAN-461).
 */
export async function wooVerbindungTesten(z: WooZugang, umgebung: WooUmgebung = {}): Promise<WooErgebnis<{ produkte: number | null }>> {
  const r = await wooAufruf(z, '/products?per_page=1&_fields=id', umgebung)
  if (!r.ok) return r
  if (!Array.isArray(r.daten.json)) return fehler('kein_woocommerce')
  return { ok: true, daten: { produkte: r.daten.gesamt } }
}

/** Erfolgstext des Verbindungstests */
export function wooVerbindungText(produkte: number | null): string {
  if (produkte === null) return 'Verbindung steht.'
  return `Verbindung steht – ${produkte} ${produkte === 1 ? 'Produkt' : 'Produkte'} im Shop.`
}

// ── Produkte lesen und SKU schreiben (KAN-461) ───────────────────────────────────────────────────────────────────────

export const WOO_SEITE = 100
export const WOO_MAX_SEITEN = 10

export type WooProdukt = { id: number; name: string; sku: string | null; status: string | null; typ: string | null }

function alsProdukt(roh: unknown): WooProdukt | null {
  const r = roh as { id?: unknown; name?: unknown; sku?: unknown; status?: unknown; type?: unknown } | null
  const id = Number(r?.id)
  if (!r || !Number.isSafeInteger(id) || id <= 0) return null
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return { id, name: (text(r.name) ?? `Produkt ${id}`).slice(0, 300), sku: text(r.sku)?.slice(0, 100) ?? null, status: text(r.status), typ: text(r.type) }
}

/**
 * Alle Produkte des Shops, seitenweise je 100 – höchstens 1.000 (`abgeschnitten`, wenn der Shop mehr hat).
 * Scheitert eine Folgeseite, ist das Ergebnis ein Fehler: nie mit einer Teilmenge weiterarbeiten.
 */
export async function wooProdukteLaden(z: WooZugang, umgebung: WooUmgebung = {}): Promise<WooErgebnis<{ produkte: WooProdukt[]; abgeschnitten: boolean }>> {
  const produkte: WooProdukt[] = []
  let seiten = 1
  let abgeschnitten = false
  for (let seite = 1; seite <= seiten; seite++) {
    if (seite > WOO_MAX_SEITEN) { abgeschnitten = true; break }
    const r = await wooAufruf(z, `/products?per_page=${WOO_SEITE}&page=${seite}&orderby=id&order=asc&_fields=id,name,sku,status,type`, umgebung)
    if (!r.ok) return r
    if (!Array.isArray(r.daten.json)) return fehler('kein_woocommerce')
    for (const roh of r.daten.json) { const p = alsProdukt(roh); if (p) produkte.push(p) }
    // Seitenzahl aus dem Kopf der Antwort; fehlt er, weiterlesen, solange die Seite voll ist
    if (r.daten.seiten !== null) seiten = r.daten.seiten
    else seiten = r.daten.json.length === WOO_SEITE ? seite + 1 : seite
  }
  return { ok: true, daten: { produkte, abgeschnitten } }
}

/** Setzt die Artikelnummer (SKU) eines Produkts – der einzige Schreibzugriff dieser Stufe; sonst wird nichts geändert */
export async function wooSkuSchreiben(z: WooZugang, produktId: number, sku: string, umgebung: WooUmgebung = {}): Promise<WooErgebnis<{ sku: string }>> {
  if (!Number.isSafeInteger(produktId) || produktId <= 0) return fehler('produkt_fehlt')
  const r = await wooAufruf(z, `/products/${produktId}`, umgebung, { methode: 'PUT', daten: { sku } })
  if (!r.ok) return r
  const geschrieben = (r.daten.json as { sku?: unknown } | null)?.sku
  if (typeof geschrieben !== 'string' || geschrieben.trim().toLowerCase() !== sku.trim().toLowerCase()) return fehler('antwort', '(SKU nicht übernommen)')
  return { ok: true, daten: { sku: geschrieben.trim() } }
}

/** Ein Produkt mit aktuellem Namen und aktueller SKU (vor dem Schreiben der SKU: nie eine vorhandene überschreiben) */
export async function wooProduktLesen(z: WooZugang, produktId: number, umgebung: WooUmgebung = {}): Promise<WooErgebnis<WooProdukt>> {
  if (!Number.isSafeInteger(produktId) || produktId <= 0) return fehler('produkt_fehlt')
  const r = await wooAufruf(z, `/products/${produktId}?_fields=id,name,sku,status,type`, umgebung)
  if (!r.ok) return r.art === 'kein_woocommerce' ? fehler('produkt_fehlt') : r
  const p = alsProdukt(r.daten.json)
  return p && p.id === produktId ? { ok: true, daten: p } : fehler('produkt_fehlt')
}

// ── Weindaten schreiben (KAN-462) ────────────────────────────────────────────────────────────────────────────────────

export const WOO_META_PRAEFIX = 's112_'

/**
 * Schreibt Meta-Felder eines Produkts – ausschließlich Felder mit dem Präfix `s112_` (alles andere wird abgelehnt, bevor
 * der Shop aufgerufen wird). Titel, Texte, Bilder, Preise, Kategorien und Attribute bleiben unberührt.
 */
export async function wooMetaSchreiben(z: WooZugang, produktId: number, felder: { key: string; value: string }[], umgebung: WooUmgebung = {}): Promise<WooErgebnis<{ felder: number }>> {
  if (!Number.isSafeInteger(produktId) || produktId <= 0) return fehler('produkt_fehlt')
  if (felder.length === 0 || felder.some(f => !/^s112_[a-z0-9_]{1,40}$/.test(f.key) || typeof f.value !== 'string')) return fehler('antwort', '(ungültiges Meta-Feld)')
  const r = await wooAufruf(z, `/products/${produktId}`, umgebung, { methode: 'PUT', daten: { meta_data: felder.map(f => ({ key: f.key, value: f.value })) } })
  if (!r.ok) return r
  if (Number((r.daten.json as { id?: unknown } | null)?.id) !== produktId) return fehler('antwort', '(Produkt nicht bestätigt)')
  return { ok: true, daten: { felder: felder.length } }
}
