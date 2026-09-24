-- Migration 110: BKI-Betriebsnummern für Empfänger (Abnehmer)
-- tenant_einstellungen.betrieb_betriebsnummer existiert bereits seit Migration 096
-- → nur firmen und kontakte bekommen ein neues betrieb_nr Feld (BKI-Empfänger-Block)
-- Erforderlich für den automatischen EDV-Import in die BKI-Weindatenbank
-- gem. § 3 Weingesetz-Formularverordnung BGBl. II Nr. 13/2012

ALTER TABLE firmen
  ADD COLUMN IF NOT EXISTS betrieb_nr TEXT;

ALTER TABLE kontakte
  ADD COLUMN IF NOT EXISTS betrieb_nr TEXT;

COMMENT ON COLUMN firmen.betrieb_nr IS
  'BKI-Betriebsnummer des Abnehmers (Empfänger-Block in der BKI-Transportliste)';

COMMENT ON COLUMN kontakte.betrieb_nr IS
  'BKI-Betriebsnummer des Abnehmers (Empfänger-Block in der BKI-Transportliste)';
