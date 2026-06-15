-- Migration 105: Stripe SaaS-Abrechnung
-- IC&P rechnet Mandanten monatlich über Stripe ab.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS stripe_customer_id      text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id  text,
  ADD COLUMN IF NOT EXISTS stripe_status           text
    CHECK (stripe_status IN ('trialing','active','past_due','cancelled','unpaid','paused')),
  ADD COLUMN IF NOT EXISTS stripe_plan             text,
  ADD COLUMN IF NOT EXISTS stripe_current_period_end timestamptz;

-- Index für Webhook-Lookup (subscription_id kommt von Stripe)
CREATE UNIQUE INDEX IF NOT EXISTS tenants_stripe_customer_idx      ON tenants (stripe_customer_id)     WHERE stripe_customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_stripe_subscription_idx  ON tenants (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

COMMENT ON COLUMN tenants.stripe_customer_id      IS 'Stripe Customer ID (cus_…)';
COMMENT ON COLUMN tenants.stripe_subscription_id  IS 'Stripe Subscription ID (sub_…)';
COMMENT ON COLUMN tenants.stripe_status           IS 'Aktueller Abo-Status laut Stripe Webhook';
COMMENT ON COLUMN tenants.stripe_plan             IS 'Stripe Price ID oder Planname (z.B. price_xyz oder "base")';
COMMENT ON COLUMN tenants.stripe_current_period_end IS 'Ende des aktuellen Abrechnungszeitraums (aus Stripe)';
