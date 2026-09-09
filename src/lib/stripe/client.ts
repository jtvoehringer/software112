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

/** Stripe-Plan-Labels für die UI. Seit 2.9.2026 gilt das Paketmodell
 *  Basis / Standard / Premium (lib/pakete.ts); die alten Slugs bleiben lesbar,
 *  bis der nächste Subscription-Event den Mandanten auf ein neues Paket setzt. */
export const STRIPE_PLAN_LABELS: Record<string, string> = {
  basis:        'software:112 Basis',
  standard:     'software:112 Standard',
  premium:      'software:112 Premium',
  base:         'software:112 Starter (alt)',
  ki_basic:     'software:112 Professional (alt)',
  ki_standard:  'software:112 Professional+ (alt)',
  ki_unlimited: 'software:112 Enterprise (alt)',
}

/** Stripe-Status-Labels und Farben */
export const STRIPE_STATUS_META: Record<string, { label: string; color: string }> = {
  trialing:           { label: 'Testphase',          color: 'bg-s112-blue-100 text-s112-blue-700' },
  active:             { label: 'Aktiv',               color: 'bg-s112-ok-bg text-s112-ok-fg' },
  past_due:           { label: 'Zahlung offen',      color: 'bg-s112-warn-bg text-s112-warn-fg' },
  unpaid:             { label: 'Unbezahlt',          color: 'bg-s112-err-bg text-s112-err-fg' },
  canceled:           { label: 'Gekündigt',          color: 'bg-[#F2F3F5] text-s112-text-2' },
  cancelled:          { label: 'Gekündigt',          color: 'bg-[#F2F3F5] text-s112-text-2' },
  paused:             { label: 'Pausiert',            color: 'bg-[#F2F3F5] text-s112-text-2' },
  incomplete:         { label: 'Zahlung ausstehend', color: 'bg-s112-warn-bg text-s112-warn-fg' },
  incomplete_expired: { label: 'Abgelaufen',         color: 'bg-[#F2F3F5] text-s112-text-2' },
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

// Rückmeldung 31.8.2026 ("Trial-Ablauf: 14 Tage, dann Sperre wie bei unpaid"):
// 'trialing' bleibt bewusst NICHT in STRIPE_BLOCKED_STATUSES (sonst wäre jede
// laufende Testphase sofort gesperrt) - stattdessen sperrt eine trialing-
// Subscription erst, wenn das von Stripe gelieferte trial_end (14 Tage nach
// Checkout, dort als trial_period_days konfiguriert) in der Vergangenheit
// liegt. Zentral hier statt doppelt in layout.tsx und /abo gepflegt.
export function istTrialAbgelaufen(stripeStatus: string | null, trialEndsAt: string | null): boolean {
  return stripeStatus === 'trialing' && !!trialEndsAt && new Date(trialEndsAt).getTime() < Date.now()
}

/** Länge der kostenlosen Testphase beim Self-Service-Signup (Rückmeldung 31.8.2026). */
export const TRIAL_TAGE = 14
