// KAN-105 (08.10.2026): Umsatz-Reports wahlweise nach Liefer- oder Rechnungsdatum (Entscheidung Jörgen 06.10.2026:
// „beide Möglichkeiten“). 'lieferung' = Lieferscheine nach Lieferdatum (bisheriges Verhalten, auch nicht berechnete),
// 'rechnung' = Rechnungen nach Rechnungsdatum (Sammelrechnung als ein Beleg, nicht berechnete Lieferscheine fehlen).

export type UmsatzBasis = 'lieferung' | 'rechnung'

/** Query-Parameter ?basis= → Basis; alles außer „rechnung“ ist das Lieferdatum (Standard wie bisher) */
export function umsatzBasis(wert: string | null | undefined): UmsatzBasis {
  return wert === 'rechnung' ? 'rechnung' : 'lieferung'
}
