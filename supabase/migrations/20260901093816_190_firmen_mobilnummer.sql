ALTER TABLE firmen
  ADD COLUMN IF NOT EXISTS mobil          text,
  ADD COLUMN IF NOT EXISTS mobil_vorwahl  text NOT NULL DEFAULT '+43';

COMMENT ON COLUMN firmen.mobil IS
  'Mobilnummer der Firma (ohne Vorwahl) - analog zu kontakte.mobil.';
COMMENT ON COLUMN firmen.mobil_vorwahl IS
  'Landesvorwahl zu firmen.mobil, z.B. "+43" - analog zu kontakte.mobil_vorwahl.';;
