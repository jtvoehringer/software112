-- Migration 054: Sonstiges-Artikel-Katalog
-- Speichert häufig verkaufte Sonstiges-Produkte mit Einheit und Standardpreis

CREATE TABLE IF NOT EXISTS sonstige_artikel (
  id            uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     uuid          NOT NULL,
  name          text          NOT NULL,
  einheit       text          NOT NULL DEFAULT 'Stk',
  default_preis numeric(10,2),
  aktiv         boolean       NOT NULL DEFAULT true,
  erstellt_am   timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sonstige_artikel_tenant_idx ON sonstige_artikel (tenant_id);

ALTER TABLE sonstige_artikel ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sonstige_artikel_select" ON sonstige_artikel FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
CREATE POLICY "sonstige_artikel_insert" ON sonstige_artikel FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
CREATE POLICY "sonstige_artikel_update" ON sonstige_artikel FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
