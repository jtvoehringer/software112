// Zustand der Mostgewicht-Eingabe (zwei gekoppelte Felder °KMW/°Oe) – KAN-128 Teil A, S4 (26.09.2026)
//
// Reine Funktionen ohne React, damit node:test (scripts/tests/mostgewicht-eingabe.test.mjs) die
// Regeln der Komponente src/components/wein/MostgewichtEingabe.tsx prüfen kann:
//  - Das zuletzt bearbeitete Feld ist gemessen, das andere zeigt den umgerechneten Wert („≈“) und
//    bleibt eingebbar – wer es überschreibt, misst in dieser Einheit.
//  - Beim Öffnen wird nichts neu gerechnet: gespeicherter Messwert und Einheit, das andere Feld
//    zeigt den gespeicherten (sonst den berechneten) Wert; die versteckten Felder tragen den
//    gespeicherten Messwert, Speichern ohne Änderung ergibt dieselben Werte.
//  - Überschreibt man einen ≈-Wert und ändert sich dadurch die rechnerische Stufe, wird das
//    angezeigt (16,99 °KMW ≈ 83,5 °Oe → gemessene 83,5 °Oe = 17,00 °KMW: Qualitätswein → Kabinett).
//  - Stufe nur aus ausMessung().kmw bzw. dem gespeicherten °KMW (Rechenregel 5).

import {
  ausMessung, formatKmw, formatOechsle, imGrenzbereich, mindestOechsle, parseEingabe, runden,
  OECHSLE_STELLEN,
  type Mostgewicht, type MostgewichtEinheit,
} from './mostgewicht'
import { mostgewichtAusGespeichert, type GespeichertesMostgewicht } from './mostgewichtFormular'
import { kmwZuQualitaet } from '../weinqualitaet'

/** Mindest-°KMW der Stufen (§§ 9–11 WeinG) wie kmwZuQualitaet() in lib/weinqualitaet.ts:
 *  Landwein, Qualitätswein, Kabinett, Spätlese, Auslese, Beerenauslese, Trockenbeerenauslese.
 *  (Nach KAN-81 aus MINDEST_KMW übernehmen.) */
export const STUFEN_SCHWELLEN_KMW: readonly number[] = [14, 15, 17, 19, 21, 25, 30]

/** Prädikatswein (§ 11 WeinG) ab Spätlese – dort zählt die Bestätigung der Mostwäger */
export const PRAEDIKATSWEIN_AB_KMW = 19

export interface EingabeZustand {
  /** Text je Feld, wie angezeigt */
  text: Record<MostgewichtEinheit, string>
  /** Einheit des zuletzt bearbeiteten Felds = gemessen (ohne Wert: die bevorzugte) */
  gemessen: MostgewichtEinheit
  /** Aktuelles Mostgewicht – null bei leerer oder ungültiger Eingabe */
  wert: Mostgewicht | null
  /** Fehlertext zur Eingabe im gemessenen Feld */
  fehler: string | null
  /** Mostgewicht, bevor ein ≈-Wert überschrieben wurde (Vergleich für den Stufenwechsel) */
  vorher: Mostgewicht | null
  /** Seit dem Öffnen bearbeitet? */
  bearbeitet: boolean
}

export const ANDERE_EINHEIT: Readonly<Record<MostgewichtEinheit, MostgewichtEinheit>> = { kmw: 'oechsle', oechsle: 'kmw' }

/** Anzeige-Reihenfolge der Felder: bevorzugte Einheit zuerst */
export function feldReihenfolge(bevorzugt: MostgewichtEinheit): [MostgewichtEinheit, MostgewichtEinheit] {
  return bevorzugt === 'oechsle' ? ['oechsle', 'kmw'] : ['kmw', 'oechsle']
}

/** °Oe im Eingabefeld: ganzzahlig ohne „,0“ (Standard, Entscheidung 9), sonst mit einer Stelle */
function oechsleText(oe: number): string {
  const r = runden(oe, OECHSLE_STELLEN)
  return Number.isInteger(r) ? String(r) : r.toFixed(OECHSLE_STELLEN).replace('.', ',')
}

/**
 * Text eines Felds: der Messwert wie gespeichert („17,4“ °KMW, „84“ bzw. „83,5“ °Oe), der
 * umgerechnete mit seiner vollen Genauigkeit („17,09“ °KMW, „84,0“ °Oe).
 */
