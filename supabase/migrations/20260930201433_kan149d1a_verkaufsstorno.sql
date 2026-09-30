-- KAN-149 (Folgeticket D), Etappe D1: Verkaufsstorno mit Grund und Benutzer, Flaschenverkauf als Bewegungszeile
-- (Staging-Test zurückgerollt 30.09.2026, „OK, einspielen“ 30.09.2026)
--
-- Bisher: Der Storno setzt nur storniert/storniert_am (kein Grund, kein Benutzer); Flaschenverkauf und -rückbuchung
-- ändern fuellungen.bestand_flaschen direkt (keine Zeile in fuellung_bewegungen, Bestandskette mit Lücken). Neu:
--
--  1. verkaufsposten: storniert_von (ohne FK, KAN-145 Soll 1), storniert_von_name, storno_grund.
--     Trigger a_verkauf_storno_schutz (BEFORE INSERT/UPDATE, nur API-Rollen):
--       - neu anlegen nur unstorniert und ohne Storno-Angaben;
--       - Stornieren (storniert false → true): Zeitpunkt, Benutzer und Name setzt die Datenbank; ein Grund braucht
--         mind. 10 Zeichen (wie lib/storno/grund.ts). PFLICHT ist er in der DB erst ab D3 – die heutige App storniert
--         noch ohne Grund und darf zwischen Migration und App-Deploy nicht scheitern; ab dem D1-Deploy erzwingt ihn
--         die App;
--       - stornierter Beleg: kein Entstornieren, Storno-Angaben, Rechnungsnummer, Datum, Kunde unveränderlich.
--         Bezahlt-Status, BMD-Export-Kennzeichen, Versand und Notizen bleiben änderbar (Zahlungs-Trigger, Export).
--     Service-Role/SQL-Editor (Demo-Reset, Mandanten-Löschung) bleiben frei. Bestehende stornierte Belege ohne Grund
--     bleiben, wie sie sind.
--  2. fuellung_bewegungen: Arten „verkauf“ (Abgang, negativ) und „verkauf_storno“ (Rückbuchung, positiv) mit
--     verkaufsposten_id (Pflicht genau bei diesen Arten). Ohne FK: der Verkauf bucht die Flaschen VOR dem Anlegen des
--     Belegs ab (kein verbrauchter Rechnungs-Nummernkreis bei einer Ablehnung, KAN-35).
--  3. RPC s112_fuellung_verkauf_buchen(p_tenant_id, p_fuellung_id, p_verkaufsposten_id, p_menge_stk, p_datum, p_grund)
--     → neuer Bestand: bucht Verkauf (negativ) bzw. Storno-Rückbuchung (positiv) mit Zeile und bestand_vorher/
--     nachher, gesperrt per FOR UPDATE (ersetzt das Vergleichen-und-Setzen in fuellungBestandAendern).
--     fuellung_bestand_buchen (Inventur, Bruch …) bleibt unverändert und lehnt die Verkaufsarten weiter ab.
--  4. z_protokoll_aendern an verkaufsposten überwacht zusätzlich storniert_von, storno_grund.
-- RPC: pruefe_tenant_zugriff (system_admin/tenant_admin/winzer), Abo-Schreibsperre, Schreibmodul Kellerbuch oder
-- Warenwirtschaft (wie fuellung_bestand_buchen), REVOKE, search_path. Kein session_replication_role (KAN-124).

-- 1. Verkaufsposten: Storno-Angaben ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.verkaufsposten
  ADD COLUMN IF NOT EXISTS storniert_von uuid,
  ADD COLUMN IF NOT EXISTS storniert_von_name text,
  ADD COLUMN IF NOT EXISTS storno_grund text;
COMMENT ON COLUMN public.verkaufsposten.storniert_von IS 'KAN-149 D1: Benutzer, der storniert hat (ohne FK, KAN-145 Soll 1)';
COMMENT ON COLUMN public.verkaufsposten.storniert_von_name IS 'KAN-149 D1: Name des stornierenden Benutzers (Momentaufnahme)';
COMMENT ON COLUMN public.verkaufsposten.storno_grund IS 'KAN-149 D1: Grund des Stornos (mind. 10 Zeichen; Pflicht in der App ab D1, in der DB ab D3)';

CREATE OR REPLACE FUNCTION public.s112_verkauf_storno_schutz()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rolle text := COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text);
  v_uid   uuid := auth.uid();
  v_name  text;
