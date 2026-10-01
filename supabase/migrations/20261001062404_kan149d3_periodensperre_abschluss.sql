-- KAN-149 (Folgeticket D), Etappe D3: Periodensperre und Abschluss in der Datenbank, Löschsperre scharf für Verkauf
-- und E/A, Storno-Grund beim Verkauf verpflichtend
--
-- Seit D1/D2 storniert die App Verkäufe, Zahlungen, Umbuchungen, E/A-Buchungen und AfA statt zu löschen und prüft
-- abgeschlossene Zeiträume selbst. Jetzt erzwingt das die Datenbank auch für direkte API-Aufrufe (Ticket Soll 7–9):
--
--  0. Wartung: s112_wartung_frei(tenant) – Service-Role/SQL-Editor mit transaktionslokalem Flag s112.loeschen_erlaubt
--     ('<tenant_id>' bzw. '*', KAN-145 A) oder Demo-Reset (s112.protokoll_aus = Musterhof); nie für authenticated/anon.
--  1. Periodensperre: Trigger a_ea_periodensperre (BEFORE INSERT/UPDATE/DELETE) an ea_transaktionen, zahlungen und
--     konto_umbuchungen. Liegt das Datum (alt und neu) in einem abgeschlossenen Monat oder einem per UVA übermittelten
--     Zeitraum, lehnt er mit 42501 ab. Ausgenommen: Abgleich (abgeglichen, von_/nach_abgeglichen), is_locked
--     (sperre_ea_*), bmd_export_id, die Storno-Kennzeichen (RPCs aus D2), aktualisiert_am, generierte Spalten und
--     Verweise, die per FK auf NULL fallen (Firma, Verkauf, Zahlung, Dauerauftrag). Neu: Buchungen nicht gesperrt
--     anlegen (is_locked), gesperrte nicht entsperren. Gilt für alle Rollen – auch die Service-Role (Sync aus D2b
--     prüft vorher und bucht dann heute). Die Prüfung steckt in s112_ea_zeitraum_sperrgrund (ohne Zugriffsprüfung);
--     pruefe_ea_zeitraum_offen nutzt sie, Meldungen unverändert.
--  2. Abschluss unveränderlich (Soll 8): Trigger a_ea_abschluss_schutz
--       - ea_monatsabschluss: nicht änderbar, nicht löschbar (Abschluss aufheben nur per Wartung, Frage 6);
--       - ea_uva: gesperrte Meldung nicht änderbar/löschbar, nicht gesperrt anlegen; sperren nur über sperre_ea_uva
--         (setzt jetzt das Flag s112.ea_sperre und sperrt nur noch offene Meldungen);
--       - ea_belege: verbuchter Beleg nicht änderbar/löschbar.
--     Storage „ea-belege“: Löschen nur für Dateien ohne verbuchten Beleg.
--  3. Protokoll (z_protokoll_aendern/_loeschen/_truncate) an ea_uva, ea_monatsabschluss und ea_belege.
--  4. Löschsperre scharf (Soll 9): s112_loeschsperre an verkaufsposten, zahlungen, ea_transaktionen,
--     konto_umbuchungen (Modus 'storno') und verkauf_positionen (Modus 'kind'). Die Lösch-RPC s112_storniert_loeschen
--     kennt diese Tabellen bewusst nicht (Frage 2: § 132 BAO, Rechnungsnummern lückenlos). Die DELETE-Policies
--     verkaufsposten_delete, verkauf_pos_delete, zahlungen_delete, ea_tx_delete, konto_umbuchungen_delete entfallen,
--     dazu RESTRICTIVE keine_direktloeschung (wie KAN-145 B4).
--  5. Konten (Entscheidung 3): Löschen nur ohne Zahlungen, E/A-Buchungen, Daueraufträge und Umbuchungen – sonst
--     42501 mit Hinweis auf Deaktivieren (Trigger a_konto_loeschsperre).
--  6. Verkaufsstorno: Grund (≥ 10 Zeichen) jetzt Pflicht (s112_verkauf_storno_schutz, Übergang aus D1 endet).
--     Bestehende stornierte Verkäufe ohne Grund bleiben, wie sie sind.
-- Keine Datenänderung. Kein session_replication_role (KAN-124).

-- 0. Wartung ──────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_wartung_frei(p_tenant uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text) NOT IN ('authenticated', 'anon')
     AND (NULLIF(current_setting('s112.loeschen_erlaubt', true), '') IN ('*', p_tenant::text)
          OR (current_setting('s112.protokoll_aus', true) = '33333333-3333-4333-8333-333333333333'
              AND p_tenant = '33333333-3333-4333-8333-333333333333'::uuid));
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_wartung_frei(uuid) FROM PUBLIC, anon, authenticated;

