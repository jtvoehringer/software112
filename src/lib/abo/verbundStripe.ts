import 'server-only'

// ── Abrechnungsverbund: Zusatzmandanten-Positionen im Stripe-Abo des Hauptmandanten (KAN-215) ────────────────────────
// Lädt das Abo, plant die Positionen (lib/abo/verbund.ts: zusatzPositionenPlan) und schreibt die Änderungen anteilig für
// den laufenden Monat (proration). Stripe zuerst, danach die Datenbank – scheitert Stripe, bleibt der Verbund unverändert.

import type Stripe from 'stripe'
import { aboPositionAus, zusatzPositionenPlan, type Nebenmandant } from '@/lib/abo/verbund'

export function verbundKonfig() {
  return {
    standardPreisId: process.env.STRIPE_PRICE_ZUSATZMANDANT?.trim() || null,
    produktId: process.env.STRIPE_PRODUCT_ZUSATZMANDANT?.trim() || null,
  }
}

/** Positionen des Abos auf die Nebenmandanten abstimmen – Fehlertext oder null */
export async function verbundStripeAbgleichen(stripe: Stripe, aboId: string, neben: readonly Nebenmandant[]): Promise<string | null> {
  try {
    const abo = await stripe.subscriptions.retrieve(aboId)
    const bestehend = (abo.items?.data ?? []).map(i => aboPositionAus(i as unknown as Record<string, unknown>))
    const plan = zusatzPositionenPlan(neben, bestehend, verbundKonfig())
    if (plan.fehler) return plan.fehler
    if (plan.aenderungen.length === 0) return null
    await stripe.subscriptions.update(aboId, {
      items: plan.aenderungen as Stripe.SubscriptionUpdateParams.Item[],
      proration_behavior: 'create_prorations',
    })
    return null
  } catch (err) {
    return `Stripe-Fehler: ${(err as Error).message}`
  }
}
