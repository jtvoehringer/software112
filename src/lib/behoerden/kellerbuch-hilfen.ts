// ── Hilfen der Gruppe „Kellerbuch“ (Behördenmeldungen als CSV, 24.09.2026) ─────
//
// Parameter (Gebinde-/Chargen-ID, Zeitraum von–bis), Zahlen aus PostgREST (numeric kommt
// als String) und Kalendertage. Isomorph und ohne Server-Importe – die Ladefunktionen
// der Gruppe (bewegungsbuch.ts, keller-behandlungen.ts …) und scripts/tests/kellerbuch.test.mjs
// nutzen dieselben Regeln.

import { wienDatum, wienZeitpunkt } from '@/lib/csv'
import { parameterFehler, type ParameterFehler } from './typen'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type R = Record<string, any>

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TAG_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Zahl aus einem DB-Wert (numeric als String, number) – Ungültiges/leer → 0 */
export function num(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : 0
}

/** Zahl aus einem DB-Wert – leer/ungültig → null (fehlender Wert bleibt leer, nie 0) */
export function numOderNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

/** Text aus einem DB-Wert – leer → null */
export function text(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/** Kalendertag 'JJJJ-MM-TT' eines DATE- oder timestamptz-Werts (Zeitpunkte in Wiener Zeit); sonst '' */
export function tag(v: unknown): string {
  if (typeof v === 'string' && TAG_RE.test(v.trim())) return v.trim()
  return wienDatum(v) ?? ''
}

/** Gültiger Kalendertag 'JJJJ-MM-TT'? */
export function istTag(s: string): boolean {
  const m = TAG_RE.exec(s)
  if (!m) return false
  const j = Number(m[1]), mo = Number(m[2]), t = Number(m[3])
  const d = new Date(Date.UTC(j, mo - 1, t))
  return j >= 1900 && j <= 2200 && d.getUTCFullYear() === j && d.getUTCMonth() === mo - 1 && d.getUTCDate() === t
}

/** true, wenn der Tag im Zeitraum liegt (Grenzen inklusive; fehlende Grenze = offen) */
export function imZeitraum(datum: string, von: string | null, bis: string | null): boolean {
  if (von && (!datum || datum < von)) return false
  if (bis && (!datum || datum > bis)) return false
  return true
}

export type Zeitraum = { von: string | null; bis: string | null }

/** Zeitraum aus den Query-Parametern von/bis ('JJJJ-MM-TT', beide optional) */
export function zeitraumAus(sp: URLSearchParams): Zeitraum | ParameterFehler {
  const von = sp.get('von')?.trim() || null
  const bis = sp.get('bis')?.trim() || null
  if (von && !istTag(von)) return parameterFehler('„von“ ist kein gültiges Datum (JJJJ-MM-TT).')
  if (bis && !istTag(bis)) return parameterFehler('„bis“ ist kein gültiges Datum (JJJJ-MM-TT).')
  if (von && bis && von > bis) return parameterFehler('Der Zeitraum ist ungültig: „von“ liegt nach „bis“.')
  return { von, bis }
}

/** Zeitraum für Dateinamen: 2026-01-01_bis_2026-09-24, ab_…, bis_…; ohne Grenzen null (gesamt) */
export function zeitraumTeil(z: Zeitraum): string | null {
  if (z.von && z.bis) return `${z.von}_bis_${z.bis}`
  if (z.von) return `ab_${z.von}`
  if (z.bis) return `bis_${z.bis}`
  return null
}

/** Zeitraum für Überschriften: „01.01.2026 – 24.09.2026“ */
export function zeitraumAnzeige(z: Zeitraum): string {
  const f = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`
  if (z.von && z.bis) return `${f(z.von)} – ${f(z.bis)}`
  if (z.von) return `ab ${f(z.von)}`
  if (z.bis) return `bis ${f(z.bis)}`
  return 'gesamter Zeitraum'
}

/** Pflicht-UUID aus einem Query-Parameter */
export function uuidAus(sp: URLSearchParams, name: string, bezeichnung: string): string | ParameterFehler {
  const v = sp.get(name)?.trim() ?? ''
  if (!v) return parameterFehler(`${bezeichnung} fehlt (Parameter „${name}“).`)
  if (!UUID_RE.test(v)) return parameterFehler(`${bezeichnung} ist ungültig (Parameter „${name}“).`)
  return v.toLowerCase()
}

/** Optionale UUID aus einem Query-Parameter (leer → null) */
export function uuidOptional(sp: URLSearchParams, name: string, bezeichnung: string): string | null | ParameterFehler {
  const v = sp.get(name)?.trim() ?? ''
  if (!v) return null
  if (!UUID_RE.test(v)) return parameterFehler(`${bezeichnung} ist ungültig (Parameter „${name}“).`)
  return v.toLowerCase()
}

/** Optionaler Jahrgang (1900–2100) aus einem Query-Parameter */
export function jahrgangOptional(sp: URLSearchParams, name = 'jahrgang'): number | null | ParameterFehler {
  const v = sp.get(name)?.trim() ?? ''
  if (!v) return null
  const j = Number(v)
  if (!Number.isInteger(j) || j < 1900 || j > 2100) return parameterFehler(`Jahrgang „${v.slice(0, 20)}“ ist ungültig.`)
  return j
}

/** Optionaler Freitext-Filter aus einem Query-Parameter (leer → null) */
export function textOptional(sp: URLSearchParams, name: string, max = 200): string | null | ParameterFehler {
  const v = sp.get(name)?.trim() ?? ''
  if (!v) return null
  if (v.length > max) return parameterFehler(`Parameter „${name}“ ist zu lang.`)
  return v
}

/** Beginn eines Wiener Kalendertags als UTC-Zeitpunkt (ISO) – für timestamptz-Filter.
 *  Die Umstellung auf Sommer-/Winterzeit liegt nie um Mitternacht, daher genügen zwei Kandidaten. */
export function wienTagesbeginnUtc(datum: string): string {
  const [j, m, t] = datum.split('-').map(Number)
  for (const stunden of [1, 2]) {
    const d = new Date(Date.UTC(j, m - 1, t) - stunden * 3600_000)
    const w = wienZeitpunkt(d)
    if (w && w.datum === datum && w.uhrzeit === '00:00') return d.toISOString()
  }
  return new Date(Date.UTC(j, m - 1, t)).toISOString()
}

/** Folgetag 'JJJJ-MM-TT' */
export function folgetag(datum: string): string {
  const [j, m, t] = datum.split('-').map(Number)
  return new Date(Date.UTC(j, m - 1, t + 1)).toISOString().slice(0, 10)
}

/** Text kürzen (für lange Protokoll- und Detailfelder) */
export function kuerzen(s: string, max: number): string {
  const z = Array.from(s)
  return z.length > max ? z.slice(0, max - 1).join('') + '…' : s
}

