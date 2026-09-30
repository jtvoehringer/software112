-- KAN-149 (Folgeticket D), Etappe D2a: E/A-Gegenbuchung statt Löschen, Zahlungen und Umbuchungen stornieren
-- (Staging-Test zurückgerollt 30.09.2026, „OK, einspielen“ 30.09.2026)
--
-- Rechtsgrundlage (Ticket): § 131 Abs. 1 Z 8 und § 132 BAO, § 16 UStG – der ursprüngliche Inhalt bleibt ersichtlich,
-- berichtigt wird im offenen Zeitraum. Neu:
--
--  1. ea_transaktionen: storniert_am/_von/_von_name/storno_grund am Original, storno_von_id an der Gegenbuchung (FK
--     RESTRICT, höchstens eine je Original), zahlung_id (Sync je Zahlung, D2b). Negative Beträge nur als Gegenbuchung.
--     Der AfA-Eindeutigkeitsindex (Anlage × Jahr) gilt nur noch für nicht stornierte Originale – nach einem Storno
--     lässt sich die AfA neu buchen.
--  2. Schutz-Trigger a_ea_storno_schutz (nur API-Rollen, außer im RPC-Kontext s112.ea_storno_rpc):
--       - anlegen ohne Storno-Angaben und ohne storno_von_id;
--       - stornierte Originale und Gegenbuchungen: unveränderlich bis auf is_locked, abgeglichen, bmd_export_id
--         (Monatsabschluss, UVA, Kontoabgleich und BMD-Export bleiben möglich) und nicht löschbar;
--       - Storno-Angaben nur über die RPCs.
--  3. zahlungen, konto_umbuchungen: Storno-Spalten; Schutz-Trigger (stornierte Zeile unveränderlich bis auf den
--     Abgleich, nicht löschbar; Stornieren nur per RPC). sync_verkaufsposten_bezahlt zählt stornierte Zahlungen nicht.
--  4. Interne Funktion s112_ea_gegenbuchung (ohne EXECUTE für Benutzer): sperrt das Original, bucht die negative Kopie
--     (ohne bank_ref, nicht gesperrt, nicht abgeglichen) und kennzeichnet das Original. Datum: p_datum, sonst das
--     des Originals, solange dessen Zeitraum offen ist (pruefe_ea_zeitraum_offen), sonst heute (Wien). Das Datum der
--     Gegenbuchung muss in einem offenen Zeitraum liegen. Auch gesperrte Originale lassen sich so stornieren.
--  5. RPCs (pruefe_tenant_zugriff SA/TA/winzer, Abo-Sperre, Schreibmodul, Grund ≥ 10 Zeichen, REVOKE, search_path):
--       s112_ea_stornieren(p_tenant_id, p_id, p_grund, p_datum)            → uuid der Gegenbuchung (Modul ea)
--       s112_zahlung_stornieren(p_tenant_id, p_zahlung_id, p_grund, p_datum) → Anzahl Gegenbuchungen
--                                           (Modul warenwirtschaft oder ea; bucht die E/A-Zeilen mit zahlung_id gegen)
--       s112_umbuchung_stornieren(p_tenant_id, p_id, p_grund)             → void (Modul ea)
--     Verkaufs-Einnahmen ohne zahlung_id (Altbestand Sandbox/Musterhof) behandelt der Sync in D2b.
--  6. Änderungsprotokoll an allen drei Tabellen (bisher keines): z_protokoll_aendern/_loeschen/_truncate.
-- Kein session_replication_role (KAN-124). Bestehende Zeilen bleiben unverändert.

