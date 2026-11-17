// ── Maßnahmen an der Maische, anteilig je Charge (KAN-481, BKI-Sitzung 16.11.2026) ─────────────────────────────────
//
// Eine Maßnahme an der Maische ist eine Kellerbehandlung mit pressung_id = Maische statt einer Charge (dieselben
// Behandlungstypen, dasselbe Stoffkonto). Beim Abpressen entstehen aus der Maische n Chargen; jede übernimmt die
// Maßnahmen anteilig nach Litern: Anteil = Liter ihrer Mostzeile(n) ÷ Liter aller Mostzeilen der Pressung, Menge der
// Maßnahme × Anteil. Gerechnet, nicht gespeichert (wie die Ernte-Anteile, src/lib/kellerbuch/chargeErnten.ts): Wird
// die Pressung oder eine Mostzeile storniert, stimmen die Anteile von selbst; die Maßnahme an der Maische bleibt.
// Reine Rechnung ohne Datenbank; stornierte Zeilen reicht der Aufrufer nicht herein. Isomorph, ohne '@/'-Importe.

// @ts-expect-error TS5097 – Pfad mit .ts-Endung für node:test (lädt ohne Bundler)
import { rund } from '../zahl/runden.ts'

export type MaischeMostZeile = { pressungId: string; chargeId: string | null; liter: number }

export type MaischeBehandlung = {
  id: string
  pressungId: string
  datum: string
  /** Erfassungszeitpunkt – Reihenfolge innerhalb des Tages (KAN-384) */
  zeitpunkt: string | null
  behandlung: string
  /** Menge an der ganzen Maische; null ohne Mengenangabe (Einheit „-“) */
  menge: number | null
  einheit: string | null
  notizen: string | null
}

export type MaischeAnteilZeile = MaischeBehandlung & {
  chargeId: string
  /** „M 2027/1“ */
  maische: string | null
  /** Anteil der Charge am Most der Maische in Prozent (1 Stelle) */
  anteilPct: number
  /** Menge der Maßnahme, die rechnerisch auf die Charge entfällt (3 Stellen) */
  mengeAnteil: number | null
}

/** Anteil (0–1) der Charge am Most einer Pressung; null, wenn die Pressung keinen Most hat oder die Charge nichts bekam */
export function maischeAnteil(chargeId: string, pressungId: string, most: readonly MaischeMostZeile[]): number | null {
  let gesamt = 0
  let meine = 0
  for (const m of most) {
    if (m.pressungId !== pressungId || !(m.liter > 0)) continue
    gesamt += m.liter
    if (m.chargeId === chargeId) meine += m.liter
  }
  return gesamt > 0 && meine > 0 ? meine / gesamt : null
}

/** „an der Maische M 2027/1, Anteil 40 %“ – Kennzeichen der übernommenen Maßnahme an der Charge */
export function maischeVermerk(maische: string | null, anteilPct: number): string {
  return `an der Maische${maische ? ` ${maische}` : ''}, Anteil ${String(anteilPct).replace('.', ',')} %`
}

/**
 * Maßnahmen an der Maische, die auf die Charge entfallen – chronologisch (Datum, Erfassung, id). Eine Charge kann
 * Most aus mehreren Maischen haben; jede Maßnahme erscheint einmal je Maische mit dem Anteil der Charge daran.
 */
export function maischeAnteilZeilen(
  chargeId: string,
  most: readonly MaischeMostZeile[],
  behandlungen: readonly MaischeBehandlung[],
  nummerJeMaische: ReadonlyMap<string, string | null> = new Map(),
): MaischeAnteilZeile[] {
  const anteile = new Map<string, number | null>()
  const zeilen: MaischeAnteilZeile[] = []
  for (const b of behandlungen) {
    if (!anteile.has(b.pressungId)) anteile.set(b.pressungId, maischeAnteil(chargeId, b.pressungId, most))
    const a = anteile.get(b.pressungId) ?? null
    if (a === null) continue
    zeilen.push({
      ...b, chargeId,
      maische: nummerJeMaische.get(b.pressungId) ?? null,
      anteilPct: rund(a * 100, 1),
      mengeAnteil: b.menge === null ? null : rund(b.menge * a, 3),
    })
  }
  return zeilen.sort((x, y) => x.datum.localeCompare(y.datum) || (x.zeitpunkt ?? '').localeCompare(y.zeitpunkt ?? '') || x.id.localeCompare(y.id))
}

/**
 * Datum einer Maßnahme an der Maische: nicht vor dem Beginn und – ist sie abgepresst – nicht nach dem Pressdatum;
 * an einer stornierten Maische wird nichts mehr erfasst. Dieselbe Regel wie der Trigger z_charge_pflicht.
 */
export function maischeMassnahmeFehler(p: { beginn: string | null; offen: boolean; pressdatum: string | null; storniert: boolean; datum: string }): string | null {
  if (!p.beginn) return 'Die gewählte Pressung ist keine Maische. Maßnahmen ohne Charge sind nur an einer Maische möglich.'
  if (p.storniert) return 'Die Maische ist storniert – an ihr lässt sich keine Maßnahme mehr erfassen.'
  const tt = (d: string) => d.slice(0, 10).split('-').reverse().join('.')
  const beginn = p.beginn.slice(0, 10)
  const ende = !p.offen && p.pressdatum ? p.pressdatum.slice(0, 10) : null
  if (p.datum < beginn || (ende !== null && p.datum > ende)) {
    return `Das Datum der Maßnahme liegt außerhalb der Maischezeit (${tt(beginn)} bis ${ende ? tt(ende) : 'heute'}).`
  }
  return null
}
