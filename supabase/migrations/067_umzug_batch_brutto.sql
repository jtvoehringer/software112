-- Migration 067: Umzug n:n – Batch-Gruppierung + Brutto-Liter
-- Ermöglicht: 1 Quell-Charge → n Ziel-Gebinde (n:m-Umzüge)
-- umzug_batch_id: gruppiert alle Zeilen eines Umzugs
-- brutto_liter:   abgehende Menge (brutto), nur auf erster Batch-Zeile

ALTER TABLE keller_umzuege
  ADD COLUMN IF NOT EXISTS umzug_batch_id UUID,
  ADD COLUMN IF NOT EXISTS brutto_liter   NUMERIC(10,2);

CREATE INDEX IF NOT EXISTS idx_umzuege_batch ON keller_umzuege(umzug_batch_id);
