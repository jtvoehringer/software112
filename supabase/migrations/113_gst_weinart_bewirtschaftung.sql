-- Migration 113: Rebsortenspezifische Felder von weingarten auf grundstuecke

ALTER TABLE grundstuecke
  ADD COLUMN IF NOT EXISTS weinart           TEXT,
  ADD COLUMN IF NOT EXISTS bewirtschaftung   TEXT,
  ADD COLUMN IF NOT EXISTS bewirtschaftung_seit DATE;

-- Datenmigration: Werte von weingarten auf alle zugehörigen grundstuecke übertragen
UPDATE grundstuecke g
SET
  weinart           = w.weinart,
  bewirtschaftung   = w.bewirtschaftung,
  bewirtschaftung_seit = w.bewirtschaftung_seit
FROM weingarten w
WHERE g.weingarten_id = w.id
  AND (g.weinart IS NULL OR g.bewirtschaftung IS NULL);
