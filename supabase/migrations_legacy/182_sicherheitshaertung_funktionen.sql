-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 182: Sicherheitshärtung der Datenbankfunktionen
--
-- Anlass (Security-Check 27.8.2026, Supabase Security Advisor):
--   1. 25 SECURITY-DEFINER-Funktionen waren über PostgREST für die Rollen
--      anon UND authenticated aufrufbar. Funktionen mit p_tenant_id-Parameter
--      haben intern NICHT geprüft, ob der Aufrufer Mitglied dieses Betriebs
--      ist (die Rollenprüfung passierte nur in der App). Ein angemeldeter
--      Nutzer hätte per Direktaufruf z. B. UVA-Perioden eines fremden
--      Betriebs sperren oder Nummernkreise hochzählen können.
--   2. 27 Funktionen ohne festen search_path (function_search_path_mutable).
--
-- Maßnahmen:
--   A. Zentrale Prüfung pruefe_tenant_zugriff(p_tenant_id, p_rollen):
--      Aufrufer muss angemeldet und aktives Mitglied des Betriebs sein,
--      optional mit einer der genannten Rollen. Aufrufe mit Service-Role-Key
--      (Admin-Client, Cron) und direkte DB-Sessions (SQL-Editor, pg_cron)
--      bleiben erlaubt – dort gibt es keinen auth.uid().
--   B. Jede Funktion mit Tenant-Parameter ruft diese Prüfung auf:
--        - lesen / zählen:     jedes aktive Mitglied
--        - Nummernkreise, Abgleich, KI-Zähler: schreibende Rollen
--        - Monats-/UVA-Sperre: nur Admin-Rollen (wie in der App)
--   C. EXECUTE für anon und PUBLIC auf allen Funktionen entzogen. Reine
--      Trigger-/Cron-Funktionen sind auch für authenticated nicht mehr
--      aufrufbar (nur service_role/postgres). Default-Privilegien so gesetzt,
--      dass künftige Funktionen nicht automatisch für anon freigegeben werden.
--   D. SET search_path = public auf allen Funktionen.
--
-- Die RLS-Hilfsfunktionen (get_user_tenant_ids, user_has_role_in_tenant,
-- get_user_role_in_tenant, tenant_has_module) sind an auth.uid() gebunden und
-- bleiben für authenticated ausführbar – RLS-Policies brauchen sie.
-- Idempotent (CREATE OR REPLACE, REVOKE ist wiederholbar).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── A. Zentrale Zugriffsprüfung ──────────────────────────────────────────────

-- Service-Kontext = Aufruf mit Service-Role-Key (Admin-Client, Cron-Routen)
-- oder direkte Datenbank-Session ohne JWT (SQL-Editor, pg_cron).
CREATE OR REPLACE FUNCTION public.ist_service_kontext()
RETURNS boolean
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_role   text;
BEGIN
  IF v_claims IS NULL THEN
    -- kein JWT: direkte DB-Session (postgres, pg_cron, SQL-Editor)
    RETURN nullif(current_setting('request.jwt.claim.role', true), '') IS NULL;
  END IF;
  BEGIN
    v_role := v_claims::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_role := NULL;
  END;
  RETURN v_role = 'service_role';
END;
$$;

COMMENT ON FUNCTION public.ist_service_kontext() IS
  'true bei Service-Role-Aufruf (Admin-Client/Cron) oder direkter DB-Session ohne JWT. Migration 182.';

CREATE OR REPLACE FUNCTION public.pruefe_tenant_zugriff(p_tenant_id uuid, p_rollen text[] DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.ist_service_kontext() THEN
    RETURN;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet' USING ERRCODE = '42501';
  END IF;

  IF p_tenant_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM tenant_memberships
    WHERE user_id   = auth.uid()
      AND tenant_id = p_tenant_id
      AND aktiv     = true
      AND (p_rollen IS NULL OR role = ANY(p_rollen))
  ) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Betrieb' USING ERRCODE = '42501';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.pruefe_tenant_zugriff(uuid, text[]) IS
  'Wirft 42501, wenn der angemeldete Nutzer kein aktives Mitglied des Betriebs ist (optional mit Rolle). Service-Role/DB-Session passieren. Migration 182.';

