-- @bereich: Rahmen
-- @ziel: Prüft den Testrahmen selbst: Staging-Wächter, eine Transaktion samt Zurückrollen (keine Reste früherer
-- @ziel: Läufe, Marker-Betrieb), Aufbau und Trigger-Fallen, Benutzerwechsel, s112_versuch/zaehle/fehlertext,
-- @ziel: Ergebnis-Helfer (Ratsche, Baseline), Katalog- und Beispielzeilen-Helfer sowie die Form der Soll-Daten.
-- @mutation kontakte_select_offen: zusätzliche PERMISSIVE-Policy USING (true) auf kontakte – fremde Kontakte werden sichtbar | rot: fremder_kontakt_unsichtbar|zaehle_fremd_0
-- @mutation pruefe_tenant_zugriff_offen: pruefe_tenant_zugriff prüft nichts mehr | rot: versuch_T_rpc_fremd
--
-- software:112 – SQL-Testrahmen, Datei 00 (läuft immer zuerst; ist sie rot, bricht run.mjs den Lauf ab).
-- Nur Staging. Die ganze Datei ist EINE Transaktion und endet mit pg_temp.s112_ende(…) = RAISE → nichts bleibt.
--
-- Rückrollbeleg über zwei Aufrufe: Diese Datei legt jedes Mal den Betrieb mit dem festen slug
-- 's112test-rahmen-marker' an und prüft zu Beginn, dass es ihn (und sonst keinen S112TEST-Rest) nicht gibt.
-- Jeder Lauf belegt so das Zurückrollen des vorigen; run.mjs prüft danach zusätzlich in einem eigenen Aufruf.
--
-- Diese Datei prüft bewusst nur den Rahmen, keine Sicherheitsregeln der Datenbank (dafür 01, 10–20): eine
-- geänderte Policy darf hier nichts rot machen, sonst bräche jeder Lauf ab. Ausnahme sind die zwei Mutationen,
-- die belegen, dass der Rahmen eine aufgemachte Mandantentrennung überhaupt erkennt.

-- Test-eigene Hilfsfunktion (Präfix t00_; s112_* ist _helfer.sql vorbehalten): Fehler mit Hinweis.
CREATE FUNCTION pg_temp.t00_wirf() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  RAISE EXCEPTION 'S112 Probe' USING ERRCODE = '22023', HINT = 'Probehinweis';
END $f$;

DO $test$
DECLARE
  c_datei constant text := '00_rahmen';
  c_m     constant uuid := '33333333-3333-4333-8333-333333333333';
  v_t0    timestamptz := clock_timestamp();
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_c     uuid;
  v_bw    uuid;
  v_bta   uuid;
  v_n     bigint;
  v_n2    bigint;
  v_txt   text;
  v_bool  boolean;
  v_zeile jsonb;
  v_z2    jsonb;
  v_km    uuid;
  v_kb    uuid;
  v_arr   text[];
