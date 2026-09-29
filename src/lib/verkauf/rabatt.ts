// ── Kunden- und Sonderrabatt im Verkaufsformular (KAN-156, 29.09.2026) ───────
// Reine Rechenlogik ohne JSX und ohne Importe (testbar mit node:test, siehe
// scripts/tests/verkauf-rabatt.test.mjs). Genutzt von weinhandel/verkauf/neu/page.tsx:
//  - rabattFuerNeuePosition: Rabattfelder einer Position aus den Konditionen des gewählten
//    Kunden – gleich bei der Kundenwahl (alle Positionen) und bei „Produkt hinzufügen“.
//  - zeilenBetrag / gesamtBetrag: Zeilensumme und Gesamtsumme; ein abgewählter Rabatt
//    (rabatt_aktiv bzw. sonderrabatt_aktiv = false) zählt nicht.

/** Konditionen des gewählten Kunden in Prozent (Rabattgruppe bzw. Sonderrabatt) */
export interface KundenKonditionen {
  rabatt_pct:       number
  sonderrabatt_pct: number
}

/** Rabattfelder einer Formularposition (Werte als Text wie in den Eingabefeldern) */
export interface RabattFelder {
  rabatt_pct:         string
  rabatt_aktiv:       boolean
  sonderrabatt:       string
  sonderrabatt_aktiv: boolean
}

/** Betragsfelder einer Formularposition */
export interface BetragsFelder extends RabattFelder {
  preis_brutto: string
  menge:        string
}

export const OHNE_KUNDENRABATT: KundenKonditionen = { rabatt_pct: 0, sonderrabatt_pct: 0 }

/** Rabattfelder für eine Position beim gewählten Kunden: Rabatt vorbelegt und aktiv, wenn > 0 */
export function rabattFuerNeuePosition(kunde: KundenKonditionen): RabattFelder {
  const rabatt = kunde.rabatt_pct || 0
  const sonder = kunde.sonderrabatt_pct || 0
  return {
    rabatt_pct:         String(rabatt),
    rabatt_aktiv:       rabatt > 0,
    sonderrabatt:       String(sonder),
    sonderrabatt_aktiv: sonder > 0,
  }
}

/** Wirksamer Kundenrabatt einer Position in Prozent (0, wenn abgewählt) */
export function wirksamerRabatt(p: RabattFelder): number {
  return p.rabatt_aktiv ? (parseFloat(p.rabatt_pct) || 0) : 0
}

/** Wirksamer Sonderrabatt einer Position in Prozent (0, wenn abgewählt) */
export function wirksamerSonderrabatt(p: RabattFelder): number {
  return p.sonderrabatt_aktiv ? (parseFloat(p.sonderrabatt) || 0) : 0
}

/** Bruttobetrag einer Zeile nach Kunden- und Sonderrabatt (ungerundet) */
export function zeilenBetrag(p: BetragsFelder): number {
  const preis = parseFloat(p.preis_brutto) || 0
  const menge = parseFloat(p.menge) || 0
  return preis * (1 - wirksamerRabatt(p) / 100) * (1 - wirksamerSonderrabatt(p) / 100) * menge
}

/** Bruttobetrag aller Zeilen (Summe von zeilenBetrag) */
export function gesamtBetrag(positionen: readonly BetragsFelder[]): number {
  return positionen.reduce((s, p) => s + zeilenBetrag(p), 0)
}