BEGIN
  -- Wartung (Service-Role, SQL-Editor, Demo-Reset, Mandanten-Löschung): frei
  IF v_rolle NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.storniert OR NEW.storniert_am IS NOT NULL OR NEW.storniert_von IS NOT NULL
       OR NEW.storniert_von_name IS NOT NULL OR NEW.storno_grund IS NOT NULL THEN
      RAISE EXCEPTION 'Ein Verkauf kann nicht storniert angelegt werden (KAN-149).' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- Stornierter Beleg: kein Entstornieren; Storno-Angaben und Belegdaten unveränderlich
  IF OLD.storniert THEN
    IF NOT NEW.storniert
       OR NEW.storniert_am IS DISTINCT FROM OLD.storniert_am OR NEW.storniert_von IS DISTINCT FROM OLD.storniert_von
       OR NEW.storniert_von_name IS DISTINCT FROM OLD.storniert_von_name OR NEW.storno_grund IS DISTINCT FROM OLD.storno_grund
       OR NEW.rechnungsnummer IS DISTINCT FROM OLD.rechnungsnummer OR NEW.datum IS DISTINCT FROM OLD.datum
       OR NEW.kontakt_id IS DISTINCT FROM OLD.kontakt_id OR NEW.firma_id IS DISTINCT FROM OLD.firma_id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'Der Verkauf % ist storniert – Storno und Belegdaten bleiben unverändert (KAN-149).', COALESCE(OLD.rechnungsnummer, '')
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- Stornieren: Grund Pflicht, Zeitpunkt, Benutzer und Name setzt die Datenbank
  IF NEW.storniert THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'Stornieren nur als angemeldeter Benutzer (KAN-149).' USING ERRCODE = '42501';
    END IF;
    -- Übergang bis D3: ohne Grund erlaubt (alte App), ein angegebener Grund braucht 10 Zeichen
    IF NEW.storno_grund IS NOT NULL AND length(btrim(NEW.storno_grund)) < 10 THEN
      RAISE EXCEPTION 'Bitte einen Grund für den Storno angeben (mindestens 10 Zeichen).' USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.display_name), ''))
      INTO v_name FROM public.profiles p WHERE p.user_id = v_uid OR p.id = v_uid ORDER BY (p.user_id = v_uid) DESC LIMIT 1;
    IF v_name IS NULL THEN
      SELECT u.email INTO v_name FROM auth.users u WHERE u.id = v_uid;
    END IF;
    NEW.storniert_am := now();
    NEW.storniert_von := v_uid;
    NEW.storniert_von_name := v_name;
    NEW.storno_grund := NULLIF(btrim(NEW.storno_grund), '');
    RETURN NEW;
  END IF;

  -- Nicht storniert: keine Storno-Angaben ohne Storno
  IF NEW.storniert_am IS NOT NULL OR NEW.storniert_von IS NOT NULL OR NEW.storniert_von_name IS NOT NULL OR NEW.storno_grund IS NOT NULL THEN
    RAISE EXCEPTION 'Storno-Angaben nur zusammen mit dem Stornieren (KAN-149).' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_verkauf_storno_schutz() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a_verkauf_storno_schutz ON public.verkaufsposten;
CREATE TRIGGER a_verkauf_storno_schutz BEFORE INSERT OR UPDATE ON public.verkaufsposten
  FOR EACH ROW EXECUTE FUNCTION public.s112_verkauf_storno_schutz();

DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.verkaufsposten;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF aktiv, storniert, storniert_am, datum, tenant_id, storniert_von, storno_grund
  ON public.verkaufsposten
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('aktiv', 'storniert', 'storniert_am', 'datum', 'tenant_id', 'storniert_von', 'storno_grund');

-- 2. Flaschenbewegungen: Verkauf und Storno-Rückbuchung ──────────────────────────────────────────────────────
ALTER TABLE public.fuellung_bewegungen ADD COLUMN IF NOT EXISTS verkaufsposten_id uuid;
COMMENT ON COLUMN public.fuellung_bewegungen.verkaufsposten_id IS 'KAN-149 D1: Verkauf bei Art verkauf/verkauf_storno (ohne FK: Abbuchung vor dem Beleg)';
CREATE INDEX IF NOT EXISTS fuellung_bewegungen_verkaufsposten_idx ON public.fuellung_bewegungen (verkaufsposten_id) WHERE verkaufsposten_id IS NOT NULL;

ALTER TABLE public.fuellung_bewegungen DROP CONSTRAINT IF EXISTS fuellung_bewegungen_art_check;
ALTER TABLE public.fuellung_bewegungen ADD CONSTRAINT fuellung_bewegungen_art_check
  CHECK (art = ANY (ARRAY['inventur', 'bruch', 'eigenverbrauch', 'schwund', 'korrektur', 'anfangsbestand', 'verkauf', 'verkauf_storno']));
ALTER TABLE public.fuellung_bewegungen DROP CONSTRAINT IF EXISTS fuellung_bewegungen_abgang_check;
ALTER TABLE public.fuellung_bewegungen ADD CONSTRAINT fuellung_bewegungen_abgang_check
  CHECK ((art <> ALL (ARRAY['bruch', 'eigenverbrauch', 'schwund', 'verkauf'])) OR (menge_stk < 0));
