// ── Kleine Helfer der Meldungsgruppe „Ernte & Lese“ (24.09.2026) ────────────────
//
// Gemeinsam genutzt von erntemeldung.ts, bestandsmeldung.ts, traubenverkauf.ts und
// register/ernte.ts. Isomorph und ohne Next-/Server-Importe (scripts/tests/ernte.test.mjs
// lädt die Dateien direkt mit Node).

import { bkiRebsorteKuerzel } from '@/lib/wein/bki_kuerzel'
import { parameterFehler, type ParameterFehler } from './typen'

/** Zahl aus einem PostgREST-Wert (numeric kommt je nach Spalte als number oder string) – sonst null */
export function zahlOderNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Nicht-leerer Text oder null */
export function textOderNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

/** 'JJJJ-MM-TT' → 'TT.MM.JJJJ' (stringbasiert, ohne Zeitzone); sonst der Wert unverändert bzw. '–' */
export function datumAT(iso: string | null | undefined): string {
  if (!iso) return '–'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso
}

/**
 * Hinweise sammeln und je Text zusammenfassen:
 *   „Rebsorte „Uhudler“ steht nicht in der BKI-Kürzelliste … (2 Lieferungen: TV-0003, TV-0007)“
 */
export class Hinweise {
  private readonly eintraege = new Map<string, string[]>()
  private readonly einheit: [einzahl: string, mehrzahl: string]

  // bewusst ohne Parameter-Property (Node-Type-Stripping kann sie nicht entfernen)
  constructor(einheit: [einzahl: string, mehrzahl: string] = ['Zeile', 'Zeilen']) {
    this.einheit = einheit
  }

  add(text: string, bezug?: string | null) {
    const liste = this.eintraege.get(text) ?? []
    if (bezug) liste.push(bezug)
    this.eintraege.set(text, liste)
  }

  liste(): string[] {
    return [...this.eintraege].map(([text, bezug]) => {
      if (bezug.length === 0) return text
      const [eins, mehr] = this.einheit
      const namen = [...new Set(bezug)]
      const auszug = namen.slice(0, 5).join(', ') + (namen.length > 5 ? ' …' : '')
      return `${text} (${bezug.length} ${bezug.length === 1 ? eins : mehr}: ${auszug})`
    })
  }
}

/** Warnungen zu Rebsorten ohne amtliches BKI-Kürzel bzw. ganz ohne Rebsorte */
export function kuerzelWarnungen(sorten: readonly (string | null)[], einheit: [string, string] = ['Zeile', 'Zeilen']): string[] {
  const fehlend = new Map<string, number>()
  let ohne = 0
  for (const s of sorten) {
    if (!s || !s.trim()) { ohne++; continue }
    if (!bkiRebsorteKuerzel(s)) fehlend.set(s, (fehlend.get(s) ?? 0) + 1)
  }
  const w = [...fehlend].map(([s, n]) =>
    `Rebsorte „${s}“ steht nicht in der BKI-Kürzelliste – Spalte „BKI-Kürzel“ leer gelassen (${n} ${n === 1 ? einheit[0] : einheit[1]}). Schreibweise in den Stammdaten (Ried bzw. Grundstück) prüfen.`)
  if (ohne > 0) w.push(`${ohne} ${ohne === 1 ? einheit[0] : einheit[1]} ohne Rebsorte – Rebsorte am Ried bzw. Grundstück ergänzen.`)
  return w
}

const JAHR_RE = /^\d{4}$/

/** ?jahrgang=JJJJ (Pflicht) – wie die searchParams der Druckseite /reports/ama */
export function jahrgangParameter(sp: URLSearchParams): { jahrgang: number } | ParameterFehler {
  const roh = (sp.get('jahrgang') ?? '').trim()
  if (!roh) return parameterFehler('Bitte einen Jahrgang angeben (?jahrgang=JJJJ).')
  if (!JAHR_RE.test(roh)) return parameterFehler(`„${roh.slice(0, 20)}“ ist kein gültiger Jahrgang – bitte eine vierstellige Jahreszahl angeben.`)
  const jahrgang = Number(roh)
  if (jahrgang < 1900 || jahrgang > 2100) return parameterFehler(`Der Jahrgang ${jahrgang} liegt außerhalb von 1900 bis 2100.`)
  return { jahrgang }
}

/** ?jahrgang=JJJJ (optional, leer = alle Jahrgänge) – ein angegebener, ungültiger Wert ist ein Fehler (400) */
export function jahrgangOptional(sp: URLSearchParams): { jahrgang: number | null } | ParameterFehler {
  if (!(sp.get('jahrgang') ?? '').trim()) return { jahrgang: null }
  return jahrgangParameter(sp)
}
