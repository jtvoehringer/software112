// Mostgewicht entlang der Kellerkette – Umzug, Zusammenführung und Verschnitt (KAN-130 Etappe 2, 02.10.2026)
//
// Entscheidungen Jörgen 01.10.2026 (KAN-130, offene Frage 1): Mischwert = mengengewichteter Mittelwert in °KMW
// (litergewichtet – Entscheidung 07.10.2026 statt über die Dichte; mischen() aus lib/wein/mostgewicht), auf 2 Stellen
// abgerundet, °Oe daraus; fehlt
// einem Anteil das Mostgewicht, zählen nur die Anteile mit Wert und das Ergebnis heißt „teilweise“.
//
// Momentaufnahme für Storno und „Umzug ändern“: keller_umzuege.kmw/oechsle/mostgewicht_einheit_vorher/_nachher
// (Zusammenführung) bzw. verschneidungen.ziel_*_vorher. Die Einheit der Momentaufnahme ist nie leer
// (weinausbau.mostgewicht_einheit ist NOT NULL) – daran erkennt der Storno, dass es eine Momentaufnahme gibt
// (Buchungen vor KAN-130 Etappe 2 haben keine und bleiben beim Storno unverändert).
//
// Ohne Importe außer dem Rechenkern: node:test (scripts/tests/kan130-mostgewicht-kette.test.mjs) lädt die Datei direkt.

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei im Test ohne Bundler lädt (wie lib/buchhaltung/bmd.ts)
import { mischenMitAnteil, type MostgewichtEinheit } from '../wein/mostgewicht.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/** Mostgewichtsspalten einer Charge (weinausbau) */
export interface MostgewichtSpalten {
  kmw: number | null
  oechsle: number | null
  mostgewicht_einheit: MostgewichtEinheit
}

/** Ein Anteil: Liter und die Charge, aus der er stammt */
export interface Anteil { liter: number; charge: R | null | undefined }

