// ── Kellerplan: Tank auf Tank ziehen (KAN-114, 07.10.2026) ──────────────────────────────────────────────
// Bewertet ein Ziel-Gebinde für eine gezogene Charge – Farbe beim Überfahren und Text im Buchungsdialog. Gebucht wird
// immer über umziehen() (KAN-112): leeres Gebinde = Umzug, gleicher Wein = Zusammenführung, abweichender Wein =
// Verschnitt in die Anker-Charge. Dieselbe Regel wie der Server (waehleZielCharge) – hier nur zur Vorschau.
// Entscheidungen Jörgen 06.10.2026: Umschalter „Kellerarbeit“/„Plan bearbeiten“ ja; Standardmenge = ganzer Inhalt der
// Charge; gleiche Sorte auf einen befüllten Tank nicht als Verschnitt (→ Zusammenführung, wie umziehen()).
// Rot auf Weiß ist seit KAN-193 als Verschnitt mit Abstufung möglich (Rückfrage beim Buchen) – daher blau mit Hinweis.
// Isomorph (node:test).

import { waehleZielCharge, merkmaleText } from '../kellerbuch/umzugZiel'
import { weinartKonflikt } from './weinart'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund } from '../zahl/runden.ts'
/** Eigene, aktive Charge in einem Gebinde (Merkmale wie in weinausbau) */
export type PlanCharge = {
  id: string
  name: string
  menge_liter: number
  jahrgang: number | null
  rebsorte: string | null
  weinart: string | null
  qualitaetsstufe: string | null
  zusatzbezeichnung: string | null
  erzeugnis: string | null
  herkunft_code: string | null
}

export type PlanGebinde = {
  id: string
  name: string
  volumen_liter: number | null
  /** von einem anderen Betrieb belegt (Kellergemeinschaft) */
  gesperrt: boolean
  fremd_betrieb: string | null
  /** Liter im Gebinde (eigen + fremd) */
  fuellung: number
}

export type ZielArt = 'umzug' | 'zusammenfuehren' | 'verschnitt' | 'gesperrt'

export type ZielBewertung = {
  art: ZielArt
  /** Kurztext für Dialog und Tooltip */
  text: string
  /** Anker- bzw. Zusammenführungs-Charge im Ziel */
  zielCharge: PlanCharge | null
  /** Rot/Weiß wird verschnitten (Abstufung auf Wein, Rückfrage beim Buchen) */
  rotWeiss: boolean
}

/** Farbe der Hervorhebung beim Überfahren */
export const ZIEL_FARBE: Readonly<Record<ZielArt, string>> = {
  umzug: '#3E9B79',            // grün
  zusammenfuehren: '#3E9B79',  // grün
  verschnitt: '#2F63AC',       // blau
  gesperrt: '#C9564E',         // rot
}

const l = (n: number) => `${(rund(n, 2)).toLocaleString('de-DE', { maximumFractionDigits: 2 })} L`

/**
 * Bewertung eines Ziel-Gebindes für `menge` Liter der Charge `quelle` aus `quellGebinde`. `zielChargen` = eigene aktive
 * Chargen im Ziel. Gesperrt: gleiches Gebinde, fremd belegt, Quelle fremd/leer, Kapazität überschritten.
 */
export function bewerteZiel(p: {
  quelle: PlanCharge | null
  quellGebinde: PlanGebinde
  ziel: PlanGebinde
  zielChargen: readonly PlanCharge[]
  menge: number
}): ZielBewertung {
  const gesperrt = (text: string): ZielBewertung => ({ art: 'gesperrt', text, zielCharge: null, rotWeiss: false })
  if (p.ziel.id === p.quellGebinde.id) return gesperrt('Gleiches Gebinde')
  if (!p.quelle || !(p.quelle.menge_liter > 0)) return gesperrt(`In „${p.quellGebinde.name}“ liegt kein eigener Wein`)
  if (p.ziel.gesperrt) return gesperrt(`„${p.ziel.name}“ ist durch ${p.ziel.fremd_betrieb ?? 'einen anderen Betrieb'} belegt`)
  if (!(p.menge > 0)) return gesperrt('Keine Menge')
  if (p.ziel.volumen_liter && p.ziel.volumen_liter > 0) {
    const frei = p.ziel.volumen_liter - p.ziel.fuellung
    if (p.menge > frei + 0.5) return gesperrt(`„${p.ziel.name}“ fasst nur noch ${l(Math.max(0, frei))} (gezogen: ${l(p.menge)})`)
  }
  if (p.zielChargen.length === 0) {
    return { art: 'umzug', text: `Umzug in das leere Gebinde „${p.ziel.name}“`, zielCharge: null, rotWeiss: false }
  }
  const wahl = waehleZielCharge(p.zielChargen, [p.quelle])
  const anker = (wahl.vorhanden as PlanCharge | null) ?? null
  if (!wahl.istVerschnitt) {
    return { art: 'zusammenfuehren', text: `Zusammenführen mit „${anker?.name ?? 'der Charge'}“ (gleicher Wein)`, zielCharge: anker, rotWeiss: false }
  }
  const rotWeiss = !!anker && weinartKonflikt(p.quelle.weinart, anker.weinart)
  return {
    art: 'verschnitt',
    text: `Verschnitt in „${anker?.name ?? 'die Charge'}“ (abweichend: ${merkmaleText(wahl.unterschiede)})${rotWeiss ? ' – Rot/Weiß: Abstufung auf Wein (aus Österreich), Rückfrage beim Buchen' : ''}`,
    zielCharge: anker,
    rotWeiss,
  }
}

/** Gebinde unter dem Zeiger (Kreis: Mittelpunkt und Radius in Pixeln der Zeichenfläche); null = freie Fläche */
export function gebindeUnterZeiger(
  punkt: { x: number; y: number },
  kreise: readonly { id: string; cx: number; cy: number; r: number }[],
  ausser: string | null,
): string | null {
  let best: { id: string; d: number } | null = null
  for (const k of kreise) {
    if (k.id === ausser) continue
    const d = Math.hypot(punkt.x - k.cx, punkt.y - k.cy)
    if (d <= k.r && (!best || d < best.d)) best = { id: k.id, d }
  }
  return best?.id ?? null
}
