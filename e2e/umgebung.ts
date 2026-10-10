// ── E2E-Umgebung: Variablen, Rollen und Produktionsschutz ─────────────────────
//
// Einzige Stelle, an der die E2E-Tests Umgebungsvariablen lesen. Wird von
// playwright.config.ts UND von den Tests importiert, damit Config und Laufzeit
// dieselbe Entscheidung treffen („darf dieser Lauf schreiben?“).
//
// Werte kommen aus der Prozess-Umgebung; zusätzlich (nachrangig) aus `.env.e2e` im
// Projektverzeichnis (gitignored, Vorlage: .env.e2e.example). Zugangsdaten stehen
// NIE in Dateien im Repository.

import fs from 'node:fs'
import path from 'node:path'

export const ROLLEN = ['tenant_admin', 'winzer', 'leser'] as const
export type Rolle = (typeof ROLLEN)[number]

/** Produktion – schreibende Tests dagegen sind ausgeschlossen (siehe e2e/README.md) */
export const PRODUKTIONS_DOMAIN = 'software112.icp-consultants.at'
export const PRODUKTIONS_SUPABASE_REF = 'zwcsgnemijkpyxrqykul'

/** Staging (seit 26.09.2026): eigene Datenbank, Vercel-Umgebung „staging“ baut den Branch staging.
 *  Schreibende Tests gegen eine entfernte Adresse sind NUR gegen dieses Supabase-Projekt erlaubt. */
export const STAGING_DOMAIN = 'staging.software112.icp-consultants.at'
export const STAGING_SUPABASE_REF = 'sjpeghrlhsowmquacjhb'
export const STAGING_SUPABASE_URL = `https://${STAGING_SUPABASE_REF}.supabase.co`

const PROJEKT = path.resolve(__dirname, '..')

/** Einfache KEY=VALUE-Datei lesen (ohne dotenv-Abhängigkeit); # = Kommentar */
function envDateiLesen(datei: string): Record<string, string> {
  const pfad = path.join(PROJEKT, datei)
  if (!fs.existsSync(pfad)) return {}
  const out: Record<string, string> = {}
  for (const roh of fs.readFileSync(pfad, 'utf8').split(/\r?\n/)) {
    const zeile = roh.trim()
    if (!zeile || zeile.startsWith('#')) continue
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(zeile)
    if (!m) continue
    let wert = m[2].trim()
    if ((wert.startsWith('"') && wert.endsWith('"')) || (wert.startsWith("'") && wert.endsWith("'"))) wert = wert.slice(1, -1)
    out[m[1]] = wert
  }
  return out
}

// .env.e2e nur ergänzend: gesetzte Prozess-Variablen (z. B. GitHub-Secrets) gewinnen
const ENV_E2E = envDateiLesen('.env.e2e')
for (const [k, v] of Object.entries(ENV_E2E)) {
  if (process.env[k] === undefined) process.env[k] = v
}

function env(name: string): string | undefined {
  const v = process.env[name]
  return v === undefined || v.trim() === '' ? undefined : v.trim()
}

export const BASE_URL = (env('E2E_BASE_URL') ?? 'http://localhost:3000').replace(/\/+$/, '')

/** true, wenn die Basis-URL auf diesen Rechner zeigt (lokaler Dev-/Prod-Server) */
export function istLokal(url: string = BASE_URL): boolean {
  try {
    const h = new URL(url).hostname
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h.endsWith('.localhost')
  } catch {
    return false
  }
}

/** Produktion: die Hauptdomain oder eine Betriebs-Subdomain (*.software112.icp-consultants.at) – nicht Staging.
 *  Vorher ein includes() auf den Domainnamen: das traf auch staging.software112… und hätte Staging blockiert. */
export function istProduktionsHost(url: string = BASE_URL): boolean {
  let h: string
  try { h = new URL(url).hostname.toLowerCase() } catch { return url.toLowerCase().includes(PRODUKTIONS_DOMAIN) }
  if (h === STAGING_DOMAIN) return false
  return h === PRODUKTIONS_DOMAIN || h.endsWith('.' + PRODUKTIONS_DOMAIN)
}

/** Lokaler Supabase-Stack (supabase start) */
function istLokalerStack(v: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(v)
}

