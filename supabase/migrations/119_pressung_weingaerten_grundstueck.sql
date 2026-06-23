-- Migration 119: grundstueck_id in pressung_weingaerten
-- Ermöglicht direkte GST-genaue Berechnung der verfügbaren Menge (kein proportionales Schätzen mehr)

ALTER TABLE pressung_weingaerten
  ADD COLUMN IF NOT EXISTS grundstueck_id UUID REFERENCES grundstuecke(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pressung_weingaerten_grundstueck
  ON pressung_weingaerten(grundstueck_id);
