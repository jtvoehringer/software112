// ── Hauptmandant und Submandanten (KAN-215, 06.10.2026; KAN-214, 08.10.2026) ──────────────────────────────────────
//
// Ein Betrieb mit mehreren Mandanten (z. B. Weingut Johannes Gebeshuber und Spaetrot Gebeshuber GmbH): Submandanten
// werden über den Hauptmandanten geführt. Entscheidungen Jörgen (KAN-214):
//  - Ein Submandant kostet 0 € – keine Zusatzposition im Stripe-Abo mehr (bis KAN-214: Zusatzmandant mit Standard-
//    oder vereinbartem Preis). Ein Stripe-Abo ist nicht nötig (Pilotbetriebe ohne Stripe, KAN-11).
//  - KAN-403 (Vertrag v3, NV 2.3, 10.11.2026): Mandanten je Paket inkl. Hauptmandant – Basis 1, Standard 2, Premium 5
//    (PAKETE[…].maxMandanten); bis dahin nur Premium, ohne Obergrenze. Benutzerlimit je Mandant; die Mandanten müssen
//    nicht demselben Inhaber gehören, Vertragspartner ist der Hauptmandant.
//  - Submandanten übernehmen Stripe-Kunde, -Abo, Status und Paket des Hauptmandanten (falls vorhanden); der Webhook
//    spiegelt sie dann in alle Betriebe derselben Kunden-ID, ein Paketwechsel auf /abo bzw. in der Administration
//    schreibt das Paket in die Submandanten mit (wendePaketAufSubmandantenAn, lib/pakete-server.ts).
//  - CRM und Kellergebinde gemeinschaftlich: beim Beitritt Keller- und CRM-Freigaben in beide Richtungen.
//  - Support-Anfragen laufen unter dem Hauptmandanten (JSM-Organisation, lib/support/kontext.ts); der Newsletter geht in
//    der Regel aus dem Hauptmandanten (Brevo des Hauptmandanten).
//  - Austritt: mit geteiltem Stripe-Abo → Nur-Lesen (Status „cancelled“), bis ein eigenes Abo abgeschlossen ist; ohne
//    Stripe-Abo bleibt der Status unverändert.
// Isomorph und ohne Stripe-SDK (Tests: scripts/tests/kan215-verbund.test.mjs, kan214-submandant.test.mjs).

import { paketAusPlan, PAKETE, type PaketKey } from '@/lib/pakete'
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

/** Submandanten, die ein Paket neben dem Hauptmandanten erlaubt (KAN-403: Basis 0, Standard 1, Premium 4) */
export function erlaubteSubmandanten(paket: PaketKey | null): number {
  return paket ? PAKETE[paket].maxMandanten - 1 : 0
}

/** „1 Mandant“ / „bis zu 2 Mandanten“ für Meldungen und Anzeige */
export function mandantenText(paket: PaketKey): string {
  const n = PAKETE[paket].maxMandanten
  return n === 1 ? '1 Mandant' : `bis zu ${n} Mandanten`
}

/**
 * Darf `neben` Submandant von `haupt` werden? null = ja, sonst die Meldung.
 * `andereSubmandanten`: Submandanten des Hauptmandanten ohne `neben` selbst (KAN-403: Obergrenze je Paket).
 */
export function beitrittFehler(neben: VerbundBetrieb, haupt: VerbundBetrieb, hatSelbstNebenmandanten: boolean, andereSubmandanten: number): string | null {
  if (neben.id === haupt.id) return 'Ein Betrieb kann nicht über sich selbst abgerechnet werden.'
  if (haupt.abrechnung_ueber) return `${haupt.name} wird selbst über einen anderen Betrieb abgerechnet und kann kein Hauptmandant sein.`
  if (hatSelbstNebenmandanten) return `${neben.name} ist Hauptmandant und kann nicht selbst Submandant werden.`
  if (neben.abrechnung_ueber && neben.abrechnung_ueber !== haupt.id) return `${neben.name} wird bereits über einen anderen Betrieb abgerechnet – zuerst austreten.`
  // KAN-214: ein Stripe-Abo ist nicht nötig (Submandant 0 €; Pilotbetriebe ohne Stripe)
  // KAN-403: Submandanten ab Standard, Obergrenze je Paket des Hauptmandanten
  const paket = paketAusPlan(haupt.stripe_plan)
  if (!paket) return `${haupt.name} hat kein Paket – Submandanten setzen Standard oder Premium beim Hauptmandanten voraus.`
  const erlaubt = erlaubteSubmandanten(paket)
  if (erlaubt === 0) return `Das Paket ${PAKETE[paket].label} von ${haupt.name} umfasst ${mandantenText(paket)} – für Submandanten ist Standard (bis zu 2) oder Premium (bis zu 5 Mandanten) nötig.`
  if (andereSubmandanten >= erlaubt) {
    return `Das Paket ${PAKETE[paket].label} von ${haupt.name} umfasst ${mandantenText(paket)} – ${andereSubmandanten === 1 ? 'ein Submandant ist' : `${andereSubmandanten} Submandanten sind`} bereits zugeordnet.${paket === 'premium' ? '' : ' Für mehr Mandanten ist Premium nötig (bis zu 5).'}`
  }
  if (neben.stripe_subscription_id && neben.stripe_subscription_id !== haupt.stripe_subscription_id) {
    return `${neben.name} hat ein eigenes Stripe-Abo – dieses bitte zuerst kündigen, damit nicht doppelt abgerechnet wird.`
  }
  return null
}

/** Paketwechsel des Hauptmandanten: nur, wenn das neue Paket die bestehenden Submandanten umfasst (KAN-403) */
export function paketwechselVerbundFehler(paket: PaketKey, anzahlNeben: number): string | null {
  if (anzahlNeben <= erlaubteSubmandanten(paket)) return null
  const zuViel = anzahlNeben - erlaubteSubmandanten(paket)
  return `Ihr Betrieb führt ${anzahlNeben === 1 ? 'einen Submandanten' : `${anzahlNeben} Submandanten`}, das Paket ${PAKETE[paket].label} umfasst ${mandantenText(paket)}. Für einen Wechsel zuerst ${zuViel === 1 ? 'einen Submandanten' : `${zuViel} Submandanten`} lösen (Plattform-Admin).`
}

/** Spalten des Submandanten beim Beitritt: Stripe-Kunde, -Abo, Status, Paket (KAN-403: das des Hauptmandanten statt
 *  fest Premium), Periode und Testphase des Hauptmandanten */
export function beitrittsWerte(haupt: R): R {
  return {
    abrechnung_ueber: haupt.id,
    zusatz_preis_cent: null,   // KAN-214: Submandant 0 €
    stripe_customer_id: haupt.stripe_customer_id ?? null,
    stripe_subscription_id: haupt.stripe_subscription_id ?? null,
    stripe_status: haupt.stripe_status ?? null,
    stripe_plan: paketAusPlan(haupt.stripe_plan as string | null) ?? null,
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
