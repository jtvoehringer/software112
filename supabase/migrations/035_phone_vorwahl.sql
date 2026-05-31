-- Migration 035: Ländervorwahl für Telefon/Mobil
-- Getrennte Speicherung ermöglicht klare Darstellung ohne Parsing

ALTER TABLE kontakte
  ADD COLUMN IF NOT EXISTS telefon_vorwahl varchar(6) DEFAULT '+43',
  ADD COLUMN IF NOT EXISTS mobil_vorwahl   varchar(6) DEFAULT '+43';

ALTER TABLE firmen
  ADD COLUMN IF NOT EXISTS telefon_vorwahl varchar(6) DEFAULT '+43';

NOTIFY pgrst, 'reload schema';