ALTER TABLE public.fuellung_bewegungen DROP CONSTRAINT IF EXISTS fuellung_bewegungen_zugang_check;
ALTER TABLE public.fuellung_bewegungen ADD CONSTRAINT fuellung_bewegungen_zugang_check
  CHECK (art <> 'verkauf_storno' OR menge_stk > 0);
ALTER TABLE public.fuellung_bewegungen DROP CONSTRAINT IF EXISTS fuellung_bewegungen_verkauf_check;
ALTER TABLE public.fuellung_bewegungen ADD CONSTRAINT fuellung_bewegungen_verkauf_check
  CHECK ((art IN ('verkauf', 'verkauf_storno')) = (verkaufsposten_id IS NOT NULL));

-- 3. RPC: Flaschen verkaufen bzw. zurückbuchen ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_fuellung_verkauf_buchen(p_tenant_id uuid, p_fuellung_id uuid, p_verkaufsposten_id uuid,
  p_menge_stk integer, p_datum date, p_grund text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_alt  integer;
  v_name text;
  v_neu  bigint;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);

  IF NOT public.ist_service_kontext()
     AND NOT public.s112_darf_schreiben(p_tenant_id, 'kellerbuch', 'warenwirtschaft') THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für den Flaschenbestand in diesem Betrieb' USING ERRCODE = '42501';
  END IF;
  IF p_verkaufsposten_id IS NULL THEN
    RAISE EXCEPTION 'Verkauf fehlt' USING ERRCODE = '22023';
  END IF;
  -- Ein vorhandener Beleg muss zum Betrieb gehören (vor dem Anlegen gibt es ihn noch nicht, KAN-35)
  IF EXISTS (SELECT 1 FROM public.verkaufsposten v WHERE v.id = p_verkaufsposten_id AND v.tenant_id <> p_tenant_id) THEN
    RAISE EXCEPTION 'Verkauf nicht gefunden' USING ERRCODE = 'P0002';
  END IF;
  IF p_menge_stk IS NULL OR p_menge_stk = 0 THEN
    RAISE EXCEPTION 'Bitte eine Menge in Stück (ungleich 0) angeben' USING ERRCODE = '22023';
  END IF;
  IF p_datum IS NULL THEN
    RAISE EXCEPTION 'Bitte ein Buchungsdatum angeben' USING ERRCODE = '22023';
  END IF;

  SELECT f.bestand_flaschen, f.name INTO v_alt, v_name
    FROM public.fuellungen f
   WHERE f.id = p_fuellung_id AND f.tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Füllung nicht gefunden – bitte Seite neu laden' USING ERRCODE = 'P0002';
  END IF;
  v_alt := COALESCE(v_alt, 0);
  v_neu := v_alt::bigint + p_menge_stk;
  IF v_neu < 0 THEN
    RAISE EXCEPTION '„%“: nur noch % Flaschen verfügbar, % angefragt.', COALESCE(v_name, 'Füllung'), v_alt, -p_menge_stk
      USING ERRCODE = '22023';
  END IF;
  IF v_neu > 2147483647 THEN
    RAISE EXCEPTION 'Der neue Flaschenbestand (% Flaschen) ist unplausibel groß – bitte die Menge prüfen', v_neu USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.fuellung_bewegungen
    (tenant_id, fuellung_id, datum, art, menge_stk, bestand_vorher, bestand_nachher, grund, erstellt_von, verkaufsposten_id)
  VALUES
    (p_tenant_id, p_fuellung_id, p_datum, CASE WHEN p_menge_stk < 0 THEN 'verkauf' ELSE 'verkauf_storno' END,
     p_menge_stk, v_alt, v_neu::integer, NULLIF(btrim(p_grund), ''), auth.uid(), p_verkaufsposten_id);

  UPDATE public.fuellungen
     SET bestand_flaschen = v_neu::integer
   WHERE id = p_fuellung_id AND tenant_id = p_tenant_id;

  RETURN v_neu::integer;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_fuellung_verkauf_buchen(uuid, uuid, uuid, integer, date, text) FROM PUBLIC, anon;

-- Selbstprüfung
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'a_verkauf_storno_schutz' AND tgrelid = 'public.verkaufsposten'::regclass) THEN
    RAISE EXCEPTION 'KAN-149 D1: Schutz-Trigger fehlt';
  END IF;
  IF has_function_privilege('authenticated', 'public.s112_verkauf_storno_schutz()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.s112_fuellung_verkauf_buchen(uuid, uuid, uuid, integer, date, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'KAN-149 D1: EXECUTE-Rechte falsch';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fuellung_bewegungen WHERE art IN ('verkauf', 'verkauf_storno')) THEN
    RAISE EXCEPTION 'KAN-149 D1: unerwartete Verkaufszeilen';
  END IF;
END $$;
