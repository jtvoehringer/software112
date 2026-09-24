-- Migration 112: Grundstücke erweitern + weingarten bereinigen

-- weingarten: Bewirtschaftung-Datum (In Umstellung seit)
ALTER TABLE weingarten
  ADD COLUMN IF NOT EXISTS bewirtschaftung_seit DATE;

-- grundstuecke: AMA-Fläche war schon da (flaeche_ha), Kataster-Fläche neu
ALTER TABLE grundstuecke
  ADD COLUMN IF NOT EXISTS flaeche_ha_kataster NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS trauben_herkunft_code TEXT;

-- Herkunft-Code von weingarten auf grundstuecke migrieren (best-effort)
UPDATE grundstuecke g
SET trauben_herkunft_code = w.trauben_herkunft_code
FROM weingarten w
WHERE g.weingarten_id = w.id
  AND w.trauben_herkunft_code IS NOT NULL
  AND g.trauben_herkunft_code IS NULL;
