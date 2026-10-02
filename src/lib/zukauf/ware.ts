// Ware eines Zukaufs (KAN-80 Nachtrag, Entscheidungen Jörgen 02.10.2026)
//
// „Wein | Traubenmost | Trauben wird mit Qualitätsstufe und Herkunfts-Code (BKI) zugekauft. Im Bereich Ware
// sind alle Felder Mussfelder. Herkunft wird Herkunfts-Code (BKI) wie bei den Ried-GST; daraus gelten die
// gleichen Regeln wie für Weinabstufungen.“ Dazu entschieden:
//  (a) Staatliche Prüfnummer bei Art „Wein“ Pflicht ab Qualitätswein (inkl. DAC – Stufe ≥ 2 der Rangfolge, nicht
//      „Sonstiges“), sonst optional. Seit KAN-186 stehen Reserve & Co. (Zusatzbezeichnung) sowie Sekt und Perlwein
//      (Erzeugnis) auf der Stufe Qualitätswein bzw. der gewählten Stufe – maßgeblich ist nur die Stufe;
//  (b) keine neue Spalte: zukauf_posten.herkunft speichert den Code. Altwerte (Freitext) bleiben – Anzeige
//      über herkunftAnzeige, im Bearbeiten-Formular per herkunftVorbelegung (nur eindeutig, sonst leer).
//
// Gemeinsam für Formulare (Client), Server Actions und Pressung. Die Qualitätsstufe selbst prüft die Action
// mit qualitaetFehler (Liste je Zieltabelle, scripts/tests/qualitaet.test.mjs) – hier nur Pflicht und Regeln.

import { HERKUNFT_LABEL, herkunftKnoten, herkunftKnotenTolerant } from '@/lib/herkunft'
import { niedrigsteQualitaet, qualitaetsRang } from '@/lib/wein/qualitaetsrang'

export type ZukaufArt = 'wein' | 'most' | 'trauben'

/** Wählbare Weinarten im Bereich Ware – „unbekannt“ (Altbestand) ist keine Angabe mehr */
export const ZUKAUF_WEINARTEN = ['weiss', 'rot', 'rose'] as const

/** Staatliche Prüfnummer Pflicht? Nur bei Art Wein und Qualitätswein oder höher (Regel a). */
export function pruefnummerPflicht(art: string | null | undefined, qualitaetsstufe: string | null | undefined): boolean {
  if (art !== 'wein') return false
  const r = qualitaetsRang(qualitaetsstufe)
  return !!r && r.art !== 'sonstiges' && r.stufe >= 2
}

/** Ist `wert` ein eigenes Weinbaugebiet des Betriebs (weinbaugebiete_custom.name)? Groß-/Kleinschreibung egal. */
function eigenesGebiet(wert: string, eigene: readonly string[]): string | null {
  const s = wert.trim().toLocaleLowerCase('de')
  return eigene.find(n => n.trim().toLocaleLowerCase('de') === s) ?? null
}

/**
 * Prüfung des Herkunfts-Codes (BKI) – dieselbe Auswahl wie am GST: ein Code des Katalogs (lib/herkunft.ts) oder ein
 * eigenes Weinbaugebiet des Betriebs. null = gültig, sonst die Meldung.
 */
export function herkunftCodeFehler(wert: string | null | undefined, eigene: readonly string[]): string | null {
  const w = typeof wert === 'string' ? wert.trim() : ''
  if (!w) return 'Bitte den Herkunfts-Code (BKI) wählen.'
  if (herkunftKnoten(w) || eigenesGebiet(w, eigene)) return null
  return `Der Herkunfts-Code „${w}“ ist unbekannt – bitte eine Herkunftsstufe aus der Auswahl wählen oder das Weinbaugebiet über „+ Neues Weinbaugebiet hinzufügen…“ anlegen.`
}

/** Anzeige von zukauf_posten.herkunft: bekannter Code → Bezeichnung, sonst der Text unverändert (Altwerte). */
export function herkunftAnzeige(wert: string | null | undefined): string | null {
  if (wert == null || wert === '') return null
  return Object.prototype.hasOwnProperty.call(HERKUNFT_LABEL, wert) ? HERKUNFT_LABEL[wert] : wert
}

