-- Migration 109: Traubenverkauf
-- Weingarten: für Traubenverkauf freigegeben + Herkunfts-Code
ALTER TABLE weingarten
  ADD COLUMN IF NOT EXISTS trauben_verkauf     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS trauben_herkunft_code TEXT;

COMMENT ON COLUMN weingarten.trauben_verkauf IS 'Trauben aus diesem Weingarten können verkauft werden';
COMMENT ON COLUMN weingarten.trauben_herkunft_code IS 'Offizielles BKI-Herkunftskürzel (z.B. WLWV für Weinviertel)';

-- Traubenverkäufe
CREATE TABLE IF NOT EXISTS traubenverkauf (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  jahrgang_id      UUID        REFERENCES weinjahrgaenge(id),
  weingarten_id    UUID        NOT NULL REFERENCES weingarten(id),
  kontakt_id       UUID        REFERENCES kontakte(id),
  firma_id         UUID        REFERENCES firmen(id),
  datum            DATE        NOT NULL,
  menge_kg         NUMERIC(10,2) NOT NULL,
  preis_per_kg     NUMERIC(10,4),
  kmw_grad         NUMERIC(5,1),
  qualitaetsstufe  TEXT,
  herkunft_code    TEXT,
  notizen          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE traubenverkauf ENABLE ROW LEVEL SECURITY;

CREATE POLICY "traubenverkauf_select" ON traubenverkauf FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
CREATE POLICY "traubenverkauf_insert" ON traubenverkauf FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
CREATE POLICY "traubenverkauf_update" ON traubenverkauf FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
CREATE POLICY "traubenverkauf_delete" ON traubenverkauf FOR DELETE
  USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));

CREATE INDEX idx_traubenverkauf_tenant   ON traubenverkauf(tenant_id);
CREATE INDEX idx_traubenverkauf_datum    ON traubenverkauf(tenant_id, datum DESC);
CREATE INDEX idx_traubenverkauf_wg       ON traubenverkauf(weingarten_id);
