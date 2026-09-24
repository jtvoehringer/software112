// ── Hilfen der Gruppe „Weinverkehr & Export“ (Behördenmeldungen als CSV, 24.09.2026) ──
//
// Transportbescheinigung und Prüfnummernantrag speichern ihre Formulare als JSONB
// (Freitextfelder). Für die CSV werden die Felder hier geprüft übernommen:
//  • Zahlen über zahlAus() (deutsche und englische Eingabe); Unlesbares → leer + Warnung
//  • Datumsangaben aus Tag/Monat/Jahr bzw. „TT/MM/JJJJ“ → 'JJJJ-MM-TT'; Ungültiges → leer + Warnung
//  • J/N-Felder → boolean
// Isomorph und ohne Server-Importe – scripts/tests/verkehr.test.mjs lädt die Datei direkt.

import { rundeText } from '@/lib/csv'
import { zahlAus } from '@/lib/format'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type R = Record<string, any>

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Kurzfassung einer Benutzereingabe für Warnungen */
function kurz(s: string): string {
  const t = s.replace(/\s+/g, ' ')
  return t.length > 40 ? `${t.slice(0, 39)}…` : t
}

/** Formularfeld (JSONB) als getrimmter Text – Zahlen als Text, alles andere leer */
export function feld(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  return ''
}

/** Leerer Text → null (für Spalten, die „kein Wert“ als leeres Feld zeigen) */
export function textOderNull(v: unknown): string | null {
  const t = feld(v)
  return t === '' ? null : t
}

/** Zahleneingabe eines Formularfelds → number | null. Unlesbares ergibt null und eine Warnung. */
export function zahlFeld(v: unknown, bezeichnung: string, warnungen: string[]): number | null {
  if (typeof v === 'number') {
    if (Number.isFinite(v)) return v
    warnungen.push(`${bezeichnung}: keine gültige Zahl – Feld leer gelassen`)
    return null
  }
  const t = feld(v)
  if (t === '') return null
  const n = zahlAus(t)
  if (n === null) {
    warnungen.push(`${bezeichnung}: „${kurz(t)}“ ist keine Zahl – Feld leer gelassen`)
    return null
  }
  return n
}

/** J/N-Feld (Formular: „J“/„N“, Checkbox: true/false) → boolean | null; Unbekanntes → null + Warnung */
export function jaNeinFeld(v: unknown, bezeichnung: string, warnungen: string[]): boolean | null {
  if (typeof v === 'boolean') return v
  const t = feld(v).toLowerCase()
  if (t === '') return null
  if (t === 'j' || t === 'ja') return true
  if (t === 'n' || t === 'nein') return false
  warnungen.push(`${bezeichnung}: „${kurz(feld(v))}“ ist weder J noch N – Feld leer gelassen`)
  return null
}

function gueltig(j: number, m: number, t: number): boolean {
  if (j < 1900 || j > 2999 || m < 1 || m > 12 || t < 1 || t > 31) return false
  const d = new Date(Date.UTC(j, m - 1, t))
  return d.getUTCFullYear() === j && d.getUTCMonth() === m - 1 && d.getUTCDate() === t
}

function alsDate(j: number, m: number, t: number): string {
  return `${String(j).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(t).padStart(2, '0')}`
}

/** Datum aus getrennten Feldern Tag/Monat/Jahr → 'JJJJ-MM-TT' | null (alle leer → null ohne Warnung) */
export function datumAusTeilen(tag: unknown, monat: unknown, jahr: unknown, bezeichnung: string, warnungen: string[]): string | null {
  const [t, m, j] = [feld(tag), feld(monat), feld(jahr)]
  if (t === '' && m === '' && j === '') return null
  if (/^\d{1,2}$/.test(t) && /^\d{1,2}$/.test(m) && /^\d{4}$/.test(j) && gueltig(Number(j), Number(m), Number(t))) {
    return alsDate(Number(j), Number(m), Number(t))
  }
  warnungen.push(`${bezeichnung}: „${kurz([t, m, j].join('.'))}“ ist kein gültiges Datum – Feld leer gelassen`)
  return null
}

/** Datumseingabe „TT/MM/JJJJ“, „TT.MM.JJJJ“, „TT-MM-JJJJ“ oder „JJJJ-MM-TT“ → 'JJJJ-MM-TT' | null */
export function datumAusEingabe(v: unknown, bezeichnung: string, warnungen: string[]): string | null {
  const s = feld(v)
  if (s === '') return null
  const iso = DATE_RE.exec(s)
  if (iso && gueltig(Number(iso[1]), Number(iso[2]), Number(iso[3]))) return s
  const de = /^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})$/.exec(s)
  if (de && gueltig(Number(de[3]), Number(de[2]), Number(de[1]))) return alsDate(Number(de[3]), Number(de[2]), Number(de[1]))
  warnungen.push(`${bezeichnung}: „${kurz(s)}“ ist kein gültiges Datum – Feld leer gelassen`)
  return null
}

/** Strenges DATE 'JJJJ-MM-TT' (Query-Parameter) prüfen */
export function istDatum(s: string | null | undefined): s is string {
  if (!s) return false
  const m = DATE_RE.exec(s)
  return !!m && gueltig(Number(m[1]), Number(m[2]), Number(m[3]))
}

/** Zahl für ein Formularfeld (Vorbelegung): Dezimalkomma, höchstens `stellen` Nachkommastellen, ohne Tausenderpunkt */
export function formularZahl(n: number | null | undefined, stellen = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return ''
  const s = rundeText(n, stellen)
  return (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s).replace('.', ',')
}

/** „Hauptstraße 12“ → { strasse: 'Hauptstraße', hausnr: '12' }; ohne Nummer bleibt alles in strasse */
export function strasseTeilen(v: unknown): { strasse: string; hausnr: string } {
  const teile = feld(v).split(/\s+/).filter(Boolean)
  if (teile.length < 2) return { strasse: teile[0] ?? '', hausnr: '' }
  return { strasse: teile.slice(0, -1).join(' '), hausnr: teile[teile.length - 1] }
}

/** Liste in Blöcke teilen (z. B. .in('id', block) mit höchstens 100 UUIDs je Abfrage) */
export function inBloecken<T>(liste: readonly T[], groesse = 100): T[][] {
  const out: T[][] = []
  for (let i = 0; i < liste.length; i += groesse) out.push(liste.slice(i, i + groesse))
  return out
}

/** Optionaler Text-Parameter nur für den Dateinamen (gekürzt, leer → undefined) */
export function dateiParameter(sp: URLSearchParams, name: string): string | undefined {
  const v = (sp.get(name) ?? '').trim()
  return v === '' ? undefined : v.slice(0, 60)
}
