-- Migration 044: Email-ID in Aktivitäten
-- Verknüpft CRM-Aktivitäten mit konkreten E-Mails in /nachrichten

ALTER TABLE aktivitaeten
  ADD COLUMN IF NOT EXISTS email_id              text,         -- Microsoft Graph Message ID
  ADD COLUMN IF NOT EXISTS email_conversation_id text;         -- Microsoft Graph ConversationId

-- Eindeutiger Index für Deduplication (eine Aktivität pro Email)
CREATE UNIQUE INDEX IF NOT EXISTS idx_aktivitaeten_email_id
  ON aktivitaeten(tenant_id, email_id)
  WHERE email_id IS NOT NULL;
