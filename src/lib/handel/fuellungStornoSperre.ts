// ── Warum lässt sich eine Füllung nicht stornieren? (KAN-378, Abnahme 23.10.2026) ──────────────────────────────
// Im Warenlager war der Mistkübel bei fast allen Füllungen ausgegraut, ohne dass die Tester den Grund sahen
// (nur ein Tooltip, am Handy unsichtbar). Außerdem zählte die Liste die Bestandsbewegungen der Verkäufe
// (fuellung_bewegungen art verkauf/verkauf_storno, seit KAN-149 D1) als „Bestandsbuchungen“ mit: Eine Füllung,
// deren Verkäufe alle storniert sind, blieb in der Liste gesperrt, obwohl deactivateFuellung sie storniert hätte.
// Diese Datei ist die gemeinsame Regel für die Liste – dieselbe Zählung wie folgebuchungenDerFuellung
// (Verkäufe aus nicht stornierten Verkaufsposten, Bestandsbuchungen ohne die Verkaufszeilen).
// Ohne @/-Importe, damit node:test sie direkt laden kann.

// @ts-expect-error TS5097 – node:test lädt ohne Bundler, die Endung .ts ist nötig
import { fmtNum } from '../format.ts'

/** Bewegungsarten, die zu einem Verkauf gehören – sie sperren nicht zusätzlich (der Verkauf selbst zählt) */
export const VERKAUFS_BEWEGUNGEN = ['verkauf', 'verkauf_storno'] as const

export type FuellungFolgen = {
  /** Handelsware aus einem Flaschenzukauf (zukauf_posten_id gesetzt) */
  zukauf: boolean
  /** nicht stornierte Verkaufsposten mit dieser Füllung */
  verkaeufe: number
  /** Flaschen in diesen Verkäufen */
  flaschenVerkauft: number
  /** Bestandsbuchungen (Inventur, Bruch, Korrektur …) ohne die Verkaufszeilen */
  bewegungen: number
}

function anzahl(n: number, eins: string, mehr: string): string {
  return `${fmtNum(n, 0)} ${n === 1 ? eins : mehr}`
}

/** Grund, warum die Füllung nicht stornierbar ist – null, wenn der Storno möglich ist */
export function fuellungStornoSperre(f: FuellungFolgen): string | null {
  if (f.zukauf) {
    return 'Nicht stornierbar: Handelsware aus einem Flaschenzukauf – bitte den Zukauf stornieren (Kellerbuch › Zukauf); der Artikel wird dabei mitstorniert.'
  }
  if (f.verkaeufe > 0) {
    const zusatz = f.bewegungen > 0 ? ` Außerdem gibt es ${anzahl(f.bewegungen, 'Bestandsbuchung', 'Bestandsbuchungen')}.` : ''
    return `Nicht stornierbar: ${anzahl(f.verkaeufe, 'Verkauf', 'Verkäufe')} (${anzahl(f.flaschenVerkauft, 'Flasche', 'Flaschen')}) gebucht – `
      + `zuerst ${f.verkaeufe === 1 ? 'den Verkauf' : 'die Verkäufe'} stornieren (Warenwirtschaft › Verkauf).${zusatz}`
  }
  if (f.bewegungen > 0) {
    return `Nicht stornierbar: ${anzahl(f.bewegungen, 'Bestandsbuchung', 'Bestandsbuchungen')} (Inventur, Bruch, Korrektur …) gebucht – `
      + 'die Füllung bleibt als Historie erhalten. Abweichungen über „Bestand korrigieren“ in der Füllung buchen.'
  }
  return null
}

type Zeile = Record<string, unknown>

/**
 * Sperrgründe je Füllung aus den geladenen Zeilen.
 *   fuellungen  id, zukauf_posten_id
 *   verkaeufe   verkauf_positionen typ 'flasche' aus NICHT stornierten Verkaufsposten: fuellung_id, verkaufsposten_id, menge
 *   bewegungen  fuellung_bewegungen: fuellung_id, art (Verkaufszeilen werden hier ausgefiltert)
 */
export function fuellungStornoSperren(fuellungen: Zeile[], verkaeufe: Zeile[], bewegungen: Zeile[]): Map<string, string> {
  const folgen = new Map<string, FuellungFolgen & { posten: Set<string> }>()
  const eintrag = (id: string) => {
    let e = folgen.get(id)
    if (!e) { e = { zukauf: false, verkaeufe: 0, flaschenVerkauft: 0, bewegungen: 0, posten: new Set() }; folgen.set(id, e) }
    return e
  }
  for (const f of fuellungen) {
    const e = eintrag(String(f.id))
    if (f.zukauf_posten_id) e.zukauf = true
  }
  for (const v of verkaeufe) {
    if (!v.fuellung_id) continue
    const e = eintrag(String(v.fuellung_id))
    e.posten.add(String(v.verkaufsposten_id ?? ''))
    e.flaschenVerkauft += Math.round(Number(v.menge) || 0)
  }
  for (const b of bewegungen) {
    if (!b.fuellung_id || (VERKAUFS_BEWEGUNGEN as readonly string[]).includes(String(b.art))) continue
    eintrag(String(b.fuellung_id)).bewegungen += 1
  }
  const sperren = new Map<string, string>()
  for (const [id, e] of folgen) {
    const grund = fuellungStornoSperre({ zukauf: e.zukauf, verkaeufe: e.posten.size, flaschenVerkauft: e.flaschenVerkauft, bewegungen: e.bewegungen })
    if (grund) sperren.set(id, grund)
  }
  return sperren
}
