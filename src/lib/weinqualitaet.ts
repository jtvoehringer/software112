// Österreichische Weinqualitätsstufen – aufsteigend nach Qualität
// KAN-74 (02.10.2026): Rang, Mischung und Abstufung kommen nur noch aus lib/wein/qualitaetsrang.ts – die Funktionen
// hier (minQualitaet, maxQualitaet, istNiedrigerAls) sind dünne Hüllen, damit die Aufrufer gleich bleiben.

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt (wie lib/buchhaltung/bmd.ts)
import { hoechsteQualitaet, istAbstufung, niedrigsteQualitaet } from './wein/qualitaetsrang.ts'

export const QUALITAET_ORDER = [
  'wein', 'landwein', 'qualitaetswein',
  'kabinett', 'spaetlese', 'auslese',
  'beerenauslese', 'ausbruch', 'trockenbeerenauslese',
  'eiswein', 'strohwein',
  'dac', 'reserve', 'erste_lage', 'grosses_gewachs',
  'sekt', 'perlwein',
] as const

export type Qualitaetsstufe = typeof QUALITAET_ORDER[number] | 'sonstiges' | null

// Kurzbezeichnungen für Fließtexte (Abstufungs-Hinweise, Badges, Notizen). Bewusst kürzer
// als die Listen-Labels in lib/wein/qualitaet.ts (dort „Wein (ohne Herkunft)“): umziehen()
// schreibt diese Texte in Notizen/Bewegungsbuch, und lib/kellerbuch/storno.ts
// (qualitaetsCode) liest sie beim Storno wieder zurück – ein geändertes Label träfe
// gespeicherte Texte nicht mehr. Werte = QUALITAET_OPTS (Test: scripts/tests/qualitaet.test.mjs).
export const QUALITAET_LABEL: Record<string, string> = {
  wein:                    'Wein',
  landwein:                'Landwein',
  qualitaetswein:          'Qualitätswein',
  kabinett:                'Kabinett',
  spaetlese:               'Spätlese',
  auslese:                 'Auslese',
  beerenauslese:           'Beerenauslese',
  ausbruch:                'Ausbruch',
  trockenbeerenauslese:    'Trockenbeerenauslese',
  eiswein:                 'Eiswein',
  strohwein:               'Strohwein',
  dac:                     'DAC',
  reserve:                 'Reserve',
  erste_lage:              'Erste Lage',
  grosses_gewachs:         'Großes Gewächs',
  sekt:                    'Sekt',
  perlwein:                'Perlwein',
  sonstiges:               'Sonstiges',
}

/** Ergebnis einer Mischung (Verschnitt): gleiche Werte bleiben (DAC + DAC = DAC), sonst die niedrigste Stufe der
 *  Achse – eine Zusatzbezeichnung (DAC, Reserve …) nur, wenn alle sie tragen. Nie null, solange ein Wert bekannt
 *  ist (KAN-74; vorher nur Prädikatsskala, DAC/Reserve/Sekt ergaben null). */
export function minQualitaet(stufen: (string | null | undefined)[]): string | null {
  return niedrigsteQualitaet(stufen)
}

/** Leitet die Qualitätsstufe aus dem KMW-Grad (Klosterneuburger Mostwaage) ab.
 *  Quelle: Österreichisches Weingesetz (oesterreichwein.at) – Mindest-Mostgewichte:
 *  Landwein 14, Qualitätswein 15, Kabinett 17, Spätlese 19, Auslese 21,
 *  Beerenauslese 25, Trockenbeerenauslese 30 °KMW; darunter „Wein“ (ohne Herkunft).
 *  KAN-73 (25.09.2026): unter 14 °KMW jetzt 'wein' statt 'landwein' – Landwein verlangt
 *  mindestens 14 °KMW. Das Ergebnis ist immer ein Wert aus LESE_QUALITAETEN
 *  (lib/wein/qualitaet.ts), also für ernte_parzellen und weinausbau speicherbar.
 *  Eiswein / Strohwein / Ausbruch werden NICHT auto-abgeleitet (Sonderbedingungen).
 *  Keine gültige Zahl (NaN, ±Infinity) sowie null, undefined und ein leerer Text zählen wie
 *  „kein KMW“: 'qualitaetswein' – derselbe Rückfall wie bei den Aufrufern ohne KMW-Wert (Lese,
 *  Pressung/Charge); sonst stufte eine fehlende oder ungültige Eingabe still auf die unterste
 *  Stufe 'wein' ab (Number(null) und Number('') ergäben 0). 0 °KMW als Zahl bleibt 'wein'. */
export function kmwZuQualitaet(kmw: number): string {
  // Laufzeitwert prüfen: null kommt z. B. als DB-Wert aus einer untypisierten Zeile
  const wert: unknown = kmw
  if (wert == null || (typeof wert === 'string' && wert.trim() === '')) return 'qualitaetswein'
  // Number(): ein numerischer Text aus der DB zählt wie bisher als Zahl
  const zahl = Number(wert)
  if (!Number.isFinite(zahl)) return 'qualitaetswein'
  if (zahl >= 30) return 'trockenbeerenauslese'
  if (zahl >= 25) return 'beerenauslese'
  if (zahl >= 21) return 'auslese'
  if (zahl >= 19) return 'spaetlese'
  if (zahl >= 17) return 'kabinett'
  if (zahl >= 15) return 'qualitaetswein'
  if (zahl >= 14) return 'landwein'
  return 'wein'
}

// Die Stufen der Achse ohne Zusatzbezeichnungen und Erzeugnisse (nur noch als Werteliste; der Rang kommt aus
// lib/wein/qualitaetsrang.ts – KAN-74).
export const PRAEDIKATSWEIN_ORDER = [
  'wein', 'landwein', 'qualitaetswein',
  'kabinett', 'spaetlese', 'auslese',
  'beerenauslese', 'ausbruch', 'trockenbeerenauslese',
  'eiswein', 'strohwein',
] as const

/** Höchster Wert der Beteiligten (für „Abstufung von … auf …“) – mit Zusatzbezeichnungen (KAN-74) */
export function maxQualitaet(stufen: (string | null | undefined)[]): string | null {
  return hoechsteQualitaet(stufen)
}

/** `a` liegt unter `b` (Abstufung von b auf a): niedrigere Stufe oder verlorene Zusatzbezeichnung
 *  (Qualitätswein unter Reserve) – KAN-74. Für die Aufwertungssperre: istAufwertung (lib/wein/qualitaetsrang). */
export function istNiedrigerAls(a: string | null | undefined, b: string | null | undefined): boolean {
  return istAbstufung(b, a)
}
