// ── Exportdokumente: Arten, Packliste, Warenbeschreibung (KAN-433, 12.11.2026 – Epic KAN-431) ───────────────────────────
//
// Eine Stelle für die Dokumentarten (bisher an drei Stellen gelistet) und die Bausteine der Druckansichten:
// Kartonnummern der Packliste, Aufschlüsselung der Kartons, zweite Zeile der Warenbeschreibung.
// Entscheidungen Jörgen 12.11.2026: Packliste bei jedem neuen Auftrag (1A); „Phytosanitär“ nicht mehr wählbar,
// bestehende Einträge bleiben (2A); keine Mischkartons – jede Position hat eigene Kartons, ein Anbruchkarton wird
// ausgewiesen (3A); Ankreuzfeld „Mustersendung“ mit Vermerk auf Packliste und Rechnung (4B); unvollständige Dokumente
// bleiben druckbar, fehlende Werte stehen als „–“ (5A) – nie geschätzt.
// Isomorph, ohne '@/'-Importe (node:test).

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rundText } from '../zahl/runden.ts'

export type ExportDokument = {
  art: string
  label: string
  /** hat eine Druckansicht unter /api/weinexport/<id>/dokument/<art> */
  druck: boolean
  /** wird bei einem neuen Exportauftrag automatisch in die Checkliste gelegt */
  standard: boolean
  /** über „Weiteres Dokument“ wählbar (false = nur noch an alten Aufträgen sichtbar) */
  waehlbar: boolean
}

/** Reihenfolge = Reihenfolge in Checkliste, Auswahl und CSV der Auftragsliste. dokument_art ist varchar(30). */
export const EXPORT_DOKUMENTE: readonly ExportDokument[] = [
  { art: 'v1v2', label: 'V1/V2 Begleitdokument', druck: true, standard: true, waehlbar: true },
  { art: 'eur1', label: 'EUR.1 Ursprungszeugnis', druck: true, standard: true, waehlbar: true },
  { art: 'cmr', label: 'CMR Frachtbrief', druck: true, standard: false, waehlbar: true },
  { art: 'certificate_of_origin', label: 'Certificate of Origin', druck: true, standard: false, waehlbar: true },
  { art: 'packliste', label: 'Packliste', druck: true, standard: true, waehlbar: true },
  { art: 'health_certificate', label: 'Health Certificate (Gesundheitszeugnis)', druck: false, standard: false, waehlbar: true },
  { art: 'phytosanitaer', label: 'Phytosanitäres Zertifikat', druck: false, standard: false, waehlbar: false },
  { art: 'lieferschein', label: 'Lieferschein', druck: true, standard: true, waehlbar: true },
  { art: 'rechnung', label: 'Exportrechnung', druck: true, standard: true, waehlbar: true },
  { art: 'proforma', label: 'Proforma-Rechnung', druck: true, standard: false, waehlbar: true },   // KAN-434 (Entscheidung 6A)
]

export const EXPORT_DOKUMENT_ARTEN: readonly string[] = EXPORT_DOKUMENTE.map(d => d.art)
export const EXPORT_DOKUMENT_LABEL: Record<string, string> = Object.fromEntries(EXPORT_DOKUMENTE.map(d => [d.art, d.label]))
/** Dokumente, die ein neuer Auftrag von selbst bekommt */
export const EXPORT_STANDARD_DOKUMENTE: readonly string[] = EXPORT_DOKUMENTE.filter(d => d.standard).map(d => d.art)
/** Dokumente, die sich über „Weiteres Dokument“ hinzufügen lassen */
export const EXPORT_WAEHLBARE_DOKUMENTE: readonly string[] = EXPORT_DOKUMENTE.filter(d => d.waehlbar).map(d => d.art)

export function hatDruckansicht(art: unknown): boolean {
  return EXPORT_DOKUMENTE.some(d => d.art === art && d.druck)
}

// ── Zahlen für die Dokumente (deutsch, ohne überflüssige Nullen) ─────────────────────────────────────────────

/** 22.5 → „22,5“, 30 → „30“, 0.375 → „0,375“ (höchstens `max` Nachkommastellen, kaufmännisch) */
export function zahlDe(n: number | null | undefined, max = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–'
  const t = rundText(n, max)
  return (t.includes('.') ? t.replace(/0+$/, '').replace(/\.$/, '') : t).replace('.', ',')
}

/** Flaschengröße in Litern: 750 → „0,75 l“ */
export function flascheText(ml: number | null | undefined): string | null {
  return ml && ml > 0 ? `${zahlDe(ml / 1000, 3)} l` : null
}

// ── Packliste ──────────────────────────────────────────────────────────────────

/** Was Packliste und Warenbeschreibung von einer Position brauchen (aus der gemeinsamen Ladefunktion, KAN-432) */
export type DokPosition = {
  bezeichnung?: string | null
  einheit?: string | null
  menge?: number | null
  flaschen?: number | null
  flaschenJeKarton?: number | null
  kartons?: number | null
  flaschengroesseMl?: number | null
  liter?: number | null
  alkohol?: number | null
  pruefnummer?: string | null
  farbe?: string | null
  rebsorte?: string | null
  jahrgang?: string | null
  bruttoKg?: number | null
}

export type KartonBereich = { von: number; bis: number }

/**
 * Kartonnummern fortlaufend über die Positionen (Position 1: 1–20, Position 2: 21–25 …). Positionen ohne Kartons
 * (lose Ware, fehlende „Flaschen je Karton“) bekommen keine Nummer und zählen nicht mit.
 */
