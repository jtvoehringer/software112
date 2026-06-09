-- Migration 041: Kostenrechnung
-- Kostenstellen, Kostenarten, manuelle Kostenbuchungen

CREATE TABLE kostenstellen (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  kuerzel     text,
  beschreibung text,
  aktiv       boolean NOT NULL DEFAULT true,
  erstellt_am timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kostenarten (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  kuerzel     text,
  kategorie   text CHECK (kategorie IN ('betriebsmittel','personal','energie','abschreibung','pacht','sonstiges')),
  aktiv       boolean NOT NULL DEFAULT true
);

CREATE TABLE kosteneintraege (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kostenstelle_id uuid REFERENCES kostenstellen(id) ON DELETE SET NULL,
  kostenart_id    uuid REFERENCES kostenarten(id) ON DELETE SET NULL,
  datum           date NOT NULL DEFAULT current_date,
  betrag          numeric(10,2) NOT NULL,
  beschreibung    text,
  periode         text,  -- YYYY-MM für Auswertungen
  erstellt_am     timestamptz NOT NULL DEFAULT now()
);

-- Standardkostenstellen + Kostenarten (werden per INSERT nach Migration angelegt)
ALTER TABLE kostenstellen ENABLE ROW LEVEL SECURITY;
ALTER TABLE kostenarten   ENABLE ROW LEVEL SECURITY;
ALTER TABLE kosteneintraege ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ks_tenant" ON kostenstellen USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
CREATE POLICY "ka_tenant" ON kostenarten   USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
CREATE POLICY "ke_tenant" ON kosteneintraege USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
CREATE POLICY "ke_insert" ON kosteneintraege FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
CREATE POLICY "ke_update" ON kosteneintraege FOR UPDATE USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
CREATE POLICY "ke_delete" ON kosteneintraege FOR DELETE USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));

NOTIFY pgrst, 'reload schema';
