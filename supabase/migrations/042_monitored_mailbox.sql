-- Migration 042: Shared Mailbox Überwachung
-- Shared/Funktionale Mailbox Überwachung
ALTER TABLE user_email_connections
  ADD COLUMN IF NOT EXISTS monitored_email text;
NOTIFY pgrst, 'reload schema';