export function kartonNummern(positionen: readonly Pick<DokPosition, 'kartons'>[]): (KartonBereich | null)[] {
  let naechste = 1
  return positionen.map(p => {
    const n = p.kartons
    if (!n || n < 1 || !Number.isInteger(n)) return null
    const bereich = { von: naechste, bis: naechste + n - 1 }
    naechste += n
    return bereich
  })
}

/** „01–20“ bzw. „25“ – zweistellig wie im Muster der ÖWM */
export function kartonText(b: KartonBereich | null): string {
  if (!b) return '–'
  const z = (n: number) => String(n).padStart(2, '0')
  return b.von === b.bis ? z(b.von) : `${z(b.von)}–${z(b.bis)}`
}

/** Flaschen im letzten, nicht vollen Karton der Position (0 = alle voll bzw. nicht bestimmbar) */
export function anbruchFlaschen(p: Pick<DokPosition, 'flaschen' | 'flaschenJeKarton' | 'kartons'>): number {
  if (!p.kartons || !p.flaschen || !p.flaschenJeKarton) return 0
  const rest = p.flaschen % p.flaschenJeKarton
  return rest > 0 ? rest : 0
}

/**
 * Aufschlüsselung der Kartons über alle Positionen: „24 Kartons à 6 Flaschen, 1 Karton mit 3 Flaschen“.
 * Volle Kartons je Kartongröße zusammengefasst, jeder Anbruchkarton einzeln. '' ohne Kartons.
 */
export function kartonAufschluesselung(positionen: readonly Pick<DokPosition, 'flaschen' | 'flaschenJeKarton' | 'kartons'>[], sprache: 'de' | 'en' = 'de'): string {
  const voll = new Map<number, number>()
  const anbruch: number[] = []
  for (const p of positionen) {
    if (!p.kartons || !p.flaschenJeKarton) continue
    const rest = anbruchFlaschen(p)
    const volle = rest > 0 ? p.kartons - 1 : p.kartons
    if (volle > 0) voll.set(p.flaschenJeKarton, (voll.get(p.flaschenJeKarton) ?? 0) + volle)
    if (rest > 0) anbruch.push(rest)
  }
  const de = sprache === 'de'
  const teile = [...voll.entries()].sort((a, b) => b[0] - a[0]).map(([je, n]) => de
    ? `${n} ${n === 1 ? 'Karton' : 'Kartons'} à ${je} Flaschen`
    : `${n} ${n === 1 ? 'box' : 'boxes'} each ${je} bottles`)
  for (const rest of anbruch.sort((a, b) => b - a)) {
    teile.push(de ? `1 Karton mit ${zahlDe(rest)} ${rest === 1 ? 'Flasche' : 'Flaschen'}` : `1 box ${zahlDe(rest)} ${rest === 1 ? 'bottle' : 'bottles'}`)
  }
  return teile.join(', ')
}

/** Kartons gesamt; null, sobald einer Flaschenposition die Kartons fehlen (dann steht „–“ im Dokument) */
export function kartonsGesamt(positionen: readonly Pick<DokPosition, 'flaschen' | 'kartons'>[]): number | null {
  let summe = 0
  for (const p of positionen) {
    if (p.flaschen === null || p.flaschen === undefined) continue   // lose Ware zählt nicht
    if (!p.kartons) return null
    summe += p.kartons
  }
  return summe
}

/** „Weiß / 0,75 l“ – Spalte „Farbe / Größe“ der Packliste */
export function farbeGroesse(p: Pick<DokPosition, 'farbe' | 'flaschengroesseMl'>): string {
  return [p.farbe || null, flascheText(p.flaschengroesseMl)].filter(Boolean).join(' / ') || '–'
}

// ── Warenbeschreibung (zweite Zeile unter der Bezeichnung) ───────────────────────────────────────────────

/**
 * Angaben, die Zoll und Empfänger zur Position brauchen: Jahrgang · Farbe · Flaschengröße · alc. % vol · Prüfnr. ·
 * Flaschen in Kartons · Liter. Fehlende Angaben fallen weg (sie stehen in der Hinweisliste des Auftrags).
 */
export function warenbeschreibung(p: DokPosition): string {
  const teile: string[] = []
  if (p.jahrgang) teile.push(String(p.jahrgang))
  if (p.farbe) teile.push(p.farbe)
  const fl = flascheText(p.flaschengroesseMl)
  if (fl) teile.push(fl)
  if (p.alkohol !== null && p.alkohol !== undefined) teile.push(`alc. ${zahlDe(p.alkohol, 1)} % vol`)
  if (p.pruefnummer) teile.push(`Prüfnr. ${p.pruefnummer}`)
  if (p.flaschen !== null && p.flaschen !== undefined) {
    teile.push(p.kartons ? `${zahlDe(p.flaschen)} Fl. in ${p.kartons} ${p.kartons === 1 ? 'Karton' : 'Kartons'}` : `${zahlDe(p.flaschen)} Fl.`)
  }
  if (p.liter !== null && p.liter !== undefined) teile.push(`${zahlDe(p.liter)} l`)
  return teile.join(' · ')
}

/** Vermerk für Mustersendungen (Entscheidung 4B) – auf Packliste und Rechnung */
export const MUSTERSENDUNG_VERMERK = 'Mustersendung – ohne Handelswert / Samples – no commercial value'
