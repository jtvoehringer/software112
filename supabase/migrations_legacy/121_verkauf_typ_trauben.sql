-- Migration 121: 'trauben' als erlaubter Typ in verkauf_positionen
-- Ermöglicht Traubenverkauf direkt im Standard-Verkaufsformular.

ALTER TABLE verkauf_positionen
  DROP CONSTRAINT IF EXISTS verkauf_positionen_typ_check;

ALTER TABLE verkauf_positionen
  ADD CONSTRAINT verkauf_positionen_typ_check
    CHECK (typ IN ('flasche', 'tank', 'sonstiges', 'trauben'));

-- Rückverweis auf den BKI-Datensatz (Lieferschein/Traubenverkauf-Record)
ALTER TABLE verkauf_positionen
  ADD COLUMN IF NOT EXISTS traubenverkauf_id UUID
    REFERENCES traubenverkauf(id) ON DELETE SET NULL;

COMMENT ON COLUMN verkauf_positionen.traubenverkauf_id IS
  'Verknüpfung zur traubenverkauf-Tabelle (BKI-Pflichtfelder) wenn typ=trauben';

CREATE INDEX IF NOT EXISTS idx_vk_pos_traubenverkauf
  ON verkauf_positionen(traubenverkauf_id);
