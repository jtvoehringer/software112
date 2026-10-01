// ── Betriebsmittel: Weinbehandlungs- und Produktionsmittel (KAN-167, 01.10.2026) ─────────────────────────
//
// Stammdaten (betriebsmittel) mit eigener Einheit (kg, g, l, ml, Stk, m), Lagerbuchungen
// (betriebsmittel_lager_bewegungen: Anfangsbestand, Einkauf mit Pflicht-E/A-Ausgabe, Inventurkorrektur – storniert
// statt gelöscht) und Verbrauch aus Maßnahmen („Sonstiges“ und „Laubarbeit“ mit betriebsmittel_id).
// Isomorph und ohne Datenbank (node:test: scripts/tests/betriebsmittel.test.mjs).
//
// Verbrauch einer Maßnahme = Aufwand je ha × behandelte Fläche (kg/ha, l/ha, Stk/ha, m/ha) bzw. Aufwand gesamt
//   (kg, l, g, ml, Stk, m), umgerechnet in die Einheit des Mittels (g ↔ kg, ml ↔ l; Stk und m nur 1:1). Andere
//   Dimension (kg ↔ l ↔ Stk ↔ m) oder ohne Aufwand: kein Abzug, nur ein Hinweis – wie bei PSM/Dünger.
// Bestand = Zugänge − Korrektur-Abgänge − Verbrauch; stornierte Buchungen zählen nicht.

import { runden } from '@/lib/csv'
import { fmtNum } from '@/lib/format'
import type { LagerHinweis, LagerKonto, VerbrauchZeile } from './lagerVerbrauch'
import { jahresBewegung, type GezaehlteBuchung } from './lagerJahr'

export const BETRIEBSMITTEL_GRUPPEN = ['weinbehandlung', 'produktion'] as const
export type BetriebsmittelGruppe = typeof BETRIEBSMITTEL_GRUPPEN[number]

export const GRUPPE_LABEL: Record<BetriebsmittelGruppe, string> = {
  weinbehandlung: 'Weinbehandlungsmittel',
  produktion: 'Produktionsmittel',
}

/** Beispiele je Gruppe (Platzhalter im Formular) */
export const GRUPPE_BEISPIELE: Record<BetriebsmittelGruppe, string> = {
  weinbehandlung: 'z. B. Pheromon-Dispenser',
  produktion: 'z. B. Bindematerial, Netze, Treibstoff, Korken, Flaschen',
}

export const BM_EINHEITEN = ['stk', 'kg', 'g', 'l', 'ml', 'm'] as const
export type BmEinheit = typeof BM_EINHEITEN[number]

export const BM_EINHEIT_LABEL: Record<string, string> = { stk: 'Stk', kg: 'kg', g: 'g', l: 'l', ml: 'ml', m: 'm' }

/** Aufwand-Einheiten einer Maßnahme mit Betriebsmittel: je ha bzw. gesamt */
export const BM_AUFWAND_EINHEITEN = ['stk_ha', 'kg_ha', 'l_ha', 'm_ha', 'stk', 'kg', 'g', 'l', 'ml', 'm'] as const
export const BM_AUFWAND_LABEL: Record<string, string> = {
  stk_ha: 'Stk/ha', kg_ha: 'kg/ha', l_ha: 'l/ha', m_ha: 'm/ha',
  stk: 'Stk gesamt', kg: 'kg gesamt', g: 'g gesamt', l: 'l gesamt', ml: 'ml gesamt', m: 'm gesamt',
}

export const BM_ARTEN = ['sonstiges', 'laubarbeit'] as const
/** Maßnahmenarten, bei denen ein Betriebsmittel wählbar ist */
export function artMitBetriebsmittel(art: string | null | undefined): boolean {
  return art === 'sonstiges' || art === 'laubarbeit'
}

const STELLEN = 3

/** Grundeinheit und Faktor: g → kg (0,001), ml → l (0,001), sonst 1:1 */
const GRUND: Record<string, { einheit: string; faktor: number }> = {
  kg: { einheit: 'kg', faktor: 1 }, g: { einheit: 'kg', faktor: 0.001 },
  l: { einheit: 'l', faktor: 1 }, ml: { einheit: 'l', faktor: 0.001 },
  stk: { einheit: 'stk', faktor: 1 }, m: { einheit: 'm', faktor: 1 },
}

/** Menge von einer Einheit in eine andere derselben Dimension (3 Stellen); null bei anderer Dimension */
export function bmInEinheit(menge: number, von: string | null | undefined, nach: string | null | undefined): number | null {
  const v = von ? GRUND[von] : undefined
  const n = nach ? GRUND[nach] : undefined
  if (!v || !n || v.einheit !== n.einheit || !Number.isFinite(menge)) return null
  return runden(menge * v.faktor / n.faktor, STELLEN)
}