/** Plausible Supabase-URL: gehostetes Projekt (https://<ref>.supabase.co) oder lokaler Stack */
function istSupabaseUrl(v: string): boolean {
  return /^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/i.test(v) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(v)
}

/**
 * Alle bekannten Angaben zum Supabase-Projekt der getesteten App:
 *  - E2E_SUPABASE_URL (ausdrücklich angegeben – Pflicht für entfernte Basis-URLs)
 *  - NEXT_PUBLIC_SUPABASE_URL aus der Umgebung
 *  - nur bei lokaler Basis-URL: NEXT_PUBLIC_SUPABASE_URL aus .env.local (die nutzt `npm run dev`)
 * Bei entfernter Basis-URL zählt nur E2E_SUPABASE_URL (die Umgebung dieses Rechners sagt über
 * den entfernten Server nichts aus).
 */
function supabaseAngaben(): string[] {
  const liste = [env('E2E_SUPABASE_URL')]
  if (istLokal()) liste.push(env('NEXT_PUBLIC_SUPABASE_URL'), envDateiLesen('.env.local').NEXT_PUBLIC_SUPABASE_URL)
  return liste.filter((v): v is string => !!v)
}

/** Supabase-URL zur Anzeige; undefined = unbekannt → wird wie Produktion behandelt */
export function supabaseUrl(): string | undefined {
  return supabaseAngaben()[0]
}

export const NUR_LESEN = env('E2E_NUR_LESEN') === '1'

export type Ziel = {
  baseUrl: string
  supabase: string | undefined
  /** Basis-URL oder Supabase-Projekt ist (möglicherweise) die Produktion */
  produktion: boolean
  gruende: string[]
}

export function zielPruefen(): Ziel {
  const gruende: string[] = []
  const angaben = supabaseAngaben()
  const sb = angaben[0]
  if (istProduktionsHost()) gruende.push(`E2E_BASE_URL zeigt auf die Produktion (${PRODUKTIONS_DOMAIN})`)
  if (angaben.length === 0) {
    gruende.push(istLokal()
      ? 'Supabase-Projekt unbekannt (weder E2E_SUPABASE_URL noch NEXT_PUBLIC_SUPABASE_URL bzw. .env.local)'
      : 'entfernte E2E_BASE_URL ohne E2E_SUPABASE_URL – das Supabase-Projekt der App ist unbekannt (Vercel-Previews nutzen die Produktions-Datenbank)')
  }
  // Irgendeine Angabe mit der Produktions-Ref genügt (z. B. E2E_SUPABASE_URL=Test, aber .env.local=Produktion)
  if (angaben.some(v => v.toLowerCase().includes(PRODUKTIONS_SUPABASE_REF))) {
    gruende.push(`Supabase-Projekt ist die Produktion (${PRODUKTIONS_SUPABASE_REF})`)
  }
  const unplausibel = angaben.filter(v => !istSupabaseUrl(v))
  if (unplausibel.length > 0) gruende.push(`keine gültige Supabase-URL: ${unplausibel.join(', ')} (erwartet https://<ref>.supabase.co oder lokaler Stack)`)
  // Positivliste (E2E-Ausbau 10.10.2026): schreibend nur gegen Staging oder einen lokalen Stack – ein unbekanntes
  // Projekt (z. B. Tippfehler, anderes Kundenprojekt) gilt wie die Produktion
  const unbekannt = angaben.filter(v => !istLokalerStack(v) && !v.toLowerCase().includes(STAGING_SUPABASE_REF))
  if (angaben.length > 0 && unbekannt.length > 0) gruende.push(`Supabase-Projekt weder Staging (${STAGING_SUPABASE_REF}) noch lokal: ${unbekannt.join(', ')}`)
  return { baseUrl: BASE_URL, supabase: sb, produktion: gruende.length > 0, gruende }
}

/** Schreibende Tests (ohne Tag @lesend) sind nur erlaubt, wenn das Ziel sicher NICHT die Produktion ist und E2E_NUR_LESEN nicht gesetzt ist. */
export function schreibenErlaubt(): boolean {
  return !NUR_LESEN && !zielPruefen().produktion
}

// ── Zugangsdaten je Rolle ─────────────────────────────────────────────────────

export type Zugang = { email: string; passwort: string; totpSecret?: string; tenantId?: string }

