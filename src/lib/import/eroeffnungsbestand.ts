// ── CSV-Import Eröffnungsbestand Tank und Flaschen (KAN-42 Etappe 1, 02.10.2026) ──────────────────────
//
// Echtbetrieb ab 01.01.2027: Nach dem Abräumen im Dezember erfasst der Betrieb den Eröffnungsbestand zum Stichtag
// (Jahrgang 2026 im Tank, Flaschenbestände). Dieses Modul ist der reine (isomorphe) Teil des Imports:
//   * Spalten je Import-Typ (TANK_FELDER, FLASCHEN_FELDER) samt Erkennung der Spaltenköpfe,
//   * Prüfung jeder Zeile (Kataloge und Optionen, Mengen, Gebinde) → Befund mit Fehlern und Hinweisen,
//   * die Formularwerte, mit denen der Import DIESELBE Kernlogik wie das Einzelformular aufruft
//     (Tank: insertEroeffnungsbestand in kellerbuch/gebinde-actions.ts; Flaschen: fuellungAnlegen in
//     weinhandel/actions.ts),
//   * die CSV-Vorlagen (Kopfzeile + Beispielzeile, PROFIL_EXCEL_AT).
// Geschrieben wird hier nichts; Gebindestand am Stichtag lädt lib/kellerbuch/eroeffnungsGebinde.ts.
// Geprüft in scripts/tests/kan42-eroeffnung.test.mjs.

import { csvText, csvDateiname, PROFIL_EXCEL_AT, type CsvSpalte, type CsvTyp } from '@/lib/csv'
import { zahlAus, fmtNum } from '@/lib/format'
import { ZUSATZ_OPTS, ERZEUGNIS_OPTS, qualitaetAusText, qualitaetFehler, qualitaetsAngabeFehler } from '@/lib/wein/qualitaet'
import { istAltwertQualitaet, normalisiereQualitaet, type QualitaetsAngabe, type Zusatz } from '@/lib/wein/qualitaetsrang'
import { KAT_ERZEUGNIS } from '@/lib/katalog/bki'
import { normalisiereLand } from '@/lib/katalog/laender'
import { HERKUNFT_KATALOG, herkunftKnotenTolerant } from '@/lib/herkunft'
import { bkiRebsorteKuerzel } from '@/lib/wein/bki_kuerzel'
import { mostgewichtAusWert } from '@/lib/wein/mostgewichtFormular'
import { stichtagText } from '@/lib/kellerbuch/eroeffnungsStichtag'

export type EroeffnungsArt = 'tank' | 'flaschen'
export type RohZeile = Record<string, string>

export type FeldDef = {
  key: string
  /** Spaltenkopf der Vorlage */
  kopf: string
  pflicht?: boolean
  /** weitere erkannte Spaltenköpfe (Groß-/Kleinschreibung, Leerzeichen egal) */
  erkennen?: readonly string[]
  /** kurze Erklärung (Anleitung auf der Import-Seite) */
  hinweis: string
  typ: CsvTyp
  stellen?: number
  beispiel: string | number | null
}

/** Zulässige Flaschengrößen (CHECK fuellungen_flaschengroesse_ml_check) */
export const FLASCHEN_ML = [187, 375, 500, 750, 1000, 1500, 3000, 6000] as const

