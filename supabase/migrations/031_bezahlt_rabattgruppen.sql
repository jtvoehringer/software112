-- Migration 031: Bezahlt-Status + Rabattgruppen + Rabatt in Positionen

-- ── Bezahlt-Status für Verkaufsposten ────────────────────────────────────────
ALTER TABLE verkaufsposten
  ADD COLUMN IF NOT EXISTS bezahlt    boolean     DEFAULT false,
  ADD COLUMN IF NOT EXISTS bezahlt_am timestamptz DEFAULT null;

-- ── Rabattgruppen ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rabattgruppen (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text        NOT NULL,             -- z.B. "Stammkunde", "Großhändler"
  rabatt_pct  numeric(5,2) NOT NULL DEFAULT 0,  -- z.B. 10.00 für 10%
  notizen     text,
  erstellt_am timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE rabattgruppen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rabattg_select" ON rabattgruppen
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "rabattg_write" ON rabattgruppen
  FOR ALL USING (
    user_has_role_in_tenant(tenant_id, ARRAY['tenant_admin', 'winzer'])
  );

-- ── Rabattgruppe-Referenz in Kontakten + Firmen ───────────────────────────────
ALTER TABLE kontakte ADD COLUMN IF NOT EXISTS rabattgruppe_id uuid REFERENCES rabattgruppen(id);
ALTER TABLE firmen   ADD COLUMN IF NOT EXISTS rabattgruppe_id uuid REFERENCES rabattgruppen(id);

-- ── Rabatt in Verkaufspositionen ──────────────────────────────────────────────
ALTER TABLE verkauf_positionen
  ADD COLUMN IF NOT EXISTS rabatt_pct       numeric(5,2) DEFAULT 0,   -- aus Rabattgruppe
  ADD COLUMN IF NOT EXISTS sonderrabatt_pct numeric(5,2) DEFAULT 0;   -- manuell
