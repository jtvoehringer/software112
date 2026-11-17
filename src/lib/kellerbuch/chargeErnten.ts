// ── Ernten einer Charge mit kg-Anteil (KAN-477 S1, BKI-Sitzung 16.11.2026: Rückverfolgung) ──────────────────────────
//
// n Ernten können zusammen verpresst werden, der Most einer Pressung geht in n Gebinde = n Chargen. Die Datenbank kennt
// je Traubenzeile der Pressung ihre Ernte (pressung_weingaerten.ernte_parzelle_id, seit KAN-477). Der Anteil einer Charge
// an den Trauben einer Pressung ist ihr Anteil am Most: kg der Traubenzeile × Liter der Mostzeile ÷ Liter aller Mostzeilen
// der Pressung. Eine Charge kann Most aus mehreren Pressungen bekommen (Zeilen je Ernte werden summiert).
// Reine Rechnung ohne Datenbank; stornierte Zeilen reicht der Aufrufer nicht herein.

// @ts-expect-error TS5097 – Pfad mit .ts-Endung für node:test (lädt ohne Bundler)
import { rund } from '../zahl/runden.ts'

/** „2026/2-03“: Jahrgang/Lese-Ernte (zweistellig) */
export function ernteNummer(jahrgang: number | string | null | undefined, leseNr: number | null | undefined, ernteNr: number | null | undefined): string | null {
  if (jahrgang == null || leseNr == null || ernteNr == null) return null
  return `${jahrgang}/${leseNr}-${String(ernteNr).padStart(2, '0')}`
}

export type MostZeile = { pressungId: string; chargeId: string | null; liter: number }
export type TraubenZeile = {
  pressungId: string
  /** null = keiner Ernte zugeordnet (Zukauf, Pressung vor KAN-477, kein passender Lesedaten-Eintrag) */
  ernteId: string | null
  kg: number
}

export type ErnteAnteil = {
  ernteId: string
  /** Trauben dieser Ernte, die rechnerisch in der Charge stecken */
  kg: number
  /** Anteil an allen zugeordneten und nicht zugeordneten Trauben der Charge (0–100, 1 Stelle) */
  prozent: number
}

export type ChargeErnten = {
  anteile: ErnteAnteil[]
  /** Trauben der Charge insgesamt (kg), inkl. der nicht zugeordneten */
  gesamtKg: number
  /** Trauben ohne Ernte-Zuordnung (Zukauf, ältere Pressungen) */
  ohneErnteKg: number
}

/**
 * Ernten der Charge: je Pressung den Most-Anteil der Charge auf die Traubenzeilen anwenden. Pressungen ohne Liter
 * (alle Mostzeilen 0) tragen nichts bei. Sortiert nach kg absteigend.
 */
export function ernteAnteile(chargeId: string, most: readonly MostZeile[], trauben: readonly TraubenZeile[]): ChargeErnten {
  const literGesamt = new Map<string, number>()
  const literCharge = new Map<string, number>()
  for (const m of most) {
    if (!(m.liter > 0)) continue
    literGesamt.set(m.pressungId, (literGesamt.get(m.pressungId) ?? 0) + m.liter)
    if (m.chargeId === chargeId) literCharge.set(m.pressungId, (literCharge.get(m.pressungId) ?? 0) + m.liter)
  }
  const jeErnte = new Map<string, number>()
  let gesamt = 0
  let ohne = 0
  for (const t of trauben) {
    const alle = literGesamt.get(t.pressungId) ?? 0
    const meine = literCharge.get(t.pressungId) ?? 0
    if (!(alle > 0) || !(meine > 0) || !(t.kg > 0)) continue
    const kg = t.kg * (meine / alle)
    gesamt += kg
    if (t.ernteId) jeErnte.set(t.ernteId, (jeErnte.get(t.ernteId) ?? 0) + kg)
    else ohne += kg
  }
  const anteile = [...jeErnte].map(([ernteId, kg]) => ({ ernteId, kg: rund(kg, 1), prozent: gesamt > 0 ? rund((kg / gesamt) * 100, 1) : 0 }))
    .sort((a, b) => b.kg - a.kg || a.ernteId.localeCompare(b.ernteId))
  return { anteile, gesamtKg: rund(gesamt, 1), ohneErnteKg: rund(ohne, 1) }
}
