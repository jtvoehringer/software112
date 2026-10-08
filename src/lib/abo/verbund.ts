// ── Abrechnungsverbund: n Mandanten über einen Hauptmandanten (KAN-215, 06.10.2026) ─────────────────────────────────
//
// Variante A (Entscheidungen Jörgen, Kommentar KAN-215):
//  - Der Hauptmandant hat EIN Stripe-Abo: Paket-Position (Premium, Pflicht) + Zusatzmandanten. Rechnungsempfänger ist
//    immer der Hauptmandant; die Weiterverrechnung im Verbund läuft intern beim Kunden.
//  - Preis je Nebenmandant: Standardpreis (Stripe-Preis STRIPE_PRICE_ZUSATZMANDANT, eine Position mit Menge) oder ein
//    vereinbarter Preis je Nebenmandant (tenants.zusatz_preis_cent → eigene Position mit price_data am Produkt
//    STRIPE_PRODUCT_ZUSATZMANDANT).
//  - Nebenmandanten übernehmen Stripe-Kunde und -Abo des Hauptmandanten; der Webhook spiegelt Status, Paket und
//    Testphase dann in alle Betriebe des Verbunds (stripeAbgleich: alle Betriebe derselben Kunden-ID). Eigene
//    Testphase gibt es für Nebenmandanten nicht.
//  - Austritt → Nur-Lesen (Status „cancelled“), bis der Betrieb ein eigenes Abo abschließt.
// Isomorph und ohne Stripe-SDK: Planung und Prüfungen sind reine Funktionen (Tests: scripts/tests/kan215-verbund.test.mjs).

import { paketAusPlan, type PaketKey } from '@/lib/pakete'
import { zahlAus } from '@/lib/format'
import { PREMIUM_ART } from '@/lib/abo/premiumStripe'

type R = Record<string, unknown>

/** Kennzeichen der Zusatzmandanten-Positionen im Stripe-Abo (metadata.s112_art) */
export const ZUSATZ_STANDARD = 'zusatzmandant_standard'
export const ZUSATZ_EINZELN = 'zusatzmandant'

/** Grenzen des vereinbarten Preises (Cent, netto) – wie CHECK tenants_zusatz_preis_chk */
export const ZUSATZ_PREIS_MIN = 100
export const ZUSATZ_PREIS_MAX = 10_000_000

export type Nebenmandant = { tenantId: string; name: string; preisCent: number | null }

/** Position eines Stripe-Abos (aus subscriptions.retrieve → items.data) */
export type AboPosition = {
  id: string
  priceId: string | null
  /** Einzelpreis in Cent (price.unit_amount) */
  betragCent: number | null
  quantity: number
  metadata: Record<string, string>
}

/** Änderung für stripe.subscriptions.update({ items }) */
export type PositionsAenderung =
  | { id: string; deleted: true }
  | { id: string; quantity: number }
  | { price: string; quantity: number; metadata: Record<string, string> }
  | { price_data: { currency: 'eur'; product: string; unit_amount: number; recurring: { interval: 'month' } }; quantity: 1; metadata: Record<string, string> }

export type VerbundKonfig = { standardPreisId: string | null; produktId: string | null }

/** Aus der Stripe-Position die für die Planung nötigen Felder */
export function aboPositionAus(item: R): AboPosition {
  const price = (item.price ?? {}) as R
  return {
    id: String(item.id),
    priceId: typeof price.id === 'string' ? price.id : null,
    betragCent: typeof price.unit_amount === 'number' ? price.unit_amount : null,
    quantity: typeof item.quantity === 'number' ? item.quantity : 1,
    metadata: (item.metadata ?? {}) as Record<string, string>,
  }
}

/**
 * Die Paket-Position eines Abos: die erste, deren Preis ein Paket ist, sonst die erste, die kein Zusatzmandant ist.
 * Vorher galt immer items[0] – mit Zusatzmandanten-Positionen hätte der Webhook das Paket falsch erkannt.
 */