-- ── B. Funktionen mit Tenant-Parameter: interne Prüfung ──────────────────────

-- Lesend: jedes aktive Mitglied
CREATE OR REPLACE FUNCTION public.berechne_ea_uva(p_tenant_id uuid, p_jahr smallint, p_zeitraum text)
RETURNS TABLE(bmgl_0 numeric, bmgl_10 numeric, bmgl_13 numeric, bmgl_20 numeric, ust_10 numeric, ust_13 numeric, ust_20 numeric, vst_10 numeric, vst_13 numeric, vst_20 numeric)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_von date;
  v_bis date;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id);

  IF p_zeitraum IN ('Q1','Q2','Q3','Q4') THEN
    v_von := make_date(p_jahr, (CASE p_zeitraum WHEN 'Q1' THEN 1 WHEN 'Q2' THEN 4 WHEN 'Q3' THEN 7 ELSE 10 END), 1);
    v_bis := (v_von + INTERVAL '3 months' - INTERVAL '1 day')::date;
  ELSE
    v_von := make_date(p_jahr, p_zeitraum::smallint, 1);
    v_bis := (v_von + INTERVAL '1 month' - INTERVAL '1 day')::date;
  END IF;

  RETURN QUERY
  SELECT
    SUM(CASE WHEN t.typ='einnahme' AND t.ust_satz=0  THEN t.betrag_netto ELSE 0 END),
    SUM(CASE WHEN t.typ='einnahme' AND t.ust_satz=10 THEN t.betrag_netto ELSE 0 END),
    SUM(CASE WHEN t.typ='einnahme' AND t.ust_satz=13 THEN t.betrag_netto ELSE 0 END),
    SUM(CASE WHEN t.typ='einnahme' AND t.ust_satz=20 THEN t.betrag_netto ELSE 0 END),
    SUM(CASE WHEN t.typ='einnahme' AND t.ust_satz=10 THEN t.ust_betrag ELSE 0 END),
    SUM(CASE WHEN t.typ='einnahme' AND t.ust_satz=13 THEN t.ust_betrag ELSE 0 END),
    SUM(CASE WHEN t.typ='einnahme' AND t.ust_satz=20 THEN t.ust_betrag ELSE 0 END),
    SUM(CASE WHEN t.typ='ausgabe' AND t.ust_satz=10 THEN t.ust_betrag ELSE 0 END),
    SUM(CASE WHEN t.typ='ausgabe' AND t.ust_satz=13 THEN t.ust_betrag ELSE 0 END),
    SUM(CASE WHEN t.typ='ausgabe' AND t.ust_satz=20 THEN t.ust_betrag ELSE 0 END)
  FROM ea_transaktionen t
  WHERE t.tenant_id = p_tenant_id
    AND t.datum BETWEEN v_von AND v_bis;
END;
$$;

CREATE OR REPLACE FUNCTION public.pruefe_ea_zeitraum_offen(p_tenant_id uuid, p_datum date)
RETURNS TABLE(offen boolean, grund text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jahr    smallint := EXTRACT(YEAR  FROM p_datum)::smallint;
  v_monat   smallint := EXTRACT(MONTH FROM p_datum)::smallint;
  v_quartal text     := 'Q' || CEIL(v_monat / 3.0)::int;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id);

  IF EXISTS (
    SELECT 1 FROM ea_monatsabschluss
    WHERE tenant_id = p_tenant_id AND jahr = v_jahr AND monat = v_monat
  ) THEN
    RETURN QUERY SELECT false, format('Monat %s/%s ist bereits abgeschlossen.', v_monat, v_jahr);
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM ea_uva
    WHERE tenant_id = p_tenant_id AND jahr = v_jahr AND gesperrt = true
      AND zeitraum IN (v_quartal, lpad(v_monat::text, 2, '0'))
  ) THEN
    RETURN QUERY SELECT false, 'Zeitraum wurde bereits per UVA übermittelt.';
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::text;
END;
$$;

