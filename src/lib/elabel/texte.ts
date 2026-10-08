// ── E-Label: Texte und Katalogbegriffe je Sprache (KAN-218, 08.10.2026) ──────────────────────────────────────────────
//
// Deutsch/Englisch: Katalogspalten name_de/name_en, KATEGORIE_LABEL/ALLERGEN_LABEL (katalog.ts) und TEXTE (oeffentlich.ts).
// Übrige Amtssprachen: UEBERSETZUNGEN (uebersetzungen.ts, Katalogbegriffe nach dem englischen Katalognamen). Fehlt ein
// Begriff (z. B. ein neu angelegter Katalogeintrag), steht der englische – die Seite bleibt vollständig; der Test
// kan218-elabel-sprachen prüft, dass jeder Katalogeintrag in jeder Sprache übersetzt ist.
// Isomorph und ohne '@/'-Importe (node:test).

// @ts-expect-error TS5097 – Pfad mit .ts-Endung für node:test (wie lib/elabel/eingabe.ts)
import { ALLERGEN_LABEL, KATEGORIE_LABEL, type Allergen, type ElabelKategorie, type KatalogEintrag } from './katalog.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung für node:test (wie lib/elabel/eingabe.ts)
import { TEXTE, type TextSchluessel } from './oeffentlich.ts'
import type { Sprache } from './sprachen.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung für node:test (wie lib/elabel/eingabe.ts)
import { UEBERSETZUNGEN } from './uebersetzungen.ts'

const fremd = (s: Sprache) => (s === 'de' || s === 'en' ? null : UEBERSETZUNGEN[s])

export function kategorieText(k: ElabelKategorie, s: Sprache): string {
  if (s === 'de' || s === 'en') return KATEGORIE_LABEL[k][s]
  return fremd(s)?.kategorien[k] || KATEGORIE_LABEL[k].en
}

export function allergenText(a: Allergen, s: Sprache): string {
  if (s === 'de' || s === 'en') return ALLERGEN_LABEL[a][s]
  return fremd(s)?.allergene[a] || ALLERGEN_LABEL[a].en
}

export function zutatName(k: Pick<KatalogEintrag, 'name_de' | 'name_en'>, s: Sprache): string {
  if (s === 'de') return k.name_de
  if (s === 'en') return k.name_en
  return fremd(s)?.zutaten[k.name_en] || k.name_en
}

/** Seitentexte einer Sprache (fehlende Schlüssel englisch) */
export function seitenTexte(s: Sprache): Record<TextSchluessel, string> {
  if (s === 'de' || s === 'en') return TEXTE[s]
  return { ...TEXTE.en, ...(fremd(s)?.texte ?? {}) }
}

/** Name der Sprache in der Sprache selbst (Umschalter) */
export function sprachName(s: Sprache): string {
  return seitenTexte(s).sprache
}
