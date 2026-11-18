// ── Prüfung vor dem Import von Kontakten und Firmen (KAN-484, 18.11.2026) ───────────────────────────────────────────
//
// Der Import im CRM (und im Datenimport der Verwaltung) zeigt vor dem Speichern einen Dialog: was importiert wird, was
// übersprungen wird und wo Angaben fehlen. Das Segment lässt sich dort je Zeile oder für alle nachtragen.
// Dialog (Prüfmodus der Route /api/import) und Import rechnen mit denselben Funktionen – was der Dialog zeigt, legt der
// Import auch an. Ein fehlendes oder unbekanntes Segment bleibt erlaubt und fällt wie bisher auf den Standard zurück.
// Isomorph, ohne '@/'-Importe (node:test).

// @ts-expect-error TS5097 – node:test lädt ohne Bundler
import { pruefeEmailFelder } from './email.ts'
// @ts-expect-error TS5097 – node:test lädt ohne Bundler
import { normalisiereLand } from '../katalog/laender.ts'

export type ImportZeilenTyp = 'kontakte' | 'firmen'

/** Werte des DB-Enums kundensegment – dieselben wie SEGMENTE in lib/crm/types.ts (Test vergleicht) */
export const SEGMENT_WERTE = [
  'privat', 'gastronomie', 'handel', 'export', 'grosshandel', 'produzent', 'weinhauer',
  'firmenkunde', 'vinothek', 'abhof', 'restaurant', 'tourismus', 'medien', 'importeur', 'sonstige',
] as const
export type SegmentWert = (typeof SEGMENT_WERTE)[number]

// CSV-Wert (klein geschrieben) → Enum-Wert. Historie: früher „gastro“ (ungültig), Migration 185/186 ergänzte die
// Kundengruppen des DKB-Altsystems (bisher in src/app/api/import/route.ts).
export const SEGMENT_MAP: Readonly<Record<string, SegmentWert>> = {
  'privat': 'privat', 'private': 'privat',
  'gastro': 'gastronomie', 'gastronomie': 'gastronomie', 'restaurant': 'restaurant',
  'handel': 'handel', 'trade': 'handel',
  'export': 'export',
  'grosshandel': 'grosshandel', 'großhandel': 'grosshandel', 'wholesale': 'grosshandel',
  'produzent': 'produzent',
  'weinhauer': 'weinhauer', 'winzer': 'weinhauer', 'weingut': 'weinhauer',
  'firmenkunde': 'firmenkunde',
  'vinothek': 'vinothek',
  'ab hof': 'abhof', 'ab-hof': 'abhof', 'abhof': 'abhof',
  'tourismus': 'tourismus',
  'medien': 'medien', 'presse': 'medien',
  'importeur': 'importeur', 'import': 'importeur',
  'sonstige': 'sonstige', 'sonstiges': 'sonstige', 'other': 'sonstige',
}

/** Standard, wenn das Segment fehlt oder unbekannt ist (wie bisher) */
export const SEGMENT_STANDARD: Readonly<Record<ImportZeilenTyp, SegmentWert>> = { kontakte: 'privat', firmen: 'gastronomie' }

/** Spalte, in der der Dialog ein nachgetragenes Segment an die Zeile hängt (kein CSV-Kopf heißt so) */
export const SEGMENT_NACHTRAG = '__s112_segment'

export function istSegment(v: unknown): v is SegmentWert {
  return typeof v === 'string' && (SEGMENT_WERTE as readonly string[]).includes(v)
}

export type SegmentErgebnis = {
  wert: SegmentWert
  /** ok = aus der Datei erkannt; fehlt/unbekannt = Standard; nachgetragen = im Dialog gewählt */
  status: 'ok' | 'fehlt' | 'unbekannt' | 'nachgetragen'
  /** Wert aus der Datei (bei „unbekannt“ für den Hinweis) */
  roh: string | null
}

type Zeile = Record<string, unknown>

/** Wert einer zugeordneten Spalte: getrimmt, leer → null, nicht zugeordnet → undefined (wie mapVal der Route) */
export function spaltenWert(row: Zeile, spalte: string | undefined): string | null | undefined {
  if (!spalte) return undefined
  const roh = (row[spalte] ?? '').toString().trim()
  return roh || null
}

