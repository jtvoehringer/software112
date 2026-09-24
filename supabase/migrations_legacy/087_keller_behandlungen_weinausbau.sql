-- Migration 087: keller_behandlungen – weinausbau_id
-- Direkte Charge-Zuordnung bei Kellerbehandlungen (Schwefelung, Filtration, etc.)
-- Ohne diese Spalte war nur der Behälter bekannt, nicht welche Charge darin war.

ALTER TABLE keller_behandlungen
  ADD COLUMN IF NOT EXISTS weinausbau_id uuid REFERENCES weinausbau(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_keller_behandlungen_weinausbau
  ON keller_behandlungen(weinausbau_id);

COMMENT ON COLUMN keller_behandlungen.weinausbau_id IS
  'Optionale direkte Charge-Zuordnung – wird beim Erfassen vorbelegt wenn der Behälter eine aktive Charge enthält';
