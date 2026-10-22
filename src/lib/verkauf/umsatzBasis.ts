// KAN-105 (08.10.2026): Umsatz-Auswertung wahlweise nach Liefer- oder Rechnungsdatum (Entscheidung Jörgen 06.10.2026:
// „beide Möglichkeiten“). KAN-346 (Entscheidung Jörgen 22.10.2026): beide Basen netto und je Position auf Cent über
// dieselbe Rechnung (lib/verkauf/umsatz.ts); Standard ist jetzt das Rechnungsdatum. Die Umschaltung gibt es nur in der
// Umsatz-Auswertung (/reports) – Dashboard, Finanzübersicht, Offene Posten und Morgenbericht rechnen fest nach
// Rechnungsdatum.
//  'rechnung'  = Rechnungen nach Rechnungsdatum (Sammelrechnung als ein Beleg, nicht berechnete Lieferscheine fehlen)
//  'lieferung' = Lieferscheine nach Lieferdatum (nicht stornierte, auch noch nicht berechnete)

export type UmsatzBasis = 'lieferung' | 'rechnung'

/** Query-Parameter ?basis= → Basis; nur „lieferung“ schaltet um, alles andere ist das Rechnungsdatum (Standard) */
export function umsatzBasis(wert: string | null | undefined): UmsatzBasis {
  return wert === 'lieferung' ? 'lieferung' : 'rechnung'
}

/** Beschriftung für Überschrift, Achse und CSV */
export function umsatzBeschriftung(basis: UmsatzBasis): string {
  return basis === 'lieferung' ? 'Umsatz netto nach Lieferdatum' : 'Umsatz netto nach Rechnungsdatum'
}
