// ── Import im CRM: Bezeichnung des Imports (KAN-426, 12.11.2026) ─────────────────────────────────────────────────────
//
// Kontakte und Firmen lassen sich direkt im CRM importieren (Betriebs-Manager und Mitarbeiter mit Schreibrecht CRM).
// Jeder Import trägt eine Bezeichnung (z. B. „Messe Seoul 2026“) – Pflicht, nicht vorbelegt. Sie steht an jedem
// importierten Datensatz (import_quelle, importiert_am) und ist Filter in Kontakt- und Firmenliste (?import=…).
// Der Datenimport der Verwaltung (/admin/import) behält seine Vorbelegung „Datenmigration aus Drittsystem“.
// Isomorph, ohne '@/'-Importe (node:test) – gemeinsam für Formular, Route und Listen.

export const IMPORT_BEZEICHNUNG_MIN = 2
export const IMPORT_BEZEICHNUNG_MAX = 120
/** Importarten, die es im CRM gibt – alles andere bleibt beim Datenimport der Verwaltung */
export const CRM_IMPORT_TYPEN = ['kontakte', 'firmen'] as const
export type CrmImportTyp = (typeof CRM_IMPORT_TYPEN)[number]

export function istCrmImportTyp(typ: unknown): typ is CrmImportTyp {
  return typeof typ === 'string' && (CRM_IMPORT_TYPEN as readonly string[]).includes(typ)
}

/** Bezeichnung aus dem Formular: Ränder weg, Mehrfach-Leerzeichen zusammengezogen */
export function importBezeichnungAus(roh: unknown): string {
  return typeof roh === 'string' ? roh.replace(/\s+/g, ' ').trim() : ''
}

/** Prüfung der Bezeichnung; null = in Ordnung */
export function importBezeichnungFehler(roh: unknown): string | null {
  const t = importBezeichnungAus(roh)
  if (t.length < IMPORT_BEZEICHNUNG_MIN) return 'Bitte eine Bezeichnung für den Import angeben, z. B. „Messe Seoul 2026“ – danach lässt sich später filtern.'
  if (t.length > IMPORT_BEZEICHNUNG_MAX) return `Die Bezeichnung darf höchstens ${IMPORT_BEZEICHNUNG_MAX} Zeichen lang sein.`
  return null
}

export type ImportZaehler = { bezeichnung: string; anzahl: number }

/** Vorhandene Import-Bezeichnungen zählen (Zeilen mit import_quelle), alphabetisch */
export function zaehleImporte(rows: readonly { import_quelle?: unknown }[]): ImportZaehler[] {
  const m = new Map<string, number>()
  for (const r of rows) {
    const b = typeof r.import_quelle === 'string' ? r.import_quelle.trim() : ''
    if (b) m.set(b, (m.get(b) ?? 0) + 1)
  }
  return [...m.entries()].map(([bezeichnung, anzahl]) => ({ bezeichnung, anzahl })).sort((a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de'))
}

/** Bezeichnungen aus mehreren Zählungen (Kontakte und Firmen) zusammenführen – Vorschläge im Import */
export function importVorschlaege(...listen: readonly ImportZaehler[][]): string[] {
  return [...new Set(listen.flat().map(z => z.bezeichnung))].sort((a, b) => a.localeCompare(b, 'de'))
}

/** Filterwert aus der Adresse (?import=…) */
export function importFilterAus(roh: unknown): string {
  return importBezeichnungAus(roh).slice(0, IMPORT_BEZEICHNUNG_MAX)
}
