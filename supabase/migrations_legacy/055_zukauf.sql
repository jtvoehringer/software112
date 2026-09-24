-- Migration 055: Zukauf-Modul
-- Erfassung von zugekauftem Wein, Trauben und Traubenmost

CREATE TABLE IF NOT EXISTS zukauf_posten (
  id                   uuid           DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id            uuid           NOT NULL,
  datum                date           NOT NULL,
  art                  text           NOT NULL CHECK (art IN ('wein', 'trauben', 'most')),
  lieferant_kontakt_id uuid           REFERENCES kontakte(id) ON DELETE SET NULL,
  lieferant_firma_id   uuid           REFERENCES firmen(id)   ON DELETE SET NULL,
  menge                numeric(12,3)  NOT NULL,
  einheit              text           NOT NULL DEFAULT 'kg',
  preis_gesamt         numeric(12,2),
  rebsorte             text,
  jahrgang             integer,
  notizen              text,
  ziel_weinausbau_id   uuid           REFERENCES weinausbau(id) ON DELETE SET NULL,
  aktiv                boolean        NOT NULL DEFAULT true,
  erstellt_am          timestamptz    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS zukauf_posten_tenant_idx ON zukauf_posten (tenant_id);
CREATE INDEX IF NOT EXISTS zukauf_posten_datum_idx  ON zukauf_posten (datum DESC);

ALTER TABLE zukauf_posten ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zukauf_posten_select" ON zukauf_posten FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
CREATE POLICY "zukauf_posten_insert" ON zukauf_posten FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
CREATE POLICY "zukauf_posten_update" ON zukauf_posten FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