export const TANK_FELDER: readonly FeldDef[] = [
  { key: 'gebinde', kopf: 'Gebinde', pflicht: true, erkennen: ['Gebindenummer', 'Gebinde-Nr.', 'Behälter', 'Tank'], typ: 'text',
    hinweis: 'Bezeichnung des Gebindes wie in der Gebindeliste (Kellerbuch › Gebinde); das Gebinde muss am Stichtag leer sein.', beispiel: 'T12' },
  { key: 'name', kopf: 'Chargenname', pflicht: true, erkennen: ['Charge', 'Chargenbezeichnung', 'Weinbezeichnung', 'Bezeichnung', 'Name'], typ: 'text',
    hinweis: 'Weinbezeichnung der Charge.', beispiel: 'Grüner Veltliner Ried Hohenberg' },
  { key: 'rebsorte', kopf: 'Rebsorte', erkennen: ['Sorte'], typ: 'text', hinweis: 'Rebsorte, z. B. Grüner Veltliner (Sorten ohne BKI-Kürzel ergeben einen Hinweis).', beispiel: 'Grüner Veltliner' },
  { key: 'jahrgang', kopf: 'Jahrgang', typ: 'ganzzahl', hinweis: 'Jahrgang (vierstellig), leer = ohne Jahrgang.', beispiel: 2026 },
  { key: 'liter', kopf: 'Menge (l)', pflicht: true, erkennen: ['Liter', 'Menge', 'Menge (Liter)', 'Menge (L)', 'Menge l'], typ: 'dezimal', stellen: 2,
    hinweis: 'Liter im Gebinde, größer als 0 und höchstens das Fassungsvermögen.', beispiel: 1500 },
  { key: 'qualitaet', kopf: 'Qualitätsstufe', erkennen: ['Qualität', 'Qualitaetsstufe'], typ: 'text',
    hinweis: 'Qualitätsstufe wie in der Auswahlliste, z. B. Landwein, Qualitätswein, Kabinett, Spätlese (leer = ohne).', beispiel: 'Qualitätswein' },
  { key: 'zusatz', kopf: 'Zusatzbezeichnung', erkennen: ['Zusatz'], typ: 'text',
    hinweis: `Optional: ${ZUSATZ_OPTS.map(o => o.label).join(', ')} – nur auf Qualitätswein.`, beispiel: '' },
  { key: 'erzeugnis', kopf: 'Erzeugnis', typ: 'text', hinweis: 'Optional (leer = Wein), z. B. Sekt g.U., Perlwein.', beispiel: '' },
  { key: 'weinart', kopf: 'Weinart', erkennen: ['Farbe', 'Weinart/Farbe'], typ: 'text', hinweis: 'weiß, rot oder rosé (leer = unbekannt).', beispiel: 'weiß' },
  { key: 'herkunft', kopf: 'Herkunfts-Code', erkennen: ['Herkunft', 'Herkunft-Code', 'Herkunftscode', 'Herkunft-Code (BKI)', 'Herkunft (BKI)'], typ: 'text',
    hinweis: 'Herkunft wie in der Auswahlliste (z. B. „Weinviertel DAC“), als Code (weinviertel_dac) oder BKI-Kürzel (WLWV).', beispiel: 'Weinviertel DAC' },
  { key: 'mostgewicht', kopf: 'Mostgewicht', erkennen: ['KMW', '°KMW', 'Oechsle', '°Oe'], typ: 'dezimal', stellen: 1,
    hinweis: 'Messwert; die Einheit steht in der nächsten Spalte oder direkt dabei („19,2 °KMW“, „92 °Oe“).', beispiel: 19 },
  { key: 'mostgewicht_einheit', kopf: 'Einheit Mostgewicht', erkennen: ['Mostgewicht Einheit', 'Einheit'], typ: 'text',
    hinweis: '°KMW oder °Oe (leer = °KMW).', beispiel: '°KMW' },
  { key: 'pruefnummer', kopf: 'Prüfnummer', erkennen: ['Staatliche Prüfnummer', 'Pruefnummer'], typ: 'code',
    hinweis: 'Optional: staatliche Prüfnummer – wird als Vermerk in den Notizen der Charge gespeichert.', beispiel: '' },
  { key: 'notiz', kopf: 'Notiz', erkennen: ['Notizen', 'Bemerkung', 'Anmerkung'], typ: 'text', hinweis: 'Optional.', beispiel: 'Restbestand lt. Altsystem' },
]

export const FLASCHEN_FELDER: readonly FeldDef[] = [
  { key: 'name', kopf: 'Name', pflicht: true, erkennen: ['Weinbezeichnung', 'Wein', 'Artikel'], typ: 'text',
    hinweis: 'Name des Weins (wie in der Füllungsliste).', beispiel: 'Grüner Veltliner Klassik' },
  { key: 'bezeichnung', kopf: 'Bezeichnung', erkennen: ['Zusatztext', 'Verkaufsbezeichnung'], typ: 'text', hinweis: 'Optional: Zusatztext, z. B. Ried oder Linie.', beispiel: 'Ried Hohenberg' },
  { key: 'jahrgang', kopf: 'Jahrgang', typ: 'ganzzahl', hinweis: 'Jahrgang (vierstellig), leer = ohne Jahrgang.', beispiel: 2025 },
  { key: 'rebsorte', kopf: 'Rebsorte', erkennen: ['Sorte'], typ: 'text', hinweis: 'Rebsorte (Sorten ohne BKI-Kürzel ergeben einen Hinweis).', beispiel: 'Grüner Veltliner' },
  { key: 'weinart', kopf: 'Weinart', erkennen: ['Farbe', 'Weinart/Farbe'], typ: 'text', hinweis: 'weiß, rot oder rosé (leer = unbekannt).', beispiel: 'weiß' },
  { key: 'qualitaet', kopf: 'Qualitätsstufe', pflicht: true, erkennen: ['Qualität', 'Qualitaetsstufe'], typ: 'text',
    hinweis: 'Qualitätsstufe wie in der Auswahlliste (Pflicht bei Füllungen).', beispiel: 'Qualitätswein' },
  { key: 'zusatz', kopf: 'Zusatzbezeichnung', erkennen: ['Zusatz'], typ: 'text', hinweis: `Optional: ${ZUSATZ_OPTS.map(o => o.label).join(', ')}.`, beispiel: '' },
  { key: 'erzeugnis', kopf: 'Erzeugnis', typ: 'text', hinweis: 'Optional (leer = Wein), z. B. Sekt g.U., Perlwein.', beispiel: '' },
  { key: 'herkunft', kopf: 'Herkunfts-Code', erkennen: ['Herkunft', 'Herkunft-Code', 'Herkunftscode', 'Herkunft-Code (BKI)', 'Herkunft (BKI)'], typ: 'text',
    hinweis: 'Herkunft wie in der Auswahlliste, als Code oder BKI-Kürzel.', beispiel: 'Weinviertel DAC' },
  { key: 'land', kopf: 'Land', erkennen: ['Ursprungsland', 'Herkunftsland'], typ: 'text', hinweis: 'ISO-Code oder Ländername (leer = AT).', beispiel: 'AT' },
  { key: 'ml', kopf: 'Flaschengröße (ml)', pflicht: true, erkennen: ['Flaschengröße', 'Flaschengroesse', 'Flaschengröße ml', 'ml', 'Größe'], typ: 'ganzzahl',
    hinweis: `${FLASCHEN_ML.join(', ')} ml (auch „0,75 l“).`, beispiel: 750 },
  { key: 'anzahl', kopf: 'Anzahl (Flaschen)', pflicht: true, erkennen: ['Anzahl', 'Flaschen', 'Lagerbestand', 'Lagerbestand (Flaschen)', 'Bestand'], typ: 'ganzzahl',
    hinweis: 'Flaschen am Stichtag (ganze Zahl größer als 0).', beispiel: 1200 },
  { key: 'pruefnummer', kopf: 'Prüfnummer', erkennen: ['Staatliche Prüfnummer', 'Pruefnummer'], typ: 'code',
    hinweis: 'Optional: staatliche Prüfnummer (wird wie beim Abfüllen geprüft).', beispiel: '' },
  { key: 'vk_preis', kopf: 'VK-Preis brutto (€)', erkennen: ['VK-Preis', 'VK-Preis Brutto (€)', 'Verkaufspreis', 'Preis'], typ: 'betrag',
    hinweis: 'Optional: Verkaufspreis je Flasche brutto.', beispiel: 9.5 },
  { key: 'notiz', kopf: 'Notiz', erkennen: ['Notizen', 'Bemerkung', 'Anmerkung'], typ: 'text', hinweis: 'Optional.', beispiel: '' },
]

