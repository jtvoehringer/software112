-- @bereich: Testrahmen (Selbsttest)
-- @ziel: Belegt, dass Staging-Wächter, Rollen- und Claim-Wechsel, die Klassifizierung der Versuche, der Generator
-- @ziel: für Beispielzeilen (jede T- und K-Tabelle im Musterhof und in B) und das Zurückrollen tragen; dazu die
-- @ziel: Datenbasis des Staging-Musterhofs, die Mutations-Mechanik und die Zählung in s112_ende.
-- @mutation anon_meine_tenants_offen: anon darf public.s112_meine_tenants() ausführen | rot: anon_meine_tenants_42501
-- @mutation service_kontext_offen: authenticated darf public.ist_service_kontext() ausführen | rot: als_ist_service_kontext_42501
-- @mutation beispiel_check_verschaerft: zusätzlicher CHECK (betrag > 1) auf konto_umbuchungen – der Generator muss das melden | rot: beispielzeile:konto_umbuchungen
-- @mutation generator_kaputt: CHECK (nachname NOT LIKE 'S112TEST%') auf kontakte – Generator und Gegenprobe müssen das als FEHLER melden, nicht abstürzen | rot: beispielzeile:kontakte
--
-- software:112 – SQL-Testrahmen, Selbsttest (Stand 28.09.2026). Nur Staging (sjpeghrlhsowmquacjhb).
-- Die ganze Datei ist EINE Transaktion und endet mit pg_temp.s112_ende(…) = RAISE → nichts bleibt auf Staging.
--
-- Geprüft wird:
--   1. Wächter: s112_nur_staging() läuft, system_identifier = Staging, keiner der drei Produktions-Betriebe
--      (IDs werden aus dem Quelltext des Wächters gelesen – sie dürfen in keiner Testdatei stehen),
--      admin@software112.test ist Plattform-Admin; als authenticated schlägt der Wächter an (S112GUARD).
--      Jeder Abbruch-Zweig des Wächters wird positiv ausgelöst (Produktions-Betrieb angelegt, Staging-Admin
--      entfernt – jeweils in einem Unterblock, der mit RAISE endet und damit zurückgenommen wird).
--   Alle Schritte, die bei einem kaputten Rahmen scheitern können, laufen in Unterblöcken und melden FEHLER
--   statt die Datei abstürzen zu lassen (sonst gilt eine Mutation im Runner nur als SQL-Fehler).
--   2. Beleg für EINE Transaktion (xid vergeben, pg_proc.xmin der Helfer = aktuelle xid).
--   3. Datenbasis des Musterhofs (sonst: demo_musterhof_zuruecksetzen() + demo_musterhof_y2_kette()).
--   4. s112_aufbau() samt Trigger-Nebenwirkungen (Profile, Plattform-Admin, Schreibmodule, Kundennummer).
--   5. s112_als / s112_als_postgres (Rolle, auth.uid(), aal, Schalter-GUCs, Unterblock-Rücknahme), anon.
--   6. Klassifizierung durch s112_versuch (R, E23502, G, T, k1 mit sofortiger Rücknahme).
--   7. Generator: s112_beispiel für jede T/K-Tabelle im Musterhof und in B, typisierter PK-Vergleich,
--      Betrieb der Zeile (T: tenant_id, K: tenant_id der Elternzeile).
--   8. Mutations-Mechanik und s112_ende (Zählung, Mindestzahl) über einen synthetischen Unterblock.
--
-- Diese Datei prüft den Rahmen, keine Sicherheitsregeln der Datenbank (dafür 01, 10–20).

