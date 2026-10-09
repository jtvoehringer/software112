// Sweep 76 (09.10.2026): kaufmännisch runden wie Postgres round(numeric, n).
// Math.round(x * 100) / 100 rechnet im Binärformat: 1,005 · 100 = 100,4999… → 1,00 statt 1,01 (ebenso 0,565 → 0,56,
// 1,035 → 1,03) und rundet negative halbe Werte Richtung +∞ (−0,125 → −0,12). Auch Number.EPSILON half nicht
// (2,135 → 2,13). Die Datenbank rechnet numeric exakt – Rechnungs-, Zahlungs- und BMD-Beträge der App lagen dann um
// einen Cent daneben. Ohne @/-Importe (node:test).
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt (tsconfig ohne allowImportingTsExtensions)
import { runden } from '../csv/index.ts'

/** Kaufmännisch gerundet (halbe Stelle von null weg). Vorher auf 15 signifikante Stellen geglättet: Produkte tragen
 *  Binärrauschen (1,66 · 0,75 = 1,2449999999999999 statt 1,245) – Postgres rechnet dort exakt 1,245 → 1,25.
 *  NaN/±∞ bleiben wie bei Math.round. */
export function rund(n: number, stellen: number): number {
  return Number.isFinite(n) ? runden(Number(n.toPrecision(15)), stellen) : n
}

/** Text mit genau `stellen` Nachkommastellen (Dezimalpunkt), kaufmännisch wie rund() – Ersatz für x.toFixed(n), das
 *  ebenso binär rundet ((1.005).toFixed(2) = „1.00“). NaN/±∞ wie toFixed („NaN“, „Infinity“). Sweep 77. */
export function rundText(n: number, stellen: number): string {
  return Number.isFinite(n) ? rund(n, stellen).toFixed(stellen) : n.toFixed(stellen)
}

/** Geldbetrag auf Cent (2 Stellen) */
export const rund2 = (n: number): number => rund(n, 2)

/** Mengen auf 3 Stellen (Liter, kg) */
export const rund3 = (n: number): number => rund(n, 3)