export type BmVerbrauchEingabe = {
  aufwand: number | null
  aufwandEinheit: string | null
  flaecheHa: number | null
}

/**
 * Verbrauch einer Maßnahme in der Einheit des Mittels: Aufwand je ha × Fläche bzw. Aufwand gesamt.
 * menge null → warnung nennt den Grund (ohne Aufwand, ohne Fläche, andere Einheit).
 */
export function bmVerbrauch(b: BmVerbrauchEingabe, mittelEinheit: string): { menge: number | null; basis: string | null; warnung: string | null } {
  const a = typeof b.aufwand === 'number' && Number.isFinite(b.aufwand) && b.aufwand >= 0 ? b.aufwand : null
  const ae = b.aufwandEinheit
  if (a === null || !ae) return { menge: null, basis: null, warnung: 'ohne Aufwand' }
  let roh: number, von: string, basis: string
  if (ae.endsWith('_ha')) {
    const ha = typeof b.flaecheHa === 'number' && b.flaecheHa > 0 ? b.flaecheHa : null
    if (ha === null) return { menge: null, basis: null, warnung: 'ohne behandelte Fläche' }
    roh = a * ha; von = ae.slice(0, -3); basis = 'Aufwand × Fläche'
  } else {
    roh = a; von = ae; basis = 'Aufwand (gesamt)'
  }
  const m = bmInEinheit(roh, von, mittelEinheit)
  if (m === null) {
    return { menge: null, basis: null, warnung: `Aufwand in ${BM_AUFWAND_LABEL[ae] ?? ae}, Mittel in ${BM_EINHEIT_LABEL[mittelEinheit] ?? mittelEinheit} geführt – nicht umrechenbar` }
  }
  return { menge: m, basis, warnung: null }
}

export type BmBuchung = { datum: string; menge: number; einheit: string; storniert: boolean; typ?: string | null }
export type BmVerbrauchPosten = BmVerbrauchEingabe & {
  behandlungId: string; datum: string; kurz: string; art: string; ort: string | null
}

/** Bestand eines Betriebsmittels in seiner Einheit (gleiche Form wie LagerKonto für PSM/Dünger) */
/** Mit `jahr` zusätzlich die Lagerbewegung im Geschäftsjahr (KAN-173, lagerJahr.ts) */
export function bmKonto(buchungen: readonly BmBuchung[], verbrauch: readonly BmVerbrauchPosten[], einheit: string, jahr?: number): LagerKonto {
  const hinweise: LagerHinweis[] = []
  const label = BM_EINHEIT_LABEL[einheit] ?? einheit
  let zugang = 0, abgang = 0
  const gezaehlt: GezaehlteBuchung[] = []
  for (const b of buchungen) {
    if (b.storniert) continue
    const m = bmInEinheit(b.menge, b.einheit, einheit)
    if (m === null) {
      hinweise.push({ text: `Buchung vom ${b.datum.split('-').reverse().join('.')}: ${BM_EINHEIT_LABEL[b.einheit] ?? b.einheit} nicht in ${label} umrechenbar – nicht berücksichtigt.`, behandlungId: null })
      continue
    }
    gezaehlt.push({ datum: b.datum, menge: m, typ: b.typ })
    if (m > 0) zugang += m
    else abgang -= m
  }
  let summe = 0
  const posten: VerbrauchZeile[] = []
  for (const p of verbrauch) {
    const v = bmVerbrauch(p, einheit)
    if (v.menge === null) {
      hinweise.push({ text: `${p.kurz}: ${v.warnung} – nicht abgezogen.`, behandlungId: p.behandlungId })
      continue
    }
    summe += v.menge
    posten.push({ behandlungId: p.behandlungId, datum: p.datum, menge: v.menge, art: p.art, ort: p.ort })
  }
  posten.sort((a, b) => a.datum.localeCompare(b.datum))
  zugang = runden(zugang, STELLEN)
  abgang = runden(abgang, STELLEN)
  const verbrauchGesamt = runden(summe, STELLEN)
  return {
    einheit: label, zugang, abgang, verbrauch: verbrauchGesamt, posten, bestand: runden(zugang - abgang - verbrauchGesamt, STELLEN), hinweise,
    ...(jahr === undefined ? {} : { jahr: jahresBewegung(gezaehlt, posten, jahr, STELLEN) }),
  }
}

/** Brutto aus Netto und USt-Satz (kaufmännisch gerundet, 2 Stellen) */
export function bmBrutto(netto: number, ustSatz: number): number {
  return runden(netto * (1 + ustSatz / 100), 2)
}

/** „1.000 Stk“ */
export function bmMengeText(menge: number, einheit: string): string {
  return `${fmtNum(menge, { max: 3 })} ${BM_EINHEIT_LABEL[einheit] ?? einheit}`
}