export function paketPosition<T extends { priceId: string | null; metadata?: Record<string, string> }>(
  positionen: readonly T[], paketAusPreis: (priceId: string | null) => PaketKey | null,
): T | null {
  return positionen.find(p => paketAusPreis(p.priceId) !== null)
    // KAN-226: auch die Premium-Support-Position ist kein Paket
    ?? positionen.find(p => !(p.metadata?.s112_art === ZUSATZ_STANDARD || p.metadata?.s112_art === ZUSATZ_EINZELN || p.metadata?.s112_art === PREMIUM_ART))
    ?? null
}

/**
 * Soll-Ist-Abgleich der Zusatzmandanten-Positionen: eine Standard-Position mit Menge = Anzahl der Nebenmandanten ohne
 * vereinbarten Preis, je Nebenmandant mit vereinbartem Preis eine eigene Position. Unveränderte Positionen bleiben
 * unangetastet; ein geänderter Preis ersetzt die Position (löschen + neu), weil Stripe-Preise unveränderlich sind.
 */
export function zusatzPositionenPlan(neben: readonly Nebenmandant[], bestehend: readonly AboPosition[], k: VerbundKonfig):
  { aenderungen: PositionsAenderung[]; fehler: string | null } {
  const aenderungen: PositionsAenderung[] = []
  const standard = neben.filter(n => n.preisCent == null)
  const einzeln = neben.filter(n => n.preisCent != null)
  if (standard.length > 0 && !k.standardPreisId) {
    return { aenderungen: [], fehler: 'Für den Zusatzmandanten ist kein Standardpreis hinterlegt (STRIPE_PRICE_ZUSATZMANDANT) – bitte einen vereinbarten Preis eintragen.' }
  }
  if (einzeln.length > 0 && !k.produktId) {
    return { aenderungen: [], fehler: 'Für vereinbarte Preise fehlt das Stripe-Produkt des Zusatzmandanten (STRIPE_PRODUCT_ZUSATZMANDANT).' }
  }
  for (const n of einzeln) {
    const c = n.preisCent as number
    if (!Number.isInteger(c) || c < ZUSATZ_PREIS_MIN || c > ZUSATZ_PREIS_MAX) {
      return { aenderungen: [], fehler: `Der vereinbarte Preis für ${n.name} ist ungültig.` }
    }
  }

  // Standard-Position
  const stdIst = bestehend.filter(p => p.metadata.s112_art === ZUSATZ_STANDARD)
  const [stdErste, ...stdRest] = stdIst
  for (const p of stdRest) aenderungen.push({ id: p.id, deleted: true })
  if (standard.length === 0) {
    if (stdErste) aenderungen.push({ id: stdErste.id, deleted: true })
  } else if (!stdErste) {
    aenderungen.push({ price: k.standardPreisId as string, quantity: standard.length, metadata: { s112_art: ZUSATZ_STANDARD } })
  } else if (stdErste.priceId !== k.standardPreisId) {
    aenderungen.push({ id: stdErste.id, deleted: true })
    aenderungen.push({ price: k.standardPreisId as string, quantity: standard.length, metadata: { s112_art: ZUSATZ_STANDARD } })
  } else if (stdErste.quantity !== standard.length) {
    aenderungen.push({ id: stdErste.id, quantity: standard.length })
  }

  // Einzelpositionen
  const einzelIst = bestehend.filter(p => p.metadata.s112_art === ZUSATZ_EINZELN)
  const gesehen = new Set<string>()
  for (const p of einzelIst) {
    const n = einzeln.find(x => x.tenantId === p.metadata.s112_tenant_id)
    if (!n || gesehen.has(n.tenantId) || p.betragCent !== n.preisCent) { aenderungen.push({ id: p.id, deleted: true }); continue }
    gesehen.add(n.tenantId)
  }
  for (const n of einzeln) {
    if (gesehen.has(n.tenantId)) continue
    aenderungen.push({
      price_data: { currency: 'eur', product: k.produktId as string, unit_amount: n.preisCent as number, recurring: { interval: 'month' } },
      quantity: 1,
      metadata: { s112_art: ZUSATZ_EINZELN, s112_tenant_id: n.tenantId, s112_name: n.name.slice(0, 450) },
    })
  }
  return { aenderungen, fehler: null }
}

/** Zeile aus tenants (Spalten für die Verbund-Prüfung) */
export type VerbundBetrieb = {
  id: string
  name: string
  abrechnung_ueber: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  stripe_plan: string | null
}

