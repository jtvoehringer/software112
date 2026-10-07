// Ware eines Zukaufs (KAN-80 Nachtrag, Entscheidungen Jörgen 02.10.2026)
//
// „Wein | Traubenmost | Trauben (seit KAN-41 auch Maische) wird mit Qualitätsstufe und Herkunfts-Code (BKI) zugekauft. Im Bereich Ware
// sind alle Felder Mussfelder. Herkunft wird Herkunfts-Code (BKI) wie bei den Ried-GST; daraus gelten die
// gleichen Regeln wie für Weinabstufungen.“ Dazu entschieden:
//  (a) Staatliche Prüfnummer: beim Zukauf NIE Pflicht, bei keiner Stufe und auch nicht bei Sekt/Perlwein (Entscheidung
//      Jörgen 02.10.2026, ersetzt die frühere Regel „Pflicht ab Qualitätswein“). Erst ein abzufüllender Wein wird zur
//      Prüfnummer angemeldet – ob er eine bekommt, ist eine andere Frage. Das Feld bleibt optional;
//  (b) keine neue Spalte: zukauf_posten.herkunft speichert den Code. Altwerte (Freitext) bleiben – Anzeige
//      über herkunftAnzeige, im Bearbeiten-Formular per herkunftVorbelegung (nur eindeutig, sonst leer).
//
// Gemeinsam für Formulare (Client), Server Actions und Pressung. Die Qualitätsstufe selbst prüft die Action
// mit qualitaetFehler (Liste je Zieltabelle, scripts/tests/qualitaet.test.mjs) – hier nur Pflicht und Regeln.

import { HERKUNFT_LABEL, herkunftKnoten, herkunftKnotenTolerant } from '@/lib/herkunft'
import { niedrigsteQualitaet, qualitaetsRang } from '@/lib/wein/qualitaetsrang'
import { fuellungBrauchtPruefnummer } from '@/lib/handel/partnerPflicht'

export type ZukaufArt = 'wein' | 'most' | 'trauben' | 'maische' | 'flaschen'

/** Bezeichnung der Zukauf-Art (Listen, Weinbuch) */
export const ZUKAUF_ART_LABEL: Record<ZukaufArt, string> = { wein: 'Wein', most: 'Traubenmost', trauben: 'Trauben', maische: 'Maische', flaschen: 'Flaschen (Handelsware)' }

/**
 * KAN-41 Paket 2a (06.10.2026): Trauben und Maische – ohne Zielcharge, Quelle einer Pressung (Journal ZK_TRAUB bzw.
 * ZK_MAISC), Qualitätsstufen der Lese, Mostgewicht Pflicht, zählen zur Zukaufsgrenze. Maische wird nur gepresst, nicht
 * weiterverkauft (Entscheidungen Jörgen 06.10.2026).
 */
export function istTraubenArt(art: string | null | undefined): boolean {
  return art === 'trauben' || art === 'maische'
}

/**
 * KAN-41 Paket 2b (06.10.2026): zugekaufte Flaschen (Handelsware) – keine Charge, sondern ein eigener Weinlager-Artikel
 * (Füllung mit zukauf_posten_id), Journal ZK_FLA; Ware wie bei Wein (Alkohol Pflicht, kein Mostgewicht).
 */
export function istFlaschenArt(art: string | null | undefined): boolean {
  return art === 'flaschen'
}

/** Zulässige Flaschengrößen (CHECK fuellungen_flaschengroesse_ml_check) */
export const FLASCHEN_GROESSEN_ML = [187, 375, 500, 750, 1000, 1500, 3000, 6000] as const

export type FlaschenZukauf = {
  name: string | null
  flaschengroesseMl: number | null
  menge: number
  einheit: string | null
  qualitaetsstufe: string | null
  zusatzbezeichnung?: string | null
  erzeugnis?: string | null
  pruefnummer: string | null
}

/**
 * Pflichtprüfung des Weinlager-Artikels eines Flaschenzukaufs (KAN-41 Paket 2b): Produktname, Flaschengröße, ganze
 * Stückzahl; Prüfnummer des Erzeugers ab Qualitätswein, mit Zusatzbezeichnung oder als Sekt (Entscheidung E2 Jörgen
 * 06.10.2026 – dieselbe Regel wie der Flaschenverkauf, fuellungBrauchtPruefnummer). null = in Ordnung.
 */
