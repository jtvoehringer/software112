// Kundennummern der Mandanten (Migration 209, 17.9.2026):
//   S112-AT-<K><NNNN>   K = erste Ziffer der Betriebs-PLZ (Nummernkreis),
//                        NNNN = laufende Nummer je Kreis ab 0001.
// Der Kreis entspricht grob dem Bundesland (Einteilung der Österreichischen
// Post) - nützlich für Support und für landesrechtliche Weinbestimmungen.

export const PLZ_KREISE: Record<string, string> = {
  '1': 'Wien',
  '2': 'Niederösterreich (Ost)',
  '3': 'Niederösterreich (West)',
  '4': 'Oberösterreich',
  '5': 'Salzburg',
  '6': 'Tirol / Vorarlberg',
  '7': 'Burgenland',
  '8': 'Steiermark',
  '9': 'Kärnten / Osttirol',
}

/** Bundesland (Nummernkreis) aus der Kundennummer, z.B. "S112-AT-20001" → "Niederösterreich (Ost)". */
export function bundeslandAusKundennummer(nr: string | null | undefined): string | null {
  const m = /^S112-AT-(\d)\d{4}$/.exec(nr ?? '')
  return m ? PLZ_KREISE[m[1]] ?? null : null
}

/** Bundesland aus einer österreichischen Postleitzahl (vier Ziffern). */
export function bundeslandAusPlz(plz: string | null | undefined): string | null {
  const z = (plz ?? '').replace(/\D/g, '')
  return z.length === 4 ? PLZ_KREISE[z[0]] ?? null : null
}
