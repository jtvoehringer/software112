// Österreichische Weinqualitätsstufen – aufsteigend nach Qualität
// KAN-74 (02.10.2026): Rang, Mischung und Abstufung kommen nur noch aus lib/wein/qualitaetsrang.ts – die Funktionen
// hier (minQualitaet, maxQualitaet, istNiedrigerAls) sind dünne Hüllen, damit die Aufrufer gleich bleiben.

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt (wie lib/buchhaltung/bmd.ts)
import { hoechsteQualitaet, istAbstufung, niedrigsteQualitaet, normalisiereQualitaet, istZusatz, type QualitaetsAngabe, type QualitaetsZeile, type Zusatz } from './wein/qualitaetsrang.ts'

// KAN-186 (02.10.2026): Reserve, Erste Lage, Großes Gewächs, Sekt und Perlwein sind keine Werte des Qualitätsfelds
// mehr (Zusatzbezeichnung bzw. Erzeugnis, siehe lib/wein/qualitaetsrang.ts) – die Listen hier nennen nur noch Stufen.
export const QUALITAET_ORDER = [
  'wein', 'landwein', 'qualitaetswein',
  'kabinett', 'spaetlese', 'auslese',
  'beerenauslese', 'ausbruch', 'trockenbeerenauslese',
  'eiswein', 'strohwein',
  'dac',
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
  sonstiges:               'Sonstiges',
}

/** Kurzbezeichnungen der Zusatzbezeichnungen für Fließtexte („Qualitätswein Reserve“) – der Storno liest sie zurück */
export const ZUSATZ_KURZ: Record<Zusatz, string> = {
  reserve:         'Reserve',
  grosse_reserve:  'Große Reserve',
  erste_lage:      'Erste Lage',
  grosses_gewachs: 'Großes Gewächs',
}

/** Kurzbezeichnungen der Erzeugnisse, die in Fließtexten vor der Stufe stehen („Sekt g.U. (Qualitätswein)“) */
export const ERZEUGNIS_KURZ: Record<string, string> = {
  SEKTGU:   'Sekt g.U.',
  PERLWEIN: 'Perlwein',
  SCHAUMW:  'Schaumwein',
  PETNAT:   'PetNat',
}

/** Bezeichnungen der Altwerte vor KAN-186 (in gespeicherten Vermerken „Abstufung von Reserve auf …“) */
const ALT_LABEL: Record<string, string> = {
  reserve:         'Reserve',
  erste_lage:      'Erste Lage',
  grosses_gewachs: 'Großes Gewächs',
  sekt:            'Sekt',
  perlwein:        'Perlwein',
}

/**
 * Kurztext einer Qualitätsangabe für Fließtexte (Abstufungsvermerke, Meldungen): „Qualitätswein Reserve“,
 * „Sekt g.U. (Qualitätswein)“, „Kabinett“. Nimmt eine Angabe oder eine Zeile (Altwerte werden normalisiert).
 * Ohne Angabe „–“. qualitaetAusText() liest den Text zurück (Storno).
 */
export function qualitaetText(q: QualitaetsAngabe | QualitaetsZeile | string | null | undefined): string {
  const a: QualitaetsAngabe = typeof q === 'string' || q == null
    ? normalisiereQualitaet({ qualitaetsstufe: q ?? null })
    : 'stufe' in q ? q as QualitaetsAngabe : normalisiereQualitaet(q as QualitaetsZeile)
  const basis = a.stufe ? (QUALITAET_LABEL[a.stufe] ?? a.stufe) : ''
  const mitZusatz = a.zusatz ? [basis, ZUSATZ_KURZ[a.zusatz]].filter(Boolean).join(' ') : basis
  const e = a.erzeugnis && Object.prototype.hasOwnProperty.call(ERZEUGNIS_KURZ, a.erzeugnis) ? ERZEUGNIS_KURZ[a.erzeugnis] : null
  if (e) return mitZusatz ? `${e} (${mitZusatz})` : e
  return mitZusatz || '–'
}

/** Stufe zu einer Bezeichnung oder einem Code (QUALITAET_LABEL) – null, wenn unbekannt */
function stufeAusText(t: string): string | null {
  if (Object.prototype.hasOwnProperty.call(QUALITAET_LABEL, t)) return t
  return Object.entries(QUALITAET_LABEL).find(([, label]) => label === t)?.[0] ?? null
}

/**
 * Qualitätsangabe aus einem Text von qualitaetText() bzw. einem älteren Vermerk („Reserve“, „Sekt“, Code wie
 * „reserve“) – null, wenn der Text nicht eindeutig lesbar ist.
 */
export function qualitaetAusText(text: string | null | undefined): QualitaetsAngabe | null {
  const t = (text ?? '').trim()
  if (!t) return null
  const stufe = stufeAusText(t)
  if (stufe) return { stufe, zusatz: null, erzeugnis: null }
  // Altwert (Code oder Bezeichnung vor KAN-186)
  const alt = Object.prototype.hasOwnProperty.call(ALT_LABEL, t) ? t : Object.entries(ALT_LABEL).find(([, l]) => l === t)?.[0]
  if (alt) return normalisiereQualitaet({ qualitaetsstufe: alt })
  // „Sekt g.U. (Qualitätswein Reserve)“ bzw. „Sekt g.U.“
  for (const [code, kurz] of Object.entries(ERZEUGNIS_KURZ)) {
    if (t === kurz) return { stufe: null, zusatz: null, erzeugnis: code }
    if (t.startsWith(`${kurz} (`) && t.endsWith(')')) {
      const innen = qualitaetAusText(t.slice(kurz.length + 2, -1))
      return innen && !innen.erzeugnis ? { ...innen, erzeugnis: code } : null
    }
  }
  // „Qualitätswein Große Reserve“ – längste Zusatzbezeichnung zuerst (Große Reserve vor Reserve)
  const zusaetze = (Object.entries(ZUSATZ_KURZ) as [Zusatz, string][]).sort((a, b) => b[1].length - a[1].length)
  for (const [code, kurz] of zusaetze) {
    if (t === kurz) return { stufe: null, zusatz: code, erzeugnis: null }
    if (t.endsWith(` ${kurz}`)) {
      const s = stufeAusText(t.slice(0, -kurz.length - 1).trim())
      return s && istZusatz(code) ? { stufe: s, zusatz: code, erzeugnis: null } : null
    }
  }
  return null
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