export function felderFuer(art: EroeffnungsArt): readonly FeldDef[] {
  return art === 'tank' ? TANK_FELDER : FLASCHEN_FELDER
}

// ── Hilfen ───────────────────────────────────────────────────────────────────────────────────────────────

const schluessel = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de')
/** Vergleichsschlüssel ohne Umlaute/Akzente und Satzzeichen (Qualitätswein = Qualitaetswein = qualitaetswein) */
const lose = (s: string) => schluessel(s)
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '')

/** Zuordnung Spaltenkopf → Feld; fehlende Pflichtspalten */
export function spaltenZuordnen(kopf: readonly string[], felder: readonly FeldDef[]): { zuordnung: Record<string, string>; fehlend: string[] } {
  const zuordnung: Record<string, string> = {}
  const vergeben = new Set<string>()
  for (const f of felder) {
    const namen = new Set([f.kopf, f.key, ...(f.erkennen ?? [])].map(lose))
    const treffer = kopf.find(h => !vergeben.has(h) && namen.has(lose(h)))
    if (treffer) { zuordnung[f.key] = treffer; vergeben.add(treffer) }
  }
  const fehlend = felder.filter(f => f.pflicht && !zuordnung[f.key]).map(f => f.kopf)
  return { zuordnung, fehlend }
}

function zelle(z: RohZeile, zuordnung: Record<string, string>, key: string): string {
  const h = zuordnung[key]
  return h ? String(z[h] ?? '').trim() : ''
}

function zusatzAus(text: string): Zusatz | null | 'unbekannt' {
  const l = lose(text)
  if (!l) return null
  for (const o of ZUSATZ_OPTS) {
    if ([o.value, o.label, o.label.replace(/\s*\(.*\)\s*$/, '')].some(k => lose(k) === l)) return o.value
  }
  return 'unbekannt'
}

function erzeugnisAus(text: string): string | null | 'unbekannt' {
  const l = lose(text)
  if (!l || l === 'wein') return null
  for (const o of ERZEUGNIS_OPTS) if (lose(o.value) === l || lose(o.label) === l) return o.value
  for (const e of KAT_ERZEUGNIS) if (lose(e.code) === l || lose(e.bezeichnung) === l) return e.code
  return 'unbekannt'
}

/** weiß/weiss/Weißwein → weiss, rot/Rotwein → rot, rosé/Roséwein → rose; leer → null; sonst 'unbekannt' */
export function weinartAus(text: string): 'weiss' | 'rot' | 'rose' | null | 'unbekannt' {
  const l = lose(text)
  if (!l) return null
  if (['weiss', 'weisswein', 'w', 'white'].includes(l)) return 'weiss'
  if (['rot', 'rotwein', 'r', 'red'].includes(l)) return 'rot'
  if (['rose', 'rosewein', 'rosee'].includes(l)) return 'rose'
  return 'unbekannt'
}