/** Darf `neben` über `haupt` abgerechnet werden? null = ja, sonst die Meldung */
export function beitrittFehler(neben: VerbundBetrieb, haupt: VerbundBetrieb, hatSelbstNebenmandanten: boolean): string | null {
  if (neben.id === haupt.id) return 'Ein Betrieb kann nicht über sich selbst abgerechnet werden.'
  if (haupt.abrechnung_ueber) return `${haupt.name} wird selbst über einen anderen Betrieb abgerechnet und kann kein Hauptmandant sein.`
  if (hatSelbstNebenmandanten) return `${neben.name} ist Hauptmandant eines Verbunds und kann nicht selbst Nebenmandant werden.`
  if (neben.abrechnung_ueber && neben.abrechnung_ueber !== haupt.id) return `${neben.name} wird bereits über einen anderen Betrieb abgerechnet – zuerst austreten.`
  if (!haupt.stripe_customer_id || !haupt.stripe_subscription_id) return `${haupt.name} hat noch kein Stripe-Abo – zuerst das Premium-Paket abschließen.`
  if (paketAusPlan(haupt.stripe_plan) !== 'premium') return `Ein Abrechnungsverbund setzt das Premium-Paket beim Hauptmandanten voraus (${haupt.name}).`
  if (neben.stripe_subscription_id && neben.stripe_subscription_id !== haupt.stripe_subscription_id) {
    return `${neben.name} hat ein eigenes Stripe-Abo – dieses bitte zuerst kündigen, damit nicht doppelt abgerechnet wird.`
  }
  return null
}

/** Paketwechsel des Hauptmandanten: unter Premium nur ohne Nebenmandanten */
export function paketwechselVerbundFehler(paket: PaketKey, anzahlNeben: number): string | null {
  if (paket === 'premium' || anzahlNeben === 0) return null
  return `Ihr Betrieb rechnet ${anzahlNeben === 1 ? 'einen weiteren Betrieb' : `${anzahlNeben} weitere Betriebe`} als Zusatzmandant ab – das setzt Premium voraus. Für einen Wechsel zuerst den Verbund auflösen (Plattform-Admin).`
}

/** Spalten des Nebenmandanten beim Beitritt: Stripe-Kunde, -Abo, Status, Paket, Periode und Testphase des Hauptmandanten */
export function beitrittsWerte(haupt: R, preisCent: number | null): R {
  return {
    abrechnung_ueber: haupt.id,
    zusatz_preis_cent: preisCent,
    stripe_customer_id: haupt.stripe_customer_id ?? null,
    stripe_subscription_id: haupt.stripe_subscription_id ?? null,
    stripe_status: haupt.stripe_status ?? null,
    stripe_plan: 'premium',
    stripe_current_period_end: haupt.stripe_current_period_end ?? null,
    stripe_trial_ends_at: haupt.stripe_trial_ends_at ?? null,
  }
}

/** Spalten beim Austritt: ohne Abo und gekündigt → Nur-Lesen, bis ein eigenes Abo abgeschlossen ist */
export function austrittsWerte(): R {
  return {
    abrechnung_ueber: null,
    zusatz_preis_cent: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    stripe_status: 'cancelled',
    stripe_current_period_end: null,
    stripe_trial_ends_at: null,
  }
}

/** Eingabe „vereinbarter Preis“ (Euro, Komma oder Punkt; leer = Standardpreis) → Cent bzw. Fehler */
export function preisCentAusEingabe(roh: unknown): { cent: number | null; fehler: string | null } {
  const s = String(roh ?? '').trim().replace(/\s/g, '')
  if (!s) return { cent: null, fehler: null }
  const n = zahlAus(s)   // lib/format: Dezimalkomma, Tausenderpunkt („1.234,50“)
  if (n === null || !/^[\d.]+(,\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(s)) {
    return { cent: null, fehler: 'Den vereinbarten Preis bitte als Betrag in Euro angeben, z. B. 99 oder 99,50.' }
  }
  const cent = Math.round(n * 100)
  if (cent < ZUSATZ_PREIS_MIN || cent > ZUSATZ_PREIS_MAX) return { cent: null, fehler: 'Der vereinbarte Preis muss zwischen 1 € und 100.000 € liegen.' }
  return { cent, fehler: null }
}