/** Segment einer Zeile: Nachtrag aus dem Dialog vor dem Wert der Datei, sonst Standard */
export function segmentAus(typ: ImportZeilenTyp, row: Zeile, mapping: Record<string, string>): SegmentErgebnis {
  const nachtrag = row[SEGMENT_NACHTRAG]
  const roh = spaltenWert(row, mapping.segment) ?? null
  if (istSegment(nachtrag)) return { wert: nachtrag, status: 'nachgetragen', roh }
  if (!roh) return { wert: SEGMENT_STANDARD[typ], status: 'fehlt', roh: null }
  const wert = SEGMENT_MAP[roh.toLowerCase()]
  return wert ? { wert, status: 'ok', roh } : { wert: SEGMENT_STANDARD[typ], status: 'unbekannt', roh }
}

export type ZeilenPruefung = {
  /** Zeilennummer in der Datei (Kopfzeile = 1) */
  zeile: number
  /** Index in der Datei (0-basiert) – Schlüssel für Nachträge */
  index: number
  name: string
  email: string | null
  status: 'neu' | 'dublette' | 'uebersprungen'
  /** Grund bei übersprungen/dublette */
  grund: string | null
  segment: SegmentErgebnis
  /** fehlende oder nicht übernommene Angaben (nur Anzeige) */
  hinweise: string[]
}

/**
 * Prüfung einer Zeile ohne Datenbank: Pflichtname, Segment, Land, E-Mail. Dubletten und Firmenzuordnung ergänzt die
 * Route (braucht die Daten des Betriebs).
 */
export function pruefeZeile(typ: ImportZeilenTyp, row: Zeile, mapping: Record<string, string>, index: number): ZeilenPruefung {
  const zeile = index + 2
  const vorname = spaltenWert(row, mapping.vorname)
  const nachname = spaltenWert(row, mapping.nachname)
  const firmenname = spaltenWert(row, mapping.name)
  const name = typ === 'kontakte' ? [vorname, nachname].filter(Boolean).join(' ') : (firmenname ?? '')
  const emailRoh = spaltenWert(row, mapping.email) ?? null
  const em = pruefeEmailFelder(emailRoh, null)
  const segment = segmentAus(typ, row, mapping)
  const basis = { zeile, index, name, email: em.email as string | null, segment }
  const pflichtFehlt = typ === 'kontakte' ? !nachname : !firmenname
  if (pflichtFehlt) {
    return { ...basis, status: 'uebersprungen', grund: typ === 'kontakte' ? 'Nachname fehlt' : 'Name fehlt', hinweise: [] }
  }
  const hinweise: string[] = []
  if (segment.status === 'fehlt') hinweise.push('Segment fehlt')
  if (segment.status === 'unbekannt') hinweise.push(`Segment „${segment.roh}“ unbekannt`)
  const land = spaltenWert(row, mapping.land)
  if (land && !normalisiereLand(land)) hinweise.push(`Land „${land}“ nicht erkannt – bleibt leer`)
  if (em.fehler) hinweise.push(`E-Mail „${emailRoh}“ unbrauchbar – kommt in die Notiz`)
  return { ...basis, status: 'neu', grund: null, hinweise }
}

/** Zeile mit fehlenden Angaben (nur importierbare Zeilen) */
export function hatFehlendeAngaben(z: ZeilenPruefung): boolean {
  return z.status === 'neu' && (z.hinweise.length > 0 || z.segment.status === 'fehlt' || z.segment.status === 'unbekannt')
}

export type PruefZusammenfassung = { neu: number; dubletten: number; uebersprungen: number; mitFehlendenAngaben: number }

export function zusammenfassung(zeilen: readonly ZeilenPruefung[]): PruefZusammenfassung {
  return {
    neu: zeilen.filter(z => z.status === 'neu').length,
    dubletten: zeilen.filter(z => z.status === 'dublette').length,
    uebersprungen: zeilen.filter(z => z.status === 'uebersprungen').length,
    mitFehlendenAngaben: zeilen.filter(hatFehlendeAngaben).length,
  }
}

/** Nachgetragene Segmente (Index → Wert) an die Zeilen hängen; ungültige Werte bleiben weg */
export function mitSegmentNachtrag<T extends Zeile>(rows: readonly T[], nachtraege: ReadonlyMap<number, string>): T[] {
  return rows.map((r, i) => {
    const s = nachtraege.get(i)
    return istSegment(s) ? { ...r, [SEGMENT_NACHTRAG]: s } : r
  })
}