/** Herkunfts-Code aus Code, Bezeichnung oder BKI-Kürzel; null = leer, 'unbekannt' = nicht erkannt */
export function herkunftAus(text: string): string | null | 'unbekannt' {
  const t = text.trim()
  if (!t) return null
  if (lose(t) === 'sonstiges') return 'sonstiges'
  const genau = HERKUNFT_KATALOG.find(k => k.code === t || lose(k.code) === lose(t) || lose(k.label) === lose(t))
  if (genau) return genau.code
  return herkunftKnotenTolerant(t)?.code ?? 'unbekannt'
}

/** Mostgewicht-Zelle: Wert, ggf. mit Einheit („19,2 °KMW“, „92 Oe“), und Einheiten-Spalte */
export function mostgewichtAusZellen(wertRoh: string, einheitRoh: string): { wert: string; einheit: 'kmw' | 'oechsle'; einheitAngenommen: boolean } | { fehler: string } | null {
  let wert = wertRoh.trim()
  let einheitText = einheitRoh.trim()
  const m = /^([\d.,\s]+?)\s*(°?\s*(?:kmw|klosterneuburger|oe|öchsle|oechsle))$/i.exec(wert)
  if (m) { wert = m[1].trim(); einheitText = einheitText || m[2] }
  if (!wert) return einheitText ? { fehler: 'Einheit des Mostgewichts ohne Messwert.' } : null
  const l = lose(einheitText)
  let einheit: 'kmw' | 'oechsle'
  let angenommen = false
  if (!l) { einheit = 'kmw'; angenommen = true }
  else if (['kmw', 'klosterneuburger', 'klosterneuburgermostwaage'].includes(l)) einheit = 'kmw'
  else if (['oe', 'oechsle', 'ochsle'].includes(l)) einheit = 'oechsle'
  else return { fehler: `Einheit des Mostgewichts „${einheitText}“ unbekannt – bitte °KMW oder °Oe.` }
  return { wert, einheit, einheitAngenommen: angenommen }
}

function ganzzahl(text: string): number | null | 'ungueltig' {
  if (!text.trim()) return null
  const n = zahlAus(text.replace(/[\s ]/g, ''))
  if (n == null || !Number.isInteger(n)) return 'ungueltig'
  return n
}

/** Flaschengröße in ml aus „750“, „750 ml“, „0,75“, „0,75 l“, „1,5l“ – null = ungültig */
export function flaschenMlAus(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '')
  if (!t) return null
  const m = /^([\d.,]+)(ml|l|liter)?$/.exec(t)
  if (!m) return null
  const n = zahlAus(m[1].includes(',') ? m[1] : m[1].replace(/^(\d+)\.(\d{1,2})$/, '$1,$2'))
  if (n == null || n <= 0) return null
  const ml = m[2] === 'l' || m[2] === 'liter' || (!m[2] && n < 10) ? Math.round(n * 1000) : Math.round(n)
  return (FLASCHEN_ML as readonly number[]).includes(ml) ? ml : null
}

/** Qualität (Stufe, Zusatz, Erzeugnis) einer Zeile; Fehler in `fehler` */
function qualitaetAusZeile(stufeText: string, zusatzText: string, erzeugnisText: string, ziel: 'charge' | 'fuellung', fehler: string[]): QualitaetsAngabe {
  let stufe: string | null = null
  let altZusatz: Zusatz | null = null
  let altErzeugnis: string | null = null
  if (stufeText) {
    stufe = qualitaetAusText(stufeText, ziel)
    if (!stufe) {
      // Altwerte (Reserve, Sekt …) werden wie überall normalisiert
      const roh = lose(stufeText) === 'sekt' ? 'sekt' : lose(stufeText) === 'perlwein' ? 'perlwein' : zusatzAus(stufeText)
      if (typeof roh === 'string' && roh !== 'unbekannt' && istAltwertQualitaet(roh)) {
        const n = normalisiereQualitaet({ qualitaetsstufe: roh })
        stufe = n.stufe; altZusatz = n.zusatz; altErzeugnis = n.erzeugnis
      } else {
        fehler.push(`Qualitätsstufe „${stufeText}“ unbekannt – bitte wie in der Auswahlliste angeben (z. B. Qualitätswein, Kabinett, Spätlese).`)
      }
    }
  }
  const z = zusatzAus(zusatzText)
  if (z === 'unbekannt') fehler.push(`Zusatzbezeichnung „${zusatzText}“ unbekannt – möglich: ${ZUSATZ_OPTS.map(o => o.label).join(', ')}.`)
  const e = erzeugnisAus(erzeugnisText)
  if (e === 'unbekannt') fehler.push(`Erzeugnis „${erzeugnisText}“ unbekannt – bitte wie in der Auswahlliste (z. B. Sekt g.U., Perlwein) oder leer lassen.`)
  const angabe: QualitaetsAngabe = {
    stufe,
    zusatz: (z !== 'unbekannt' ? z : null) ?? altZusatz,
    erzeugnis: (e !== 'unbekannt' ? e : null) ?? altErzeugnis,
  }
  if (stufe) {
    const f = qualitaetFehler(ziel, stufe)
    if (f) fehler.push(f)
  }
  if (z !== 'unbekannt' && e !== 'unbekannt') {
    const f = qualitaetsAngabeFehler(angabe)
    if (f) fehler.push(f)
  }
  return angabe
}

