-- Migration 059: Prüfnummer + Chargennummer in Füllungen; Anfangsbestand in Weinausbau

-- Füllungen: optionale Prüfnummer und Chargennummer
ALTER TABLE fuellungen
  ADD COLUMN IF NOT EXISTS pruefnummer   TEXT,
  ADD COLUMN IF NOT EXISTS chargennummer TEXT;

-- Weinausbau: Anfangsbestand einmalig speichern (wird bei Anlage gesetzt, nie mehr geändert)
ALTER TABLE weinausbau
  ADD COLUMN IF NOT EXISTS anfangsbestand_liter NUMERIC(10,2);

-- Backfill für bestehende Chargen: aktueller Wert als Anfangsbestand
UPDATE weinausbau
  SET anfangsbestand_liter = menge_liter
  WHERE anfangsbestand_liter IS NULL AND menge_liter IS NOT NULL;
