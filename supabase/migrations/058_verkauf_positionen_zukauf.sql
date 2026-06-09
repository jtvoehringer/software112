-- Migration 058: Zukauf-Verknüpfung in Verkaufspositionen
--
-- Ermöglicht Tank-Verkäufe direkt aus einem Zukauf-Posten heraus.
-- Analog zu weinausbau_id (Kellerbuch-Charge) gibt es nun zukauf_id.

ALTER TABLE verkauf_positionen
  ADD COLUMN IF NOT EXISTS zukauf_id uuid REFERENCES zukauf_posten(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_verkauf_pos_zukauf ON verkauf_positionen(zukauf_id);

COMMENT ON COLUMN verkauf_positionen.zukauf_id IS
  'Verknüpfung Tankware aus Zukauf → reduziert menge in zukauf_posten';
