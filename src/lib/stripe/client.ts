import Stripe from 'stripe'

let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('STRIPE_SECRET_KEY nicht gesetzt')
    _stripe = new Stripe(key, { apiVersion: '2025-02-24.acacia' })
  }
  return _stripe
}

/** Stripe-Plan-Labels für die UI */
export const STRIPE_PLAN_LABELS: Record<string, string> = {
  base:         'software:112 Starter',
  ki_basic:     'software:112 Professional',
  ki_standard:  'software:112 Professional+',
  ki_unlimited: 'software:112 Enterprise',
}

/** Stripe-Status-Labels und Farben */
export const STRIPE_STATUS_META: Record<string, { label: string; color: string }> = {
  trialing:           { label: '🔵 Testphase',          color: 'bg-blue-100 text-blue-700' },
  active:             { label: '✅ Aktiv',               color: 'bg-green-100 text-green-700' },
  past_due:           { label: '⚠️ Zahlung offen',      color: 'bg-amber-100 text-amber-700' },
  unpaid:             { label: '🔴 Unbezahlt',          color: 'bg-red-100 text-red-700' },
  canceled:           { label: '⛔ Gekündigt',          color: 'bg-gray-100 text-gray-600' },
  