-- 1. Periodensperre ───────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_ea_zeitraum_sperrgrund(p_tenant_id uuid, p_datum date)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_jahr    smallint;
  v_monat   smallint;
  v_quartal text;
BEGIN
  IF p_tenant_id IS NULL OR p_datum IS NULL THEN
    RETURN NULL;
  END IF;
  v_jahr    := EXTRACT(YEAR  FROM p_datum)::smallint;
  v_monat   := EXTRACT(MONTH FROM p_datum)::smallint;
  v_quartal := 'Q' || CEIL(v_monat / 3.0)::int;
  IF EXISTS (SELECT 1 FROM public.ea_monatsabschluss
              WHERE tenant_id = p_tenant_id AND jahr = v_jahr AND monat = v_monat) THEN
    RETURN format('Monat %s/%s ist bereits abgeschlossen.', v_monat, v_jahr);
  END IF;
  IF EXISTS (SELECT 1 FROM public.ea_uva
              WHERE tenant_id = p_tenant_id AND jahr = v_jahr AND gesperrt = true
                AND zeitraum IN (v_quartal, lpad(v_monat::text, 2, '0'))) THEN
    RETURN 'Zeitraum wurde bereits per UVA übermittelt.';
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_ea_zeitraum_sperrgrund(uuid, date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pruefe_ea_zeitraum_offen(p_tenant_id uuid, p_datum date)
 RETURNS TABLE(offen boolean, grund text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_grund text;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id);
  v_grund := public.s112_ea_zeitraum_sperrgrund(p_tenant_id, p_datum);
  RETURN QUERY SELECT v_grund IS NULL, v_grund;
END;
$function$;

-- TG_ARGV[0]: änderbare Spalten (Komma), TG_ARGV[1]: Verweise, die per FK auf NULL fallen dürfen (Komma)
CREATE OR REPLACE FUNCTION public.s112_ea_periodensperre()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_frei    text[] := string_to_array(COALESCE(TG_ARGV[0], ''), ',');
  v_verweis text[] := string_to_array(COALESCE(TG_ARGV[1], ''), ',');
  v_gen     text[];
  v_alt     jsonb;
  v_neu     jsonb;
  v_k       text;
  v_d       date;
  v_grund   text;
BEGIN
  IF public.s112_wartung_frei(CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_neu := to_jsonb(NEW);
    IF (v_neu ->> 'is_locked')::boolean IS TRUE THEN
      RAISE EXCEPTION 'Buchungen werden nicht gesperrt angelegt – gesperrt wird über Monatsabschluss bzw. UVA.' USING ERRCODE = '42501';
    END IF;
    v_d := (v_neu ->> 'datum')::date;
    v_grund := public.s112_ea_zeitraum_sperrgrund(NEW.tenant_id, v_d);
    IF v_grund IS NOT NULL THEN
      RAISE EXCEPTION 'Buchung mit Datum % nicht möglich: % Bitte ein Datum im offenen Zeitraum wählen.', to_char(v_d, 'DD.MM.YYYY'), v_grund
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  v_alt := to_jsonb(OLD);
  IF TG_OP = 'DELETE' THEN
    v_d := (v_alt ->> 'datum')::date;
    v_grund := public.s112_ea_zeitraum_sperrgrund(OLD.tenant_id, v_d);
    IF v_grund IS NOT NULL THEN
      RAISE EXCEPTION 'Die Buchung vom % lässt sich nicht löschen: % Berichtigungen bitte stornieren.', to_char(v_d, 'DD.MM.YYYY'), v_grund
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  v_neu := to_jsonb(NEW);
  IF (v_alt ->> 'is_locked')::boolean IS TRUE AND (v_neu ->> 'is_locked')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Gesperrte Buchungen lassen sich nicht entsperren (Monatsabschluss bzw. UVA).' USING ERRCODE = '42501';
  END IF;
  -- generierte Spalten sind in BEFORE-Triggern noch leer und folgen ohnehin aus den übrigen
  SELECT COALESCE(array_agg(a.attname::text), '{}') INTO v_gen
    FROM pg_attribute a WHERE a.attrelid = TG_RELID AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated <> '';
  v_alt := v_alt - (v_frei || v_gen);
  v_neu := v_neu - (v_frei || v_gen);
  FOREACH v_k IN ARRAY v_verweis LOOP
    IF v_neu -> v_k = 'null'::jsonb THEN
      v_alt := v_alt - v_k;
      v_neu := v_neu - v_k;
    END IF;
  END LOOP;
  IF v_alt = v_neu THEN
    RETURN NEW;
  END IF;

  v_d := (v_alt ->> 'datum')::date;
  v_grund := public.s112_ea_zeitraum_sperrgrund(OLD.tenant_id, v_d);
  IF v_grund IS NULL AND (v_neu ->> 'datum')::date IS DISTINCT FROM v_d THEN
    v_d := (v_neu ->> 'datum')::date;
    v_grund := public.s112_ea_zeitraum_sperrgrund(NEW.tenant_id, v_d);
  END IF;
  IF v_grund IS NOT NULL THEN
    RAISE EXCEPTION 'Buchung mit Datum % lässt sich nicht ändern: % Berichtigungen bitte stornieren – die Gegenbuchung kommt in einen offenen Zeitraum.',
      to_char(v_d, 'DD.MM.YYYY'), v_grund USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_ea_periodensperre() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a_ea_periodensperre ON public.ea_transaktionen;
CREATE TRIGGER a_ea_periodensperre BEFORE INSERT OR UPDATE OR DELETE ON public.ea_transaktionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_ea_periodensperre(
    'is_locked,abgeglichen,bmd_export_id,aktualisiert_am,storniert_am,storniert_von,storniert_von_name,storno_grund',
    'firma_id,verkaufsposten_id,zahlung_id,dauerauftrag_id');
DROP TRIGGER IF EXISTS a_ea_periodensperre ON public.zahlungen;
CREATE TRIGGER a_ea_periodensperre BEFORE INSERT OR UPDATE OR DELETE ON public.zahlungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_ea_periodensperre(
    'abgeglichen,storniert_am,storniert_von,storniert_von_name,storno_grund', '');
DROP TRIGGER IF EXISTS a_ea_periodensperre ON public.konto_umbuchungen;
CREATE TRIGGER a_ea_periodensperre BEFORE INSERT OR UPDATE OR DELETE ON public.konto_umbuchungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_ea_periodensperre(
    'von_abgeglichen,nach_abgeglichen,storniert_am,storniert_von,storniert_von_name,storno_grund', '');

-- 2. Abschluss unveränderlich ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_ea_abschluss_schutz()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_alt jsonb;
  v_neu jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_alt := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_neu := to_jsonb(NEW); END IF;
  IF public.s112_wartung_frei((COALESCE(v_alt, v_neu) ->> 'tenant_id')::uuid) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_TABLE_NAME = 'ea_monatsabschluss' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      RAISE EXCEPTION 'Der Monatsabschluss %/% ist endgültig – er lässt sich nicht ändern oder aufheben.', v_alt ->> 'monat', v_alt ->> 'jahr'
        USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'ea_uva' THEN
    IF TG_OP = 'INSERT' AND (v_neu ->> 'gesperrt')::boolean IS TRUE THEN
      RAISE EXCEPTION 'Eine UVA wird über „Als übermittelt markieren“ gesperrt, nicht beim Anlegen.' USING ERRCODE = '42501';
    END IF;
    IF TG_OP IN ('UPDATE', 'DELETE') AND (v_alt ->> 'gesperrt')::boolean IS TRUE THEN
      RAISE EXCEPTION 'Die UVA % % ist übermittelt (gesperrt) und bleibt unverändert – eine Berichtigung wird eine eigene Meldung.',
        v_alt ->> 'zeitraum', v_alt ->> 'jahr' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND (v_neu ->> 'gesperrt')::boolean IS TRUE
       AND COALESCE(current_setting('s112.ea_sperre', true), '') <> 'an' THEN
      RAISE EXCEPTION 'Gesperrt wird eine UVA nur über „Als übermittelt markieren“ (prüft die Monatsabschlüsse).' USING ERRCODE = '42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'ea_belege' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') AND v_alt ->> 'status' = 'verbucht' THEN
      RAISE EXCEPTION 'Der Beleg „%“ ist verbucht und bleibt als Nachweis unverändert (§ 132 BAO).', v_alt ->> 'dateiname' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_ea_abschluss_schutz() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a_ea_abschluss_schutz ON public.ea_monatsabschluss;
CREATE TRIGGER a_ea_abschluss_schutz BEFORE UPDATE OR DELETE ON public.ea_monatsabschluss
  FOR EACH ROW EXECUTE FUNCTION public.s112_ea_abschluss_schutz();
DROP TRIGGER IF EXISTS a_ea_abschluss_schutz ON public.ea_uva;
CREATE TRIGGER a_ea_abschluss_schutz BEFORE INSERT OR UPDATE OR DELETE ON public.ea_uva
  FOR EACH ROW EXECUTE FUNCTION public.s112_ea_abschluss_schutz();
DROP TRIGGER IF EXISTS a_ea_abschluss_schutz ON public.ea_belege;
CREATE TRIGGER a_ea_abschluss_schutz BEFORE UPDATE OR DELETE ON public.ea_belege
  FOR EACH ROW EXECUTE FUNCTION public.s112_ea_abschluss_schutz();

-- sperre_ea_uva: Flag für den Schutz-Trigger, nur offene Meldungen sperren (sonst unverändert)
CREATE OR REPLACE FUNCTION public.sperre_ea_uva(p_tenant_id uuid, p_jahr smallint, p_zeitraum text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_von      date;
  v_bis      date;
  v_monate   smallint[];
  v_monat    smallint;
  v_fehlende smallint[] := '{}';
  v_beginn   date;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);   -- KAN-5 Nur-Lesen-Modus

  SELECT ea_betriebsbeginn INTO v_beginn
  FROM tenant_einstellungen WHERE tenant_id = p_tenant_id;

  IF p_zeitraum IN ('Q1','Q2','Q3','Q4') THEN
    v_von := make_date(p_jahr, (CASE p_zeitraum WHEN 'Q1' THEN 1 WHEN 'Q2' THEN 4 WHEN 'Q3' THEN 7 ELSE 10 END), 1);
    v_bis := (v_von + INTERVAL '3 months' - INTERVAL '1 day')::date;
    v_monate := ARRAY[
      EXTRACT(MONTH FROM v_von)::smallint,
      EXTRACT(MONTH FROM v_von + INTERVAL '1 month')::smallint,
      EXTRACT(MONTH FROM v_von + INTERVAL '2 months')::smallint
    ];
  ELSE
    v_von := make_date(p_jahr, p_zeitraum::smallint, 1);
    v_bis := (v_von + INTERVAL '1 month' - INTERVAL '1 day')::date;
    v_monate := ARRAY[p_zeitraum::smallint];
  END IF;

  FOREACH v_monat IN ARRAY v_monate LOOP
    -- Migration 180: Monate, die vollständig vor dem Betriebsbeginn enden, brauchen keinen Abschluss
    IF v_beginn IS NOT NULL
       AND (make_date(p_jahr, v_monat, 1) + INTERVAL '1 month' - INTERVAL '1 day')::date < v_beginn THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM ea_monatsabschluss
      WHERE tenant_id = p_tenant_id AND jahr = p_jahr AND monat = v_monat
    ) THEN
      v_fehlende := array_append(v_fehlende, v_monat);
    END IF;
  END LOOP;

  IF array_length(v_fehlende, 1) > 0 THEN
    RAISE EXCEPTION
      'Monatsabschluss fehlt für Monat(e) % / % – die UVA kann erst übermittelt werden, wenn alle Monate dieser Periode abgeschlossen sind.',
      array_to_string(v_fehlende, ', '), p_jahr;
  END IF;

  UPDATE ea_transaktionen
  SET is_locked = true
  WHERE tenant_id = p_tenant_id
    AND datum BETWEEN v_von AND v_bis;

  -- KAN-149 D3: der Schutz-Trigger an ea_uva lässt das Sperren nur mit diesem Flag zu
  PERFORM set_config('s112.ea_sperre', 'an', true);
  UPDATE ea_uva
  SET gesperrt = true, gesperrt_am = now()
  WHERE tenant_id = p_tenant_id AND jahr = p_jahr AND zeitraum = p_zeitraum AND NOT gesperrt;
  PERFORM set_config('s112.ea_sperre', '', true);
