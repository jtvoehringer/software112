// ── Weinexport: länderspezifische Belegnummern am Exportauftrag (KAN-437 Teil 3, 13.11.2026) ──
// Nummern, die zur Sendung bzw. zum Wein gehören und meist vom Importeur kommen (USA: COLA je Wein, Prior Notice je
// Sendung …). Bisher blieb dafür nur das Notizfeld. Entscheidungen Jörgen 13.11.2026: freie Liste am Auftrag aus
// Bezeichnung und Nummer mit Vorschlägen je Zielland (5A), änderbar bis „Abgeschlossen“; kein Druck auf Rechnung oder
// Packliste – Anzeige am Auftrag und in der CSV der Auftragsliste (6A).
// Spalte exportauftraege.laender_belege (jsonb-Liste). Isomorph und ohne '@/'-Importe (node:test).

export type Belegnummer = { bezeichnung: string; nummer: string }

/** Grenzen wie in der Datenbank (CHECK: höchstens 20 Einträge) */
export const BELEGNUMMERN_MAX = 20
export const BELEGNUMMER_LAENGE = 60

/** Vorschläge für die Bezeichnung je Zielland (aus den Länderhinweisen) – frei überschreibbar */
const VORSCHLAEGE: Record<string, readonly string[]> = {
  US: ['COLA', 'Prior Notice'],
  CH: ['Generaleinfuhrbewilligung des Importeurs'],
  BR: ['Einfuhrlizenz (SISCOMEX)'],
  TH: ['Einfuhrlizenz des Importeurs'],
  CN: ['Ursprungszeugnis'],
}

export function belegVorschlaege(land: unknown): readonly string[] {
  const iso = typeof land === 'string' ? land.trim().toUpperCase() : ''
  return VORSCHLAEGE[iso] ?? []
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** Liste aus der Datenbank bzw. aus der Eingabe lesen: nur Einträge mit Bezeichnung und Nummer, getrimmt */
export function belegnummernAus(v: unknown): Belegnummer[] {
  if (!Array.isArray(v)) return []
  return v
    .map(e => ({ bezeichnung: text((e as Record<string, unknown> | null)?.bezeichnung), nummer: text((e as Record<string, unknown> | null)?.nummer) }))
    .filter(e => e.bezeichnung !== '' && e.nummer !== '')
}

/**
 * Prüfung der Eingabe (vor dem Bereinigen): jede Zeile braucht Bezeichnung UND Nummer – ganz leere Zeilen fallen weg,
 * halb ausgefüllte sind ein Fehler; Längen und Anzahl wie in der Datenbank. null = in Ordnung.
 */
export function belegnummernFehler(v: unknown): string | null {
  if (!Array.isArray(v)) return 'Ungültige Belegnummern.'
  let anzahl = 0
  for (const [i, e] of v.entries()) {
    if (e === null || typeof e !== 'object' || Array.isArray(e)) return 'Ungültige Belegnummern.'
    const b = text((e as Record<string, unknown>).bezeichnung), n = text((e as Record<string, unknown>).nummer)
    if (b === '' && n === '') continue
    if (b === '') return `Zeile ${i + 1}: Bitte angeben, wofür die Nummer ${n} ist (z. B. COLA).`
    if (n === '') return `Zeile ${i + 1}: Bitte die Nummer zu „${b}“ angeben.`
    if (b.length > BELEGNUMMER_LAENGE || n.length > BELEGNUMMER_LAENGE) return `Zeile ${i + 1}: Bezeichnung und Nummer dürfen je höchstens ${BELEGNUMMER_LAENGE} Zeichen lang sein.`
    anzahl++
  }
  return anzahl > BELEGNUMMERN_MAX ? `Höchstens ${BELEGNUMMERN_MAX} Belegnummern je Exportauftrag.` : null
}

/** Eine Zeile für Listen und CSV: „COLA: 21123001000123; Prior Notice: 987654321“ */
export function belegnummernText(v: unknown): string {
  return belegnummernAus(v).map(e => `${e.bezeichnung}: ${e.nummer}`).join('; ')
}
