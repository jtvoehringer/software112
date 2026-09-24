-- Mitarbeiter ohne explizite Matrix (ältere Einladungswege: Administration › Mandanten,
-- Hohenstein Suite Demo-Zugänge) erhalten alle Module - Verhalten wie bisher.
CREATE OR REPLACE FUNCTION tenant_memberships_schreibmodule_default()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role = 'winzer' THEN
    IF NEW.schreibmodule IS NULL THEN
      NEW.schreibmodule := ARRAY['rieden','kellerbuch','warenwirtschaft','crm','ea','auswertungen'];
    END IF;
  ELSE
    NEW.schreibmodule := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tenant_memberships_schreibmodule_default ON tenant_memberships;
CREATE TRIGGER tenant_memberships_schreibmodule_default
  BEFORE INSERT OR UPDATE OF role, schreibmodule ON tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION tenant_memberships_schreibmodule_default();;
