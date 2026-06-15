import Stripe from 'stripe'

// Leerer Fallback-Key damit der Build-Prozess nicht crasht;
// zur Laufzeit auf Vercel ist STRIPE_SECRET_KEY gesetzt.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', {
  apiVersion: '2025-02-24.acacia',
})

/** Stripe-Plan-Labels für die UI */
export const STRIPE_PLAN_LABELS: Record<string, string> = {
  base:         'software:112 Basis',
  ki_basic:     'software:112 + KI Basic',
  ki_standard:  'software:112 + KI Standard',
  ki_unlimited: 'software:112 + KI Unlimited',
}

/** Stripe-Status-Labels und Farben */
export const STRIPE_STATUS_META: Record<string, { label: string; color: string }> = {
  trialing:  { label: '🔵 Testphase',     color: 'bg-blue-100 text-blue-700' },
  active:    { label: '✅ Aktiv',          color: 'bg-green-100 text-green-700' },
  past_due:  { label: '⚠️ Zahlung offen', color: 'bg-amber-100 text-amber-700' },
  unpaid:    { label: '🔴 Unbezahlt',     color: 'bg-red-100 text-red-700' },
  cancelled: { label: '⛔ Gekündigt',     color: 'bg-gray-100 text-gray-600' },
  paused:    { label: '⏸ Pausiert',       color: 'bg-gray-100 text-gray-600' },
}