function zahlOderNull(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function einheitVon(c: R | null | undefined): MostgewichtEinheit {
  return c?.mostgewicht_einheit === 'oechsle' ? 'oechsle' : 'kmw'
}

/** Mostgewichtsspalten einer geladenen Charge (Zahlen aus PostgREST kommen auch als Text) */
export function mostgewichtVon(c: R | null | undefined): MostgewichtSpalten {
  return { kmw: zahlOderNull(c?.kmw), oechsle: zahlOderNull(c?.oechsle), mostgewicht_einheit: einheitVon(c) }
}

function gleich(a: MostgewichtSpalten, b: MostgewichtSpalten): boolean {
  return a.kmw === b.kmw && a.oechsle === b.oechsle && a.mostgewicht_einheit === b.mostgewicht_einheit
}

/** Ergebnis einer Mischung: Spalten für die Charge (null = kein Mostgewicht bekannt) und „teilweise“ */
export interface MischSpalten {
  spalten: MostgewichtSpalten | null
  teilweise: boolean
  mitWert: number
  gesamt: number
}

/**
 * Mostgewicht einer NEUEN Charge aus ihren Anteilen (Umzug in ein leeres Gebinde, Zusammenführung zu einer neuen
 * Charge). Stammt alles aus Chargen mit demselben Mostgewicht (z. B. ein einfacher Umzug), wird der Messwert samt
 * Einheit unverändert übernommen – eine in °Oe gemessene Charge bleibt so in °Oe (KAN-128, Rechenregel 9).
 * Sonst der Mittelwert in °KMW (Einheit 'kmw').
 */
export function mostgewichtNeu(anteile: readonly Anteil[]): MischSpalten {
  const mitMenge = anteile.filter(a => Number.isFinite(a.liter) && a.liter > 0)
  const mitWert = mitMenge.filter(a => mostgewichtVon(a.charge).kmw != null)
  if (mitWert.length === 0) return { spalten: null, teilweise: false, mitWert: 0, gesamt: mitMenge.length }
  const teilweise = mitWert.length < mitMenge.length
  const erste = mostgewichtVon(mitWert[0].charge)
  if (mitWert.every(a => gleich(mostgewichtVon(a.charge), erste))) {
    return { spalten: erste, teilweise, mitWert: mitWert.length, gesamt: mitMenge.length }
  }
  const m = mischenMitAnteil(mitMenge.map(a => ({ menge: a.liter, kmw: mostgewichtVon(a.charge).kmw })), 'l')
  return {
    spalten: m.mostgewicht ? { kmw: m.mostgewicht.kmw, oechsle: m.mostgewicht.oechsle, mostgewicht_einheit: 'kmw' } : null,
    teilweise, mitWert: mitWert.length, gesamt: mitMenge.length,
  }
}

/** Zusammenführung bzw. Verschnitt in eine BESTEHENDE Charge */
export interface ZusammenfuehrungMostgewicht {
  /** Spalten für das UPDATE der Ziel-Charge – null: Mostgewicht bleibt unverändert */
  werte: MostgewichtSpalten | null
  vorher: MostgewichtSpalten
  nachher: MostgewichtSpalten
  teilweise: boolean
}

/**
 * Ziel-Charge (Bestand `zielLiter` vor dem Zugang) bekommt Zugänge – gewichteter Mittelwert aus Ziel und Zugängen.
 * Ändert sich der Wert nicht (gleiches Mostgewicht, oder niemand hat eines), bleibt die Charge samt gemessener
 * Einheit unverändert (`werte` = null). `vorher`/`nachher` sind die Momentaufnahme für den Storno.
 */
export function mostgewichtZusammenfuehren(ziel: R, zielLiter: number, zugaenge: readonly Anteil[]): ZusammenfuehrungMostgewicht {
  const vorher = mostgewichtVon(ziel)
  const m = mostgewichtNeu([{ liter: zielLiter, charge: ziel }, ...zugaenge])
  // Gleicher °KMW-Wert: Charge bleibt samt gemessener Einheit (z. B. °Oe) unverändert
  if (!m.spalten || m.spalten.kmw === vorher.kmw) {
    return { werte: null, vorher, nachher: vorher, teilweise: m.teilweise }
  }
  return { werte: m.spalten, vorher, nachher: m.spalten, teilweise: m.teilweise }
}

/** Vermerk für Zielzeile/Verschnitt, wenn das Mittel nur aus einem Teil der Anteile stammt */
export function teilweiseVermerk(m: { teilweise: boolean; mitWert?: number; gesamt?: number }): string | null {
  if (!m.teilweise) return null
  return 'Mostgewicht teilweise: Mittelwert nur aus den Anteilen mit Mostgewicht'
}

/** Spalten der Momentaufnahme an keller_umzuege (Zielzeile einer Zusammenführung) */
export function umzugMomentaufnahme(z: ZusammenfuehrungMostgewicht): R {
  return {
    kmw_vorher: z.vorher.kmw, oechsle_vorher: z.vorher.oechsle, mostgewicht_einheit_vorher: z.vorher.mostgewicht_einheit,
    kmw_nachher: z.nachher.kmw, oechsle_nachher: z.nachher.oechsle, mostgewicht_einheit_nachher: z.nachher.mostgewicht_einheit,
  }
}

/** Spalten der Momentaufnahme an verschneidungen */
export function verschnittMomentaufnahme(ziel: R): R {
  const v = mostgewichtVon(ziel)
  return { ziel_kmw_vorher: v.kmw, ziel_oechsle_vorher: v.oechsle, ziel_mostgewicht_einheit_vorher: v.mostgewicht_einheit }
}

/**
 * Storno einer Zusammenführung: Mostgewicht aus der Momentaufnahme der Zielzeile zurück – nur, wenn es eine gibt
 * und die Charge noch auf „nachher“ steht (sonst wurde es seither bewusst geändert und bleibt).
 * Liefert die Spalten für den Rückbuchungs-Payload oder null.
 */
export function umzugRuecknahme(zielZeile: R, charge: R): MostgewichtSpalten | null {
  if (!zielZeile?.mostgewicht_einheit_nachher || !zielZeile?.mostgewicht_einheit_vorher) return null
  const nachher: MostgewichtSpalten = {
    kmw: zahlOderNull(zielZeile.kmw_nachher), oechsle: zahlOderNull(zielZeile.oechsle_nachher),
    mostgewicht_einheit: zielZeile.mostgewicht_einheit_nachher === 'oechsle' ? 'oechsle' : 'kmw',
  }
  const vorher: MostgewichtSpalten = {
    kmw: zahlOderNull(zielZeile.kmw_vorher), oechsle: zahlOderNull(zielZeile.oechsle_vorher),
    mostgewicht_einheit: zielZeile.mostgewicht_einheit_vorher === 'oechsle' ? 'oechsle' : 'kmw',
  }
  if (gleich(vorher, nachher)) return null
  const jetzt = mostgewichtVon(charge)
  if (jetzt.kmw !== nachher.kmw) return null
  return vorher
}

/** Storno eines Verschnitts: Mostgewicht der Ziel-Charge aus der Momentaufnahme (nur Verschnitte ab KAN-130 Etappe 2) */
export function verschnittRuecknahme(v: R): MostgewichtSpalten | null {
  if (!v?.ziel_mostgewicht_einheit_vorher) return null
  return {
    kmw: zahlOderNull(v.ziel_kmw_vorher), oechsle: zahlOderNull(v.ziel_oechsle_vorher),
    mostgewicht_einheit: v.ziel_mostgewicht_einheit_vorher === 'oechsle' ? 'oechsle' : 'kmw',
  }
}
