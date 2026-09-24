-- Migration 124: Behälter-Typen erweitern
-- Fehlendes: 'lagertank' und 'immervolltank' waren im UI vorhanden,
-- aber nicht im CHECK-Constraint der Tabelle → 500er beim Anlegen/Bearbeiten.

ALTER TABLE behaelter
  DROP CONSTRAINT IF EXISTS behaelter_typ_check;

ALTER TABLE behaelter
  ADD CONSTRAINT behaelter_typ_check
    CHECK (typ IN ('stahltank', 'lagertank', 'immervolltank', 'holzfass', 'betonei', 'amphore', 'sonstiges'));
