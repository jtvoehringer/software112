// ── Aufteilung eines Umzugs auf mehrere Ziel-Gebinde (KAN-112, Entscheidung Jörgen 03.10.2026: „n Zielgebinde“) ──
//
// Reine Funktion ohne Datenbank (node:test: scripts/tests/kan112-n-ziele.test.mjs). Ein Umzug mit Quellen i (Brutto
// b_i, Summe B) und Zielen j (netto z_j, Summe N) wird je Ziel als eigener Verschnitt bzw. Umzug gebucht – dafür braucht
// jedes Ziel seinen Anteil an jeder Quelle:
//   netto  n_ij ≈ z_j · b_i / B          (jedes Ziel bekommt dieselbe Mischung)
//   brutto b_ij ≈ b_i · z_j / N          (der Schwund S = B − N trifft die Ziele im Verhältnis ihrer Menge)
//   Schwund s_ij = b_ij − n_ij ≥ 0
// Gerundet auf 2 Stellen nach dem größten Rest (verteileLiter), so dass genau gilt: Σ_i n_ij = z_j je Ziel,
// Σ_j b_ij = b_i je Quelle, s_ij ≥ 0.
// Vorgehen: die Ziele nacheinander aus dem Rest jeder Quelle bedienen (Gewicht = Rest; der Rest bleibt so im
// Verhältnis der Quellen und kann nie negativ werden), was übrig bleibt, ist der Schwund S_i der Quelle; ihn
// verteilt verteileLiter im Verhältnis der Netto-Anteile n_ij auf die Ziele.

import { verteileLiter } from '../wein/mischungsrechnung'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund } from '../zahl/runden.ts'
export type UmzugAufteilung = {
  /** netto[j][i] = Liter aus Quelle i in Ziel j */
  netto: number[][]
  /** schwund[j][i] = Schwund der Quelle i, der auf Ziel j entfällt */
  schwund: number[][]
  /** brutto[j][i] = netto + schwund */
  brutto: number[][]
  /** Netto je Ziel, wie aufgeteilt (= z_j; nur bei N > B um den Überhang gekürzt, siehe unten) */
  ziele: number[]
  /** Quellen, die in keinem Ziel mindestens 0,01 L netto bekommen (Index) – ihr Schwund lässt sich nicht zuordnen */
  ohneAnteil: number[]
}

const cent = (n: number): number => Math.round(n * 100)
const rund2 = (n: number): number => rund(n, 2)

/**
 * KAN-112: Quellen (`brutto` je Quelle) auf Ziele (`ziele` = netto je Ziel) aufteilen – siehe Dateikopf.
 * Übersteigt N die Summe B (Eingaben erlauben 0,01 L Rundungsspiel), wird der Überhang vom größten Ziel abgezogen.
 */
export function teileUmzugAuf(brutto: readonly number[], ziele: readonly number[]): UmzugAufteilung {
  const b = brutto.map(x => rund2(Math.max(0, x)))
  const z = ziele.map(x => rund2(Math.max(0, x)))
  const summeB = cent(b.reduce((s, x) => s + x, 0))
  const ueberhang = cent(z.reduce((s, x) => s + x, 0)) - summeB
  if (ueberhang > 0) {
    const j = z.reduce((best, x, k) => (x > z[best] ? k : best), 0)
    z[j] = Math.max(0, cent(z[j]) - ueberhang) / 100
  }

  // Ziele nacheinander aus dem Rest der Quellen bedienen (in Cent gerechnet, damit kein Gleitkomma-Rest bleibt)
  const rest = b.map(cent)
  const netto: number[][] = []
  for (const zj of z) {
    const anteile = verteileLiter(rest.map(r => r / 100), zj).map(cent)
    for (let i = 0; i < rest.length; i++) rest[i] -= anteile[i]
    netto.push(anteile.map(c => c / 100))
  }

  // Rest = Schwund der Quelle, im Verhältnis der Netto-Anteile auf die Ziele
  const schwundJeZiel: number[][] = z.map(() => b.map(() => 0))
  const ohneAnteil: number[] = []
  for (let i = 0; i < b.length; i++) {
    const gewichte = netto.map(zeile => zeile[i])
    if (!gewichte.some(g => g >= 0.01)) {
      if (b[i] > 0) ohneAnteil.push(i)
      continue
    }
    const s = verteileLiter(gewichte, rest[i] / 100)
    for (let j = 0; j < z.length; j++) schwundJeZiel[j][i] = s[j]
  }

  return {
    netto,
    schwund: schwundJeZiel,
    brutto: netto.map((zeile, j) => zeile.map((n, i) => rund2(n + schwundJeZiel[j][i]))),
    ziele: z,
    ohneAnteil,
  }
}