function jahrgangAus(text: string, fehler: string[]): number | null {
  const j = ganzzahl(text)
  if (j === 'ungueltig' || (typeof j === 'number' && (j < 1900 || j > 2100))) {
    fehler.push(`Jahrgang „${text}“ ungültig – bitte vierstellig (z. B. 2026) oder leer.`)
    return null
  }
  return j
}

function rebsorteHinweis(rebsorte: string | null, hinweise: string[]) {
  if (rebsorte && !bkiRebsorteKuerzel(rebsorte)) hinweise.push(`Rebsorte „${rebsorte}“ hat kein amtliches BKI-Kürzel – bitte die Schreibweise prüfen.`)
}

// ── Befund ───────────────────────────────────────────────────────────────────────────────────────────────

export type ZeilenBefund<E> = {
  /** Zeilennummer in der Datei (Kopfzeile = 1) */
  zeile: number
  /** Kurzbezeichnung für die Vorschau */
  titel: string
  /** Menge für die Vorschau („1.500 l“, „1.200 × 750 ml“) */
  menge: string
  fehler: string[]
  hinweise: string[]
  /** geprüfte Eingabe – nur ohne Fehler gesetzt */
  eingabe: E | null
}

export type DateiBefund<E> = {
  /** Fehler der ganzen Datei (fehlende Pflichtspalten, keine Zeilen) */
  dateiFehler: string[]
  zeilen: ZeilenBefund<E>[]
}

// ── Tank ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Gebinde mit Inhalt heute und am Stichtag (lib/kellerbuch/eroeffnungsGebinde.ts) */
export type GebindeStand = {
  id: string
  name: string
  anzeigeName: string
  volumen: number | null
  aktiv: boolean
  /** Betrieb, der Wein im (Partner-)Gebinde hat – null, wenn nicht fremd belegt */
  fremdBelegt: string | null
  /** eigene Liter heute */
  literHeute: number
  /** eigene Liter am Ende des Stichtags */
  literAmStichtag: number
}

export type TankEingabe = {
  behaelterId: string
  gebinde: string
  name: string
  rebsorte: string | null
  jahrgang: number | null
  liter: number
  angabe: QualitaetsAngabe
  weinart: 'weiss' | 'rot' | 'rose' | null
  herkunftCode: string | null
  mostgewicht: { wert: string; einheit: 'kmw' | 'oechsle' } | null
  pruefnummer: string | null
  notiz: string | null
}

const LEER_UNTER = 0.01

function gebindeFinden(text: string, gebinde: readonly GebindeStand[]): GebindeStand | 'mehrdeutig' | null {
  const s = schluessel(text)
  const nachAnzeige = gebinde.filter(g => schluessel(g.anzeigeName) === s)
  if (nachAnzeige.length === 1) return nachAnzeige[0]
  const nachName = gebinde.filter(g => schluessel(g.name) === s)
  if (nachName.length === 1) return nachName[0]
  if (nachName.length > 1 || nachAnzeige.length > 1) return 'mehrdeutig'
  return null
}

/**
 * Prüft die Zeilen einer Tank-Datei: Pflichtspalten, Gebinde (vorhanden, aktiv, nicht fremd belegt, heute und am
 * Stichtag leer, nicht doppelt in der Datei), Liter > 0 und ≤ Fassungsvermögen, Qualität/Zusatz/Erzeugnis,
 * Weinart, Herkunft, Mostgewicht. `zeilenOffset` = Zahl der Datenzeilen vor diesem Block.
 */