export function flaschenZukaufFehler(z: FlaschenZukauf): string | null {
  if (!z.name?.trim()) return 'Bitte den Produktnamen für das Weinlager angeben.'
  if (z.flaschengroesseMl == null || !(FLASCHEN_GROESSEN_ML as readonly number[]).includes(z.flaschengroesseMl)) {
    return 'Bitte die Flaschengröße aus der Liste wählen.'
  }
  if (!(z.menge > 0) || !Number.isInteger(z.menge)) return 'Bitte die Anzahl Flaschen als ganze Zahl über 0 angeben.'
  if ((z.einheit ?? 'Stk') !== 'Stk') return 'Zugekaufte Flaschen werden in Stück (Stk) erfasst.'
  return flaschenPruefnummerFehler(z, z.pruefnummer)
}

/**
 * KAN-225 (07.10.2026, Vorgabe Jörgen zu KAN-41/KAN-199): Braucht zugekaufte Flaschenware eine staatliche Prüfnummer?
 * Ja ab Qualitätswein (Kabinett, Prädikatsweine …), mit Zusatzbezeichnung (DAC, Reserve …) oder als Sekt g.U.; nein
 * darunter – Wein und Landwein haben keine Prüfnummer. Dieselbe Regel wie beim Flaschenverkauf (fuellungBrauchtPruefnummer).
 */
export function flaschenPruefnummerPflicht(q: { qualitaetsstufe: string | null; zusatzbezeichnung?: string | null; erzeugnis?: string | null }): boolean {
  const erzeugnis = q.erzeugnis === 'SEKTGU' ? 'sekt' : q.erzeugnis
  return fuellungBrauchtPruefnummer({ qualitaet: q.qualitaetsstufe, zusatzbezeichnung: q.zusatzbezeichnung, erzeugnis })
}

/** KAN-225: Prüfnummer fehlt, obwohl Pflicht – für Neuanlage und Bearbeiten eines Flaschenzukaufs; null = in Ordnung */
export function flaschenPruefnummerFehler(
  q: { qualitaetsstufe: string | null; zusatzbezeichnung?: string | null; erzeugnis?: string | null },
  pruefnummer: string | null | undefined,
): string | null {
  if (!flaschenPruefnummerPflicht(q) || pruefnummer?.trim()) return null
  return 'Für zugekaufte Flaschen ab Qualitätswein (bzw. mit Zusatzbezeichnung oder als Sekt g.U.) bitte die staatliche Prüfnummer des Erzeugers angeben – Wein und Landwein brauchen keine.'
}

/** Wählbare Weinarten im Bereich Ware – „unbekannt“ (Altbestand) ist keine Angabe mehr */
export const ZUKAUF_WEINARTEN = ['weiss', 'rot', 'rose'] as const

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
}

/**
 * Pflichtprüfung des Bereichs Ware (KAN-80 Nachtrag): null = vollständig, sonst eine Meldung mit allen fehlenden
 * Feldern bzw. dem ersten Regelverstoß. Die Anreicherung bleibt optional.
 */
export function zukaufWareFehler(w: ZukaufWare, eigeneWeinbaugebiete: readonly string[]): string | null {
  const fehlt: string[] = []
  const weinMost = w.art === 'wein' || w.art === 'most' || istFlaschenArt(w.art)
  const mitMost = istTraubenArt(w.art) || w.art === 'most'
  if (!w.weinart || !(ZUKAUF_WEINARTEN as readonly string[]).includes(w.weinart)) fehlt.push('Weinart (Weißwein, Rotwein oder Rosé)')
  if (!w.rebsorte?.trim()) fehlt.push('Rebsorte(n)')
  if (w.jahrgang == null || !Number.isInteger(w.jahrgang)) fehlt.push('Jahrgang')
  if (!w.qualitaetsstufe) fehlt.push('Qualitätsstufe')
  if (!w.herkunft?.trim()) fehlt.push('Herkunfts-Code (BKI)')
  if (mitMost && !w.mostgewicht) fehlt.push('Mostgewicht')
  if ((w.art === 'wein' || istFlaschenArt(w.art)) && !(w.alkohol != null && w.alkohol > 0)) fehlt.push('Alkoholgehalt')
  // Prüfnummer beim Zukauf optional (Entscheidung Jörgen 02.10.2026, ersetzt KAN-80 Regel a „Pflicht ab Qualitätswein“)
  if (fehlt.length > 0) return `Bitte im Bereich Ware ausfüllen: ${fehlt.join(', ')}.`
  if (!weinMost && !mitMost) return 'Unbekannte Art – bitte Wein, Traubenmost, Trauben, Maische oder Flaschen wählen.'
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
