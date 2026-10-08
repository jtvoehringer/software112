// ── E-Label: Sprachen (KAN-218, 08.10.2026) ──────────────────────────────────────────────────────────────────────────
//
// Die öffentliche E-Label-Seite gibt es in allen 24 EU-Amtssprachen. Deutsch und Englisch stehen in katalog.ts und
// oeffentlich.ts (Spalten name_de/name_en des Katalogs), die übrigen 22 in uebersetzungen.ts. Quelle der Katalogbegriffe
// sind die amtlichen Verordnungstexte (EUR-Lex: VO (EU) 1169/2011, Delegierte VO (EU) 2019/33 i. d. F. 2023/1606,
// VO (EG) 1333/2008 bzw. VO (EU) 231/2012) – keine Maschinenübersetzung (Vorgabe KAN-218). Begriffe ohne amtliche
// Fundstelle stehen je Sprache in nichtAmtlich.
// Isomorph und ohne '@/'-Importe (node:test).

export const ELABEL_SPRACHEN = [
  'bg', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fi', 'fr', 'ga', 'hr',
  'hu', 'it', 'lt', 'lv', 'mt', 'nl', 'pl', 'pt', 'ro', 'sk', 'sl', 'sv',
] as const
export type Sprache = typeof ELABEL_SPRACHEN[number]

export function istSprache(x: unknown): x is Sprache {
  return typeof x === 'string' && (ELABEL_SPRACHEN as readonly string[]).includes(x)
}

/** Sprache für Intl (Zahlen): Deutsch wie bisher de-DE, Englisch en-GB, sonst der Sprachcode */
export function intlSprache(s: Sprache): string {
  return s === 'de' ? 'de-DE' : s === 'en' ? 'en-GB' : s
}