const praefix = (r: Rolle) => `E2E_${r.toUpperCase()}_`

export function zugang(rolle: Rolle): Zugang | null {
  const p = praefix(rolle)
  const email = env(`${p}EMAIL`)
  const passwort = env(`${p}PASSWORT`)
  if (!email || !passwort) return null
  return { email, passwort, totpSecret: env(`${p}TOTP_SECRET`), tenantId: env(`${p}TENANT_ID`) }
}

export function rolleKonfiguriert(rolle: Rolle): boolean {
  return zugang(rolle) !== null
}

export const authDatei = (rolle: Rolle) => path.join(PROJEKT, 'e2e', '.auth', `${rolle}.json`)

// ── Weitere Test-Einstellungen ────────────────────────────────────────────────

/** Modul-Toggles des Test-Betriebs (E2E_MODULE, kommagetrennt, z. B. „modul_ea,modul_controlling“).
 *  Nicht gesetzt = alle Module an: Seiten nicht freigeschalteter Module leiten per Guard auf
 *  /dashboard um – das ist kein Fehler, prüft aber weniger. */
export function module(): string[] | null {
  const v = env('E2E_MODULE')
  return v === undefined ? null : v.split(',').map(s => s.trim()).filter(Boolean)
}

/** Zusätzliche Konsolenmeldungen, die kein Fehler sind (E2E_KONSOLE_IGNORIEREN, Regex, `||`-getrennt) */
export function konsoleIgnorieren(): RegExp[] {
  const v = env('E2E_KONSOLE_IGNORIEREN')
  return v ? v.split('||').map(s => new RegExp(s, 'i')) : []
}

export type FremderDatensatz = {
  /** Pfad eines Datensatzes aus Betrieb B, z. B. /crm/kontakte/<uuid> */
  pfad: string
  /** Optional: Text, der nur im fremden Datensatz vorkommt (Name o. ä.) – darf nicht erscheinen */
  text?: string
  /** Optional: nur für diese Rollen prüfen (Standard: alle konfigurierten) */
  rollen?: Rolle[]
}

/** Datensätze des Betriebs „E2E Fremdbetrieb (nur Staging)“ (44444444-…), angelegt am 10.10.2026 nur auf Staging,
 *  ohne Benutzer – kein Geheimnis, deshalb hier statt in E2E_FREMDE_IDS */
export const STAGING_FREMDE: FremderDatensatz[] = [
  { pfad: '/crm/kontakte/44444444-4444-4444-8444-000000000001', text: 'E2E-Fremdkontakt' },
  { pfad: '/crm/firmen/44444444-4444-4444-8444-000000000002', text: 'E2E-Fremdfirma' },
  { pfad: '/kellerbuch/behaelter/44444444-4444-4444-8444-000000000003/bewegungen', text: 'E2E-Fremdtank' },
]

/** E2E_FREMDE_IDS: JSON-Array aus Pfaden oder Objekten { pfad, text?, rollen? }; ohne Angabe gegen Staging STAGING_FREMDE */
export function fremdeDatensaetze(): FremderDatensatz[] {
  const v = env('E2E_FREMDE_IDS')
  if (!v) return (supabaseUrl() ?? '').includes(STAGING_SUPABASE_REF) ? STAGING_FREMDE : []
  let roh: unknown
  try {
    roh = JSON.parse(v)
  } catch (e) {
    throw new Error(`E2E_FREMDE_IDS ist kein gültiges JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!Array.isArray(roh)) throw new Error('E2E_FREMDE_IDS muss ein JSON-Array sein, z. B. ["/crm/kontakte/<uuid>"]')
  return roh.map((x, i) => {
    const d: FremderDatensatz = typeof x === 'string' ? { pfad: x } : (x as FremderDatensatz)
    if (!d || typeof d.pfad !== 'string' || !d.pfad.startsWith('/')) throw new Error(`E2E_FREMDE_IDS[${i}]: „pfad“ muss mit / beginnen`)
    return d
  })
}

/** Header für geschützte Vercel-Previews (Protection Bypass for Automation) */
export function vercelBypassHeader(): Record<string, string> {
  const v = env('E2E_VERCEL_BYPASS')
  return v ? { 'x-vercel-protection-bypass': v, 'x-vercel-set-bypass-cookie': 'true' } : {}
}
