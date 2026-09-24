-- Migration 120: Traubenverkauf → Verknüpfung mit Verkaufsposten
-- Beim Speichern eines Traubenverkaufs wird automatisch ein Verkaufsposten angelegt.

ALTER TABLE traubenverkauf
  ADD COLUMN IF NOT EXISTS verkaufsposten_id UUID
    REFERENCES verkaufsposten(id) ON DELETE SET NULL;

COMMENT ON COLUMN traubenverkauf.verkaufsposten_id IS 'Verknüpfung zum automatisch erzeugten Verkaufsposten (Rechnung)';

CREATE INDEX IF NOT EXISTS idx_traubenverkauf_verkaufsposten
  ON traubenverkauf(verkaufsposten_id);