export function pruefeTankZeilen(
  kopf: readonly string[],
  zeilen: readonly RohZeile[],
  gebinde: readonly GebindeStand[],
  opts: { stichtag: string; zeilenOffset?: number },
): DateiBefund<TankEingabe> {
  const { zuordnung, fehlend } = spaltenZuordnen(kopf, TANK_FELDER)
  const dateiFehler: string[] = []
  if (fehlend.length > 0) dateiFehler.push(`Pflichtspalte${fehlend.length > 1 ? 'n' : ''} fehlt: ${fehlend.join(', ')} – bitte die CSV-Vorlage verwenden.`)
  if (zeilen.length === 0) dateiFehler.push('Die Datei enthält keine Datenzeilen.')
  if (dateiFehler.length > 0) return { dateiFehler, zeilen: [] }
  const basis = 2 + (opts.zeilenOffset ?? 0)
  const st = stichtagText(opts.stichtag)

  const befunde: ZeilenBefund<TankEingabe>[] = zeilen.map((z, i) => {
    const w = (k: string) => zelle(z, zuordnung, k)
    const fehler: string[] = []
    const hinweise: string[] = []
    const gebindeText = w('gebinde')
    const name = w('name')
    if (!gebindeText) fehler.push('Gebinde fehlt.')
    if (!name) fehler.push('Chargenname fehlt.')

    let g: GebindeStand | null = null
    if (gebindeText) {
      const t = gebindeFinden(gebindeText, gebinde)
      if (t === 'mehrdeutig') fehler.push(`Gebinde „${gebindeText}“ ist nicht eindeutig (eigenes und Partner-Gebinde gleichen Namens) – bitte wie in der Gebindeliste angeben („Name · Betrieb“).`)
      else if (!t) fehler.push(`Gebinde „${gebindeText}“ nicht gefunden – bitte die Bezeichnung aus der Gebindeliste verwenden.`)
      else g = t
    }
    if (g) {
      if (!g.aktiv) fehler.push(`Gebinde „${g.anzeigeName}“ ist deaktiviert.`)
      if (g.fremdBelegt) fehler.push(`Gebinde „${g.anzeigeName}“ ist durch ${g.fremdBelegt} belegt – kein Eröffnungsbestand möglich.`)
      if (g.literAmStichtag >= LEER_UNTER) fehler.push(`Gebinde „${g.anzeigeName}“ ist am Stichtag ${st} nicht leer (${fmtNum(g.literAmStichtag, 2)} l).`)
      else if (g.literHeute >= LEER_UNTER) fehler.push(`Gebinde „${g.anzeigeName}“ ist nicht leer (heute ${fmtNum(g.literHeute, 2)} l) – erst nach dem Abräumen importieren.`)
    }

    const literText = w('liter')
    const liter = literText ? zahlAus(literText.replace(/\s|l$/gi, '')) : null
    if (!literText) fehler.push('Menge (l) fehlt.')
    else if (liter == null) fehler.push(`Menge „${literText}“ ist keine Zahl.`)
    else if (liter < 0.01) fehler.push('Die Menge muss größer als 0 l sein.')
    else if (g && g.volumen != null && g.volumen > 0 && liter > g.volumen + 0.005) {
      fehler.push(`Menge ${fmtNum(liter, 2)} l übersteigt das Fassungsvermögen von „${g.anzeigeName}“ (${fmtNum(g.volumen, 2)} l).`)
    } else if (g && (g.volumen == null || g.volumen <= 0)) {
      hinweise.push(`Fassungsvermögen von „${g.anzeigeName}“ unbekannt – Menge nicht gegen das Gebinde geprüft.`)
    }

    const rebsorte = w('rebsorte') || null
    rebsorteHinweis(rebsorte, hinweise)
    const jahrgang = jahrgangAus(w('jahrgang'), fehler)
    const angabe = qualitaetAusZeile(w('qualitaet'), w('zusatz'), w('erzeugnis'), 'charge', fehler)
    if (!angabe.stufe && !w('qualitaet')) hinweise.push('Ohne Qualitätsstufe.')
    const wa = weinartAus(w('weinart'))
    if (wa === 'unbekannt') fehler.push(`Weinart „${w('weinart')}“ unbekannt – weiß, rot oder rosé.`)
    const hk = herkunftAus(w('herkunft'))
    if (hk === 'unbekannt') fehler.push(`Herkunfts-Code „${w('herkunft')}“ unbekannt – bitte wie in der Auswahlliste, als Code oder BKI-Kürzel.`)

    let mostgewicht: TankEingabe['mostgewicht'] = null
    const mg = mostgewichtAusZellen(w('mostgewicht'), w('mostgewicht_einheit'))
    if (mg && 'fehler' in mg) fehler.push(mg.fehler)
    else if (mg) {
      const r = mostgewichtAusWert(mg.wert, mg.einheit, 'Mostgewicht')
      if (!r.ok) fehler.push(r.fehler)
      else {
        mostgewicht = { wert: mg.wert, einheit: mg.einheit }
        if (mg.einheitAngenommen) hinweise.push('Einheit des Mostgewichts fehlt – als °KMW übernommen.')
      }
    }

    const ok = fehler.length === 0 && g && liter != null
    return {
      zeile: basis + i,
      titel: [gebindeText || '–', name].filter(Boolean).join(' · '),
      menge: liter != null ? `${fmtNum(liter, 2)} l` : literText || '–',
      fehler,
      hinweise,
      eingabe: ok ? {
        behaelterId: g!.id, gebinde: g!.anzeigeName, name, rebsorte, jahrgang,
        liter: Math.round(liter! * 100) / 100, angabe,
        weinart: wa === 'unbekannt' ? null : wa,
        herkunftCode: hk === 'unbekannt' ? null : hk,
        mostgewicht, pruefnummer: w('pruefnummer') || null, notiz: w('notiz') || null,
      } : null,
    }
  })

  // dasselbe Gebinde mehrfach in der Datei: alle Zeilen ablehnen (welche gilt, ist unklar)
  const jeGebinde = new Map<string, number[]>()
  zeilen.forEach((z, i) => {
    const t = zelle(z, zuordnung, 'gebinde')
    const g = t ? gebindeFinden(t, gebinde) : null
    const key = g && g !== 'mehrdeutig' ? g.id : t ? `text:${schluessel(t)}` : null
    if (key) jeGebinde.set(key, [...(jeGebinde.get(key) ?? []), i])
  })
  for (const idx of jeGebinde.values()) {
    if (idx.length < 2) continue
    const nummern = idx.map(i => befunde[i].zeile).join(', ')
    for (const i of idx) {
      befunde[i].fehler.push(`Gebinde steht mehrfach in der Datei (Zeilen ${nummern}) – je Gebinde nur eine Zeile.`)
      befunde[i].eingabe = null
    }
  }
  return { dateiFehler: [], zeilen: befunde }
}

