ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS modul_controlling boolean NOT NULL DEFAULT false;

UPDATE tenant_einstellungen SET modul_controlling = true;

COMMENT ON COLUMN tenant_einstellungen.modul_controlling IS
  'Modul Controlling (Auswertungen, Kostenrechnung, Datenexport) für diesen Mandanten freigeschaltet';;
