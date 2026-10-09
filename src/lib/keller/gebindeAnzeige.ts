// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund } from '../zahl/runden.ts'
// ── Gebinde-Anzeige im Kellerbuch (KAN-174, 07.10.2026) ─────────────────────────────────────────────────
// Rückmeldung Jörgen (Ticket KAN-174):
//  C  Bei der Gebinde-Auswahl (Umziehen, Pressen, Zukauf …) keine Kapazität, sondern „Inhalt – Charge | frei“.
//  E  Übersicht: ein Gebinde je Zeile, Füllstand als Kreis in der Farbe des Inhalts (weiß/rot/rosé) statt Balken
//     und Weinart-Knöpfen.
//  F  „LP-Pickerl“: Hinweis für Lohnproduktion, nur Anzeige (Spalte behaelter.lp_pickerl).
// Isomorph (node:test).

export const PICKERL_MAX = 60

/** Prüfung der Pickerl-Bezeichnung (leer = kein Pickerl) – wie CHECK behaelter_lp_pickerl_chk */
export function pickerlFehler(text: string | null | undefined): string | null {
  const t = (text ?? '').trim()
  if (!t) return null
  return t.length > PICKERL_MAX ? `Die Bezeichnung des LP-Pickerls darf höchstens ${PICKERL_MAX} Zeichen haben.` : null
}

/** „LP + Huber“ bzw. null */
export function pickerlText(p: string | null | undefined): string | null {
  const t = (p ?? '').trim()
  return t ? `LP + ${t}` : null
}

const liter = (n: number) => `${(rund(n, 2)).toLocaleString('de-DE', { maximumFractionDigits: 0 })} L`

/**
 * Text einer Gebinde-Auswahl: „T5 · 800 L GV Kellerberg | frei 200 L“, leer „T5 · leer | frei 1.000 L“; ohne Volumen
 * ohne „frei“. Mit Pickerl „ · LP + Huber“ am Ende. (Fett schreiben lässt sich eine <option> nicht – der Name steht
 * vorne.)
 */
export function gebindeOption(g: {
  name: string
  inhaltLiter: number
  chargen?: readonly string[]
  volumenLiter?: number | null
  pickerl?: string | null
}): string {
  const inhalt = g.inhaltLiter > 0.005
    ? `${liter(g.inhaltLiter)}${g.chargen && g.chargen.length ? ` ${g.chargen.join(', ')}` : ''}`
    : 'leer'
  const frei = g.volumenLiter && g.volumenLiter > 0 ? ` | frei ${liter(Math.max(0, g.volumenLiter - g.inhaltLiter))}` : ''
  const lp = pickerlText(g.pickerl)
  return `${g.name} · ${inhalt}${frei}${lp ? ` · ${lp}` : ''}`
}

/** Farbe des Füllstands-Kreises nach dem Inhalt (weiß/rot/rosé); unbekannt bzw. gemischt nach der Mehrheit */
export const WEINART_FARBE: Readonly<Record<string, string>> = {
  weiss: '#E2C45A',
  rot: '#8B2635',
  rose: '#E58FA8',
  unbekannt: '#3E9B79',
}

/** Weinart mit den meisten Litern (ohne Angabe: 'unbekannt') */
export function vorherrschendeWeinart(chargen: readonly { weinart?: string | null; liter: number }[]): string {
  const je = new Map<string, number>()
  for (const c of chargen) {
    const w = c.weinart === 'weiss' || c.weinart === 'rot' || c.weinart === 'rose' ? c.weinart : 'unbekannt'
    je.set(w, (je.get(w) ?? 0) + Math.max(0, c.liter))
  }
  let best = 'unbekannt', max = -1
  for (const [w, l] of je) if (l > max || (l === max && w !== 'unbekannt')) { best = w; max = l }
  return best
}

/** Suche auf der Übersicht: Gebinde-Name, Standort, Charge, Rebsorte, Pickerl (Groß-/Kleinschreibung egal) */
export function gebindePasst(suche: string | null | undefined, felder: readonly (string | null | undefined)[]): boolean {
  const s = (suche ?? '').trim().toLocaleLowerCase('de')
  if (!s) return true
  return felder.some(f => (f ?? '').toLocaleLowerCase('de').includes(s))
}

/** KAN-174 D: Manuelle Schwundbuchung nur mit Begründung (z. B. „ausgelaufen“) – Formular und Server Action gleich */
export function schwundGrundFehler(grund: string | null | undefined): string | null {
  return (grund ?? '').trim().length < 3 ? 'Bitte eine Begründung für den Schwund angeben (z. B. ausgelaufen, Verdunstung).' : null
}
