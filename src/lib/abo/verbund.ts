// ── Hauptmandant und Submandanten (KAN-215, 06.10.2026; KAN-214, 08.10.2026) ──────────────────────────────────────
//
// Ein Betrieb mit mehreren Mandanten (z. B. Weingut Johannes Gebeshuber und Spaetrot Gebeshuber GmbH): Der
// Hauptmandant hat das Premium-Paket (Pflicht), Submandanten werden über ihn geführt. Entscheidungen Jörgen (KAN-214):
//  - Ein Submandant kostet 0 € – keine Zusatzposition im Stripe-Abo mehr (bis KAN-214: Zusatzmandant mit Standard-
//    oder vereinbartem Preis). Voraussetzung ist nur Premium beim Hauptmandanten, ein Stripe-Abo ist nicht nötig
//    (Pilotbetriebe ohne Stripe, KAN-11).
//  - Submandanten übernehmen Stripe-Kunde, -Abo, Status und Testphase des Hauptmandanten (falls vorhanden); der Webhook
//    spiegelt sie dann in alle Betriebe derselben Kunden-ID. Paket: Premium.
//  - CRM und Kellergebinde gemeinschaftlich: beim Beitritt Keller- und CRM-Freigaben in beide Richtungen.
//  - Support-Anfragen laufen unter dem Hauptmandanten (JSM-Organisation, lib/support/kontext.ts); der Newsletter geht in
//    der Regel aus dem Hauptmandanten (Brevo des Hauptmandanten).
//  - Austritt: mit geteiltem Stripe-Abo → Nur-Lesen (Status „cancelled“), bis ein eigenes Abo abgeschlossen ist; ohne
//    Stripe-Abo bleibt der Status unverändert.
// Isomorph und ohne Stripe-SDK (Tests: scripts/tests/kan215-verbund.test.mjs, kan214-submandant.test.mjs).

import { paketAusPlan, type PaketKey } from '@/lib/pakete'
import { PREMIUM_ART } from '@/lib/abo/premiumStripe'

type R = Record<string, unknown>

/** Kennzeichen der Zusatzmandanten-Positionen im Stripe-Abo (metadata.s112_art) – seit KAN-214 keine neuen mehr, die
 *  Paket-Erkennung überspringt etwaige Altpositionen weiter */
export const ZUSATZ_STANDARD = 'zusatzmandant_standard'
export const ZUSATZ_EINZELN = 'zusatzmandant'

/** Position eines Stripe-Abos (aus subscriptions.retrieve → items.data) */
export type AboPosition = {
  id: string
  priceId: string | null
  /** Einzelpreis in Cent (price.unit_amount) */
  betragCent: number | null
  quantity: number
  metadata: Record<string, string>
}

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

/** Zeile aus tenants (Spalten für die Verbund-Prüfung) */
export type VerbundBetrieb = {
  id: string
  name: string
  abrechnung_ueber: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  stripe_plan: string | null
}

/** Darf `neben` Submandant von `haupt` werden? null = ja, sonst die Meldung */
export function beitrittFehler(neben: VerbundBetrieb, haupt: VerbundBetrieb, hatSelbstNebenmandanten: boolean): string | null {
  if (neben.id === haupt.id) return 'Ein Betrieb kann nicht über sich selbst abgerechnet werden.'
  if (haupt.abrechnung_ueber) return `${haupt.name} wird selbst über einen anderen Betrieb abgerechnet und kann kein Hauptmandant sein.`
  if (hatSelbstNebenmandanten) return `${neben.name} ist Hauptmandant und kann nicht selbst Submandant werden.`
  if (neben.abrechnung_ueber && neben.abrechnung_ueber !== haupt.id) return `${neben.name} wird bereits über einen anderen Betrieb abgerechnet – zuerst austreten.`
  // KAN-214: nur Premium ist Pflicht, ein Stripe-Abo nicht (Submandant 0 €; Pilotbetriebe ohne Stripe)
  if (paketAusPlan(haupt.stripe_plan) !== 'premium') return `Submandanten setzen das Premium-Paket beim Hauptmandanten voraus (${haupt.name}).`
  if (neben.stripe_subscription_id && neben.stripe_subscription_id !== haupt.stripe_subscription_id) {
    return `${neben.name} hat ein eigenes Stripe-Abo – dieses bitte zuerst kündigen, damit nicht doppelt abgerechnet wird.`
  }
  return null
}

/** Paketwechsel des Hauptmandanten: unter Premium nur ohne Nebenmandanten */
export function paketwechselVerbundFehler(paket: PaketKey, anzahlNeben: number): string | null {
  if (paket === 'premium' || anzahlNeben === 0) return null
  return `Ihr Betrieb führt ${anzahlNeben === 1 ? 'einen Submandanten' : `${anzahlNeben} Submandanten`} – das setzt Premium voraus. Für einen Wechsel zuerst die Submandanten lösen (Plattform-Admin).`
}

/** Spalten des Submandanten beim Beitritt: Stripe-Kunde, -Abo, Status, Paket, Periode und Testphase des Hauptmandanten */
export function beitrittsWerte(haupt: R): R {
  return {
    abrechnung_ueber: haupt.id,
    zusatz_preis_cent: null,   // KAN-214: Submandant 0 €
    stripe_customer_id: haupt.stripe_customer_id ?? null,
    stripe_subscription_id: haupt.stripe_subscription_id ?? null,
    stripe_status: haupt.stripe_status ?? null,
    stripe_plan: 'premium',
    stripe_current_period_end: haupt.stripe_current_period_end ?? null,
    stripe_trial_ends_at: haupt.stripe_trial_ends_at ?? null,
  }
}

/**
 * Spalten beim Austritt: mit geteiltem Stripe-Abo gekündigt → Nur-Lesen, bis ein eigenes Abo abgeschlossen ist;
 * ohne Stripe-Abo (KAN-214, Pilotbetrieb) bleibt der Status, wie er ist.
 */
export function austrittsWerte(mitAbo: boolean): R {
  return {
    abrechnung_ueber: null,
    zusatz_preis_cent: null,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    ...(mitAbo ? { stripe_status: 'cancelled' } : {}),
    stripe_current_period_end: null,
    stripe_trial_ends_at: null,
  }
}

/** Freigaben für die Gemeinschaft Haupt- ↔ Submandant (Keller und CRM, beide Richtungen) */
export function gemeinschaftsFreigaben(hauptId: string, subId: string): { eigentuemer_tenant_id: string; nutzer_tenant_id: string; aktiv: true; notizen: string }[] {
  const notizen = 'Hauptmandant/Submandant (KAN-214)'
  return [
    { eigentuemer_tenant_id: hauptId, nutzer_tenant_id: subId, aktiv: true, notizen },
    { eigentuemer_tenant_id: subId, nutzer_tenant_id: hauptId, aktiv: true, notizen },
  ]
}
