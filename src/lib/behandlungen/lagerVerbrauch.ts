// ── Lagerbestand und Verbrauch aus Maßnahmen (KAN-133 Soll 2 und 3, 26.09.2026) ──
//
// Bestand eines Pflanzenschutz- bzw. Düngemittels = Zugänge − Korrektur-Abgänge − Verbrauch aus
// Maßnahmen, alles in der Lager-Einheit. Isomorph und ohne Datenbank (node:test:
// scripts/tests/lager-verbrauch.test.mjs); die Lagerseite (behandlungen/lager/page.tsx) lädt
// Maßnahmen (ladeBehandlungen) und Buchungen und rechnet nur hier.
//
// Verbrauch = Σ mittelmenge() je Maßnahme: Pflanzenschutzmittel nur aus Spritzungen (Aufwand ×
//   Fläche usw.) – „Menge gesamt“ ist dort die Spritzbrühe und wird nie abgezogen, auch nicht bei
//   einer Tankmischung – und seit KAN-154 aus Sonstiges mit Mittel (z. B. Pheromon-Dispenser; ohne
//   Aufwand nur ein Hinweis), Düngemittel nur aus Düngungen (Düngermenge, sonst Aufwand × Fläche).
//   Umgerechnet in die Lager-Einheit (g ↔ kg, ml ↔ l); kg ↔ l ohne Dichte nicht: kein Abzug, nur ein
//   Hinweis – ebenso Maßnahmen ohne bestimmbare Mittelmenge (z. B. Spritzung ohne Aufwand).
// Lager-Einheit (pflanzenschutzmittel hat keine Einheit-Spalte): Einheit der Buchungen – alle gleich
//   → diese, gemischt → kg bzw. l in der Dimension der jüngsten Buchung; ohne Buchungen die Einheit
//   des Düngemittels (Stammdaten), sonst die der ersten Mittelmenge, sonst kg. Buchungen der anderen
//   Dimension (l neben kg) zählen nicht – Hinweis.
// Summen addieren die je Maßnahme bzw. Buchung gerundeten Werte (3 Stellen wie mittelmenge()).

import { runden } from '@/lib/csv'
import { fmtNum } from '@/lib/format'
import { jahresBewegung, type GezaehlteBuchung, type JahresBewegung } from './lagerJahr'
import {
  ART_LABEL, behandlungKurz, datumDe, einheitText, mengeInEinheit, mittelmenge, STELLEN_MENGE, weingartenText,
  type MittelEinheit, type PsmBehandlung,
} from '@/lib/behoerden/psm'

/** Lager der Lagerseite: Pflanzenschutzmittel (Verbrauch aus Spritzungen und Sonstiges) bzw. Düngemittel (aus Düngungen) */
export type LagerArt = 'psm' | 'duenger'

/** Buchung aus psm_lager_bewegungen bzw. duengemittel_lager_bewegungen (Abgänge negativ); typ für die Jahressicht (KAN-173) */
export type LagerBuchung = { datum: string; menge: number; einheit: string | null; typ?: string | null }

/** Verbrauch einer Maßnahme, noch in der Einheit der Mittelmenge */
export type VerbrauchPosten = {
  behandlungId: string
  datum: string
  /** Mittelmenge (kg bzw. l, 3 Stellen); null = nicht bestimmbar, Grund in warnung */
  menge: number | null
  einheit: MittelEinheit | null
  basis: string | null
  warnung: string | null
  /** „Spritzung am 10.07.2026 (Pfaffenberg Riesling)“ – für Hinweise */
  kurz: string
  /** Art der Maßnahme („Spritzung“) und Ort (Ried/GST) – für die Zeile in Bestand & Bewegungen */
  art: string
  ort: string | null
}

/** Abgezogener Verbrauch einer Maßnahme in der Lager-Einheit (Zeile in „Bestand & Bewegungen“) */
export type VerbrauchZeile = { behandlungId: string; datum: string; menge: number; art: string; ort: string | null }

export type LagerHinweis = {
  text: string
  /** Maßnahme zum Nachtragen bzw. Korrigieren; null bei Buchungen */
  behandlungId: string | null
}

/** Bestand eines Mittels, alle Mengen in `einheit` (3 Stellen) */
export type LagerKonto = {
  einheit: string
  zugang: number
  /** Korrektur-Abgänge (positiv) */
  abgang: number
  /** Verbrauch aus Maßnahmen */
  verbrauch: number
  /** Verbrauch je Maßnahme (nur abgezogene), chronologisch */
  posten: VerbrauchZeile[]
  bestand: number
  /** nicht berücksichtigte Buchungen und nicht abgezogene Maßnahmen */
  hinweise: LagerHinweis[]
  /** Lagerbewegung im laufenden Geschäftsjahr (KAN-173, lagerJahr.ts) – nur, wenn ein Jahr übergeben wurde */
  jahr?: JahresBewegung
}

const ARTEN_DES_LAGERS: Readonly<Record<LagerArt, readonly string[]>> = { psm: ['spritzung', 'sonstiges'], duenger: ['duengung'] }

const zahl = (n: number) => fmtNum(n, { max: 3 })

/** kg bzw. l für kg/g bzw. l/ml; null bei unbekannter Einheit */
export function grundeinheit(e: string | null | undefined): MittelEinheit | null {
  if (mengeInEinheit(1, e, 'kg') !== null) return 'kg'
  if (mengeInEinheit(1, e, 'l') !== null) return 'l'
  return null
}

/**
 * Verbrauchsposten je Mittel (psm.id bzw. duengemittel.id): Pflanzenschutzmittel nur aus
 * Spritzungen und Sonstiges, Düngemittel nur aus Düngungen, Menge je Maßnahme aus mittelmenge().
 */