-- KI-Abfragen: Zähler prüfen/erhöhen – jedes aktive Mitglied (Leser dürfen fragen)
CREATE OR REPLACE FUNCTION public.check_und_increment_ki_abfrage(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  limit_map jsonb := '{"basic":100,"standard":200,"unlimited":9999999}'::jsonb;
  rec record;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id);

  SELECT ki_abfragen_aktiv, ki_abfragen_paket, ki_abfragen_zaehler, ki_abfragen_reset_datum
  INTO rec FROM tenant_einstellungen WHERE tenant_id = p_tenant_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('erlaubt', false, 'fehler', 'Mandant nicht gefunden');
  END IF;

  IF rec.ki_abfragen_reset_datum < date_trunc('month', current_date) THEN
    UPDATE tenant_einstellungen
    SET ki_abfragen_zaehler = 0, ki_abfragen_reset_datum = current_date
    WHERE tenant_id = p_tenant_id;
    rec.ki_abfragen_zaehler := 0;
  END IF;

  IF rec.ki_abfragen_zaehler >= (limit_map->>rec.ki_abfragen_paket)::int THEN
    RETURN jsonb_build_object(
      'erlaubt', false,
      'verbraucht', rec.ki_abfragen_zaehler,
      'limit', (limit_map->>rec.ki_abfragen_paket)::int,
      'paket', rec.ki_abfragen_paket
    );
  END IF;

  UPDATE tenant_einstellungen
  SET ki_abfragen_zaehler = ki_abfragen_zaehler + 1
  WHERE tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'erlaubt', true,
    'verbraucht', rec.ki_abfragen_zaehler + 1,
    'paket', rec.ki_abfragen_paket
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_ki_tokens(p_tenant_id uuid, p_input_tokens integer, p_output_tokens integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id);

  UPDATE tenant_einstellungen
  SET
    ki_input_tokens_total  = ki_input_tokens_total  + GREATEST(COALESCE(p_input_tokens, 0), 0),
    ki_output_tokens_total = ki_output_tokens_total + GREATEST(COALESCE(p_output_tokens, 0), 0)
  WHERE tenant_id = p_tenant_id;
END;
$$;