BEGIN
  PERFORM pg_temp.s112_nur_staging();

  -- ── 1. Eine Transaktion, pg_temp, keine Reste früherer Läufe ─────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('transaktion_xid_vergeben', pg_current_xact_id_if_assigned() IS NOT NULL, true);
  SELECT p.xmin = xid(pg_current_xact_id()) INTO v_bool FROM pg_proc p WHERE p.oid = 'pg_temp.s112_als(uuid,text,text)'::regprocedure;
  v_erg := v_erg || pg_temp.s112_erwarte('pg_temp_in_derselben_transaktion', v_bool, true);
  SELECT p.pronamespace = pg_my_temp_schema() INTO v_bool FROM pg_proc p WHERE p.oid = 'pg_temp.s112_ende(text,text[],timestamptz,integer)'::regprocedure;
  v_erg := v_erg || pg_temp.s112_erwarte('helfer_im_eigenen_temp_schema', v_bool, true);
  v_erg := v_erg || pg_temp.s112_erwarte('rolle_postgres_am_anfang', current_user::text, 'postgres');

  SELECT count(*) INTO v_n FROM public.tenants WHERE slug = 's112test-rahmen-marker';
  v_erg := v_erg || pg_temp.s112_erwarte('marker_voriger_lauf_abwesend', v_n, 0);
  SELECT count(*) INTO v_n FROM public.tenants WHERE slug LIKE 's112test-%' OR name LIKE 'S112TEST%';
  v_erg := v_erg || pg_temp.s112_erwarte('keine_reste_betriebe', v_n, 0);
  SELECT count(*) INTO v_n FROM auth.users WHERE email LIKE 's112test-%';
  v_erg := v_erg || pg_temp.s112_erwarte('keine_reste_benutzer', v_n, 0);
  SELECT count(*) INTO v_n FROM auth.mfa_factors WHERE friendly_name LIKE 's112test%';
  v_erg := v_erg || pg_temp.s112_erwarte('keine_reste_faktoren', v_n, 0);
  SELECT count(*) INTO v_n FROM storage.objects WHERE name LIKE '%s112test%';
  v_erg := v_erg || pg_temp.s112_erwarte('keine_reste_storage', v_n, 0);
  SELECT count(*) INTO v_n FROM public.kontakte WHERE nachname LIKE 'S112TEST%';
  v_erg := v_erg || pg_temp.s112_erwarte('keine_reste_kontakte', v_n, 0);
  SELECT count(*) INTO v_n FROM public.tenants WHERE id = c_m;
  v_erg := v_erg || pg_temp.s112_erwarte('musterhof_vorhanden', v_n, 1);

  INSERT INTO public.tenants (id, name, slug) VALUES (gen_random_uuid(), 'S112TEST Rahmen-Marker', 's112test-rahmen-marker');
  SELECT count(*) INTO v_n FROM public.tenants WHERE slug = 's112test-rahmen-marker';
  v_erg := v_erg || pg_temp.s112_erwarte('marker_angelegt', v_n, 1);

  -- ── 2. Aufbau und Trigger-Fallen ─────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau(true);
  v_b := (v_a ->> 'b')::uuid;
  v_c := (v_a ->> 'c')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  SELECT count(*) INTO v_n FROM jsonb_each_text(v_a) e WHERE e.value IS NOT NULL;
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_alle_ids', v_n, 18);
  SELECT count(*) INTO v_n FROM public.tenants WHERE id IN (v_b, v_c) AND name LIKE 'S112TEST Betrieb _' AND slug = 's112test-' || id;
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_betriebe_b_c', v_n, 2);
  SELECT count(*) INTO v_n FROM public.tenant_einstellungen WHERE tenant_id IN (v_b, v_c) AND betrieb_plz IS NULL;
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_einstellungen_ohne_plz', v_n, 2);
  -- trg_tenant_plattform_admins: alle Plattform-Admins (Staging-Admin + Test-PA) sind system_admin in B
  SELECT count(*) INTO v_n FROM public.tenant_memberships m JOIN public.plattform_admins p ON p.user_id = m.user_id
   WHERE m.tenant_id = v_b AND m.role = 'system_admin' AND m.aktiv;
  SELECT count(*) INTO v_n2 FROM public.plattform_admins;
  v_erg := v_erg || pg_temp.s112_erwarte('trigger_plattform_admins_in_b', v_n, v_n2);
  v_erg := v_erg || pg_temp.s112_erwarte('plattform_admins_mindestens_zwei', v_n2 >= 2, true);
  SELECT count(*) INTO v_n FROM public.tenant_memberships WHERE user_id = (v_a ->> 'pa')::uuid AND role = 'system_admin';
  v_erg := v_erg || pg_temp.s112_erwarte('test_pa_in_m_b_c', v_n, 3);
  -- tenant_memberships_schreibmodule_default
  SELECT schreibmodule INTO v_arr FROM public.tenant_memberships WHERE user_id = (v_a ->> 'm_w')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('trigger_winzer_null_alle_module', v_arr, pg_temp.s112_soll_liste('schreibmodule'));
  SELECT schreibmodule INTO v_arr FROM public.tenant_memberships WHERE user_id = (v_a ->> 'm_w0')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('trigger_winzer_leer_bleibt_leer', v_arr, '{}'::text[]);
  SELECT schreibmodule INTO v_arr FROM public.tenant_memberships WHERE user_id = (v_a ->> 'm_wc')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('trigger_winzer_nur_crm', v_arr, ARRAY['crm']);
  SELECT count(*) INTO v_n FROM public.tenant_memberships WHERE user_id = v_bta AND schreibmodule IS NULL;
  v_erg := v_erg || pg_temp.s112_erwarte('trigger_admin_module_null', v_n, 1);
  SELECT count(*) INTO v_n FROM public.profiles WHERE id = v_bw;
  v_erg := v_erg || pg_temp.s112_erwarte('trigger_profil_angelegt', v_n, 1);
  SELECT count(*) INTO v_n FROM public.tenant_memberships
   WHERE (user_id = (v_a ->> 'm_inak')::uuid AND tenant_id = c_m AND NOT aktiv)
      OR (user_id = (v_a ->> 'mix')::uuid AND ((tenant_id = c_m AND NOT aktiv) OR (tenant_id = v_b AND aktiv)))
      OR (user_id = (v_a ->> 'mb_ta')::uuid AND tenant_id IN (c_m, v_b) AND aktiv AND role = 'tenant_admin');
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_inaktiv_mix_zwei_betriebe', v_n, 5);
  SELECT count(*) INTO v_n FROM public.tenant_memberships WHERE user_id = (v_a ->> 'ohne')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_ohne_mitgliedschaft', v_n, 0);
  SELECT count(*) INTO v_n FROM public.tenant_memberships m
   WHERE m.user_id = (v_a ->> 'm_sa')::uuid AND m.role = 'system_admin'
     AND NOT EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = m.user_id);
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_system_admin_ohne_pa', v_n, 1);
  PERFORM pg_temp.s112_faktor(v_bta);
  SELECT count(*) INTO v_n FROM auth.mfa_factors WHERE user_id = v_bta AND status = 'verified' AND factor_type = 'totp';
  v_erg := v_erg || pg_temp.s112_erwarte('faktor_angelegt', v_n, 1);
  BEGIN
    PERFORM pg_temp.s112_als(v_bw);
    PERFORM pg_temp.s112_betrieb('nicht erlaubt');
    v_erg := v_erg || pg_temp.s112_fehler('aufbau_nur_als_postgres', 'als authenticated möglich');
  EXCEPTION WHEN raise_exception THEN
    v_erg := v_erg || pg_temp.s112_erwarte('aufbau_nur_als_postgres', SQLERRM LIKE 's112_betrieb nur als postgres%', true);
  END;
  v_erg := v_erg || pg_temp.s112_erwarte('rolle_nach_abgelehntem_aufbau', current_user::text, 'postgres');

  -- Beispieldaten für die Versuche: je ein Kontakt in M und B (als postgres)
  SELECT id INTO v_km FROM public.kontakte WHERE tenant_id = c_m ORDER BY id LIMIT 1;
  v_erg := v_erg || pg_temp.s112_erwarte('musterhof_kontakt_existiert', v_km IS NOT NULL, true);
  v_zeile := pg_temp.s112_zeile('kontakte', v_b, '{"nachname": "S112TEST Kontakt B"}');
  v_kb := (v_zeile ->> 'id')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('zeile_kontakt_b', v_zeile ->> 'tenant_id', v_b::text);

  -- Mutationen (nur im Mutationsmodus von run.mjs; sonst ohne Wirkung)
  PERFORM pg_temp.s112_mutiere('kontakte_select_offen',
    $m$CREATE POLICY s112test_mutation_offen ON public.kontakte AS PERMISSIVE FOR SELECT TO authenticated USING (true)$m$);
  PERFORM pg_temp.s112_mutiere('pruefe_tenant_zugriff_offen',
    $m$CREATE OR REPLACE FUNCTION public.pruefe_tenant_zugriff(p_tenant_id uuid, p_rollen text[] DEFAULT NULL::text[])
       RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $x$ BEGIN NULL; END $x$$m$);
  v_erg := v_erg || pg_temp.s112_erwarte('mutiere_unbekannt_ohne_wirkung', pg_temp.s112_mutiere(format('%s', 'nicht_deklariert'), 'SELECT 1/0'), false);
  v_erg := v_erg || pg_temp.s112_erwarte('ausfuehrlich_gesetzt', pg_temp.s112_ausfuehrlich() IS NOT NULL, true);

  -- ── 3. Benutzerwechsel ───────────────────────────────────────────────────────────────────────────────
  PERFORM set_config('app.active_tenant_id', c_m::text, true);
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  PERFORM set_config('s112.protokoll_aus', c_m::text, true);
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('als_rolle_authenticated', current_user::text, 'authenticated');
  v_erg := v_erg || pg_temp.s112_erwarte('als_auth_uid', auth.uid(), v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('als_aal1', auth.jwt() ->> 'aal', 'aal1');
  v_erg := v_erg || pg_temp.s112_erwarte('als_schalter_zurueckgesetzt',
    coalesce(current_setting('app.active_tenant_id', true), '') || coalesce(current_setting('storage.allow_delete_query', true), '')
    || coalesce(current_setting('s112.protokoll_aus', true), ''), '');
  BEGIN
    PERFORM public.ist_service_kontext();
    v_erg := v_erg || pg_temp.s112_fehler('ist_service_kontext_gesperrt', 'für authenticated ausführbar');
  EXCEPTION WHEN insufficient_privilege THEN
    v_erg := v_erg || pg_temp.s112_ok('ist_service_kontext_gesperrt');
  END;
  -- Rollen- und Claim-Wechsel in einem scheiternden Unterblock werden mit zurückgerollt
  BEGIN
    PERFORM pg_temp.s112_als_postgres();
    PERFORM 1 / 0;
  EXCEPTION WHEN division_by_zero THEN
    v_erg := v_erg || pg_temp.s112_erwarte('rolle_nach_unterblock_fehler', current_user::text, 'authenticated');
    v_erg := v_erg || pg_temp.s112_erwarte('claims_nach_unterblock_fehler', auth.uid(), v_bw);
  END;
  PERFORM pg_temp.s112_als(v_bta, 'authenticated', 'aal2');
  v_erg := v_erg || pg_temp.s112_erwarte('als_aal2', auth.jwt() ->> 'aal', 'aal2');
  PERFORM pg_temp.s112_als(NULL, 'anon');
  v_erg := v_erg || pg_temp.s112_erwarte('als_anon_rolle', current_user::text, 'anon');
  v_erg := v_erg || pg_temp.s112_erwarte('als_anon_ohne_uid', auth.uid(), NULL::uuid);
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('als_postgres_rolle', current_user::text, 'postgres');
  v_erg := v_erg || pg_temp.s112_erwarte('als_postgres_service_kontext', public.ist_service_kontext(), true);
  BEGIN
    PERFORM pg_temp.s112_als(v_bw, 'service_role');
    v_erg := v_erg || pg_temp.s112_fehler('als_nur_authenticated_anon', 'service_role angenommen');
  EXCEPTION WHEN raise_exception THEN
    v_erg := v_erg || pg_temp.s112_ok('als_nur_authenticated_anon');
  END;

  -- ── 4. Versuche ──────────────────────────────────────────────────────────────────────────────────────
  SELECT count(*) INTO v_n FROM public.kontakte WHERE tenant_id = v_b;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('versuch_k1_eigen',
    pg_temp.s112_versuch(format('INSERT INTO public.kontakte (tenant_id, nachname) VALUES (%L, %L)', v_b, 'S112TEST Versuch')), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('versuch_R_fremd',
    pg_temp.s112_versuch(format('INSERT INTO public.kontakte (tenant_id, nachname) VALUES (%L, %L)', c_m, 'S112TEST fremd')), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('versuch_k0_update_fremd',
    pg_temp.s112_versuch(format('UPDATE public.kontakte SET nachname = nachname WHERE id = %L', v_km)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('versuch_k1_update_eigen',
    pg_temp.s112_versuch(format('UPDATE public.kontakte SET nachname = nachname WHERE id = %L', v_kb)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('versuch_G_geheimnis',
    pg_temp.s112_versuch(format('SELECT brevo_api_key FROM public.tenant_einstellungen WHERE tenant_id = %L', v_b)), 'G');
  v_erg := v_erg || pg_temp.s112_erwarte('versuch_T_rpc_fremd',
    pg_temp.s112_versuch(format('SELECT public.pruefe_tenant_zugriff(%L, NULL)', c_m)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('versuch_E23502',
    pg_temp.s112_versuch(format('INSERT INTO public.kontakte (tenant_id) VALUES (%L)', v_b)), 'E23502');
  v_erg := v_erg || pg_temp.s112_erwarte('versuch_select_zeilen',
    pg_temp.s112_versuch(format('SELECT id FROM public.kontakte WHERE id IN (%L, %L)', v_kb, v_km)), 'k1');
  SELECT count(*) INTO v_n2 FROM public.kontakte WHERE id = v_km;
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_kontakt_unsichtbar', v_n2, 0);
  v_erg := v_erg || pg_temp.s112_erwarte('zaehle_fremd_0',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.kontakte WHERE tenant_id = %L', c_m)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('zaehle_eigen',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.kontakte WHERE tenant_id = %L', v_b)), v_n::text);
  v_erg := v_erg || pg_temp.s112_erwarte('zaehle_fehlercode',
    pg_temp.s112_zaehle('SELECT count(*) FROM public.s112_gibt_es_nicht'), 'E42P01');
  v_erg := v_erg || pg_temp.s112_erwarte('zaehle_recht_fehlt',
    pg_temp.s112_zaehle(format('SELECT count(brevo_api_key) FROM public.tenant_einstellungen WHERE tenant_id = %L', v_b)), 'G');
  v_erg := v_erg || pg_temp.s112_erwarte('fehlertext_mit_hinweis',
    pg_temp.s112_fehlertext('SELECT pg_temp.t00_wirf()'), '22023: S112 Probe | HINT: Probehinweis');
  v_erg := v_erg || pg_temp.s112_erwarte('fehlertext_ok', pg_temp.s112_fehlertext('SELECT 1'), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  SELECT count(*) INTO v_n2 FROM public.kontakte WHERE tenant_id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('versuch_sofort_zurueckgerollt', v_n2, v_n);
  SELECT count(*) INTO v_n2 FROM public.kontakte WHERE tenant_id = c_m;
  v_erg := v_erg || pg_temp.s112_erwarte('zaehle_als_postgres',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.kontakte WHERE tenant_id = %L', c_m)), v_n2::text);
  v_erg := v_erg || pg_temp.s112_erwarte('fehlercode_R', pg_temp.s112_fehlercode('42501', 'new row violates row-level security policy for table "x"'), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('fehlercode_G', pg_temp.s112_fehlercode('42501', 'permission denied for table x'), 'G');
  v_erg := v_erg || pg_temp.s112_erwarte('fehlercode_T', pg_temp.s112_fehlercode('42501', 'Kein Zugriff auf diesen Betrieb'), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('fehlercode_E', pg_temp.s112_fehlercode('23514', 'check'), 'E23514');

  -- ── 5. Ergebnis-Helfer ───────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('erwarte_ok_form', pg_temp.s112_erwarte('a b', 1, 1), 'OK:a_b');
  v_erg := v_erg || pg_temp.s112_erwarte('erwarte_fehler_form', pg_temp.s112_erwarte('x', 1, 2), 'FEHLER:x ist=1 soll=2');
  v_erg := v_erg || pg_temp.s112_erwarte('erwarte_null_gleich_null', pg_temp.s112_erwarte('x', NULL::int, NULL::int), 'OK:x');
  v_erg := v_erg || pg_temp.s112_erwarte('erwarte_null_ungleich', pg_temp.s112_erwarte('x', NULL::text, 'a'), 'FEHLER:x ist=NULL soll=a');
  v_erg := v_erg || pg_temp.s112_erwarte('text_einzeilig', pg_temp.s112_text(E'a\r\nb ; c'), 'a ⏎ b, c');
  v_erg := v_erg || pg_temp.s112_erwarte('fehler_form', pg_temp.s112_fehler('f', E'x\ny'), 'FEHLER:f x ⏎ y');
  v_erg := v_erg || pg_temp.s112_erwarte('bekannt_form', pg_temp.s112_bekannt('BX Probe', 'Beleg'), 'BEKANNT:BX Probe [Beleg]');
  v_erg := v_erg || pg_temp.s112_erwarte('luecke_bekannt', pg_temp.s112_luecke('l', 1, 0, 1, 'BX Probe'), 'BEKANNT:BX Probe [l ist=1]');
  v_erg := v_erg || pg_temp.s112_erwarte('luecke_behoben', pg_temp.s112_luecke('l', 0, 0, 1, 'BX Probe') LIKE 'FEHLER:l BEHOBEN – in harte Prüfung umwandeln%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('luecke_anders', pg_temp.s112_luecke('l', 2, 0, 1, 'BX Probe') LIKE 'FEHLER:l ist=2 soll=0 (bekannte Lücke erwartete 1%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('baseline_gleich', pg_temp.s112_baseline('z', 5, 5, 'BY Probe') LIKE 'BEKANNT:BY Probe [z 5]', true);
  v_erg := v_erg || pg_temp.s112_erwarte('baseline_mehr', pg_temp.s112_baseline('z', 6, 5, 'BY Probe') LIKE 'FEHLER:z ist=6 soll<=5 – neue Lücke%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('baseline_weniger', pg_temp.s112_baseline('z', 4, 5, 'BY Probe') LIKE 'FEHLER:z BEHOBEN – Baseline senken auf 4%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('baseline_null', pg_temp.s112_baseline('z', 0, 5, 'BY Probe') LIKE 'FEHLER:z BEHOBEN – in harte Prüfung umwandeln%', true);

  -- ── 6. Katalog und Beispielzeilen ────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('klasse_T', pg_temp.s112_klasse('kontakte'), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('klasse_K', pg_temp.s112_klasse('kontakt_firmen'), 'K');
  v_erg := v_erg || pg_temp.s112_erwarte('klasse_G', pg_temp.s112_klasse('rebsorten') || pg_temp.s112_klasse('tenants'), 'GG');
  v_erg := v_erg || pg_temp.s112_erwarte('klasse_unbekannt', pg_temp.s112_klasse('s112_gibt_es_nicht'), NULL::text);
  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity;
  SELECT count(*) INTO v_n2 FROM pg_temp.s112_mandantentabellen();
  v_erg := v_erg || pg_temp.s112_erwarte('mandantentabellen_alle_rls_tabellen', v_n2, v_n);
  SELECT count(*) INTO v_n FROM pg_temp.s112_mandantentabellen()
   WHERE klasse NOT IN ('T', 'K', 'G') OR (klasse = 'K') <> (eltern_tabelle IS NOT NULL) OR pk IS NULL
      OR (klasse = 'T') <> (tid_nullable IS NOT NULL);
  v_erg := v_erg || pg_temp.s112_erwarte('mandantentabellen_form', v_n, 0);
  SELECT eltern_spalte || '->' || eltern_tabelle || '.' || eltern_ref INTO v_txt FROM pg_temp.s112_mandantentabellen() WHERE tabelle = 'kontakt_praeferenzen';
  v_erg := v_erg || pg_temp.s112_erwarte('mandantentabellen_eltern', v_txt, 'kontakt_id->kontakte.id');

  v_zeile := pg_temp.s112_zeile('kontakt_firmen', v_b);
  SELECT count(*) INTO v_n FROM public.kontakte k JOIN public.firmen f ON f.id = (v_zeile ->> 'firma_id')::uuid
   WHERE k.id = (v_zeile ->> 'kontakt_id')::uuid AND k.tenant_id = v_b AND f.tenant_id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('zeile_K_eltern_im_selben_betrieb', v_n, 1);
  EXECUTE format('SELECT count(*) FROM public.kontakt_firmen WHERE %s', pg_temp.s112_pk_where('kontakt_firmen', v_zeile)) INTO v_n;
  v_erg := v_erg || pg_temp.s112_erwarte('pk_where_findet_zeile', v_n, 1);
  v_z2 := pg_temp.s112_zeile('wetter_stunden', v_b);
  EXECUTE format('SELECT count(*) FROM public.wetter_stunden WHERE %s', pg_temp.s112_pk_where('wetter_stunden', v_z2)) INTO v_n;
  v_erg := v_erg || pg_temp.s112_erwarte('pk_where_typisiert', v_n, 1);
  v_z2 := pg_temp.s112_zeile('kontakte', v_b, '{"nachname": "S112TEST Werte", "vorname": null}');
  v_erg := v_erg || pg_temp.s112_erwarte('zeile_werte_uebernommen', (v_z2 ->> 'nachname') || '/' || coalesce(v_z2 ->> 'vorname', 'NULL'), 'S112TEST Werte/NULL');

  v_zeile := pg_temp.s112_klon('kontakte', v_z2);
  v_erg := v_erg || pg_temp.s112_erwarte('klon_neue_id',
    v_zeile ->> 'id' <> v_z2 ->> 'id' AND v_zeile ->> 'nachname' = 'S112TEST Werte' AND v_zeile ->> 'tenant_id' = v_b::text, true);
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('klon_fremd_R',
    pg_temp.s112_versuch(pg_temp.s112_klon_sql('kontakte', v_z2, jsonb_build_object('tenant_id', c_m))), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('klon_eigen_k1', pg_temp.s112_versuch(pg_temp.s112_klon_sql('kontakte', v_z2)), 'k1');
  PERFORM pg_temp.s112_als_postgres();

  v_zeile := pg_temp.s112_beispiel('assistent_unterhaltungen', v_b, v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('beispiel_eigentuemer', v_zeile ->> 'user_id', v_bw::text);
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('beispiel_positivkontrolle_update',
    pg_temp.s112_versuch(format('UPDATE public.assistent_unterhaltungen SET %s WHERE %s',
      quote_ident((SELECT upd_spalte FROM pg_temp.s112_mandantentabellen() WHERE tabelle = 'assistent_unterhaltungen'))
        || ' = ' || quote_ident((SELECT upd_spalte FROM pg_temp.s112_mandantentabellen() WHERE tabelle = 'assistent_unterhaltungen')),
      pg_temp.s112_pk_where('assistent_unterhaltungen', v_zeile))), 'k1');
  PERFORM pg_temp.s112_als_postgres();
  v_zeile := pg_temp.s112_beispiel('konto_umbuchungen', v_b, v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('beispiel_konto_umbuchung',
    v_zeile ->> 'von_konto_id' <> v_zeile ->> 'nach_konto_id' AND v_zeile ->> 'tenant_id' = v_b::text, true);
  v_zeile := pg_temp.s112_beispiel('traubenverkauf', v_b);
  v_erg := v_erg || pg_temp.s112_erwarte('beispiel_traubenverkauf', v_zeile ->> 'weingarten_id' IS NOT NULL AND v_zeile ->> 'zukauf_posten_id' IS NULL, true);
  v_zeile := pg_temp.s112_beispiel('ama_erntemeldungen', v_b);
  v_erg := v_erg || pg_temp.s112_erwarte('beispiel_ama_entwurf', v_zeile ->> 'status', 'entwurf');

  -- ── 7. Soll-Daten (nur die Form; der Abgleich mit dem Katalog steht in 01) ───────────────────────────
  SELECT count(*), count(DISTINCT tabelle) INTO v_n, v_n2 FROM pg_temp.s112_soll();
  v_erg := v_erg || pg_temp.s112_erwarte('soll_drei_aktionen_je_tabelle', v_n, v_n2 * 3);
  SELECT count(*) INTO v_n FROM pg_temp.s112_soll()
   WHERE NOT (rollen <@ ARRAY['SA', 'TA', 'W', 'W*', 'L', 'PA'])
      OR NOT (module <@ (pg_temp.s112_soll_liste('schreibmodule') || ARRAY['betrieb']))
      OR aktion NOT IN ('INSERT', 'UPDATE', 'DELETE');
  v_erg := v_erg || pg_temp.s112_erwarte('soll_matrix_gueltig', v_n, 0);
  SELECT rollen::text || module::text INTO v_txt FROM pg_temp.s112_soll() WHERE tabelle = 'aktivitaet_dokumente' AND aktion = 'UPDATE';
  v_erg := v_erg || pg_temp.s112_erwarte('soll_matrix_zerlegt', v_txt, '{}{crm,warenwirtschaft}');
  v_erg := v_erg || pg_temp.s112_erwarte('soll_liste_unbekannt', pg_temp.s112_soll_liste('s112_gibt_es_nicht'), NULL::text[]);
  v_erg := v_erg || pg_temp.s112_erwarte('soll_listen_laengen',
    array_length(pg_temp.s112_soll_liste('geheimnis_spalten'), 1) || '/' || array_length(pg_temp.s112_soll_liste('public_policies'), 1)
    || '/' || array_length(pg_temp.s112_soll_liste('protokoll_tabellen'), 1) || '/' || array_length(pg_temp.s112_soll_liste('g_tabellen'), 1),
    '12/6/44/8');   -- KAN-167: + betriebsmittel, betriebsmittel_lager_bewegungen; KAN-150 F2a: + 5 Antrags-/Aufzeichnungstabellen; KAN-129: protokoll_tabellen + lesen; KAN-149 D2: + ea_transaktionen, zahlungen, konto_umbuchungen; KAN-149 D3: + ea_belege, ea_monatsabschluss, ea_uva; KAN-150 F1a: + 7 Stammdatentabellen
  v_erg := v_erg || pg_temp.s112_erwarte('soll_truncate_anon_wie_authenticated',
    pg_temp.s112_soll_liste('truncate_anon'), pg_temp.s112_soll_liste('truncate_authenticated'));
  SELECT count(*) INTO v_n FROM pg_temp.s112_soll_rpc()
   WHERE einstufung NOT IN ('rls_hilfe', 'mandant', 'mandant_eigen', 'session_user', 'intern', 'trigger')
      OR rechte !~ '^[A-][U-][S-]$' OR funktion !~ '^[a-z0-9_]+\(.*\)$' OR abo IS NULL;
  v_erg := v_erg || pg_temp.s112_erwarte('soll_rpc_gueltig', v_n, 0);
  SELECT count(*) - count(DISTINCT funktion) INTO v_n FROM pg_temp.s112_soll_rpc();
  v_erg := v_erg || pg_temp.s112_erwarte('soll_rpc_eindeutig', v_n, 0);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 60);
END
$test$;