export function verbrauchJeMittel(behandlungen: readonly PsmBehandlung[], lager: LagerArt): Map<string, VerbrauchPosten[]> {
  const je = new Map<string, VerbrauchPosten[]>()
  for (const b of behandlungen) {
    if (!ARTEN_DES_LAGERS[lager].includes(b.art)) continue
    const id = lager === 'psm' ? b.psm?.id : b.duengemittel?.id
    if (!id) continue
    const mm = mittelmenge(b)
    const posten = je.get(id) ?? []
    posten.push({
      behandlungId: b.id, datum: b.datum,
      menge: mm.menge, einheit: mm.einheit, basis: mm.basis, warnung: mm.warnung,
      kurz: behandlungKurz(b),
      art: ART_LABEL[b.art] ?? b.art,
      ort: weingartenText(b),
    })
    je.set(id, posten)
  }
  return je
}

/** Lager-Einheit (Regeln im Dateikopf); `stammEinheit` = duengemittel.einheit, bei PSM leer */
export function lagerEinheit(buchungen: readonly LagerBuchung[], verbrauch: readonly VerbrauchPosten[] = [], stammEinheit?: string | null): string {
  const mitEinheit = buchungen.filter(b => grundeinheit(b.einheit) !== null)
  const einheiten = [...new Set(mitEinheit.map(b => b.einheit as string))]
  if (einheiten.length === 1) return einheiten[0]
  if (einheiten.length > 1) {
    const juengste = mitEinheit.reduce((j, b) => (b.datum > j.datum ? b : j))
    return grundeinheit(juengste.einheit) as MittelEinheit
  }
  if (stammEinheit && grundeinheit(stammEinheit)) return stammEinheit
  return verbrauch.find(p => p.einheit)?.einheit ?? 'kg'
}

/**
 * Einheit, in der der Preis eines Pflanzenschutzmittels gilt (Material-Vorschlag der Maßnahme, KAN-133
 * Soll 8): preis_pro_einheit gilt je kg bzw. l – also die Grundeinheit des Lagers, auch wenn alle
 * Buchungen in g bzw. ml erfasst sind. null ohne Buchung mit bekannter Einheit – dann kein Vorschlag.
 */
export function preisEinheit(buchungen: readonly LagerBuchung[]): MittelEinheit | null {
  if (!buchungen.some(b => grundeinheit(b.einheit) !== null)) return null
  return grundeinheit(lagerEinheit(buchungen))
}

/**
 * Bestand eines Mittels aus Buchungen und Verbrauchsposten, alles in der Lager-Einheit.
 * Buchungen ohne Einheit zählen wie bisher in der Lager-Einheit.
 */
export function lagerKonto(
  buchungen: readonly LagerBuchung[], verbrauch: readonly VerbrauchPosten[], stammEinheit?: string | null, jahr?: number,
  /** Startjahr des Betriebs (Jahr von tenants.created_at) für die Jahressicht (KAN-173, Nachtrag 02.10.2026) */
  startJahr?: number | null,
): LagerKonto {
  const einheit = lagerEinheit(buchungen, verbrauch, stammEinheit)
  const hinweise: LagerHinweis[] = []
  const ohneDichte = (von: string) => `Lager in ${einheit}, ${einheitText(von)} ohne Dichte nicht in ${einheit} umrechenbar`

  let zugang = 0, abgang = 0
  const gezaehlt: GezaehlteBuchung[] = []
  for (const b of buchungen) {
    const gueltig = Number.isFinite(b.menge)
    const m = !gueltig ? null : b.einheit ? mengeInEinheit(b.menge, b.einheit, einheit) : b.menge
    if (m === null) {
      const grund = !gueltig ? 'Menge ungültig' : grundeinheit(b.einheit) ? ohneDichte(b.einheit as string) : `Einheit „${b.einheit}“ unbekannt`
      hinweise.push({
        text: `Buchung vom ${datumDe(b.datum)}${gueltig ? ` über ${zahl(b.menge)} ${einheitText(b.einheit)}` : ''}: ${grund} – nicht berücksichtigt.`,
        behandlungId: null,
      })
      continue
    }
    gezaehlt.push({ datum: b.datum, menge: m, typ: b.typ })
    if (m > 0) zugang += m
    else abgang -= m
  }

  let summe = 0
  const posten: VerbrauchZeile[] = []
  for (const p of verbrauch) {
    if (p.menge === null || p.einheit === null) {
      hinweise.push({ text: `${p.kurz}: ${p.warnung ?? 'keine Mittelmenge'} – nicht abgezogen.`, behandlungId: p.behandlungId })
      continue
    }
    const m = mengeInEinheit(p.menge, p.einheit, einheit)
    if (m === null) {
      hinweise.push({ text: `${p.kurz}: ${zahl(p.menge)} ${p.einheit} – ${ohneDichte(p.einheit)}, nicht abgezogen.`, behandlungId: p.behandlungId })
      continue
    }
    const gerundet = runden(m, STELLEN_MENGE)
    summe += gerundet
    posten.push({ behandlungId: p.behandlungId, datum: p.datum, menge: gerundet, art: p.art, ort: p.ort })
  }
  posten.sort((a, b) => a.datum.localeCompare(b.datum))

  zugang = runden(zugang, STELLEN_MENGE)
  abgang = runden(abgang, STELLEN_MENGE)
  const verbrauchGesamt = runden(summe, STELLEN_MENGE)
  return {
    einheit, zugang, abgang, verbrauch: verbrauchGesamt, posten,
    bestand: runden(zugang - abgang - verbrauchGesamt, STELLEN_MENGE),
    hinweise,
    ...(jahr === undefined ? {} : { jahr: jahresBewegung(gezaehlt, posten, jahr, STELLEN_MENGE, startJahr) }),
  }
}
