-- Migration 106: Stripe Status Constraint erweitern
-- Stripe verwendet 'canceled' (ein l) + 'incomplete' / 'incomplete_expired'

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_stripe_status_check;

ALTER TABLE tenants ADD CONSTRAINT tenants_stripe_status_check
  CHECK (stripe_status IN (
    'trialing', 'active', 'past_due', 'canceled', 'cancelled',
    'unpaid', 'paused', 'incomplete', 'incomplete_expired'
  ));
