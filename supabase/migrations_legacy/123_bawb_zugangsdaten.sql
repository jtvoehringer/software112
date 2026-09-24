-- Migration 123: bawb.at Zugangsdaten pro Mandant
-- Speichert LFRZ-Online Kennung + Passwort in tenant_einstellungen

ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS bawb_kennung  text,
  ADD COLUMN IF NOT EXISTS bawb_passwort text;

COMMENT ON COLUMN tenant_einstellungen.bawb_kennung  IS 'LFRZ Weinkontrolle – Kennung (Betriebsnummer)';
COMMENT ON COLUMN tenant_einstellungen.bawb_passwort IS 'LFRZ Weinkontrolle – Passwort';