-- 1. ea_transaktionen ─────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.ea_transaktionen
  ADD COLUMN IF NOT EXISTS storniert_am timestamptz,
  ADD COLUMN IF NOT EXISTS storniert_von uuid,
  ADD COLUMN IF NOT EXISTS storniert_von_name text,
  ADD COLUMN IF NOT EXISTS storno_grund text,
  ADD COLUMN IF NOT EXISTS storno_von_id uuid REFERENCES public.ea_transaktionen(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS zahlung_id uuid REFERENCES public.zahlungen(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.ea_transaktionen.storno_von_id IS 'KAN-149 D2: Gegenbuchung zu dieser (stornierten) Buchung – negativer Betrag';
COMMENT ON COLUMN public.ea_transaktionen.zahlung_id IS 'KAN-149 D2: Verkaufs-Einnahme aus dieser Zahlung (Sync je Zahlung)';
CREATE UNIQUE INDEX IF NOT EXISTS ea_transaktionen_storno_von_uniq ON public.ea_transaktionen (storno_von_id) WHERE storno_von_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ea_transaktionen_zahlung_idx ON public.ea_transaktionen (zahlung_id) WHERE zahlung_id IS NOT NULL;

ALTER TABLE public.ea_transaktionen DROP CONSTRAINT IF EXISTS ea_transaktionen_betrag_netto_check;
ALTER TABLE public.ea_transaktionen ADD CONSTRAINT ea_transaktionen_betrag_netto_check
  CHECK (betrag_netto >= 0 OR storno_von_id IS NOT NULL);
ALTER TABLE public.ea_transaktionen DROP CONSTRAINT IF EXISTS ea_transaktionen_gegenbuchung_check;
ALTER TABLE public.ea_transaktionen ADD CONSTRAINT ea_transaktionen_gegenbuchung_check
  CHECK (storno_von_id IS NULL OR storniert_am IS NULL);

DROP INDEX IF EXISTS public.ea_transaktionen_afa_je_jahr;
CREATE UNIQUE INDEX ea_transaktionen_afa_je_jahr
  ON public.ea_transaktionen (anlage_id, (EXTRACT(YEAR FROM datum)::int))
  WHERE anlage_id IS NOT NULL AND storno_von_id IS NULL AND storniert_am IS NULL;

-- 2./3. Schutz-Trigger ──────────────────────────────────────────────────────────────────────────────────────
-- Gemeinsam für ea_transaktionen, zahlungen, konto_umbuchungen. TG_ARGV: Spalten, die an stornierten Zeilen (und an
-- Gegenbuchungen) änderbar bleiben.
CREATE OR REPLACE FUNCTION public.s112_ea_storno_schutz()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rolle text := COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text);
  v_rpc   boolean := coalesce(current_setting('s112.ea_storno_rpc', true), '') = 'an';
  v_alt   jsonb;
  v_neu   jsonb;
  -- änderbare Spalten (TG_ARGV) und generierte Spalten (in BEFORE-Triggern noch leer; folgen aus betrag_netto/ust_satz)
  v_frei  text[] := TG_ARGV || ARRAY['ust_betrag', 'betrag_brutto', 'betrag_abzugsfaehig'];
  v_fest  boolean;
BEGIN
  IF v_rolle NOT IN ('authenticated', 'anon') OR v_rpc THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_neu := to_jsonb(NEW);
    IF v_neu ->> 'storniert_am' IS NOT NULL OR v_neu ->> 'storniert_von' IS NOT NULL OR v_neu ->> 'storniert_von_name' IS NOT NULL
       OR v_neu ->> 'storno_grund' IS NOT NULL OR v_neu ->> 'storno_von_id' IS NOT NULL THEN
      RAISE EXCEPTION 'Eine Buchung kann nicht storniert oder als Gegenbuchung angelegt werden – bitte „Stornieren“ verwenden (KAN-149).'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  v_alt := to_jsonb(OLD);
  v_fest := v_alt ->> 'storniert_am' IS NOT NULL OR v_alt ->> 'storno_von_id' IS NOT NULL;

  IF TG_OP = 'DELETE' THEN
    IF v_fest THEN
      RAISE EXCEPTION 'Stornierte Buchungen und Gegenbuchungen bleiben erhalten (§ 132 BAO, KAN-149).' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  v_neu := to_jsonb(NEW);
  IF v_fest THEN
    IF (v_neu - v_frei) IS DISTINCT FROM (v_alt - v_frei) THEN
      RAISE EXCEPTION 'Die Buchung ist storniert bzw. eine Gegenbuchung und bleibt unverändert (KAN-149).' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF v_neu ->> 'storniert_am' IS NOT NULL OR v_neu ->> 'storniert_von' IS NOT NULL OR v_neu ->> 'storniert_von_name' IS NOT NULL
     OR v_neu ->> 'storno_grund' IS NOT NULL OR v_neu ->> 'storno_von_id' IS NOT NULL THEN
    RAISE EXCEPTION 'Stornieren nur über „Stornieren“ (KAN-149).' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_ea_storno_schutz() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a_ea_storno_schutz ON public.ea_transaktionen;
CREATE TRIGGER a_ea_storno_schutz BEFORE INSERT OR UPDATE OR DELETE ON public.ea_transaktionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_ea_storno_schutz('is_locked', 'abgeglichen', 'bmd_export_id', 'aktualisiert_am');

ALTER TABLE public.zahlungen
  ADD COLUMN IF NOT EXISTS storniert_am timestamptz,
  ADD COLUMN IF NOT EXISTS storniert_von uuid,
  ADD COLUMN IF NOT EXISTS storniert_von_name text,
  ADD COLUMN IF NOT EXISTS storno_grund text;
DROP TRIGGER IF EXISTS a_ea_storno_schutz ON public.zahlungen;
CREATE TRIGGER a_ea_storno_schutz BEFORE INSERT OR UPDATE OR DELETE ON public.zahlungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_ea_storno_schutz('abgeglichen');

ALTER TABLE public.konto_umbuchungen
  ADD COLUMN IF NOT EXISTS storniert_am timestamptz,
  ADD COLUMN IF NOT EXISTS storniert_von uuid,
  ADD COLUMN IF NOT EXISTS storniert_von_name text,
  ADD COLUMN IF NOT EXISTS storno_grund text;
DROP TRIGGER IF EXISTS a_ea_storno_schutz ON public.konto_umbuchungen;
CREATE TRIGGER a_ea_storno_schutz BEFORE INSERT OR UPDATE OR DELETE ON public.konto_umbuchungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_ea_storno_schutz('von_abgeglichen', 'nach_abgeglichen');

-- „bezahlt“ nur aus nicht stornierten Zahlungen
CREATE OR REPLACE FUNCTION public.sync_verkaufsposten_bezahlt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id       uuid;
  v_tenant   uuid;
  v_gesamt   numeric(10,2);
  v_gezahlt  numeric(10,2);
BEGIN
  IF TG_OP <> 'DELETE' AND NEW.verkaufsposten_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM verkaufsposten v WHERE v.id = NEW.verkaufsposten_id AND v.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Der Verkaufsposten gehört nicht zu diesem Betrieb.' USING ERRCODE = '42501';
  END IF;

  FOR v_id, v_tenant IN
    SELECT DISTINCT x.id, x.tenant_id
      FROM (VALUES (CASE WHEN TG_OP <> 'INSERT' THEN OLD.verkaufsposten_id END, CASE WHEN TG_OP <> 'INSERT' THEN OLD.tenant_id END),
                   (CASE WHEN TG_OP <> 'DELETE' THEN NEW.verkaufsposten_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.tenant_id END)) AS x (id, tenant_id)
     WHERE x.id IS NOT NULL
  LOOP
    SELECT COALESCE(SUM(
      ROUND(vp.menge * COALESCE(vp.preis_brutto, 0)
        * (1 - COALESCE(vp.rabatt_pct, 0) / 100)
        * (1 - COALESCE(vp.sonderrabatt_pct, 0) / 100), 2)
    ), 0) INTO v_gesamt
    FROM verkauf_positionen vp WHERE vp.verkaufsposten_id = v_id;

    -- KAN-149 D2: stornierte Zahlungen zählen nicht
    SELECT COALESCE(SUM(betrag), 0) INTO v_gezahlt
    FROM zahlungen WHERE verkaufsposten_id = v_id AND tenant_id = v_tenant AND storniert_am IS NULL;

    UPDATE verkaufsposten
    SET bezahlt    = (v_gezahlt >= v_gesamt AND v_gesamt > 0),
        bezahlt_am = CASE WHEN v_gezahlt >= v_gesamt AND v_gesamt > 0 THEN now() ELSE NULL END
    WHERE id = v_id AND tenant_id = v_tenant;
  END LOOP;

  RETURN NULL;   -- AFTER-Trigger: Rückgabewert wird ignoriert
END;
$function$;

-- 4. Gegenbuchung (intern) ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_storno_benutzername(p_uid uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.display_name), ''))
       FROM public.profiles p WHERE p.user_id = p_uid OR p.id = p_uid ORDER BY (p.user_id = p_uid) DESC LIMIT 1),
    (SELECT u.email FROM auth.users u WHERE u.id = p_uid));
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_storno_benutzername(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.s112_ea_gegenbuchung(p_tenant_id uuid, p_id uuid, p_grund text, p_datum date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_o     record;
  v_datum date;
  v_offen boolean;
  v_warum text;
  v_id    uuid;
BEGIN
  SELECT e.* INTO v_o FROM public.ea_transaktionen e WHERE e.id = p_id AND e.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Buchung nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_o.storno_von_id IS NOT NULL THEN
    RAISE EXCEPTION 'Eine Gegenbuchung kann nicht storniert werden.' USING ERRCODE = '42501';
  END IF;
  IF v_o.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Die Buchung ist bereits storniert.' USING ERRCODE = '42501';
  END IF;

  -- Datum: vorgegeben, sonst das des Originals (offener Zeitraum), sonst heute (Wien)
  v_datum := p_datum;
  IF v_datum IS NULL THEN
    SELECT z.offen INTO v_offen FROM public.pruefe_ea_zeitraum_offen(p_tenant_id, v_o.datum) z;
    v_datum := CASE WHEN v_offen THEN v_o.datum ELSE (now() AT TIME ZONE 'Europe/Vienna')::date END;
  END IF;
  SELECT z.offen, z.grund INTO v_offen, v_warum FROM public.pruefe_ea_zeitraum_offen(p_tenant_id, v_datum) z;
  IF NOT v_offen THEN
    RAISE EXCEPTION 'Die Gegenbuchung am % ist nicht möglich: %', to_char(v_datum, 'DD.MM.YYYY'), v_warum USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('s112.ea_storno_rpc', 'an', true);
  INSERT INTO public.ea_transaktionen
    (tenant_id, typ, datum, beschreibung, kategorie_id, betrag_netto, ust_satz, is_locked, dauerauftrag_id, import_quelle,
     bank_ref, notizen, verkaufsposten_id, konto_id, abgeglichen, firma_id, abzugsfaehig_pct, anlage_id, storno_von_id, zahlung_id)
  VALUES
    (v_o.tenant_id, v_o.typ, v_datum, left('Storno: ' || COALESCE(v_o.beschreibung, ''), 500), v_o.kategorie_id, -v_o.betrag_netto,
     v_o.ust_satz, false, v_o.dauerauftrag_id, v_o.import_quelle, NULL, btrim(p_grund), v_o.verkaufsposten_id, v_o.konto_id,
     false, v_o.firma_id, v_o.abzugsfaehig_pct, v_o.anlage_id, v_o.id, v_o.zahlung_id)
  RETURNING id INTO v_id;
  UPDATE public.ea_transaktionen
     SET storniert_am = now(), storniert_von = auth.uid(), storniert_von_name = public.s112_storno_benutzername(auth.uid()),
         storno_grund = btrim(p_grund)
   WHERE id = v_o.id;
  PERFORM set_config('s112.ea_storno_rpc', '', true);
  RETURN v_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_ea_gegenbuchung(uuid, uuid, text, date) FROM PUBLIC, anon, authenticated;

-- 5. RPCs ─────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_ea_stornieren(p_tenant_id uuid, p_id uuid, p_grund text, p_datum date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'ea');
  IF length(btrim(COALESCE(p_grund, ''))) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für den Storno angeben (mindestens 10 Zeichen).' USING ERRCODE = '23514';
  END IF;
  RETURN public.s112_ea_gegenbuchung(p_tenant_id, p_id, p_grund, p_datum);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_ea_stornieren(uuid, uuid, text, date) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.s112_zahlung_stornieren(p_tenant_id uuid, p_zahlung_id uuid, p_grund text, p_datum date DEFAULT NULL::date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_z  record;
  v_ea uuid;
  v_n  integer := 0;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft', 'ea');
  IF length(btrim(COALESCE(p_grund, ''))) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für den Storno angeben (mindestens 10 Zeichen).' USING ERRCODE = '23514';
  END IF;
  SELECT z.* INTO v_z FROM public.zahlungen z WHERE z.id = p_zahlung_id AND z.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Zahlung nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_z.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Die Zahlung ist bereits storniert.' USING ERRCODE = '42501';
  END IF;

  -- E/A-Einnahmen dieser Zahlung gegenbuchen (Verkaufs-Einnahmen je Zahlung, D2b)
  FOR v_ea IN
    SELECT e.id FROM public.ea_transaktionen e
     WHERE e.tenant_id = p_tenant_id AND e.zahlung_id = p_zahlung_id AND e.storniert_am IS NULL AND e.storno_von_id IS NULL
     ORDER BY e.id
  LOOP
    PERFORM public.s112_ea_gegenbuchung(p_tenant_id, v_ea, p_grund, p_datum);
    v_n := v_n + 1;
  END LOOP;

  PERFORM set_config('s112.ea_storno_rpc', 'an', true);
  UPDATE public.zahlungen
     SET storniert_am = now(), storniert_von = auth.uid(), storniert_von_name = public.s112_storno_benutzername(auth.uid()),
         storno_grund = btrim(p_grund)
   WHERE id = p_zahlung_id;
  PERFORM set_config('s112.ea_storno_rpc', '', true);
  RETURN v_n;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_zahlung_stornieren(uuid, uuid, text, date) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.s112_umbuchung_stornieren(p_tenant_id uuid, p_id uuid, p_grund text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_u record;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'ea');
  IF length(btrim(COALESCE(p_grund, ''))) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für den Storno angeben (mindestens 10 Zeichen).' USING ERRCODE = '23514';
  END IF;
  SELECT k.* INTO v_u FROM public.konto_umbuchungen k WHERE k.id = p_id AND k.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Umbuchung nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_u.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Die Umbuchung ist bereits storniert.' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('s112.ea_storno_rpc', 'an', true);
  UPDATE public.konto_umbuchungen
     SET storniert_am = now(), storniert_von = auth.uid(), storniert_von_name = public.s112_storno_benutzername(auth.uid()),
         storno_grund = btrim(p_grund)
   WHERE id = p_id;
  PERFORM set_config('s112.ea_storno_rpc', '', true);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_umbuchung_stornieren(uuid, uuid, text) FROM PUBLIC, anon;

-- 6. Änderungsprotokoll ───────────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.ea_transaktionen;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF betrag_netto, ust_satz, datum, typ, kategorie_id, is_locked, tenant_id,
  storniert_am, storno_grund ON public.ea_transaktionen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('betrag_netto', 'ust_satz', 'datum', 'typ', 'kategorie_id',
  'is_locked', 'tenant_id', 'storniert_am', 'storno_grund');
DROP TRIGGER IF EXISTS z_protokoll_loeschen ON public.ea_transaktionen;
CREATE TRIGGER z_protokoll_loeschen AFTER DELETE ON public.ea_transaktionen FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben();
DROP TRIGGER IF EXISTS z_protokoll_truncate ON public.ea_transaktionen;
CREATE TRIGGER z_protokoll_truncate BEFORE TRUNCATE ON public.ea_transaktionen FOR EACH STATEMENT EXECUTE FUNCTION public.bestandsprotokoll_schreiben();

DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.zahlungen;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF betrag, datum, verkaufsposten_id, konto_id, tenant_id, storniert_am, storno_grund
  ON public.zahlungen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('betrag', 'datum', 'verkaufsposten_id', 'konto_id', 'tenant_id',
  'storniert_am', 'storno_grund');
DROP TRIGGER IF EXISTS z_protokoll_loeschen ON public.zahlungen;
CREATE TRIGGER z_protokoll_loeschen AFTER DELETE ON public.zahlungen FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben();
DROP TRIGGER IF EXISTS z_protokoll_truncate ON public.zahlungen;
CREATE TRIGGER z_protokoll_truncate BEFORE TRUNCATE ON public.zahlungen FOR EACH STATEMENT EXECUTE FUNCTION public.bestandsprotokoll_schreiben();

DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.konto_umbuchungen;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF betrag, datum, von_konto_id, nach_konto_id, tenant_id, storniert_am, storno_grund
  ON public.konto_umbuchungen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('betrag', 'datum', 'von_konto_id', 'nach_konto_id', 'tenant_id',
  'storniert_am', 'storno_grund');
DROP TRIGGER IF EXISTS z_protokoll_loeschen ON public.konto_umbuchungen;
CREATE TRIGGER z_protokoll_loeschen AFTER DELETE ON public.konto_umbuchungen FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben();
DROP TRIGGER IF EXISTS z_protokoll_truncate ON public.konto_umbuchungen;
CREATE TRIGGER z_protokoll_truncate BEFORE TRUNCATE ON public.konto_umbuchungen FOR EACH STATEMENT EXECUTE FUNCTION public.bestandsprotokoll_schreiben();

-- Selbstprüfung
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'a_ea_storno_schutz'
        AND tgrelid IN ('public.ea_transaktionen'::regclass, 'public.zahlungen'::regclass, 'public.konto_umbuchungen'::regclass)) <> 3 THEN
    RAISE EXCEPTION 'KAN-149 D2: Schutz-Trigger fehlen';
  END IF;
  IF has_function_privilege('authenticated', 'public.s112_ea_gegenbuchung(uuid, uuid, text, date)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.s112_storno_benutzername(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.s112_ea_storno_schutz()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.s112_ea_stornieren(uuid, uuid, text, date)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.s112_zahlung_stornieren(uuid, uuid, text, date)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.s112_umbuchung_stornieren(uuid, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'KAN-149 D2: EXECUTE-Rechte falsch';
  END IF;
END $$;