export function feldText(einheit: MostgewichtEinheit, m: Mostgewicht | null): string {
  if (!m) return ''
  if (einheit === 'kmw') return formatKmw(m.kmw, 2)
  return m.einheit === 'oechsle' ? oechsleText(m.oechsle) : formatOechsle(m.oechsle)
}

/** Startzustand aus den gespeicherten Werten – ohne Neuberechnung (siehe Dateikopf) */
export function eingabeStart(
  gespeichert: GespeichertesMostgewicht | null | undefined,
  bevorzugt: MostgewichtEinheit,
): EingabeZustand {
  const m = mostgewichtAusGespeichert(gespeichert)
  return {
    text: { kmw: feldText('kmw', m), oechsle: feldText('oechsle', m) },
    gemessen: m ? m.einheit : bevorzugt,
    wert: m,
    fehler: null,
    vorher: null,
    bearbeitet: false,
  }
}

/**
 * Eingabe `text` im Feld `einheit`: dieses Feld ist ab jetzt gemessen, das andere wird aus
 * ausMessung() neu gefüllt (leer bei leerer oder ungültiger Eingabe – Leeren = gelöscht). War das
 * Feld bisher der ≈-Wert, merkt sich `vorher` das bisherige Mostgewicht für den Stufenwechsel.
 */
export function eingabeAendern(z: EingabeZustand, einheit: MostgewichtEinheit, text: string): EingabeZustand {
  const andere = ANDERE_EINHEIT[einheit]
  const p = parseEingabe(text, einheit)
  const wert = p.ok && p.wert != null ? ausMessung(p.wert, einheit) : null
  return {
    text: { [einheit]: text, [andere]: feldText(andere, wert) } as Record<MostgewichtEinheit, string>,
    gemessen: einheit,
    wert,
    fehler: p.ok ? null : p.fehler,
    vorher: einheit === z.gemessen ? z.vorher : z.wert,
    bearbeitet: true,
  }
}

/** Qualitätsstufe (Code aus lib/weinqualitaet) zum aktuellen Mostgewicht – nur aus °KMW */
export function eingabeStufe(z: EingabeZustand): string | null {
  return z.wert ? kmwZuQualitaet(z.wert.kmw) : null
}

/**
 * Stufenwechsel durch das Überschreiben eines ≈-Werts: rechnerische Stufe vorher (Messung in der
 * anderen Einheit) und jetzt, wenn sie sich unterscheiden – sonst null.
 */
export function stufenwechsel(z: EingabeZustand): { von: string; nach: string; vorher: Mostgewicht } | null {
  if (!z.vorher || !z.wert || z.vorher.einheit === z.wert.einheit) return null
  const von = kmwZuQualitaet(z.vorher.kmw)
  const nach = kmwZuQualitaet(z.wert.kmw)
  return von === nach ? null : { von, nach, vorher: z.vorher }
}

export interface Grenzfall {
  /** Mindest-°KMW der nächstgelegenen Stufe */
  schwelleKmw: number
  /** Kleinster °Oe-Messwert (0,1-Raster, Variante B) für diese Stufe – wie die BKI-Tabelle */
  schwelleOechsle: number
  /** Stufe ab dieser Schwelle (Code aus lib/weinqualitaet) */
  stufe: string
  /** Prädikatswein: die Bestätigung der Mostwäger zählt (§ 11 Abs. 2, § 12 Abs. 6 WeinG) */
  praedikatswein: boolean
}

/** Liegt das Mostgewicht höchstens ±0,2 °KMW an einer Stufenschwelle? (Jörgen, 26.09.2026) */
export function grenzfall(m: Mostgewicht | null | undefined): Grenzfall | null {
  if (!m) return null
  const s = imGrenzbereich(m.kmw, STUFEN_SCHWELLEN_KMW)
  if (s == null) return null
  return { schwelleKmw: s, schwelleOechsle: mindestOechsle(s, 1), stufe: kmwZuQualitaet(s), praedikatswein: s >= PRAEDIKATSWEIN_AB_KMW }
}

/**
 * Werte der versteckten Felder: `wert` = Messwert wie eingegeben (die Action rechnet selbst),
 * `einheit` = gemessene Einheit, `kmw` = °KMW für das alte Feld (Punkt als Dezimaltrennzeichen;
 * leer, wenn nichts oder Ungültiges eingegeben ist).
 */
export function versteckteWerte(z: EingabeZustand): { wert: string; einheit: MostgewichtEinheit; kmw: string } {
  return {
    wert: z.text[z.gemessen].trim(),
    einheit: z.gemessen,
    kmw: z.wert ? String(z.wert.kmw) : '',
  }
}
