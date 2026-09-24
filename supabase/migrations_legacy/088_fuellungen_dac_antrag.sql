-- Migration 088: fuellungen.dac_antrag_id
-- Verknüpft eine Füllung direkt mit dem genehmigten DAC-Antrag (Prüfnummer).
-- Bisher war pruefnummer nur ein Freitext-Feld ohne Enforcement.
-- Mit dieser FK kann das UI prüfen ob der Antrag tatsächlich genehmigt ist.

ALTER TABLE fuellungen
  ADD COLUMN IF NOT EXISTS dac_antrag_id uuid REFERENCES dac_antrag(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fuellungen_dac_antrag
  ON fuellungen(dac_antrag_id);

COMMENT ON COLUMN fuellungen.dac_antrag_id IS
  'FK zum genehmigten DAC-Antrag – Prüfnummer wird daraus gezogen. NULL = kein DAC-Antrag (normaler Qualitätswein)';

-- Bestehende Datensätze: pruefnummer-Text mit dac_antrag abgleichen (wo eindeutig)
UPDATE fuellungen f
SET dac_antrag_id = (
  SELECT d.id FROM dac_antrag d
  WHERE d.tenant_id = f.tenant_id
    AND d.pruefnummer IS NOT NULL
    AND d.pruefnummer = f.pruefnummer
  LIMIT 1
)
WHERE f.pruefnummer IS NOT NULL
  AND f.dac_antrag_id IS NULL;
