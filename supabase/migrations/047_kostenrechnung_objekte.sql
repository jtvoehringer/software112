-- Migration 047: Kostenrechnung – Zuordnung zu Weingarten/Rieden oder Keller/Behälter

ALTER TABLE kosteneintraege
  ADD COLUMN IF NOT EXISTS objekt_typ    text CHECK (objekt_typ IN ('weingarten','keller')),
  ADD COLUMN IF NOT EXISTS ried_id       uuid REFERENCES lagen(id)     ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS behaelter_id  uuid REFERENCES behaelter(id) ON DELETE SET NULL;

COMMENT ON COLUMN kosteneintraege.objekt_typ   IS 'weingarten=Rieden/Alle Weingärten, keller=Tank/Alle Behälter';
COMMENT ON COLUMN kosteneintraege.ried_id      IS 'NULL = alle Rieden (wenn objekt_typ=weingarten)';
COMMENT ON COLUMN kosteneintraege.behaelter_id IS 'NULL = alle Behälter (wenn objekt_typ=keller)';
