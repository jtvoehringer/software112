-- Migration 039: Microsoft 365 / Graph API Integration
-- OAuth2-basierte E-Mail-Anbindung ohne Passwort-Sharing

ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS m365_modul_aktiv       boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS m365_tenant_id         text,    -- Azure AD Tenant ID
  ADD COLUMN IF NOT EXISTS m365_client_id         text,    -- App-Registrierung Client ID
  ADD COLUMN IF NOT EXISTS m365_client_secret_enc text,    -- verschlüsselt
  ADD COLUMN IF NOT EXISTS m365_user_email        text,    -- überwachte Mailbox
  ADD COLUMN IF NOT EXISTS m365_access_token_enc  text,    -- verschlüsselt, kurzlebig
  ADD COLUMN IF NOT EXISTS m365_refresh_token_enc text,    -- verschlüsselt, langlebig
  ADD COLUMN IF NOT EXISTS m365_token_expires_at  timestamptz,
  ADD COLUMN IF NOT EXISTS m365_webhook_sub_id    text,    -- Graph Subscription ID
  ADD COLUMN IF NOT EXISTS m365_webhook_expires   timestamptz;

NOTIFY pgrst, 'reload schema';
