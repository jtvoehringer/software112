-- Migration 118: Pressung-Direktbefüllung in Verkaufspositionen
-- Ermöglicht den Verkauf von Most/Wein direkt aus einem Pressung-Behälter
-- (pressung_behaelter.weinausbau_id IS NULL = noch keiner Kellerbuch-Charge zugeordnet)

ALTER TABLE verkauf_positionen
  ADD COLUMN IF NOT EXISTS pressung_behaelter_id UUID REFERENCES pressung_behaelter(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_verkauf_positionen_pressung_behaelter
  ON verkauf_positionen(pressung_behaelter_id);
