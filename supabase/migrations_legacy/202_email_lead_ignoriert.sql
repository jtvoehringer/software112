-- E-Mail → Lead (Rückmeldung 15.9.2026): Öffnet jemand unter Nachrichten eine
-- E-Mail, deren Absender weder Kontakt noch Firma (noch Lead) ist, fragt die
-- Plattform „Soll ein Lead angelegt werden?“ und belegt Kontakt/Firma aus der
-- Signatur vor (KI, wie beim Visitenkarten-Scan). Sagt der Benutzer „Nein,
-- nicht mehr fragen“, landet die Absenderadresse hier - je Betrieb, damit der
-- Dialog bei Newslettern, Lieferanten-Portalen usw. nicht wiederkommt.

CREATE TABLE IF NOT EXISTS email_lead_ignoriert (
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email        text NOT NULL,                     -- Absenderadresse, klein geschrieben
  grund        text,                              -- optional (z. B. „Newsletter“)
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
  WITH CHECK (user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']));
