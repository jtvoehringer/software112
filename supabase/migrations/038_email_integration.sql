-- Migration 038: E-Mail-Integration (IMAP/SMTP Basic)
-- Bidirektionale E-Mail-Anbindung für beliebige Anbieter (GMX, Gmail, Outlook, etc.)

ALTER TABLE tenant_einstellungen
  -- SMTP (Ausgehend)
  ADD COLUMN IF NOT EXISTS email_modul_aktiv    boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_smtp_host      text,
  ADD COLUMN IF NOT EXISTS email_smtp_port      integer DEFAULT 587,
  ADD COLUMN IF NOT EXISTS email_smtp_user      text,
  ADD COLUMN IF NOT EXISTS email_smtp_pass_enc  text,  -- verschlüsselt
  ADD COLUMN IF NOT EXISTS email_smtp_from_name text,  -- Absendername
  -- IMAP (Eingehend)
  ADD COLUMN IF NOT EXISTS email_imap_host      text,
  ADD COLUMN IF NOT EXISTS email_imap_port      integer DEFAULT 993,
  ADD COLUMN IF NOT EXISTS email_imap_user      text,
  ADD COLUMN IF NOT EXISTS email_imap_pass_enc  text,  -- verschlüsselt
  ADD COLUMN IF NOT EXISTS email_last_poll      timestamptz;

NOTIFY pgrst, 'reload schema';
