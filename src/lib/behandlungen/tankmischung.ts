// Tankmischung (KAN-398, UAT): mehrere Pflanzenschutzmittel in einer Spritzbrühe. Gespeichert wird weiterhin je Mittel
// eine Maßnahme (Aufwandmenge, Lager, Cu-Bilanz, PSM-Aufzeichnung je Mittel – die Brühe wird nie summiert); die
// Maßnahmen einer Mischung tragen dieselbe behandlungen.tankmischung_id. Hier: Eingabe der weiteren Mittel, Prüfung,
// gemeinsame Felder beim Bearbeiten und Gruppierung in der Liste – dieselbe Regel für Formular und Server Action.

import { AUFWAND_EINHEITEN } from '@/lib/behandlungen/massnahmeMengen'
import { dezimal } from '@/lib/format'

/** Höchstens so viele weitere Mittel neben dem ersten (Praxis: 2–4 Mittel im Tank) */
export const WEITERE_MITTEL_MAX = 5

/** Formularfelder je weiterem Mittel (wiederholt, in derselben Reihenfolge) */
export const WEITERE_FELDER = { psm: 'weitere_psm_id', aufwand: 'weitere_aufwandmenge', einheit: 'weitere_aufwandmenge_einheit' } as const

export type WeiteresMittel = { psmId: string; aufwand: number | null; einheit: string }

type FormLike = { getAll(name: string): unknown[] }

/** Weitere Mittel aus dem Formular; ganz leere Zeilen zählen nicht */
export function weitereMittelAus(fd: FormLike): WeiteresMittel[] {
  const psm = fd.getAll(WEITERE_FELDER.psm).map(v => String(v ?? '').trim())
  const aufwand = fd.getAll(WEITERE_FELDER.aufwand).map(v => String(v ?? '').trim())
  const einheit = fd.getAll(WEITERE_FELDER.einheit).map(v => String(v ?? '').trim())
  const out: WeiteresMittel[] = []
  for (let i = 0; i < psm.length; i++) {
    const roh = aufwand[i] ?? ''
    if (!psm[i] && !roh) continue
    const n = roh ? Number(dezimal(roh)) : null
    out.push({ psmId: psm[i], aufwand: n === null || Number.isFinite(n) ? n : NaN, einheit: einheit[i] || 'kg_ha' })
  }
  return out
}

/** Fehlertext zu den weiteren Mitteln bzw. null: nur bei Spritzung, je Zeile Mittel und Aufwand, kein Mittel doppelt */
export function tankmischungFehler(art: string, hauptPsmId: string | null, weitere: readonly WeiteresMittel[]): string | null {
  if (weitere.length === 0) return null
  if (art !== 'spritzung') return 'Weitere Mittel (Tankmischung) gibt es nur bei einer Spritzung.'
  if (!hauptPsmId) return 'Bitte zuerst das erste Mittel der Tankmischung wählen.'
  if (weitere.length > WEITERE_MITTEL_MAX) return `Höchstens ${WEITERE_MITTEL_MAX + 1} Mittel je Tankmischung.`
  const gesehen = new Set([hauptPsmId])
  for (const [i, w] of weitere.entries()) {
    const nr = i + 2
    if (!w.psmId) return `Mittel ${nr} der Tankmischung: bitte das Mittel wählen.`
    if (w.aufwand === null) return `Mittel ${nr} der Tankmischung: bitte die Aufwandmenge angeben.`
    if (!Number.isFinite(w.aufwand) || w.aufwand <= 0) return `Mittel ${nr} der Tankmischung: die Aufwandmenge muss eine Zahl größer als 0 sein.`
    if (!(AUFWAND_EINHEITEN as readonly string[]).includes(w.einheit)) return `Mittel ${nr} der Tankmischung: Einheit „${w.einheit}“ ist nicht zulässig.`
    if (gesehen.has(w.psmId)) return `Mittel ${nr} der Tankmischung ist schon in der Mischung – jedes Mittel nur einmal.`
    gesehen.add(w.psmId)
  }
  return null
}

/**
 * Spalten, die für alle Mittel einer Tankmischung gleich sind und beim Bearbeiten eines Mittels für die ganze Mischung
 * übernommen werden (ein Tank, eine Ausbringung). Mittel, Aufwand, Spritzbrühe und Rieden bleiben je Maßnahme – sie
 * bestimmen Mittelmenge, Lager und Cu-Bilanz.
 */
export const GEMEINSAME_SPALTEN = [
  'datum', 'datum_bis', 'uhrzeit_von', 'uhrzeit_bis', 'witterung', 'temperatur_c', 'bbch_stadium', 'durchgefuehrt_von', 'anwender_name',
] as const

/** „Erntefrei ab“ eines anderen Mittels der Mischung, wenn sich das Datum ändert: um dieselben Tage verschoben */
export function erntefreiVerschoben(erntefrei: string | null, altDatum: string, neuDatum: string): string | null {
  if (!erntefrei) return null
  const tag = (s: string) => Date.parse(`${s.slice(0, 10)}T00:00:00Z`)
  const diff = tag(neuDatum) - tag(altDatum)
  if (!Number.isFinite(diff) || diff === 0) return erntefrei
  return new Date(tag(erntefrei) + diff).toISOString().slice(0, 10)
}

export type MischungsInfo = { anzahl: number; nr: number; erste: boolean }

/** Je Maßnahme einer Tankmischung (≥ 2 Maßnahmen mit derselben tankmischung_id): Anzahl, Position, erste Zeile */
export function mischungsInfo<T extends { id: string; tankmischung_id?: string | null }>(liste: readonly T[]): Map<string, MischungsInfo> {
  const je = new Map<string, string[]>()
  for (const b of liste) if (b.tankmischung_id) je.set(b.tankmischung_id, [...(je.get(b.tankmischung_id) ?? []), b.id])
  const out = new Map<string, MischungsInfo>()
  for (const ids of je.values()) {
    if (ids.length < 2) continue
    ids.forEach((id, i) => out.set(id, { anzahl: ids.length, nr: i + 1, erste: i === 0 }))
  }
  return out
}

/** Reihenfolge einer Liste mit den Mitteln einer Mischung direkt hintereinander (an der Stelle des ersten) */
export function mischungZusammen<T extends { tankmischung_id?: string | null }>(liste: readonly T[]): T[] {
  const out: T[] = []
  const erledigt = new Set<string>()
  for (const b of liste) {
    const t = b.tankmischung_id
    if (!t) { out.push(b); continue }
    if (erledigt.has(t)) continue
    erledigt.add(t)
    out.push(...liste.filter(x => x.tankmischung_id === t))
  }
  return out
}
