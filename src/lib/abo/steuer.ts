// ── Abo: Umsatzsteuer bei Stripe (KAN-450, 13.11.2026) ──
// Befund: Die Paketpreise sind Nettopreise (199/299/399 €, Premium-Support 79 €), der Checkout übergab Stripe aber
// keinen Steuersatz – der Kunde hätte genau den Nettobetrag gezahlt, die Rechnung keine Umsatzsteuer ausgewiesen.
//
// Entscheidungen Jörgen 13.11.2026: fester Steuersatz 20 % (kein Stripe Tax, solange alle Kunden österreichische
// Betriebe sind); der Checkout fragt die UID des Kunden ab; ist der Steuersatz nicht hinterlegt, wird NICHT
// abgerechnet (Abbruch mit Meldung) – nie ohne Umsatzsteuer.
//
// Der Steuersatz hängt am Abo (default_tax_rates): Er gilt damit für alle Positionen (Paket, Zusatzmandant,
// Premium-Support) und alle Folgerechnungen. Die ID des Steuersatzes (txr_…) steht je Umgebung in der Variable
// STRIPE_TAX_RATE_UST – sie ist kein Geheimnis, aber an das Stripe-Konto gebunden (Sandbox bzw. Live).
// Isomorph und ohne '@/'-Importe (node:test).

/** Umsatzsteuersatz der Abo-Preise in Prozent (Anzeige; abgerechnet wird der bei Stripe hinterlegte Steuersatz) */
export const ABO_UST_PROZENT = 20

/** Hinweis unter Preisangaben */
export const ABO_PREIS_HINWEIS = `Alle Preise sind Nettopreise zuzüglich ${ABO_UST_PROZENT} % USt.`

/** Meldung, wenn der Steuersatz in dieser Umgebung nicht hinterlegt ist */
export const STEUERSATZ_FEHLT =
  'Die Abrechnung ist noch nicht vollständig eingerichtet (der Umsatzsteuersatz fehlt) – bitte kontaktieren Sie uns. Es wurde nichts abgerechnet.'

/** ID des Stripe-Steuersatzes aus der Umgebung – null, wenn sie fehlt oder keine Steuersatz-ID ist */
export function stripeSteuersatzId(env: Record<string, string | undefined> = process.env): string | null {
  const id = (env.STRIPE_TAX_RATE_UST ?? '').trim()
  return /^txr_[A-Za-z0-9]+$/.test(id) ? id : null
}

/**
 * Optionen des Stripe-Checkouts neben Preis und Abo-Daten: UID des Kunden abfragen (steht dann auf jeder Rechnung),
 * Rechnungsadresse verlangen und Name bzw. Adresse aus dem Checkout am Stripe-Kunden speichern (verlangt Stripe für
 * die UID-Abfrage bei einem bestehenden Kunden).
 */
export function checkoutSteuerOptionen(): {
  tax_id_collection: { enabled: true }
  customer_update: { name: 'auto'; address: 'auto' }
  billing_address_collection: 'required'
} {
  return { tax_id_collection: { enabled: true }, customer_update: { name: 'auto', address: 'auto' }, billing_address_collection: 'required' }
}

/** Was vom Stripe-Abo gebraucht wird, um den Steuersatz zu prüfen */
export type AboMitSteuersatz = { default_tax_rates?: readonly ({ id?: string | null } | string)[] | null }

/**
 * Steuersatz an einem bestehenden Abo nachziehen: liefert die Änderung für subscriptions.update – oder null, wenn
 * das Abo den Steuersatz schon trägt. Ein Abo aus der Zeit vor KAN-450 bekommt ihn so beim nächsten Paketwechsel bzw.
 * bei der Buchung des Premium-Supports.
 */
export function steuersatzNachziehen(abo: AboMitSteuersatz, steuersatzId: string): { default_tax_rates: string[] } | null {
  const vorhanden = (abo.default_tax_rates ?? []).map(t => (typeof t === 'string' ? t : t?.id ?? ''))
  return vorhanden.includes(steuersatzId) ? null : { default_tax_rates: [steuersatzId] }
}
