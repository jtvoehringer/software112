// ── Gewichte im Weinexport (KAN-414, 11.11.2026) ─────────────────────────────────────────────────────────────────────
//
// Nettogewicht = Wein, Bruttogewicht = Wein + Flasche (Leergewicht der Füllung, inkl. Verschluss, Kapsel, Etikett);
// die Bruttomasse der Sendung zusätzlich mit der Verpackung des Auftrags (Kartons, Palette).
// Rechenweg je Position: Flaschen × Inhalt (l) × 0,99 kg/l (Stillwein, Näherung) + Flaschen × Leergewicht.
// Einheiten der Position: „Fl“ (Flaschen), „HL“ (Hektoliter lose Ware – ohne Flaschengewicht) und „Kiste“ (Flaschen je
// Kiste unbekannt – wie beim Volumen der CSV, lib/behoerden/exportauftrag.ts literAus: kein Gewicht). Fehlt eine Angabe
// (keine Füllung, kein Leergewicht, keine Flaschengröße), gibt es KEIN geschätztes Gewicht: der Wert ist null und der
// Auftrag zeigt einen Hinweis.
// Vorher (bis KAN-414) rechnete nur die e-AD-Datei Menge × 1,25 kg – unabhängig von der Einheit, bei „Fl“ also
// Flaschenzahl × 1,25 kg.
// Ohne '@/'-Importe (node:test).

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund, rundText } from '../zahl/runden.ts'

/** Dichte von Stillwein in kg je Liter (Näherung für Versandgewichte) */
export const WEIN_KG_JE_LITER = 0.99
/** Nachkommastellen der Gewichte in kg */
export const GEWICHT_STELLEN = 2

export type GewichtPosition = {
  menge?: unknown
  einheit?: unknown
  /** Füllung der Position (null/undefined: freie Position ohne Füllung) */
  fuellung?: { flaschengroesse_ml?: unknown; leergewicht_g?: unknown } | null
}

export type PositionsGewicht = {
  /** Liter Wein der Position (null, wenn nicht bestimmbar) */
  liter: number | null
  /** Anzahl Flaschen (null bei loser Ware bzw. unbekannt) */
  flaschen: number | null
  nettoKg: number | null
  bruttoKg: number | null
  /** Warum kein Gewicht (für den Hinweis am Auftrag), sonst null */
  fehlt: 'fuellung' | 'flaschengroesse' | 'leergewicht' | 'menge' | 'kiste' | null
}

const zahl = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

/** Brutto- und Nettogewicht einer Flasche in kg (null, wenn Größe bzw. Leergewicht fehlen) */
export function flaschenGewicht(flaschengroesseMl: unknown, leergewichtG: unknown): { nettoKg: number | null; bruttoKg: number | null } {
  const ml = zahl(flaschengroesseMl)
  const leer = zahl(leergewichtG)
  const netto = ml !== null && ml > 0 ? (ml / 1000) * WEIN_KG_JE_LITER : null
  return {
    nettoKg: netto === null ? null : rund(netto, 3),
    bruttoKg: netto === null || leer === null || !(leer > 0) ? null : rund(netto + leer / 1000, 3),
  }
}

