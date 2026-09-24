-- Migration 066: Kellerplan-Trigger fix
-- kellerplaene + kellerplan_positionen verwenden 'aktualisiert_am' statt 'updated_at'.
-- Der generische update_updated_at()-Trigger setzt new.updated_at = now() und wirft
-- "record new has no field updated_at" bei jedem UPDATE -> Verschieben fehlgeschlagen.

-- Neue Trigger-Funktion fuer aktualisiert_am-Tabellen
CREATE OR REPLACE FUNCTION update_aktualisiert_am()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.aktualisiert_am = NOW();
  RETURN NEW;
END;
$$;

-- Kellerplaene: alten Trigger ersetzen
DROP TRIGGER IF EXISTS kellerplaene_updated_at ON kellerplaene;
CREATE TRIGGER kellerplaene_updated_at
  BEFORE UPDATE ON kellerplaene
  FOR EACH ROW EXECUTE FUNCTION update_aktualisiert_am();

-- Kellerplan-Positionen: alten Trigger ersetzen
DROP TRIGGER IF EXISTS kellerplan_positionen_updated_at ON kellerplan_positionen;
CREATE TRIGGER kellerplan_positionen_updated_at
  BEFORE UPDATE ON kellerplan_positionen
  FOR EACH ROW EXECUTE FUNCTION update_aktualisiert_am();
