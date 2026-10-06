-- KAN-21 (06.10.2026): Lückenlose Rechnungsnummern (Entscheidung Jörgen: verpflichtend, § 11 UStG).
-- Bisher holte die App die Nummer per RPC get_next_rechnungsnummer VOR dem Insert des Belegs – jeder Mitarbeiter konnte
-- den Zähler per /rest/v1/rpc hochzählen, und ein gescheiterter Insert hinterließ eine Lücke.
--  1. s112_rechnungsnummer_ziehen(tenant): Zählerlogik von get_next_rechnungsnummer ohne Zugriffsprüfung (intern).
--  2. Trigger a_rechnungsnummer (BEFORE INSERT/UPDATE auf verkaufsposten): vergibt die Nummer beim Insert in derselben
--     Transaktion wie den Beleg – scheitert der Insert, wird auch der Zähler zurückgerollt. Eine mitgeschickte Nummer
--     oder eine Änderung lehnt die Datenbank für API-Rollen ab (Wartung/Import per Service-Role bleibt möglich).
--  3. Eindeutige Nummer je Betrieb (Index; geprüft 06.10.2026: keine Doppelten in Produktion).
--  4. get_next_rechnungsnummer nur noch für die Service-Role (kein EXECUTE für authenticated).
-- Stornierte Belege behalten ihre Nummer (Storno statt Löschen, KAN-149) – der Nummernkreis bleibt lückenlos.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- 1. Zähler ziehen (ohne Zugriffsprüfung – nur aus dem Trigger und get_next_rechnungsnummer) ─────────────────
CREATE OR REPLACE FUNCTION public.s112_rechnungsnummer_ziehen(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_prefix   text;
  v_suffix   text;
  v_stellen  integer;
  v_zaehler  integer;
  v_row_jahr integer;
  v_jahr     integer := extract(year from now())::int;
  v_nummer   integer;
BEGIN
  SELECT rechnung_prefix, rechnung_suffix, rechnung_stellen, rechnung_zaehler, rechnung_zaehler_jahr
    INTO v_prefix, v_suffix, v_stellen, v_zaehler, v_row_jahr
    FROM tenant_einstellungen
   WHERE tenant_id = p_tenant_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  -- Reset nur bei Jahreswechsel UND nur wenn der Suffix einen Jahres-Platzhalter enthält
  IF coalesce(v_suffix, '') LIKE '%{JJ%' AND v_row_jahr IS DISTINCT FROM v_jahr THEN
    v_nummer := 1;
  ELSE
    v_nummer := v_zaehler;
  END IF;
  UPDATE tenant_einstellungen
     SET rechnung_zaehler = v_nummer + 1,
         rechnung_zaehler_jahr = v_jahr
   WHERE tenant_id = p_tenant_id;
  RETURN v_prefix || '-' || lpad(v_nummer::text, v_stellen, '0') ||
         replace(replace(coalesce(v_suffix, ''), '{JJJJ}', v_jahr::text), '{JJ}', lpad((v_jahr % 100)::text, 2, '0'));
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_rechnungsnummer_ziehen(uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.s112_rechnungsnummer_ziehen(uuid) IS
  'KAN-21: nächste Rechnungsnummer (Zähler +1, Jahreswechsel) – intern, nur Trigger a_rechnungsnummer und get_next_rechnungsnummer';

-- get_next_rechnungsnummer: gleiche Prüfungen wie bisher, Zähler über (1); nur noch Service-Role
CREATE OR REPLACE FUNCTION public.get_next_rechnungsnummer(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin','winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);   -- KAN-5 Nur-Lesen-Modus
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft', 'rieden');   -- KAN-159 B9
  RETURN public.s112_rechnungsnummer_ziehen(p_tenant_id);
END
$function$;
REVOKE EXECUTE ON FUNCTION public.get_next_rechnungsnummer(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_next_rechnungsnummer(uuid) TO service_role;

-- 2. Vergabe im Insert, keine fremde oder geänderte Nummer per API ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_rechnungsnummer_vergeben()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  -- API-Rolle aus dem JWT (current_user ist hier der Eigentümer der SECURITY-DEFINER-Funktion); SQL-Editor, Wartung
  -- und Service-Role haben keine bzw. eine andere Rolle
  v_api boolean := coalesce(auth.role(), '') IN ('authenticated', 'anon');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.rechnungsnummer IS NOT NULL AND v_api THEN
      RAISE EXCEPTION 'Die Rechnungsnummer vergibt das System (lückenloser Nummernkreis) – bitte ohne Nummer speichern.'
        USING ERRCODE = '42501', HINT = 'rechnungsnummer';
    END IF;
    IF NEW.rechnungsnummer IS NULL THEN
      NEW.rechnungsnummer := public.s112_rechnungsnummer_ziehen(NEW.tenant_id);
    END IF;
  ELSIF NEW.rechnungsnummer IS DISTINCT FROM OLD.rechnungsnummer AND v_api THEN
    RAISE EXCEPTION 'Die Rechnungsnummer eines Belegs ist unveränderlich (lückenloser Nummernkreis).'
      USING ERRCODE = '42501', HINT = 'rechnungsnummer';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_rechnungsnummer_vergeben() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_rechnungsnummer BEFORE INSERT OR UPDATE OF rechnungsnummer ON public.verkaufsposten
  FOR EACH ROW EXECUTE FUNCTION public.s112_rechnungsnummer_vergeben();

-- 3. Eindeutig je Betrieb ──────────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX verkaufsposten_rechnungsnummer_eindeutig ON public.verkaufsposten (tenant_id, rechnungsnummer)
  WHERE rechnungsnummer IS NOT NULL;
