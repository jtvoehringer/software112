-- Migration 057: Kaputten Trigger auf fuellungen reparieren
--
-- Problem: fuellungen_updated_at verwendet update_updated_at(), die NEW.updated_at = now()
-- setzt – aber die fuellungen-Tabelle hat aktualisiert_am (nicht updated_at).
-- Dadurch schlägt jeder UPDATE auf fuellungen mit
-- "record 'new' has no field 'updated_at'" fehl.
--
-- Lösung: Trigger neu erstellen mit einer Funktion die aktualisiert_am setzt.
-- (actions.ts setzt aktualisiert_am bereits explizit, der Trigger ist aber
--  als Sicherheitsnetz sinnvoll.)

DROP TRIGGER IF EXISTS fuellungen_updated_at ON fuellungen;

CREATE OR REPLACE FUNCTION update_fuellungen_aktualisiert_am()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.aktualisiert_am = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER fuellungen_updated_at
  BEFORE UPDATE ON fuellungen
  FOR EACH ROW EXECUTE FUNCTION update_fuellungen_aktualisiert_am();
