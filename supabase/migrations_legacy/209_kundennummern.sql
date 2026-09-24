-- Migration 209 (17.9.2026): Kundennummern für Mandanten
-- Rückmeldung: "Wir brauchen noch Kundennummern für unsere Mandanten für
-- künftige Support- oder sonstige Prozesse."
--
-- Format: S112-AT-<K><NNNN>
--   K    = Nummernkreis = erste Ziffer der österreichischen Postleitzahl des
--          Betriebs (tenant_einstellungen.betrieb_plz): 1 Wien, 2 östl. NÖ,
--          3 westl. NÖ, 4 OÖ, 5 Salzburg, 6 Tirol/Vorarlberg, 7 Burgenland,
--          8 Steiermark, 9 Kärnten/Osttirol (Übersicht der Post, Rückmeldung
--          17.9.2026). Der Kreis liefert damit auch das Bundesland (z.B. für
--          landesrechtliche Weinbestimmungen, lib/tenant/kundennummer.ts).
--          Andere Länder (DE, CH, IT …) folgen später.
--   NNNN = fortlaufend je Kreis ab 0001.
-- Beispiel: Gumpoldskirchen (2352) → S112-AT-20001.
--
-- Vergabe automatisch, sobald eine PLZ hinterlegt ist (Trigger auf
-- tenant_einstellungen), einmalig und unveränderlich; ohne PLZ bleibt die
-- Nummer leer (Administration zeigt einen Hinweis).

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS kundennummer text;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_kundennummer_idx ON tenants (kundennummer) WHERE kundennummer IS NOT NULL;

-- Nächste Nummer im Kreis (serialisiert über Advisory Lock, damit zwei
-- gleichzeitige Anlagen nicht dieselbe Nummer bekommen)
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
    IF v_plz IS NULL OR length(v_plz) <> 4 THEN RETURN NULL; END IF;  -- keine (österreichische) PLZ
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

-- Automatisch, sobald die PLZ des Betriebs gespeichert wird
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

-- Kundennummer darf nachträglich nicht verändert werden (nur von NULL aus setzen)
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

-- Bestand: echte Betriebe zuerst, Sandbox und Demo nach ihrer PLZ (Firmensitz NÖ)
SELECT kundennummer_vergeben(id) FROM tenants WHERE name = 'Weingut Johannes Gebeshuber';         -- 2352 → S112-AT-20001
SELECT kundennummer_vergeben(id, 2) FROM tenants WHERE name = 'Spaetrot Gebeshuber GmbH';         -- Gumpoldskirchen, PLZ noch nicht hinterlegt → S112-AT-20002
SELECT kundennummer_vergeben(id) FROM tenants WHERE name = 'Sandbox';                             -- 2352 → S112-AT-20003
SELECT kundennummer_vergeben(id) FROM tenants WHERE name = 'Weingut Musterhof (Demo)';            -- 3500 → S112-AT-30001
