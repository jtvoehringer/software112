-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 060: Umzüge – Ziel-Charge verknüpfen (Bewegungsbuch eingehend)
-- ─────────────────────────────────────────────────────────────────────────────
-- Bisher hatte keller_umzuege nur von_weinausbau_id (Quelle).
-- Neu: nach_weinausbau_id (Ziel-Charge) → eingehende Umzüge im Bewegungsbuch sichtbar.

ALTER TABLE keller_umzuege
  ADD COLUMN IF NOT EXISTS nach_weinausbau_id uuid REFERENCES weinausbau(id);

CREATE INDEX IF NOT EXISTS idx_umzuege_nach ON keller_umzuege(nach_weinausbau_id);

COMMENT ON COLUMN keller_umzuege.nach_weinausbau_id IS
  'Ziel-Weinausbau-Charge – ermöglicht Darstellung eingehender Umzüge im Bewegungsbuch der Ziel-Charge';
