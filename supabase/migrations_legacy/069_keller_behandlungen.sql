-- Migration 069: Kellerbehandlungen
-- keller_behandlungstypen: mandantenspezifische Behandlungstypen (mit Defaults)
-- keller_behandlungen:     Kellermaßnahmen pro Behälter

-- ── Behandlungstypen ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS keller_behandlungstypen (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            text NOT NULL,
  einheit_standard text,           -- Vorschlag für Einheit (kg, g, L, mL, -)
  sort_order      int  DEFAULT 0,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE keller_behandlungstypen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "behandlungstypen_select" ON keller_behandlungstypen
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "behandlungstypen_write" ON keller_behandlungstypen
  FOR ALL USING (
    user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
  );

-- ── Behandlungen ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS keller_behandlungen (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  behaelter_id        uuid NOT NULL REFERENCES behaelter(id) ON DELETE CASCADE,
  typ_id              uuid REFERENCES keller_behandlungstypen(id) ON DELETE SET NULL,
  typ_name_snapshot   text,        -- Typname zum Zeitpunkt der Buchung (falls Typ gelöscht wird)
  datum               date NOT NULL DEFAULT CURRENT_DATE,
  menge               numeric(10,3),
  einheit             text,        -- kg, g, L, mL, – (kein Mengenfeld)
  volumen_liter_ist   numeric(10,1), -- Behälterinhalt zum Zeitpunkt der Behandlung
  notizen             text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

ALTER TABLE keller_behandlungen ENABLE ROW LEVEL SECURITY;

CREATE POLICY "behandlungen_select" ON keller_behandlungen
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "behandlungen_write" ON keller_behandlungen
  FOR ALL USING (
    user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
  );

-- ── Index ────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_keller_behandlungen_behaelter ON keller_behandlungen(behaelter_id);
CREATE INDEX IF NOT EXISTS idx_keller_behandlungstypen_tenant ON keller_behandlungstypen(tenant_id);

-- ── Default-Typen für bestehende Mandanten ───────────────────────────────────
INSERT INTO keller_behandlungstypen (tenant_id, name, einheit_standard, sort_order)
SELECT id, 'Bentonit',           'kg',  1 FROM tenants
UNION ALL
SELECT id, 'Kieselsol',          'L',   2 FROM tenants
UNION ALL
SELECT id, 'Schwefelung',        'g',   3 FROM tenants
UNION ALL
SELECT id, 'Filtration',         '-',   4 FROM tenants
UNION ALL
SELECT id, 'Hefezugabe',         'g',   5 FROM tenants
UNION ALL
SELECT id, 'Säurekorrektur',     'kg',  6 FROM tenants
UNION ALL
SELECT id, 'Sonstige Schönung',  'kg',  7 FROM tenants;