DO $test$
DECLARE
  c_datei      constant text := '00_rahmen_selbsttest';
  c_m          constant uuid := '33333333-3333-4333-8333-333333333333';
  c_sysid      constant text := '7678069749886157684';
  -- im Kopf deklarierte Mutationen (Schutz gegen Tippfehler im Runner: mutation_unbekannt)
  c_mutationen constant text[] := ARRAY['anon_meine_tenants_offen', 'service_kontext_offen', 'beispiel_check_verschaerft', 'generator_kaputt'];
  c_demo_hint  constant text := 'Staging-Demo unvollständig – demo_musterhof_zuruecksetzen() + demo_musterhof_y2_kette()';
  v_t0         timestamptz := clock_timestamp();
  v_erg        text[] := '{}';
  v_a          jsonb;
  v_b          uuid;
  v_bw         uuid;
  v_bta        uuid;
  v_mw         uuid;
  v_n          bigint;
  v_n2         bigint;
  v_txt        text;
  v_bool       boolean;
  v_arr        text[];
  v_ids        uuid[];
  v_z          jsonb;
  v_t          uuid;
  v_state      text;
  v_msg        text;
  v_fehl       text;
  v_tab        record;
  v_tabellen   int := 0;
  v_ausfall    int := 0;
  v_kontakt    text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();

  -- ── 1. Wächter ───────────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_ok('waechter_laeuft');
  SELECT system_identifier::text INTO v_txt FROM pg_control_system();
  v_erg := v_erg || pg_temp.s112_erwarte('waechter_system_identifier', v_txt, c_sysid);
  -- Produktions-Betriebs-IDs aus dem Wächter-Quelltext (nur dort dürfen sie stehen)
  SELECT array_agg(x[1]::uuid) INTO v_ids
    FROM pg_proc p,
         regexp_matches(substring(p.prosrc FROM 'c_prod_betriebe\s+constant\s+uuid\[\]\s*:=\s*ARRAY\[([^\]]*)\]'),
                        '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'g') x
   WHERE p.oid = 'pg_temp.s112_nur_staging()'::regprocedure;
  v_erg := v_erg || pg_temp.s112_erwarte('waechter_kennt_drei_produktionsbetriebe', coalesce(array_length(v_ids, 1), 0), 3);
  SELECT count(*) INTO v_n FROM public.tenants WHERE id = ANY (v_ids);
  v_erg := v_erg || pg_temp.s112_erwarte('waechter_keine_produktionsbetriebe', v_n, 0);
  SELECT count(*) INTO v_n FROM auth.users u JOIN public.plattform_admins p ON p.user_id = u.id
   WHERE u.email = 'admin@software112.test';
  v_erg := v_erg || pg_temp.s112_erwarte('waechter_staging_admin_ist_plattform_admin', v_n, 1);
  -- Abbruch-Zweige positiv auslösen: Unterblock endet immer mit RAISE (S1T01) → Änderung zurückgenommen.
  -- Produktions-Betrieb: ID aus dem Wächter-Quelltext (v_ids), kein Literal in dieser Datei
  BEGIN
    IF coalesce(array_length(v_ids, 1), 0) = 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'S1T01', MESSAGE = 'keine Produktions-ID im Wächter gefunden';
    END IF;
    INSERT INTO public.tenants (id, name, slug) VALUES (v_ids[1], 'S112TEST Wächterprobe', 's112test-waechterprobe');
    PERFORM pg_temp.s112_nur_staging();
    RAISE EXCEPTION USING ERRCODE = 'S1T01', MESSAGE = 'Wächter lief trotz Produktions-Betrieb durch';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    v_erg := v_erg || CASE WHEN v_state = 'P0001' AND v_msg LIKE 'S112GUARD|Produktions-Betrieb%'
                           THEN pg_temp.s112_ok('waechter_zweig_produktionsbetrieb')
                           ELSE pg_temp.s112_fehler('waechter_zweig_produktionsbetrieb', v_state || ' ' || left(v_msg, 200)) END;
  END;
  SELECT count(*) INTO v_n FROM public.tenants WHERE id = ANY (v_ids);
  v_erg := v_erg || pg_temp.s112_erwarte('waechter_zweig_produktionsbetrieb_zurueck', v_n, 0);
  BEGIN
    DELETE FROM public.plattform_admins p USING auth.users u
     WHERE u.id = p.user_id AND u.email = 'admin@software112.test';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'S1T01', MESSAGE = format('Staging-Admin: %s Zeilen entfernt statt 1', v_n);
    END IF;
    PERFORM pg_temp.s112_nur_staging();
    RAISE EXCEPTION USING ERRCODE = 'S1T01', MESSAGE = 'Wächter lief ohne Staging-Admin durch';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    v_erg := v_erg || CASE WHEN v_state = 'P0001' AND v_msg LIKE 'S112GUARD|Staging-Testkonto%'
                           THEN pg_temp.s112_ok('waechter_zweig_staging_admin')
                           ELSE pg_temp.s112_fehler('waechter_zweig_staging_admin', v_state || ' ' || left(v_msg, 200)) END;
  END;
  SELECT count(*) INTO v_n FROM auth.users u JOIN public.plattform_admins p ON p.user_id = u.id
   WHERE u.email = 'admin@software112.test';
  v_erg := v_erg || pg_temp.s112_erwarte('waechter_zweig_staging_admin_zurueck', v_n, 1);

  -- ── 2. Eine Transaktion: Helfer und Test ─────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('transaktion_xid_schon_vergeben', pg_current_xact_id_if_assigned() IS NOT NULL, true);
  SELECT p.xmin = xid(pg_current_xact_id()) INTO v_bool FROM pg_proc p WHERE p.oid = 'pg_temp.s112_als(uuid,text,text)'::regprocedure;
  v_erg := v_erg || pg_temp.s112_erwarte('transaktion_helfer_xmin_gleich_xid', v_bool, true);
  v_erg := v_erg || pg_temp.s112_erwarte('transaktion_rolle_postgres', current_user::text, 'postgres');

  -- ── 3. Datenbasis Musterhof (vor dem Aufbau, damit Testzeilen nicht mitzählen) ───────────────────────
  v_n := 0;
  FOR v_tab IN SELECT tabelle FROM pg_temp.s112_mandantentabellen() WHERE klasse = 'T' LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE tenant_id = %L)', v_tab.tabelle, c_m) INTO v_bool;
    IF v_bool THEN
      v_n := v_n + 1;
    END IF;
  END LOOP;
  -- Schwelle als Anteil: mindestens 60 % der T-Tabellen haben Musterhof-Zeilen (Stand 28.09.2026: 53 von 81)
  SELECT count(*) INTO v_n2 FROM pg_temp.s112_mandantentabellen() WHERE klasse = 'T';
  v_erg := v_erg || CASE WHEN v_n2 > 0 AND v_n * 100 >= v_n2 * 60 THEN pg_temp.s112_ok('demo_tabellen_mit_zeilen')
                         ELSE pg_temp.s112_fehler('demo_tabellen_mit_zeilen', format('ist=%s von %s T-Tabellen, soll>=60 %% – %s', v_n, v_n2, c_demo_hint)) END;
  SELECT count(*) INTO v_n FROM public.ea_transaktionen WHERE tenant_id = c_m AND is_locked;
  v_erg := v_erg || CASE WHEN v_n >= 1 THEN pg_temp.s112_ok('demo_ea_transaktion_gesperrt')
                         ELSE pg_temp.s112_fehler('demo_ea_transaktion_gesperrt', format('ist=%s soll>=1 – %s', v_n, c_demo_hint)) END;
  SELECT count(*) INTO v_n FROM public.ea_uva WHERE tenant_id = c_m AND gesperrt;
  v_erg := v_erg || CASE WHEN v_n >= 1 THEN pg_temp.s112_ok('demo_ea_uva_gesperrt')
                         ELSE pg_temp.s112_fehler('demo_ea_uva_gesperrt', format('ist=%s soll>=1 – %s', v_n, c_demo_hint)) END;
  SELECT count(*) INTO v_n FROM public.ama_erntemeldungen WHERE tenant_id = c_m AND status = 'bestaetigt';
  v_erg := v_erg || CASE WHEN v_n >= 1 THEN pg_temp.s112_ok('demo_ama_bestaetigt')
                         ELSE pg_temp.s112_fehler('demo_ama_bestaetigt', format('ist=%s soll>=1 – %s', v_n, c_demo_hint)) END;

  -- ── 4. Aufbau und Trigger-Nebenwirkungen ─────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_mw := (v_a ->> 'm_w')::uuid;
  SELECT count(*) INTO v_n FROM public.tenants WHERE id = v_b AND kundennummer IS NULL;
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_b_ohne_kundennummer', v_n, 1);
  SELECT count(*) INTO v_n FROM public.tenant_einstellungen WHERE tenant_id = v_b AND betrieb_plz IS NULL;
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_b_einstellungen_ohne_plz', v_n, 1);
  -- handle_new_user: je neuem auth.users genau eine profiles-Zeile
  SELECT count(*), count(*) FILTER (WHERE (SELECT count(*) FROM public.profiles p WHERE p.id = u.id) <> 1)
    INTO v_n, v_n2 FROM auth.users u WHERE u.email LIKE 's112test-%';
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_test_benutzer_angelegt', v_n >= 14, true);
  v_erg := v_erg || pg_temp.s112_erwarte('trigger_je_benutzer_ein_profil', v_n2, 0);
  -- tenants_plattform_admins: Test-PA automatisch system_admin in B
  SELECT count(*) INTO v_n FROM public.tenant_memberships
   WHERE tenant_id = v_b AND user_id = (v_a ->> 'pa')::uuid AND role = 'system_admin' AND aktiv;
  v_erg := v_erg || pg_temp.s112_erwarte('trigger_test_pa_system_admin_in_b', v_n, 1);
  -- tenant_memberships_schreibmodule_default
  SELECT schreibmodule INTO v_arr FROM public.tenant_memberships WHERE user_id = v_bw AND tenant_id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('trigger_winzer_null_sechs_module', v_arr, pg_temp.s112_soll_liste('schreibmodule'));
  v_erg := v_erg || pg_temp.s112_erwarte('soll_schreibmodule_sechs', coalesce(array_length(pg_temp.s112_soll_liste('schreibmodule'), 1), 0), 6);
  SELECT schreibmodule INTO v_arr FROM public.tenant_memberships WHERE user_id = (v_a ->> 'm_w0')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('trigger_winzer_leer_bleibt_leer', v_arr, '{}'::text[]);
  SELECT count(*) INTO v_n FROM public.tenant_memberships
   WHERE user_id IN ((v_a ->> 'm_l')::uuid, (v_a ->> 'b_l')::uuid, (v_a ->> 'm_ta')::uuid, v_bta) AND schreibmodule IS NULL;
  v_erg := v_erg || pg_temp.s112_erwarte('trigger_leser_admin_module_null', v_n, 4);

  -- Mutationen (nur im Mutationsmodus von run.mjs; sonst ohne Wirkung) – nach dem Aufbau, vor den Prüfungen
  PERFORM pg_temp.s112_mutiere('anon_meine_tenants_offen',
    $m$GRANT EXECUTE ON FUNCTION public.s112_meine_tenants() TO anon$m$);
  PERFORM pg_temp.s112_mutiere('service_kontext_offen',
    $m$GRANT EXECUTE ON FUNCTION public.ist_service_kontext() TO authenticated$m$);
  PERFORM pg_temp.s112_mutiere('beispiel_check_verschaerft',
    $m$ALTER TABLE public.konto_umbuchungen ADD CONSTRAINT s112test_mutation_betrag CHECK (betrag > 1) NOT VALID$m$);
  PERFORM pg_temp.s112_mutiere('generator_kaputt',
    $m$ALTER TABLE public.kontakte ADD CONSTRAINT s112test_mutation_nachname CHECK (nachname NOT LIKE 'S112TEST%') NOT VALID$m$);

  -- ── 5. Rollen- und Claim-Wechsel ─────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw, 'authenticated', 'aal1');
  v_erg := v_erg || pg_temp.s112_erwarte('als_rolle_authenticated', current_user::text, 'authenticated');
  v_erg := v_erg || pg_temp.s112_erwarte('als_auth_uid', auth.uid(), v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('als_aal1', auth.jwt() ->> 'aal', 'aal1');
  BEGIN
    PERFORM public.ist_service_kontext();
    v_erg := v_erg || pg_temp.s112_fehler('als_ist_service_kontext_42501', 'für authenticated ausführbar');
  EXCEPTION WHEN OTHERS THEN
    v_erg := v_erg || pg_temp.s112_erwarte('als_ist_service_kontext_42501', SQLSTATE, '42501');
  END;
  -- Wächter als authenticated: muss anschlagen (S112GUARD), der Unterblock nimmt die Rolle nicht zurück
  BEGIN
    PERFORM pg_temp.s112_nur_staging();
    v_erg := v_erg || pg_temp.s112_fehler('waechter_als_authenticated', 'lief durch');
  EXCEPTION
    WHEN raise_exception THEN
      v_erg := v_erg || pg_temp.s112_erwarte('waechter_als_authenticated', SQLERRM LIKE 'S112GUARD|%', true);
    WHEN OTHERS THEN
      -- z. B. 42501 auf auth.users: der Wächter prüft current_user nicht mehr selbst
      v_erg := v_erg || pg_temp.s112_fehler('waechter_als_authenticated', SQLSTATE || ' ' || SQLERRM);
  END;
  -- Rollen- und Claim-Wechsel in einem scheiternden Unterblock werden mit zurückgenommen
  BEGIN
    PERFORM pg_temp.s112_als_postgres();
    PERFORM 1 / 0;
  EXCEPTION WHEN division_by_zero THEN
    v_erg := v_erg || pg_temp.s112_erwarte('unterblock_rolle_zurueck', current_user::text, 'authenticated');
    v_erg := v_erg || pg_temp.s112_erwarte('unterblock_claims_zurueck', auth.uid(), v_bw);
  END;
  PERFORM pg_temp.s112_als(v_bta, 'authenticated', 'aal2');
  v_erg := v_erg || pg_temp.s112_erwarte('als_aal2', (auth.jwt() ->> 'aal') || '/' || auth.uid()::text, 'aal2/' || v_bta::text);

  -- s112_als_postgres leert Claims und die Schalter-GUCs (ki_readonly_query setzt app.active_tenant_id)
  PERFORM set_config('app.active_tenant_id', c_m::text, true);
  PERFORM set_config('s112.protokoll_aus', c_m::text, true);
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  v_erg := v_erg || pg_temp.s112_erwarte('schalter_gesetzt',
    nullif(current_setting('app.active_tenant_id', true), '') IS NOT NULL
    AND nullif(current_setting('s112.protokoll_aus', true), '') IS NOT NULL
    AND nullif(current_setting('storage.allow_delete_query', true), '') IS NOT NULL, true);
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('als_postgres_rolle', current_user::text, 'postgres');
  v_erg := v_erg || pg_temp.s112_erwarte('als_postgres_claims_leer', nullif(current_setting('request.jwt.claims', true), ''), NULL::text);
  BEGIN
    v_erg := v_erg || pg_temp.s112_erwarte('als_postgres_service_kontext', public.ist_service_kontext(), true);
  EXCEPTION WHEN OTHERS THEN
    v_erg := v_erg || pg_temp.s112_fehler('als_postgres_service_kontext', SQLSTATE || ' ' || SQLERRM);
  END;
  v_erg := v_erg || pg_temp.s112_erwarte('als_postgres_schalter_leer',
    coalesce(nullif(current_setting('app.active_tenant_id', true), ''), '')
    || coalesce(nullif(current_setting('s112.protokoll_aus', true), ''), '')
    || coalesce(nullif(current_setting('storage.allow_delete_query', true), ''), ''), '');

  -- anon
  PERFORM pg_temp.s112_als(NULL, 'anon');
  v_erg := v_erg || pg_temp.s112_erwarte('anon_rolle', current_user::text, 'anon');
  v_erg := v_erg || pg_temp.s112_erwarte('anon_ohne_uid', auth.uid(), NULL::uuid);
  BEGIN
    PERFORM public.s112_meine_tenants();
    v_erg := v_erg || pg_temp.s112_fehler('anon_meine_tenants_42501', 'für anon ausführbar');
  EXCEPTION WHEN OTHERS THEN
    v_erg := v_erg || pg_temp.s112_erwarte('anon_meine_tenants_42501', SQLSTATE, '42501');
  END;
  PERFORM pg_temp.s112_als_postgres();

  -- ── 6. Klassifizierung durch s112_versuch (als tenant_admin B) ───────────────────────────────────────
  v_kontakt := 'S112TEST Selbsttest ' || left(gen_random_uuid()::text, 8);
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('versuch_R_insert_fremd',
    pg_temp.s112_versuch(format('INSERT INTO public.kontakte (tenant_id) VALUES (%L)', c_m)), 'R');
  -- RLS-WITH-CHECK greift vor NOT NULL: im eigenen Betrieb scheitert erst die Pflichtspalte
  v_erg := v_erg || pg_temp.s112_erwarte('versuch_E23502_insert_eigen_unvollstaendig',
    pg_temp.s112_versuch(format('INSERT INTO public.kontakte (tenant_id) VALUES (%L)', v_b)), 'E23502');
  v_erg := v_erg || pg_temp.s112_erwarte('versuch_G_bestandsprotokoll',
    pg_temp.s112_versuch(format('INSERT INTO public.bestandsprotokoll (tenant_id) VALUES (%L)', v_b)), 'G');
  v_erg := v_erg || pg_temp.s112_erwarte('versuch_T_paketfeld_plan',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET plan = %L WHERE id = %L', 's112test', v_b)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('versuch_k1_insert_eigen',
    pg_temp.s112_versuch(format('INSERT INTO public.kontakte (tenant_id, nachname) VALUES (%L, %L)', v_b, v_kontakt)), 'k1');
  PERFORM pg_temp.s112_als_postgres();
  SELECT count(*) INTO v_n FROM public.kontakte WHERE nachname = v_kontakt;
  v_erg := v_erg || pg_temp.s112_erwarte('versuch_k1_sofort_zurueckgenommen', v_n, 0);
  -- Gegenprobe: dieselbe Anweisung ohne s112_versuch bleibt bis zum Dateiende bestehen
  BEGIN
    INSERT INTO public.kontakte (tenant_id, nachname) VALUES (v_b, v_kontakt);
    SELECT count(*) INTO v_n FROM public.kontakte WHERE nachname = v_kontakt;
    v_erg := v_erg || pg_temp.s112_erwarte('versuch_gegenprobe_ohne_versuch', v_n, 1);
  EXCEPTION WHEN OTHERS THEN
    v_erg := v_erg || pg_temp.s112_fehler('versuch_gegenprobe_ohne_versuch', SQLSTATE || ' ' || SQLERRM);
  END;

  -- ── 7. Generator: Beispielzeile für jede T- und K-Tabelle im Musterhof und in B ──────────────────────
  -- K-Tabellen: Betrieb über die Elternzeile (K verweist per Definition direkt auf eine T-Tabelle)
  FOR v_tab IN SELECT tabelle, klasse, eltern_spalte, eltern_tabelle, eltern_ref
                 FROM pg_temp.s112_mandantentabellen() WHERE klasse IN ('T', 'K') ORDER BY tabelle LOOP
    v_tabellen := v_tabellen + 1;
    v_fehl := NULL;
    FOREACH v_t IN ARRAY ARRAY[c_m, v_b] LOOP
      BEGIN
        -- module_flags: der Musterhof belegt alle 10 per CHECK erlaubten Module (UNIQUE tenant_id, module) –
        -- dort einen Eintrag entfernen und neu anlegen (bis zum Dateiende, dann mit allem zurückgenommen)
        IF v_tab.tabelle = 'module_flags' AND v_t = c_m THEN
          DELETE FROM public.module_flags WHERE tenant_id = c_m AND module = 'reports';
          v_z := pg_temp.s112_beispiel(v_tab.tabelle, v_t, v_mw, '{"module": "reports"}');
        ELSE
          v_z := pg_temp.s112_beispiel(v_tab.tabelle, v_t, CASE WHEN v_t = c_m THEN v_mw ELSE v_bw END);
        END IF;
        EXECUTE format('SELECT count(*) FROM public.%I WHERE %s', v_tab.tabelle, pg_temp.s112_pk_where(v_tab.tabelle, v_z)) INTO v_n;
        IF v_n <> 1 THEN
          v_fehl := concat_ws(' / ', v_fehl, format('%s: pk-Vergleich count=%s', CASE WHEN v_t = c_m THEN 'M' ELSE 'B' END, v_n));
        ELSIF v_tab.klasse = 'T' AND v_z ->> 'tenant_id' IS DISTINCT FROM v_t::text THEN
          v_fehl := concat_ws(' / ', v_fehl, format('%s: tenant_id=%s', CASE WHEN v_t = c_m THEN 'M' ELSE 'B' END, v_z ->> 'tenant_id'));
        ELSIF v_tab.klasse = 'K' THEN
          v_txt := NULL;
          IF v_tab.eltern_tabelle IS NOT NULL AND v_z ->> v_tab.eltern_spalte IS NOT NULL THEN
            EXECUTE format('SELECT e.tenant_id::text FROM public.%I e WHERE e.%I::text = %L',
                           v_tab.eltern_tabelle, v_tab.eltern_ref, v_z ->> v_tab.eltern_spalte) INTO v_txt;
          END IF;
          IF v_txt IS DISTINCT FROM v_t::text THEN
            v_fehl := concat_ws(' / ', v_fehl, format('%s: Eltern %s.%s=%s → tenant_id=%s', CASE WHEN v_t = c_m THEN 'M' ELSE 'B' END,
                                                      v_tab.eltern_tabelle, v_tab.eltern_spalte, v_z ->> v_tab.eltern_spalte, v_txt));
          END IF;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        v_fehl := concat_ws(' / ', v_fehl, format('%s: %s %s', CASE WHEN v_t = c_m THEN 'M' ELSE 'B' END, v_state, left(v_msg, 200)));
      END;
    END LOOP;
    IF v_fehl IS NULL THEN
      v_erg := v_erg || pg_temp.s112_ok('beispielzeile:' || v_tab.tabelle);
    ELSE
      v_ausfall := v_ausfall + 1;
      v_erg := v_erg || pg_temp.s112_fehler('beispielzeile:' || v_tab.tabelle, v_fehl);
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM pg_temp.s112_mandantentabellen() WHERE klasse IN ('T', 'K');
  v_erg := v_erg || pg_temp.s112_erwarte('generator_alle_t_k_tabellen', v_tabellen, v_n::int);
  v_erg := v_erg || pg_temp.s112_erwarte('generator_mindestens_90_tabellen', v_tabellen >= 90, true);
  -- Vorlagen mit Mehrspalten-CHECKs ausdrücklich
  BEGIN
    v_z := pg_temp.s112_beispiel('konto_umbuchungen', v_b, v_bw);
    v_erg := v_erg || pg_temp.s112_erwarte('vorlage_konto_umbuchungen_zwei_konten',
      v_z ->> 'von_konto_id' IS DISTINCT FROM v_z ->> 'nach_konto_id' AND v_z ->> 'von_konto_id' IS NOT NULL, true);
  EXCEPTION WHEN OTHERS THEN
    v_erg := v_erg || pg_temp.s112_fehler('vorlage_konto_umbuchungen_zwei_konten', SQLSTATE || ' ' || SQLERRM);
  END;
  BEGIN
    v_z := pg_temp.s112_beispiel('traubenverkauf', c_m, v_mw);
    v_erg := v_erg || pg_temp.s112_erwarte('vorlage_traubenverkauf_quelle',
      v_z ->> 'weingarten_id' IS NOT NULL AND v_z ->> 'zukauf_posten_id' IS NULL, true);
  EXCEPTION WHEN OTHERS THEN
    v_erg := v_erg || pg_temp.s112_fehler('vorlage_traubenverkauf_quelle', SQLSTATE || ' ' || SQLERRM);
  END;
  -- typisierter PK mit timestamptz (wetter_stunden)
  -- eigener Zeitpunkt mit Mikrosekunden und Zeitzone (die Generatorzeile oben trägt now() – sonst Schlüsselkonflikt)
  SELECT count(*) INTO v_n FROM pg_temp.s112_mandantentabellen() t, unnest(t.pk) s(spalte)
    JOIN pg_attribute a ON a.attrelid = 'public.wetter_stunden'::regclass AND a.attname = s.spalte
   WHERE t.tabelle = 'wetter_stunden' AND a.atttypid = 'timestamptz'::regtype;
  v_erg := v_erg || pg_temp.s112_erwarte('pk_wetter_stunden_hat_timestamptz', v_n >= 1, true);
  BEGIN
    v_z := pg_temp.s112_beispiel('wetter_stunden', v_b, NULL, '{"zeit": "2026-09-28 10:15:30.123456+02"}');
    EXECUTE format('SELECT count(*) FROM public.wetter_stunden WHERE %s', pg_temp.s112_pk_where('wetter_stunden', v_z)) INTO v_n2;
    v_erg := v_erg || pg_temp.s112_erwarte('pk_where_wetter_stunden_timestamptz', v_n2, 1);
  EXCEPTION WHEN OTHERS THEN
    v_erg := v_erg || pg_temp.s112_fehler('pk_where_wetter_stunden_timestamptz', SQLSTATE || ' ' || SQLERRM);
  END;

  -- ── 8. Mutations-Mechanik und s112_ende ──────────────────────────────────────────────────────────────
  v_txt := pg_temp.s112_mutation();
  v_erg := v_erg || CASE WHEN v_txt IS NULL OR v_txt = ANY (c_mutationen) THEN pg_temp.s112_ok('mutation_unbekannt')
                         ELSE pg_temp.s112_fehler('mutation_unbekannt', format('Runner verlangt „%s“, die Datei deklariert %s', v_txt, c_mutationen)) END;
  IF v_txt IS NULL THEN
    v_erg := v_erg || pg_temp.s112_erwarte('mutation_normallauf_nichts_angewendet',
      nullif(current_setting('s112.mutation_angewendet', true), ''), NULL::text);
  ELSE
    v_erg := v_erg || pg_temp.s112_erwarte('mutation_angewendet_vermerkt',
      nullif(current_setting('s112.mutation_angewendet', true), ''), v_txt);
  END IF;
  -- ein nicht deklarierter Name bleibt ohne Wirkung (format(), damit die statische Prüfung ihn nicht als Mutation liest):
  -- harmloses SQL mit sichtbarer Spur (SET LOCAL überlebt den erfolgreichen Unterblock), dazu ein Unterblock,
  -- falls s112_mutiere doch ausführt und dabei scheitert
  PERFORM set_config('s112.probe', '', true);
  BEGIN
    v_bool := pg_temp.s112_mutiere(format('%s', 's112test_nicht_deklariert'), $m$SET LOCAL s112.probe = 'angewendet'$m$);
    v_erg := v_erg || pg_temp.s112_erwarte('mutiere_undeklariert_ohne_wirkung',
      v_bool::text || '/' || coalesce(nullif(current_setting('s112.probe', true), ''), '-'), 'false/-');
  EXCEPTION WHEN OTHERS THEN
    v_erg := v_erg || pg_temp.s112_fehler('mutiere_undeklariert_ohne_wirkung', SQLSTATE || ' ' || SQLERRM);
  END;

  -- s112_ende zählt richtig: synthetisches Ergebnis in einem Unterblock, Meldung zerlegen
  BEGIN
    PERFORM pg_temp.s112_ende('selbsttest_zaehlung',
      ARRAY['OK:eins', 'OK:zwei', 'FEHLER:drei beleg', 'BEKANNT:B0 Probe [beleg]', 'ohne_praefix'], clock_timestamp(), 5);
    v_erg := v_erg || pg_temp.s112_fehler('ende_zaehlt', 's112_ende warf nicht');
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    v_erg := v_erg || pg_temp.s112_erwarte('ende_sqlstate_p0001', v_state, 'P0001');
    v_erg := v_erg || pg_temp.s112_erwarte('ende_zaehlt',
      concat_ws('|', split_part(v_msg, '|', 1), split_part(v_msg, '|', 2), split_part(v_msg, '|', 3),
                split_part(v_msg, '|', 4), split_part(v_msg, '|', 5)),
      'S112TEST|selbsttest_zaehlung|ok=2|fehler=2|bekannt=1');
    v_erg := v_erg || pg_temp.s112_erwarte('ende_unbekannter_eintrag_ist_fehler', v_msg LIKE '%FEHLER:unbekannter_eintrag ohne_praefix%', true);
    v_erg := v_erg || pg_temp.s112_erwarte('ende_genau_mindestzahl_nicht_leer', v_msg LIKE '%zu_wenige_pruefungen%', false);
  END;
  BEGIN
    PERFORM pg_temp.s112_ende('selbsttest_leer', ARRAY['OK:eins', 'OK:zwei'], clock_timestamp(), 3);
    v_erg := v_erg || pg_temp.s112_fehler('ende_leer', 's112_ende warf nicht');
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    v_erg := v_erg || pg_temp.s112_erwarte('ende_leer',
      split_part(v_msg, '|', 3) || '|' || split_part(v_msg, '|', 4) || '|' || (v_msg LIKE '%FEHLER:zu_wenige_pruefungen ist=2 soll>=3%')::text,
      'ok=2|fehler=1|true');
  END;
  v_erg := v_erg || pg_temp.s112_erwarte('ende_rolle_postgres', current_user::text, 'postgres');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 140);
END
$test$;
