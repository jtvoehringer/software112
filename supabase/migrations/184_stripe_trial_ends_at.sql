-- Rückmeldung 31.8.2026 ("Trial-Ablauf: 14 Tage, dann Sperre wie bei unpaid"):
-- Stripe liefert bei einer trialing-Subscription trial_end mit - bisher wurde
-- das nirgends gespeichert, ein Mandant in Testphase hatte also nie ein
-- tatsächliches Ablaufdatum. Wird vom Webhook (customer.subscription.created/
-- updated) befüllt und von der Zugriffssperre in (dashboard)/layout.tsx sowie
-- /abo ausgewertet.
alter table tenants add column if not exists stripe_trial_ends_at timestamptz;
