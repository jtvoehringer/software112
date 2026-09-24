-- Migration 040: Per-User E-Mail-Verbindungen
-- Jeder User verbindet seine eigene Mailbox (M365 oder IMAP/SMTP)
-- Ersetzt die tenant-weite E-Mail-Konfiguration für den Nachrichten-Client

CREATE TABLE IF NOT EXISTS user_email_connections (
  id              uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       uuid          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_address   text          NOT NULL,
  anzeigename     text,

  -- M365 OAuth2
  m365_aktiv              boolean DEFAULT false,
  m365_access_token_enc   text,
  m365_refresh_token_enc  text,
  m365_token_expires_at   timestamptz,
  m365_webhook_sub_id     text,
  m365_webhook_expires    timestamptz,

  -- IMAP/SMTP Fallback
  imap_aktiv      boolean DEFAULT false,
  imap_host       text,
  imap_port       integer DEFAULT 993,
  imap_user       text,
  imap_pass_enc   text,
  smtp_host       text,
  smtp_port       integer DEFAULT 587,
  smtp_user       text,
  smtp_pass_enc   text,
  smtp_from_name  text,

  erstellt_am     timestamptz NOT NULL DEFAULT now(),
  aktualisiert_am timestamptz NOT NULL DEFAULT now(),

  UNIQUE(tenant_id, user_id)  -- ein Eintrag pro User pro Tenant
);

-- RLS: User sieht nur seine eigene Verbindung
ALTER TABLE user_email_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "uec_select" ON user_email_connections
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "uec_insert" ON user_email_connections
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND
    tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "uec_update" ON user_email_connections
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "uec_delete" ON user_email_connections
  FOR DELETE USING (user_id = auth.uid());

CREATE INDEX idx_uec_tenant_user ON user_email_connections(tenant_id, user_id);

NOTIFY pgrst, 'reload schema';