END;
$function$;

-- Storage „ea-belege“: Löschen nur für Dateien ohne verbuchten Beleg
DROP POLICY IF EXISTS "ea-belege: Löschen (Schreibrecht ea)" ON storage.objects;
CREATE POLICY "ea-belege: Löschen (Schreibrecht ea)" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'ea-belege'
         AND EXISTS (SELECT 1 FROM public.s112_meine_tenants() m(tenant_id)
                      WHERE m.tenant_id::text = (storage.foldername(objects.name))[1]
                        AND public.s112_darf_schreiben(m.tenant_id, VARIADIC ARRAY['ea']))
         AND NOT EXISTS (SELECT 1 FROM public.ea_belege b
                          WHERE b.storage_pfad = objects.name AND b.status = 'verbucht'));

-- 3. Protokoll ────────────────────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.ea_uva;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF gesperrt, gesperrt_am, zahllast, ust_gesamt, vst_gesamt, jahr, zeitraum, tenant_id
  ON public.ea_uva FOR EACH ROW
  EXECUTE FUNCTION public.bestandsprotokoll_schreiben('gesperrt', 'gesperrt_am', 'zahllast', 'ust_gesamt', 'vst_gesamt', 'jahr', 'zeitraum', 'tenant_id');
DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.ea_monatsabschluss;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF jahr, monat, tenant_id
  ON public.ea_monatsabschluss FOR EACH ROW
  EXECUTE FUNCTION public.bestandsprotokoll_schreiben('jahr', 'monat', 'tenant_id');
DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.ea_belege;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF status, ea_transaktion_id, storage_pfad, dateiname, tenant_id
  ON public.ea_belege FOR EACH ROW
  EXECUTE FUNCTION public.bestandsprotokoll_schreiben('status', 'ea_transaktion_id', 'storage_pfad', 'dateiname', 'tenant_id');
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ea_uva', 'ea_monatsabschluss', 'ea_belege'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS z_protokoll_loeschen ON public.%I', t);
    EXECUTE format('CREATE TRIGGER z_protokoll_loeschen AFTER DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS z_protokoll_truncate ON public.%I', t);
    EXECUTE format('CREATE TRIGGER z_protokoll_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.bestandsprotokoll_schreiben()', t);
  END LOOP;
END $$;

-- 4. Löschsperre scharf ───────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['verkaufsposten', 'zahlungen', 'ea_transaktionen', 'konto_umbuchungen'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS a_loeschsperre ON public.%I', t);
    EXECUTE format('CREATE TRIGGER a_loeschsperre BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.s112_loeschsperre(%L)', t, 'storno');
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS a_loeschsperre ON public.verkauf_positionen;
CREATE TRIGGER a_loeschsperre BEFORE DELETE ON public.verkauf_positionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_loeschsperre('kind', 'verkaufsposten_id');

DROP POLICY IF EXISTS verkaufsposten_delete ON public.verkaufsposten;
DROP POLICY IF EXISTS verkauf_pos_delete ON public.verkauf_positionen;
DROP POLICY IF EXISTS zahlungen_delete ON public.zahlungen;
DROP POLICY IF EXISTS ea_tx_delete ON public.ea_transaktionen;
DROP POLICY IF EXISTS konto_umbuchungen_delete ON public.konto_umbuchungen;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['verkaufsposten', 'verkauf_positionen', 'zahlungen', 'ea_transaktionen', 'konto_umbuchungen'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS keine_direktloeschung ON public.%I', t);
    EXECUTE format('CREATE POLICY keine_direktloeschung ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (false)', t);
  END LOOP;
END $$;

-- 5. Konten: Löschen nur ohne Bewegungen ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_konto_loeschsperre()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.s112_wartung_frei(OLD.tenant_id) THEN
    RETURN OLD;
  END IF;
  IF EXISTS (SELECT 1 FROM public.zahlungen z WHERE z.konto_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.ea_transaktionen e WHERE e.konto_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.ea_dauerauftraege d WHERE d.konto_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.konto_umbuchungen u WHERE u.von_konto_id = OLD.id OR u.nach_konto_id = OLD.id) THEN
    RAISE EXCEPTION 'Das Konto „%“ hat Buchungen, Zahlungen, Umbuchungen oder Daueraufträge – bitte deaktivieren statt löschen.', OLD.name
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_konto_loeschsperre() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS a_konto_loeschsperre ON public.konten;
CREATE TRIGGER a_konto_loeschsperre BEFORE DELETE ON public.konten
  FOR EACH ROW EXECUTE FUNCTION public.s112_konto_loeschsperre();

-- 6. Verkaufsstorno: Grund Pflicht ────────────────────────────────────────────────────────────────────────
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

  -- Stornieren: Grund Pflicht (seit D3), Zeitpunkt, Benutzer und Name setzt die Datenbank
  IF NEW.storniert THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'Stornieren nur als angemeldeter Benutzer (KAN-149).' USING ERRCODE = '42501';
    END IF;
    IF length(btrim(COALESCE(NEW.storno_grund, ''))) < 10 THEN
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
    NEW.storno_grund := btrim(NEW.storno_grund);
    RETURN NEW;
  END IF;

  -- Nicht storniert: keine Storno-Angaben ohne Storno
  IF NEW.storniert_am IS NOT NULL OR NEW.storniert_von IS NOT NULL OR NEW.storniert_von_name IS NOT NULL OR NEW.storno_grund IS NOT NULL THEN
    RAISE EXCEPTION 'Storno-Angaben nur zusammen mit dem Stornieren (KAN-149).' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