/** Formularwerte für insertEroeffnungsbestand (dieselben Felder wie das Einzelformular) */
export function tankFormularWerte(e: TankEingabe, stichtag: string, herkunftZeile: string): Record<string, string> {
  const notizen = [e.notiz, e.pruefnummer ? `Prüfnummer (Altsystem): ${e.pruefnummer}` : null, herkunftZeile].filter(Boolean).join('\n')
  const werte: Record<string, string> = {
    stichtag,
    name: e.name,
    behaelter_id: e.behaelterId,
    jahrgang: e.jahrgang != null ? String(e.jahrgang) : '',
    menge_liter: String(e.liter).replace('.', ','),
    qualitaetsstufe: e.angabe.stufe ?? '',
    zusatzbezeichnung: e.angabe.zusatz ?? '',
    erzeugnis: e.angabe.erzeugnis ?? '',
    rebsorte: e.rebsorte ?? '',
    weinart: e.weinart ?? '',
    herkunft_code: e.herkunftCode ?? '',
    notizen,
  }
  if (e.mostgewicht) {
    werte.mostgewicht_wert = e.mostgewicht.wert
    werte.mostgewicht_einheit = e.mostgewicht.einheit
  }
  return werte
}

// ── Flaschen ─────────────────────────────────────────────────────────────────────────────────────────────

export type FlaschenEingabe = {
  name: string
  bezeichnung: string | null
  jahrgang: number | null
  rebsorte: string | null
  weinart: 'weiss' | 'rot' | 'rose' | null
  angabe: QualitaetsAngabe
  herkunftCode: string | null
  land: string
  ml: number
  anzahl: number
  pruefnummer: string | null
  vkPreis: number | null
  notiz: string | null
}

/** Prüft die Zeilen einer Flaschen-Datei (ohne Datenbank; die Prüfnummer prüft der Server zusätzlich) */
export function pruefeFlaschenZeilen(
  kopf: readonly string[],
  zeilen: readonly RohZeile[],
  opts: { zeilenOffset?: number } = {},
): DateiBefund<FlaschenEingabe> {
  const { zuordnung, fehlend } = spaltenZuordnen(kopf, FLASCHEN_FELDER)
  const dateiFehler: string[] = []
  if (fehlend.length > 0) dateiFehler.push(`Pflichtspalte${fehlend.length > 1 ? 'n' : ''} fehlt: ${fehlend.join(', ')} – bitte die CSV-Vorlage verwenden.`)
  if (zeilen.length === 0) dateiFehler.push('Die Datei enthält keine Datenzeilen.')
  if (dateiFehler.length > 0) return { dateiFehler, zeilen: [] }
  const basis = 2 + (opts.zeilenOffset ?? 0)

  const befunde = zeilen.map((z, i): ZeilenBefund<FlaschenEingabe> => {
    const w = (k: string) => zelle(z, zuordnung, k)
    const fehler: string[] = []
    const hinweise: string[] = []
    const name = w('name')
    if (!name) fehler.push('Name fehlt.')
    const jahrgang = jahrgangAus(w('jahrgang'), fehler)
    const rebsorte = w('rebsorte') || null
    rebsorteHinweis(rebsorte, hinweise)
    const wa = weinartAus(w('weinart'))
    if (wa === 'unbekannt') fehler.push(`Weinart „${w('weinart')}“ unbekannt – weiß, rot oder rosé.`)
    if (!w('qualitaet')) fehler.push('Qualitätsstufe fehlt (Pflicht bei Füllungen).')
    const angabe = qualitaetAusZeile(w('qualitaet'), w('zusatz'), w('erzeugnis'), 'fuellung', fehler)
    const hk = herkunftAus(w('herkunft'))
    if (hk === 'unbekannt') fehler.push(`Herkunfts-Code „${w('herkunft')}“ unbekannt – bitte wie in der Auswahlliste, als Code oder BKI-Kürzel.`)
    const landText = w('land')
    const land = landText ? normalisiereLand(landText) : 'AT'
    if (!land) fehler.push(`Land „${landText}“ nicht erkannt – ISO-Code (AT, DE …) oder Ländername.`)
    const mlText = w('ml')
    const ml = flaschenMlAus(mlText)
    if (!mlText) fehler.push('Flaschengröße fehlt.')
    else if (ml == null) fehler.push(`Flaschengröße „${mlText}“ unzulässig – möglich: ${FLASCHEN_ML.join(', ')} ml.`)
    const anzahlText = w('anzahl')
    const anzahl = ganzzahl(anzahlText)
    if (!anzahlText) fehler.push('Anzahl (Flaschen) fehlt.')
    else if (anzahl === 'ungueltig' || anzahl == null || anzahl <= 0) fehler.push(`Anzahl „${anzahlText}“ ungültig – ganze Zahl größer als 0.`)
    const preisText = w('vk_preis')
    const vkPreis = preisText ? zahlAus(preisText) : null
    if (preisText && (vkPreis == null || vkPreis < 0)) fehler.push(`VK-Preis „${preisText}“ ist kein gültiger Betrag.`)

    const ok = fehler.length === 0 && ml != null && typeof anzahl === 'number' && land
    return {
      zeile: basis + i,
      titel: [name || '–', jahrgang].filter(Boolean).join(' '),
      menge: typeof anzahl === 'number' && ml != null ? `${fmtNum(anzahl)} × ${ml} ml` : [anzahlText, mlText].filter(Boolean).join(' × ') || '–',
      fehler,
      hinweise,
      eingabe: ok ? {
        name, bezeichnung: w('bezeichnung') || null, jahrgang, rebsorte,
        weinart: wa === 'unbekannt' ? null : wa, angabe,
        herkunftCode: hk === 'unbekannt' ? null : hk, land: land!,
        ml: ml!, anzahl: anzahl as number, pruefnummer: w('pruefnummer') || null,
        vkPreis: vkPreis != null ? Math.round(vkPreis * 100) / 100 : null, notiz: w('notiz') || null,
      } : null,
    }
  })

  // gleicher Wein (Name, Jahrgang, Flaschengröße) mehrfach in der Datei: alle Zeilen ablehnen – je Wein und Größe
  // eine Zeile mit der Gesamtzahl (der Import erkennt einen schon angelegten Eröffnungsbestand ebenso)
  const jeWein = new Map<string, number[]>()
  befunde.forEach((b, i) => {
    const e = b.eingabe
    if (!e) return
    const k = `${schluessel(e.name)}|${e.jahrgang ?? ''}|${e.ml}`
    jeWein.set(k, [...(jeWein.get(k) ?? []), i])
  })
  for (const idx of jeWein.values()) {
    if (idx.length < 2) continue
    const nummern = idx.map(i => befunde[i].zeile).join(', ')
    for (const i of idx) {
      befunde[i].fehler.push(`Gleicher Wein, Jahrgang und Flaschengröße mehrfach (Zeilen ${nummern}) – bitte zu einer Zeile mit der Gesamtzahl zusammenfassen.`)
      befunde[i].eingabe = null
    }
  }
  return { dateiFehler: [], zeilen: befunde }
}

