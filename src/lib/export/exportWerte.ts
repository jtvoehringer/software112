// Sweep 77 (09.10.2026): Warenwerte der Weinexport-Dokumente (Handelsrechnung, EUR.1, Ursprungszeugnis, Lieferschein)
// und Bruttogewicht der EMCS-Vorlage. Vorher: Zeilenwert (menge · preis).toFixed(2) und Gesamtwert als Summe der
// UNgerundeten Produkte – toFixed rundet binär (0,565 → 0,56) und die Summe der gedruckten Zeilen wich vom gedruckten
// Gesamtwert um einen Cent ab. Jetzt: Zeilenwert kaufmännisch auf Cent, Gesamtwert = Summe der Zeilenwerte.
// Ohne @/-Importe (node:test).
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt (tsconfig ohne allowImportingTsExtensions)
import { rund, rundText } from '../zahl/runden.ts'

type Position = { menge?: unknown; preis_eur?: unknown }

const zahl = (v: unknown): number => parseFloat(String(v ?? '')) || 0

/** Zeilenwert in EUR, kaufmännisch auf Cent */
export function positionsWert(p: Position): number {
  return rund(zahl(p.menge) * zahl(p.preis_eur), 2)
}

/** Gesamtwert = Summe der gedruckten Zeilenwerte */
export function gesamtWert(positionen: readonly Position[]): number {
  return rund(positionen.reduce((s, p) => s + positionsWert(p), 0), 2)
}

/** Betrag mit zwei Nachkommastellen (Dezimalpunkt, wie bisher auf den Dokumenten) */
export function eurText(n: number): string {
  return rundText(n, 2)
}

/** Bruttogewicht der EMCS-Vorlage: 1,25 kg je Liter, auf 2 Stellen */
export function bruttogewichtText(menge: unknown): string {
  return rundText(zahl(menge) * 1.25, 2)
}
