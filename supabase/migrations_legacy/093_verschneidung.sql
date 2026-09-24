-- Migration 093: Verschneidungs-Schema (Blend-Protokoll)
-- Ermöglicht das Mischen mehrerer Chargen zu einer neuen Ziel-Charge
-- mit vollständiger Rückverfolgbarkeit (Quelle A: X%, Quelle B: Y%)

CREATE TABLE IF NOT EXISTS verschneidungen (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  datum           DATE NOT NULL,
  ziel_weinausbau_id UUID NOT NULL REFERENCES weinausbau(id) ON DELETE CASCADE,
  notizen         TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verschneidung_quellen (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  verschneidung_id    UUID NOT NULL REFERENCES verschneidungen(id) ON DELETE CASCADE,
  quell_weinausbau_id UUID NOT NULL REFERENCES weinausbau(id),
  menge_liter         NUMERIC(10,2),
  anteil_pct          NUMERIC(5,2)
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_verschneidungen_tenant   ON verschneidungen(tenant_id);
CREATE INDEX IF NOT EXISTS idx_verschneidungen_ziel     ON verschneidungen(ziel_weinausbau_id);
CREATE INDEX IF NOT EXISTS idx_verschn_quellen_vschneid ON verschneidung_quellen(verschneidung_id);
CREATE INDEX IF NOT EXISTS idx_verschn_quellen_quelle   ON verschneidung_quellen(quell_weinausbau_id);

-- RLS
ALTER TABLE verschneidungen        ENABLE ROW LEVEL SECURITY;
ALTER TABLE verschneidung_quellen  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON verschneidungen
  USING (tenant_id = (
    SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid() LIMIT 1
  ));

CREATE POLICY "tenant_isolation" ON verschneidung_quellen
  USING (verschneidung_id IN (
    SELECT id FROM verschneidungen WHERE tenant_id = (
      SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid() LIMIT 1
    )
  ));
