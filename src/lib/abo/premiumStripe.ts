// ── Premium-Support über Stripe (KAN-226 Teil 2, 08.10.2026) ────────────────────────────────────────────
//
// Premium-Support ist eine zusätzliche Position im bestehenden Stripe-Abo (Preis STRIPE_PRICE_PREMIUM_SUPPORT,
// 79 € netto/Monat), markiert mit metadata s112_art = 'premium_support' und s112_tenant_id (im Abrechnungsverbund teilen
// sich mehrere Betriebe einen Stripe-Kunden). Buchen fügt die Position hinzu (anteilig ab heute), Kündigen entfernt sie
// ohne Gutschrift – das Kennzeichen tenants.premium_support_bis steht dann auf dem Monatsende (Entscheidung KAN-226).
// Der Webhook gleicht nach: Position neu im Abo → seit heute; Position entfernt bzw. Abo beendet → bis Monatsende.
// Beendet wird nur, was über Stripe gebucht war (Position vorher vorhanden) – eine vom Plattform-Admin gesetzte
// Buchung ohne Stripe (z. B. Pilotbetrieb) bleibt bei anderen Abo-Ereignissen unangetastet.
// Isomorph und ohne '@/'-Importe (node:test).

export const PREMIUM_ART = 'premium_support'

export type PremiumPosition = { id: string; priceId: string | null; metadata: Record<string, string> }
export type PremiumZeitraum = { seit: string | null; bis: string | null }

/** Premium-Position eines Betriebs im Abo – über das Kennzeichen, sonst (ohne Betriebs-Kennzeichen) über die Preis-ID */
export function premiumPositionFuer<T extends PremiumPosition>(positionen: readonly T[], tenantId: string, preisId: string | null): T | null {
  return positionen.find(p => p.metadata?.s112_art === PREMIUM_ART && (p.metadata.s112_tenant_id ?? tenantId) === tenantId)
    ?? (preisId ? positionen.find(p => p.priceId === preisId && !p.metadata?.s112_tenant_id && p.metadata?.s112_art !== PREMIUM_ART) ?? null : null)
}

/**
 * Neuer Stand des Kennzeichens nach einem Abo-Ereignis – null = unverändert.
 * jetzt/vorher: Premium-Position im Abo nach bzw. vor dem Ereignis (vorher = jetzt, wenn sich die Positionen nicht
 * geändert haben); aboBeendet: das ganze Abo ist beendet.
 */
export function premiumAbgleichPlan(e: {
  jetzt: boolean; vorher: boolean; aboBeendet: boolean; bisher: PremiumZeitraum; heute: string; monatsende: string
}): PremiumZeitraum | null {
  const aktiv = !!e.bisher.seit && (!e.bisher.bis || e.bisher.bis >= e.heute)
  if (e.jetzt && !e.aboBeendet) {
    if (!aktiv) return { seit: e.heute, bis: null }                          // neu bzw. nach Ende wieder gebucht
    if (e.bisher.bis) return { seit: e.bisher.seit, bis: null }              // Kündigung zurückgenommen
    return null
  }
  // Position entfernt bzw. Abo beendet: nur beenden, was über Stripe lief
  const warUeberStripe = e.vorher || (e.aboBeendet && e.jetzt)
  if (warUeberStripe && aktiv && !e.bisher.bis) return { seit: e.bisher.seit, bis: e.monatsende }
  return null
}

/** Darf gebucht werden? (Prüfung vor dem Stripe-Aufruf) */
export function buchenFehler(e: { darfVerwalten: boolean; preisId: string | null; hatAbo: boolean; abrechnungUeber: boolean; aktivUnbefristet: boolean }): string | null {
  if (!e.darfVerwalten) return 'Nur die Betriebsleitung kann Premium-Support buchen oder kündigen.'
  if (e.abrechnungUeber) return 'Ihr Betrieb wird über einen anderen Betrieb abgerechnet – bitte wenden Sie sich an uns.'
  if (!e.preisId) return 'Premium-Support ist noch nicht direkt buchbar – bitte wenden Sie sich an uns.'
  if (!e.hatAbo) return 'Für Ihren Betrieb gibt es noch kein Abo – bitte zuerst die Zahlungsdaten hinterlegen.'
  if (e.aktivUnbefristet) return 'Premium-Support ist bereits gebucht.'
  return null
}