/** Gewicht einer Exportposition */
export function positionsGewicht(p: GewichtPosition): PositionsGewicht {
  const menge = zahl(p.menge)
  const leerErg: PositionsGewicht = { liter: null, flaschen: null, nettoKg: null, bruttoKg: null, fehlt: 'menge' }
  if (menge === null || !(menge > 0)) return leerErg
  const einheit = String(p.einheit ?? 'Fl')
  if (einheit === 'HL') {
    // lose Ware: nur der Wein, kein Flaschengewicht – Gebinde gehören in die Verpackung des Auftrags
    const liter = menge * 100
    const kg = rund(liter * WEIN_KG_JE_LITER, GEWICHT_STELLEN)
    return { liter: rund(liter, 3), flaschen: null, nettoKg: kg, bruttoKg: kg, fehlt: null }
  }
  if (einheit === 'Kiste') return { ...leerErg, fehlt: 'kiste' }
  const flaschen = menge
  if (!p.fuellung) return { ...leerErg, flaschen, fehlt: 'fuellung' }
  const ml = zahl(p.fuellung.flaschengroesse_ml)
  if (ml === null || !(ml > 0)) return { ...leerErg, flaschen, fehlt: 'flaschengroesse' }
  const liter = (flaschen * ml) / 1000
  const nettoKg = rund(liter * WEIN_KG_JE_LITER, GEWICHT_STELLEN)
  const leer = zahl(p.fuellung.leergewicht_g)
  if (leer === null || !(leer > 0)) return { liter: rund(liter, 3), flaschen, nettoKg, bruttoKg: null, fehlt: 'leergewicht' }
  return { liter: rund(liter, 3), flaschen, nettoKg, bruttoKg: rund(liter * WEIN_KG_JE_LITER + (flaschen * leer) / 1000, GEWICHT_STELLEN), fehlt: null }
}

export type SendungsGewicht = {
  positionen: PositionsGewicht[]
  /** Summe der Positionen; null, sobald einer Position das Gewicht fehlt */
  nettoKg: number | null
  /** Summe der Positionen + Verpackung; null, sobald einer Position das Bruttogewicht fehlt */
  bruttoKg: number | null
  verpackungKg: number
  /** Anzahl Positionen ohne vollständiges Gewicht */
  unvollstaendig: number
  /** Hinweis für den Auftrag, wenn Gewichte fehlen – sonst null */
  hinweis: string | null
}

/** Gewichte einer Sendung: Summen aus den gerundeten Positionswerten, Verpackung nur im Brutto */
export function sendungsGewicht(positionen: readonly GewichtPosition[], verpackungKg: unknown): SendungsGewicht {
  const pos = positionen.map(positionsGewicht)
  const verpackung = Math.max(0, zahl(verpackungKg) ?? 0)
  const nettoVollstaendig = pos.length > 0 && pos.every(p => p.nettoKg !== null)
  const bruttoVollstaendig = pos.length > 0 && pos.every(p => p.bruttoKg !== null)
  const unvollstaendig = pos.filter(p => p.bruttoKg === null).length
  const gruende = new Set(pos.map(p => p.fehlt).filter(Boolean))
  const teile: string[] = []
  if (gruende.has('leergewicht')) teile.push('bei mindestens einer Füllung fehlt das Leergewicht der Flasche')
  if (gruende.has('fuellung')) teile.push('mindestens eine Position hat keine Füllung')
  if (gruende.has('flaschengroesse')) teile.push('bei mindestens einer Füllung fehlt die Flaschengröße')
  if (gruende.has('kiste')) teile.push('bei der Einheit „Kiste“ ist die Flaschenzahl unbekannt – bitte in Flaschen erfassen')
  if (gruende.has('menge')) teile.push('mindestens eine Position hat keine Menge')
  return {
    positionen: pos,
    nettoKg: nettoVollstaendig ? rund(pos.reduce((s, p) => s + (p.nettoKg ?? 0), 0), GEWICHT_STELLEN) : null,
    bruttoKg: bruttoVollstaendig ? rund(pos.reduce((s, p) => s + (p.bruttoKg ?? 0), 0) + verpackung, GEWICHT_STELLEN) : null,
    verpackungKg: rund(verpackung, GEWICHT_STELLEN),
    unvollstaendig,
    hinweis: teile.length ? `Gewicht unvollständig: ${teile.join('; ')}. In den Dokumenten bleibt das Gewicht leer.` : null,
  }
}

/** Gewicht für Dokumente: zwei Nachkommastellen mit Dezimalpunkt (wie die Beträge dort), leer wenn unbekannt */
export function kgText(kg: number | null | undefined): string {
  return kg === null || kg === undefined ? '' : rundText(kg, GEWICHT_STELLEN)
}
