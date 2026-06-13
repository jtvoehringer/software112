-- Migration 096: Transportbescheinigung + Prüfnummernantrag Formulare
-- Offizielle Weingesetz-Formulare als editierbare, gespeicherte Dokumente

-- ── betrieb_betriebsnummer in tenant_einstellungen ──────────────────────────
ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS betrieb_betriebsnummer text; -- Weinbau-Betriebsnummer (z.B. 4489781)

-- ── Transportbescheinigungen ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transportbescheinigungen (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           UUID        NOT NULL,
  verkaufsposten_id   UUID        REFERENCES verkaufsposten(id) ON DELETE SET NULL,
  formular_daten      JSONB       NOT NULL DEFAULT '{}',
  erstellt_am         TIMESTAMPTZ NOT NULL DEFAULT now(),
  aktualisiert_am     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE transportbescheinigungen ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tb_select" ON transportbescheinigungen;
DROP POLICY IF EXISTS "tb_insert" ON transportbescheinigungen;
DROP POLICY IF EXISTS "tb_update" ON transportbescheinigungen;
DROP POLICY IF EXISTS "tb_delete" ON transportbescheinigungen;

CREATE POLICY "tb_select" ON transportbescheinigungen FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
CREATE POLICY "tb_insert" ON transportbescheinigungen FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
CREATE POLICY "tb_update" ON transportbescheinigungen FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
CREATE POLICY "tb_delete" ON transportbescheinigungen FOR DELETE
  USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));

-- ── Prüfnummernanträge ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pruefnummernantraege (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       UUID        NOT NULL,
  dac_antrag_id   UUID        REFERENCES dac_antrag(id) ON DELETE SET NULL,
  formular_daten  JSONB       NOT NULL DEFAULT '{}',
  erstellt_am     TIMESTAMPTZ NOT NULL DEFAULT now(),
  aktualisiert_am TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE pruefnummernantraege ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pna_select" ON pruefnummernantraege;
DROP POLICY IF EXISTS "pna_insert" ON pruefnummernantraege;
DROP POLICY IF EXISTS "pna_update" ON pruefnummernantraege;
DROP POLICY IF EXISTS "pna_delete" ON pruefnummernantraege;

CREATE POLICY "pna_select" ON pruefnummernantraege FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
CREATE POLICY "pna_insert" ON pruefnummernantraege FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
CREATE POLICY "pna_update" ON pruefnummernantraege FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
CREATE POLICY "pna_delete" ON pruefnummernantraege FOR DELETE
  USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
