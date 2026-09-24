-- Migration 211 (18.9.2026): mehrere E-Mail-Adressen je Account
-- Rückmeldung: "Accounts müssen mehrere E-Mails hinterlegen können. Wir
-- identifizieren eine Standard-E-Mail (Newsletter, Rechnung …) und weitere
-- E-Mails für Sonstiges."
-- kontakte.email / firmen.email bleibt die Standardadresse (Newsletter,
-- Rechnungsversand, Antworten); email_weitere nimmt beliebig viele weitere
-- Adressen auf. Absender-Erkennung (lib/crm/absender.ts), E-Mail-Spiegelung und
-- Graph-Webhook matchen über alle Adressen.
ALTER TABLE kontakte ADD COLUMN IF NOT EXISTS email_weitere text[] NOT NULL DEFAULT '{}';
ALTER TABLE firmen   ADD COLUMN IF NOT EXISTS email_weitere text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS kontakte_email_weitere_gin ON kontakte USING gin (email_weitere);
CREATE INDEX IF NOT EXISTS firmen_email_weitere_gin   ON firmen   USING gin (email_weitere);