-- Nummernkreise: schreibende Rollen
CREATE OR REPLACE FUNCTION public.get_next_chargennummer(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_prefix TEXT; v_stellen INTEGER; v_zaehler INTEGER; v_jahr TEXT;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin','winzer']);

  UPDATE tenant_einstellungen SET charge_zaehler = charge_zaehler + 1
  WHERE tenant_id = p_tenant_id
  RETURNING charge_prefix, charge_stellen, charge_zaehler - 1
  INTO v_prefix, v_stellen, v_zaehler;
  v_jahr := to_char(now(), 'YYYY');
  RETURN v_prefix || '-' || v_jahr || '-' || lpad(v_zaehler::TEXT, v_stellen, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_next_kundennummer(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix   text;
  v_stellen  integer;
  v_zaehler  integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin','winzer']);

  UPDATE tenant_einstellungen
  SET    kunden_zaehler = kunden_zaehler + 1
  WHERE  tenant_id = p_tenant_id
  RETURNING kunden_prefix, kunden_stellen, kunden_zaehler - 1
  INTO v_prefix, v_stellen, v_zaehler;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN v_prefix || '-' || lpad(v_zaehler::text, v_stellen, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_next_liefernummer(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix   TEXT;
  v_zaehler  INTEGER;
  v_stellen  INTEGER;
  v_jahr     TEXT;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin','winzer']);

  UPDATE tenant_einstellungen
  SET    liefernummer_zaehler = liefernummer_zaehler + 1
  WHERE  tenant_id = p_tenant_id
  RETURNING liefernummer_prefix, liefernummer_zaehler, liefernummer_stellen
  INTO v_prefix, v_zaehler, v_stellen;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant % nicht gefunden', p_tenant_id;
  END IF;

  v_jahr := to_char(CURRENT_DATE, 'YYYY');
  RETURN v_prefix || '-' || v_jahr || '-' || lpad(v_zaehler::TEXT, v_stellen, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_next_rechnungsnummer(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix   text;
  v_stellen  integer;
  v_zaehler  integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin','winzer']);

  UPDATE tenant_einstellungen
  SET    rechnung_zaehler = rechnung_zaehler + 1
  WHERE  tenant_id = p_tenant_id
  RETURNING rechnung_prefix, rechnung_stellen, rechnung_zaehler - 1
  INTO v_prefix, v_stellen, v_zaehler;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN v_prefix || '-' || lpad(v_zaehler::text, v_stellen, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_next_transaktionsnr(p_tenant_id uuid, p_typ text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jahr    integer := EXTRACT(YEAR FROM CURRENT_DATE)::integer;
  v_prefix  text;
  v_zaehler integer;
  v_stellen integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin','winzer']);

  v_prefix := CASE p_typ
    WHEN 'umzug'         THEN 'KU'
    WHEN 'eroeffnung'    THEN 'EB'
    WHEN 'verkauf'       THEN 'VK'
    WHEN 'kosteneintrag' THEN 'KE'
    ELSE 'TX'
  END;

  INSERT INTO transaktionszaehler (tenant_id, typ, prefix, zaehler, jahr, stellen)
  VALUES (p_tenant_id, p_typ, v_prefix, 1, v_jahr, 4)
  ON CONFLICT (tenant_id, typ, jahr) DO UPDATE
    SET zaehler = transaktionszaehler.zaehler + 1
  RETURNING prefix, zaehler, stellen
    INTO v_prefix, v_zaehler, v_stellen;

  RETURN v_prefix || '-' || v_jahr || '-' || LPAD(v_zaehler::text, v_stellen, '0');
END;
$$;

-- Exportnummer: bisher SECURITY INVOKER (wird nur über den Admin-Client aufgerufen),
-- bekommt dieselbe Prüfung und festen search_path.
CREATE OR REPLACE FUNCTION public.get_next_exportnummer(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_prefix text; v_zaehler int; v_stellen int;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin','winzer']);

  UPDATE tenant_einstellungen
    SET export_zaehler = export_zaehler + 1
    WHERE tenant_id = p_tenant_id
    RETURNING export_prefix, export_zaehler, export_stellen
    INTO v_prefix, v_zaehler, v_stellen;
  RETURN v_prefix || '-' || lpad(v_zaehler::text, v_stellen, '0');
END
$$;

-- Kontenabgleich: schreibende Rollen
CREATE OR REPLACE FUNCTION public.setze_kontobewegung_abgeglichen(p_tenant_id uuid, p_quelle text, p_id uuid, p_abgeglichen boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin','winzer']);

  IF p_quelle = 'zahlung' THEN
    UPDATE zahlungen SET abgeglichen = p_abgeglichen
    WHERE id = p_id AND tenant_id = p_tenant_id;
  ELSIF p_quelle = 'ea_transaktion' THEN
    UPDATE ea_transaktionen SET abgeglichen = p_abgeglichen
    WHERE id = p_id AND tenant_id = p_tenant_id;
  ELSIF p_quelle = 'umbuchung_von' THEN
    UPDATE konto_umbuchungen SET von_abgeglichen = p_abgeglichen
    WHERE id = p_id AND tenant_id = p_tenant_id;
  ELSIF p_quelle = 'umbuchung_nach' THEN
    UPDATE konto_umbuchungen SET nach_abgeglichen = p_abgeglichen
    WHERE id = p_id AND tenant_id = p_tenant_id;
  ELSE
    RAISE EXCEPTION 'Unbekannte Quelle: %', p_quelle;
  END IF;
END;
$$;

-- Monatsabschluss / UVA-Sperre: nur Admin-Rollen (wie canAdmin in der App)
CREATE OR REPLACE FUNCTION public.sperre_ea_monat(p_tenant_id uuid, p_jahr smallint, p_monat smallint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_von date;
  v_bis date;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin']);

  v_von := make_date(p_jahr, p_monat, 1);
  v_bis := (v_von + INTERVAL '1 month' - INTERVAL '1 day')::date;

  UPDATE ea_transaktionen
  SET is_locked = true
  WHERE tenant_id = p_tenant_id
    AND datum BETWEEN v_von AND v_bis;

  INSERT INTO ea_monatsabschluss (tenant_id, jahr, monat)
  VALUES (p_tenant_id, p_jahr, p_monat)
  ON CONFLICT (tenant_id, jahr, monat) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.sperre_ea_uva(p_tenant_id uuid, p_jahr smallint, p_zeitraum text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_von      date;
  v_bis      date;
  v_monate   smallint[];
  v_monat    smallint;
  v_fehlende smallint[] := '{}';
  v_beginn   date;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin']);

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

  UPDATE ea_uva
  SET gesperrt = true, gesperrt_am = now()
  WHERE tenant_id = p_tenant_id AND jahr = p_jahr AND zeitraum = p_zeitraum;
END;
$$;

-- Verkaufsposten-Status per RPC: in der App nicht mehr verwendet (Trigger
-- sync_verkaufsposten_bezahlt übernimmt das). Bekommen trotzdem eine Prüfung
-- über den Betrieb des Postens und sind nur noch für service_role aufrufbar.
CREATE OR REPLACE FUNCTION public.mark_verkauf_bezahlt(p_posten_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM verkaufsposten WHERE id = p_posten_id;
  IF v_tenant IS NULL THEN RETURN; END IF;
  PERFORM public.pruefe_tenant_zugriff(v_tenant, ARRAY['system_admin','tenant_admin','winzer']);

  UPDATE verkaufsposten
  SET bezahlt = true, bezahlt_am = now()
  WHERE id = p_posten_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_verkauf_storniert(p_posten_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM verkaufsposten WHERE id = p_posten_id;
  IF v_tenant IS NULL THEN RETURN; END IF;
  PERFORM public.pruefe_tenant_zugriff(v_tenant, ARRAY['system_admin','tenant_admin','winzer']);

  UPDATE verkaufsposten
  SET storniert = true, storniert_am = now()
  WHERE id = p_posten_id;
END;
$$;

-- ── C/D. search_path fixieren (Funktionen ohne Änderung des Rumpfs) ──────────

ALTER FUNCTION public.get_behandlungen_fuer_grundstuecke(uuid[], uuid) SET search_path = public;
ALTER FUNCTION public.get_user_role_in_tenant(uuid)                     SET search_path = public;
ALTER FUNCTION public.get_user_tenant_ids()                             SET search_path = public;
ALTER FUNCTION public.user_has_role_in_tenant(uuid, text[])             SET search_path = public;
ALTER FUNCTION public.tenant_has_module(text)                           SET search_path = public;
ALTER FUNCTION public.process_ea_dauerauftraege()                       SET search_path = public;
ALTER FUNCTION public.ki_readonly_query(text, uuid)                     SET search_path = public;
ALTER FUNCTION public.ki_schema_info(text[])                            SET search_path = public;
-- Trigger-Funktionen
ALTER FUNCTION public.create_profile_on_signup()                        SET search_path = public;
ALTER FUNCTION public.handle_new_user()                                 SET search_path = public;
ALTER FUNCTION public.sumup_tx_zu_zahlung()                             SET search_path = public;
ALTER FUNCTION public.sync_verkaufsposten_bezahlt()                     SET search_path = public;
ALTER FUNCTION public.fn_sync_pressung_wg_to_weinausbau()               SET search_path = public;
ALTER FUNCTION public.update_aktualisiert_am()                          SET search_path = public;
ALTER FUNCTION public.update_fuellungen_aktualisiert_am()               SET search_path = public;
ALTER FUNCTION public.update_updated_at()                               SET search_path = public;

-- ── C. Ausführungsrechte ─────────────────────────────────────────────────────

-- Hinweis zu Default-Privilegien: Postgres gibt jeder neuen Funktion EXECUTE für
-- PUBLIC (globaler Default, vom Schema-Default nicht überschreibbar) – ein
-- "ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ..." wäre wirkungslos, und
-- der globale Entzug würde auch künftige Extension-Funktionen (z. B. PostGIS)
-- für die App sperren. Deshalb gilt ab jetzt die KONVENTION (siehe CLAUDE.md):
-- jede Migration, die eine Funktion anlegt, endet mit
--   REVOKE EXECUTE ON FUNCTION <fn> FROM PUBLIC, anon;
-- und bei Bedarf einem gezielten GRANT an authenticated/service_role.
-- Der Supabase Security Advisor (Lint 0028/0029) zeigt Verstöße an.

-- Alle bestehenden Funktionen: anon und PUBLIC raus
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
  END LOOP;
END $$;

-- Nur Service-Role / Datenbank: Trigger-, Event-Trigger- und Cron-Funktionen
-- sowie die nicht mehr aus der App verwendeten Verkaufsposten-Funktionen
REVOKE EXECUTE ON FUNCTION public.create_profile_on_signup()          FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                   FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.sumup_tx_zu_zahlung()               FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_verkaufsposten_bezahlt()       FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_sync_pressung_wg_to_weinausbau() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.update_aktualisiert_am()            FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.update_fuellungen_aktualisiert_am() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at()                 FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable()                   FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.process_ea_dauerauftraege()         FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_next_exportnummer(uuid)         FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_verkauf_bezahlt(uuid)          FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.set_verkauf_storniert(uuid)         FROM authenticated;
-- ist_service_kontext wird nur intern gebraucht
REVOKE EXECUTE ON FUNCTION public.ist_service_kontext()               FROM authenticated;

-- Explizit sicherstellen, dass die aus der App (User-Session) aufgerufenen
-- Funktionen und die RLS-Hilfsfunktionen für authenticated und service_role
-- ausführbar bleiben (idempotent, auch falls Rechte früher abweichend gesetzt waren).
GRANT EXECUTE ON FUNCTION public.pruefe_tenant_zugriff(uuid, text[])                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.berechne_ea_uva(uuid, smallint, text)                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pruefe_ea_zeitraum_offen(uuid, date)                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_und_increment_ki_abfrage(uuid)                     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_ki_tokens(uuid, integer, integer)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_next_chargennummer(uuid)                             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_next_kundennummer(uuid)                              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_next_liefernummer(uuid)                              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_next_rechnungsnummer(uuid)                           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_next_transaktionsnr(uuid, text)                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.setze_kontobewegung_abgeglichen(uuid, text, uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sperre_ea_monat(uuid, smallint, smallint)                TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sperre_ea_uva(uuid, smallint, text)                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_behandlungen_fuer_grundstuecke(uuid[], uuid)         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ki_readonly_query(text, uuid)                            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ki_schema_info(text[])                                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_role_in_tenant(uuid)                            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_tenant_ids()                                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_role_in_tenant(uuid, text[])                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tenant_has_module(text)                                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ist_service_kontext()                                    TO service_role;
GRANT EXECUTE ON FUNCTION public.get_next_exportnummer(uuid)                              TO service_role;
GRANT EXECUTE ON FUNCTION public.process_ea_dauerauftraege()                              TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_verkauf_bezahlt(uuid)                               TO service_role;
GRANT EXECUTE ON FUNCTION public.set_verkauf_storniert(uuid)                              TO service_role;

COMMENT ON FUNCTION public.sperre_ea_uva(uuid, smallint, text) IS
  'Sperrt UVA-Periode + Buchungen. Prüft intern: Aufrufer ist Admin-Rolle im Betrieb (Migration 182).';
COMMENT ON FUNCTION public.sperre_ea_monat(uuid, smallint, smallint) IS
  'Monatsabschluss. Prüft intern: Aufrufer ist Admin-Rolle im Betrieb (Migration 182).';