/** Formularwerte für fuellungAnlegen (dieselben Felder wie das Füllungsformular, Datum = Stichtag) */
export function flaschenFormularWerte(e: FlaschenEingabe, stichtag: string, herkunftZeile: string): Record<string, string> {
  return {
    name: e.name,
    bezeichnung: e.bezeichnung ?? '',
    jahrgang: e.jahrgang != null ? String(e.jahrgang) : '',
    rebsorte: e.rebsorte ?? '',
    qualitaet: e.angabe.stufe ?? '',
    zusatzbezeichnung: e.angabe.zusatz ?? '',
    erzeugnis: e.angabe.erzeugnis ?? '',
    herkunft_code: e.herkunftCode ?? '',
    datum: stichtag,
    flaschengroesse_ml: String(e.ml),
    anzahl_flaschen: String(e.anzahl),
    pruefnummer: e.pruefnummer ?? '',
    vk_preis_brutto: e.vkPreis != null ? String(e.vkPreis).replace('.', ',') : '',
    notizen: [e.notiz, herkunftZeile].filter(Boolean).join('\n'),
  }
}

/** Vermerk in den Notizen: „Eröffnungsbestand zum 01.01.2027 – <Herkunft>, importiert am 15.12.2026“ */
export function eroeffnungsVermerk(stichtag: string, herkunft: string, heute: string): string {
  const h = herkunft.trim()
  return `Eröffnungsbestand zum ${stichtagText(stichtag)}${h ? ` – ${h}` : ''}, importiert am ${stichtagText(heute)}`
}

// ── Vorlagen ─────────────────────────────────────────────────────────────────────────────────────────────

/** CSV-Vorlage: Kopfzeile + eine Beispielzeile (Excel-AT: Semikolon, UTF-8 mit BOM, Dezimalkomma) */
export function vorlageCsv(art: EroeffnungsArt, erstellt?: string): { text: string; dateiname: string; zeilen: number } {
  const felder = felderFuer(art)
  const spalten: CsvSpalte<Record<string, unknown>>[] = felder.map(f => ({
    kopf: f.kopf, typ: f.typ, ...(f.stellen != null ? { stellen: f.stellen } : {}), wert: z => z[f.key],
  }))
  const beispiel = Object.fromEntries(felder.map(f => [f.key, f.beispiel === '' ? null : f.beispiel]))
  return {
    text: csvText([beispiel], spalten, PROFIL_EXCEL_AT),
    dateiname: csvDateiname(['Vorlage', art === 'tank' ? 'Eroeffnungsbestand-Tank' : 'Eroeffnungsbestand-Flaschen'], erstellt).utf8,
    zeilen: 1,
  }
}
