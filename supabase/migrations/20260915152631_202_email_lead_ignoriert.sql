-- E-Mail → Lead (Rückmeldung 15.9.2026): Absender, für die unter Nachrichten kein
-- Lead-Dialog mehr angeboten wird („Nein, nicht mehr fragen“) - je Betrieb.

CREATE TABLE IF NOT EXISTS email_lead_ignoriert (
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email        text NOT NULL,
  grund        text,
  erstellt_von uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  erstellt_am  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, email)
);
COMMENT ON TABLE email_lead_ignoriert IS 'Absender, für die unter Nachrichten kein Lead-Dialog mehr angeboten wird („Nein, nicht mehr fragen“).';

ALTER TABLE email_lead_ignoriert ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_lead_ignoriert_select ON email_lead_ignoriert;
CREATE POLICY email_lead_ignoriert_select ON email_lead_ignoriert FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS email_lead_ignoriert_write ON email_lead_ignoriert;
CREATE POLICY email_lead_ignoriert_write ON email_lead_ignoriert FOR ALL
  USING (user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']))
  WITH CHECK (user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']));;
