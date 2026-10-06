// KAN-216: Kategorien und Allergene des E-Label-Katalogs (elabel_zutaten) – Bezeichnungen DE/EN.
// Isomorph und ohne @/-Importe (node:test).

export const ELABEL_KATEGORIEN = ['zutat', 'saeureregulator', 'konservierung', 'stabilisator', 'gas', 'dosage', 'allergen_hilfsstoff'] as const
export type ElabelKategorie = typeof ELABEL_KATEGORIEN[number]

export const KATEGORIE_LABEL: Record<ElabelKategorie, { de: string; en: string }> = {
  zutat:               { de: 'Zutaten',                                   en: 'Ingredients' },
  saeureregulator:     { de: 'Säureregulatoren',                          en: 'Acidity regulators' },
  konservierung:       { de: 'Konservierungsstoffe und Antioxidationsmittel', en: 'Preservatives and antioxidants' },
  stabilisator:        { de: 'Stabilisatoren',                            en: 'Stabilising agents' },
  gas:                 { de: 'Gase und Packgase',                         en: 'Gases and packaging gases' },
  dosage:              { de: 'Tirage- und Versanddosage',                 en: 'Tirage and expedition liqueur' },
  allergen_hilfsstoff: { de: 'Allergene Verarbeitungshilfsstoffe',        en: 'Allergenic processing aids' },
}

export type Allergen = 'sulfite' | 'ei' | 'milch'
export const ALLERGEN_LABEL: Record<Allergen, { de: string; en: string }> = {
  sulfite: { de: 'Sulfite', en: 'Sulphites' },
  ei:      { de: 'Ei',      en: 'Egg' },
  milch:   { de: 'Milch',   en: 'Milk' },
}

export type KatalogEintrag = {
  id: string
  kategorie: ElabelKategorie
  name_de: string
  name_en: string
  e_nummer: string | null
  allergen: Allergen | null
  sortierung: number
}

/** Zutatenliste in der gespeicherten Reihenfolge, Zusatzstoffe nach Kategorie gruppiert (Reihenfolge der ersten Nennung). */
export function zutatenGruppen(ids: string[], katalog: KatalogEintrag[]): { kategorie: ElabelKategorie; eintraege: KatalogEintrag[] }[] {
  const nachId = new Map(katalog.map(k => [k.id, k]))
  const gruppen: { kategorie: ElabelKategorie; eintraege: KatalogEintrag[] }[] = []
  for (const id of ids) {
    const k = nachId.get(id)
    if (!k) continue
    let g = gruppen.find(x => x.kategorie === k.kategorie)
    if (!g) { g = { kategorie: k.kategorie, eintraege: [] }; gruppen.push(g) }
    g.eintraege.push(k)
  }
  return gruppen
}

/** Allergene der Zutatenliste (für den Etikett-Hinweis „Enthält …“), ohne Doppelte. */
export function allergeneDerListe(ids: string[], katalog: KatalogEintrag[]): Allergen[] {
  const nachId = new Map(katalog.map(k => [k.id, k]))
  const a: Allergen[] = []
  for (const id of ids) {
    const x = nachId.get(id)?.allergen
    if (x && !a.includes(x)) a.push(x)
  }
  return a
}

/** Zutatenliste als Text (z. B. für die Vorschau): „Trauben, Säureregulator: Weinsäure, Konservierungsstoff: Sulfite“. */
export function zutatenText(ids: string[], katalog: KatalogEintrag[], sprache: 'de' | 'en' = 'de'): string {
  return zutatenGruppen(ids, katalog).map(g => {
    const namen = g.eintraege.map(k => sprache === 'de' ? k.name_de : k.name_en).join(', ')
    return g.kategorie === 'zutat' ? namen : `${KATEGORIE_LABEL[g.kategorie][sprache]}: ${namen}`
  }).join('; ')
}
