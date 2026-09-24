ALTER TABLE tenants ADD COLUMN IF NOT EXISTS kundennummer text;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_kundennummer_idx ON tenants (kundennummer) WHERE kundennummer IS NOT NULL;
CREATE OR REPLACE FUNCTION kundennummer_vergeben(p_tenant_id uuid, p_kreis int DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vorhanden text;
  v_plz text;
  v_kreis int;
  v_lfd int;
  v_nr text;
BEGIN
  SELECT kundennummer INTO v_vorhanden FROM tenants WHERE id = p_tenant_id;
  IF v_vorhanden IS NOT NULL THEN RETURN v_vorhanden; END IF;
  v_kreis := p_kreis;
  IF v_kreis IS NULL THEN
    SELECT regexp_replace(COALESCE(betrieb_plz, ''), '\D', '', 'g') INTO v_plz
      FROM tenant_einstellungen WHERE tenant_id = p_tenant_id;
    IF v_plz IS NULL OR length(v_plz) <> 4 THEN RETURN NULL; END IF;
    v_kreis := substr(v_plz, 1, 1)::int;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('kundennummer'), v_kreis);
  SELECT COALESCE(MAX(substr(kundennummer, 10)::int), 0) + 1 INTO v_lfd
    FROM tenants
   WHERE kundennummer LIKE 'S112-AT-' || v_kreis || '%';
  v_nr := 'S112-AT-' || v_kreis || lpad(v_lfd::text, 4, '0');
  UPDATE tenants SET kundennummer = v_nr WHERE id = p_tenant_id AND kundennummer IS NULL;
  RETURN v_nr;
END $$;
REVOKE ALL ON FUNCTION kundennummer_vergeben(uuid, int) FROM public;
GRANT EXECUTE ON FUNCTION kundennummer_vergeben(uuid, int) TO service_role;
CREATE OR REPLACE FUNCTION kundennummer_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.betrieb_plz IS NOT NULL THEN PERFORM kundennummer_vergeben(NEW.tenant_id); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kundennummer_trg ON tenant_einstellungen;
CREATE TRIGGER kundennummer_trg
  AFTER INSERT OR UPDATE OF betrieb_plz ON tenant_einstellungen
  FOR EACH ROW EXECUTE FUNCTION kundennummer_trg();
CREATE OR REPLACE FUNCTION kundennummer_unveraenderlich_trg()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kundennummer IS NOT NULL AND NEW.kundennummer IS DISTINCT FROM OLD.kundennummer THEN
    RAISE EXCEPTION 'Kundennummer % kann nicht geändert werden', OLD.kundennummer;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kundennummer_unveraenderlich_trg ON tenants;
CREATE TRIGGER kundennummer_unveraenderlich_trg
  BEFORE UPDATE OF kundennummer ON tenants
  FOR EACH ROW EXECUTE FUNCTION kundennummer_unveraenderlich_trg();
SELECT kundennummer_vergeben(id) FROM tenants WHERE name = 'Weingut Johannes Gebeshuber';
SELECT kundennummer_vergeben(id, 2) FROM tenants WHERE name = 'Spaetrot Gebeshuber GmbH';
SELECT kundennummer_vergeben(id, 0) FROM tenants WHERE name = 'Sandbox';
SELECT kundennummer_vergeben(id, 0) FROM tenants WHERE name = 'Weingut Musterhof (Demo)';;
