-- Migration 047: Kostenrechnung – Zuordnung zu Weingarten oder Keller/Behälter

ALTER TABLE kosteneintraege
  ADD COLUMN IF NOT EXISTS objekt_typ      text CHECK (objekt_typ IN ('weingarten','keller')),
  ADD COLUMN IF NOT EXISTS weingarten_id   uuid REFERENCES weingarten(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS behaelter_id    uuid REFERENCES behaelter(id)  ON DELETE SET NULL;

COMMENT ON COLUMN kosteneintraege.objekt_typ    IS 'weingarten=Weingarten, keller=Behälter';
COMMENT ON COLUMN kosteneintraege.weingarten_id IS 'NULL = alle Weingärten (wenn objekt_typ=weingarten)';
COMMENT ON COLUMN kosteneintraege.behaelter_id  IS 'NULL = alle Behälter (wenn objekt_typ=keller)';
