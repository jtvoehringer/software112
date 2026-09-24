// ── Gemeinsame Helfer der Gruppe „Buchhaltung & Steuer“ (24.09.2026) ─────────────
//
// Parameterprüfung (Jahr, Zeitraum von–bis, Konto) und kleine Umrechnungen, die UVA,
// E&A-Journal, Kassabuch, Rechnungsausgangsjournal, Belegverzeichnis, Anlagenverzeichnis
// und SVS-Einheitswerte teilen. Isomorph und ohne Datenbankzugriff (Tests: scripts/tests/
// buchhaltung.test.mjs).

import { runden, wienHeute } from '@/lib/csv'
import { parameterFehler, type ParameterFehler } from './typen'

const DATUM_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Kalendertag 'JJJJ-MM-TT' (streng, echtes Datum) */
export function istIsoDatum(s: unknown): s is string {
  if (typeof s !== 'string') return false
  const m = DATUM_RE.exec(s)
  if (!m) return false
  const j = Number(m[1]), mo = Number(m[2]), t = Number(m[3])
  const d = new Date(Date.UTC(j, mo - 1, t))
  return d.getUTCFullYear() === j && d.getUTCMonth() === mo - 1 && d.getUTCDate() === t
}

export function istUuid(s: unknown): s is string {
  return typeof s === 'string' && UUID_RE.test(s)
}

/** Jahr aus ?jahr= (2000–2100) */
export function jahrAus(sp: URLSearchParams): number | ParameterFehler {
  const roh = (sp.get('jahr') ?? '').trim()
  if (!roh) return parameterFehler('Das Jahr fehlt (?jahr=JJJJ).')
  const jahr = Number(roh)
  return Number.isInteger(jahr) && jahr >= 2000 && jahr <= 2100 ? jahr : parameterFehler(`Ungültiges Jahr „${roh.slice(0, 20)}“.`)
}

/** Zeitraum aus ?von=JJJJ-MM-TT&bis=JJJJ-MM-TT (von ≤ bis) */
export function zeitraumAus(sp: URLSearchParams): { von: string; bis: string } | ParameterFehler {
  const von = (sp.get('von') ?? '').trim()
  const bis = (sp.get('bis') ?? '').trim()
  if (!von || !bis) return parameterFehler('Der Zeitraum fehlt (?von=JJJJ-MM-TT&bis=JJJJ-MM-TT).')
  if (!istIsoDatum(von) || !istIsoDatum(bis)) return parameterFehler('Ungültiges Datum im Zeitraum – erwartet wird JJJJ-MM-TT.')
  if (von > bis) return parameterFehler('Der Zeitraum ist ungültig: „von“ liegt nach „bis“.')
  return { von, bis }
}

/** Standard-Zeitraum der Druckseiten: 1. Jänner des laufenden Jahres bis heute (Wiener Zeit) */
export function standardZeitraum(heute: string = wienHeute()): { von: string; bis: string } {
  return { von: `${heute.slice(0, 4)}-01-01`, bis: heute }
}

/** Zahl aus einem Datenbankwert (numeric kommt je nach Treiber als number oder string); null bei leer/ungültig */
export function zahl(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Eurobetrag kaufmännisch auf 2 Stellen; null bleibt null */
export function betrag(v: unknown): number | null {
  const n = zahl(v)
  return n === null ? null : runden(n, 2)
}

/** Summe bereits gerundeter Beträge (für Druck-Summen) – wieder auf 2 Stellen */
export function summe(werte: readonly (number | null | undefined)[]): number {
  return runden(werte.reduce<number>((s, w) => s + (w ?? 0), 0), 2)
}

/** Text oder null (leer → null) */
export function text(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/** Sachkonto vierstellig (Kontenklasse 0: 660 → 0660), wie in der BMD-Übergabe */
export function sachkonto(v: unknown): string | null {
  const n = zahl(v)
  return n === null ? null : String(Math.trunc(n)).padStart(4, '0')
}

export const KONTOART_LABEL: Record<string, string> = {
  giro: 'Girokonto', kreditkarte: 'Kreditkarte', kassa: 'Kassa', sonstiges: 'Sonstiges',
}

/** Datum 'JJJJ-MM-TT' → 'TT.MM.JJJJ' (stringbasiert, für Überschriften der Druckseiten) */
export function datumText(iso: string | null | undefined): string {
  if (!iso || !istIsoDatum(iso.slice(0, 10))) return '–'
  const [j, m, t] = iso.slice(0, 10).split('-')
  return `${t}.${m}.${j}`
}
