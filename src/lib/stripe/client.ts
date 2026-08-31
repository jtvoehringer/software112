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
  trialing:           { label: 'Testphase',          color: 'bg-blue-100 text-blue-700' },
  active:             { label: 'Aktiv',               color: 'bg-green-100 text-green-700' },
  past_due:           { label: 'Zahlung offen',      color: 'bg-amber-100 text-amber-700' },
  unpaid:             { label: 'Unbezahlt',          color: 'bg-red-100 text-red-700' },
  canceled:           { label: 'Gekündigt',          color: 'bg-gray-100 text-gray-600' },
  cancelled:          { label: 'Gekündigt',          color: 'bg-gray-100 text-gray-600' },
  paused:             { label: 'Pausiert',            color: 'bg-gray-100 text-gray-600' },
  incomplete:         { label: 'Zahlung ausstehend', color: 'bg-yellow-100 text-yellow-700' },
  incomplete_expired: { label: 'Abgelaufen',         color: 'bg-gray-100 text-gray-500' },
}

// Rückmeldung 31.8.2026 ("die Plattform soll sich selber abrechnen können,
// damit wir zu unserem Geld kommen"): stripe_status wurde bisher nirgends
// außerhalb der Admin-Seiten und des Webhooks gelesen - ein Mandant mit
// abgelaufenem/gekündigtem Abo hatte trotzdem uneingeschränkten Zugriff.
// Diese Status führen jetzt zur Zugriffssperre (siehe (dashboard)/layout.tsx,
// leitet auf /abo um). 'past_due' ist bewusst NICHT dabei - Stripes eigenes
// Dunning eskaliert fehlgeschlagene Zahlungsversuche nach einigen Tagen
// automatisch zu 'unpaid' (das dann sperrt); bis dahin gibt's im Layout nur
// eine Warnung mit Link zur Selbstverwaltung.
export const STRIPE_BLOCKED_STATUSES = ['unpaid', 'canceled', 'cancelled', 'incomplete', 'incomplete_expired', 'paused']