/**
 * Startwert des Herkunfts-Codes im Bearbeiten-Formular: gespeicherter Code bzw. eigenes Weinbaugebiet unverändert,
 * ein Freitext-Altwert („Kamptal“) über herkunftKnotenTolerant, wenn er ein Gebiet eindeutig nennt – sonst leer
 * (dann muss gewählt werden).
 */
export function herkunftVorbelegung(wert: string | null | undefined, eigene: readonly string[]): string {
  const w = typeof wert === 'string' ? wert.trim() : ''
  if (!w) return ''
  if (herkunftKnoten(w)) return w
  const eigen = eigenesGebiet(w, eigene)
  if (eigen) return eigen
  return herkunftKnotenTolerant(w)?.code ?? ''
}

export type ZukaufWare = {
  art: string
  weinart: string | null
  rebsorte: string | null
  /** Jahrgang wie eingegeben (ohne Rückfall auf das Lieferjahr); NaN/null = fehlt */
  jahrgang: number | null
  qualitaetsstufe: string | null
  herkunft: string | null
  /** Mostgewicht vorhanden (Trauben, Most) */
  mostgewicht: boolean
  alkohol: number | null
  pruefnummer: string | null
}

/**
 * Pflichtprüfung des Bereichs Ware (KAN-80 Nachtrag): null = vollständig, sonst eine Meldung mit allen fehlenden
 * Feldern bzw. dem ersten Regelverstoß. Die Anreicherung bleibt optional.
 */
export function zukaufWareFehler(w: ZukaufWare, eigeneWeinbaugebiete: readonly string[]): string | null {
  const fehlt: string[] = []
  const weinMost = w.art === 'wein' || w.art === 'most'
  const mitMost = w.art === 'trauben' || w.art === 'most'
  if (!w.weinart || !(ZUKAUF_WEINARTEN as readonly string[]).includes(w.weinart)) fehlt.push('Weinart (Weißwein, Rotwein oder Rosé)')
  if (!w.rebsorte?.trim()) fehlt.push('Rebsorte(n)')
  if (w.jahrgang == null || !Number.isInteger(w.jahrgang)) fehlt.push('Jahrgang')
  if (!w.qualitaetsstufe) fehlt.push('Qualitätsstufe')
  if (!w.herkunft?.trim()) fehlt.push('Herkunfts-Code (BKI)')
  if (mitMost && !w.mostgewicht) fehlt.push('Mostgewicht')
  if (w.art === 'wein' && !(w.alkohol != null && w.alkohol > 0)) fehlt.push('Alkoholgehalt')
  if (pruefnummerPflicht(w.art, w.qualitaetsstufe) && !w.pruefnummer?.trim()) fehlt.push('Staatl. Prüfnummer (Pflicht ab Qualitätswein)')
  if (fehlt.length > 0) return `Bitte im Bereich Ware ausfüllen: ${fehlt.join(', ')}.`
  if (!weinMost && !mitMost) return 'Unbekannte Art – bitte Wein, Traubenmost oder Trauben wählen.'
  if (w.jahrgang! < 1900 || w.jahrgang! > 2100) return 'Der Jahrgang muss zwischen 1900 und 2100 liegen.'
  return herkunftCodeFehler(w.herkunft, eigeneWeinbaugebiete)
}

/**
 * Obergrenze der Qualitätsstufe einer Pressung (Abstufungsregel wie beim Verschnitt): die Stufe aus den °KMW bzw.
 * der Lese, höchstens die niedrigste Stufe der verpressten Zukauf-Trauben. Zukäufe ohne Stufe (Altbestand) zählen nicht.
 */
export function pressungObergrenze(ausLese: string, zukaufStufen: readonly (string | null | undefined)[]): string {
  const bekannt = zukaufStufen.filter((s): s is string => !!s && qualitaetsRang(s) != null)
  if (bekannt.length === 0) return ausLese
  return niedrigsteQualitaet([ausLese, ...bekannt]) ?? ausLese
}
