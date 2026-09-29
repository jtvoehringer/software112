-- @bereich: Plattform-Admin und Mitgliedschaften
-- @ziel: Globale Schreibrechte (rebsorten, release_notes, module_flags, tenants INSERT, Storage mandant-logos)
-- @ziel: hat nur, wer in plattform_admins steht – system_admin allein reicht nie. Kein Betriebsbenutzer vergibt
-- @ziel: selbst Mitgliedschaften oder Rollen (Benutzerlimit max_benutzer nicht umgehbar), niemand vergibt sich
-- @ziel: selbst den Plattform-Admin; Löschen von Mitgliedschaften nur durch SA/TA, nie sich selbst, system_admin-
-- @ziel: Zeilen nur durch Plattform-Admins. Lesen: Mitgliedschaften, plattform_admins, inaktive Release-Notes,
-- @ziel: bestandsprotokoll (Plattform-Admin auch betriebsfremd, Winzer nie).
-- @mutation rebsorten_system_admin: PERMISSIVE-Policy FOR ALL auf rebsorten für jeden aktiven system_admin | rot: rebsorten_(insert|update|delete)_m_sa
-- @mutation tm_insert_betriebsadmin: PERMISSIVE-INSERT-Policy auf tenant_memberships für SA/TA des Betriebs | rot: tm_insert_(b_ta|m_sa)
-- @mutation pa_selbstvergabe: PERMISSIVE-INSERT-Policy auf plattform_admins mit user_id = auth.uid() | rot: pa_insert_selbst_(m_sa|b_ta)
-- @mutation tm_delete_selbst: PERMISSIVE-DELETE-Policy auf tenant_memberships für die eigene Zeile | rot: tm_delete_selbst_b_ta|tm_delete_pa_selbst
-- @mutation release_notes_alle_lesen: PERMISSIVE-SELECT-Policy USING (true) auf release_notes | rot: rn_inaktiv_unsichtbar_.*
-- @mutation bestandsprotokoll_mitglieder: PERMISSIVE-SELECT-Policy auf bestandsprotokoll für alle Mitglieder | rot: bp_b_w_unsichtbar
-- @mutation tm_delete_winzer: DELETE-Policy auf tenant_memberships auch für winzer | rot: tm_delete_policy_b_w_.*
-- @mutation tm_delete_pa_ohne_mitglied: DELETE-Policy auf tenant_memberships für Plattform-Admins auch ohne Mitgliedschaft | rot: tm_delete_policy_pa_musterhof
-- @mutation module_flags_delete_offen: zusätzliche DELETE-Policy USING (true) auf module_flags | rot: module_flags_delete_(m_sa|b_ta|pa)
-- @mutation tenants_insert_rls_offen: INSERT-Policy auf tenants mit WITH CHECK (true) | rot: tenants_insert_policy_.*
-- @mutation tm_update_ta: UPDATE-Policy auf tenant_memberships für SA/TA des Betriebs statt Plattform-Admin | rot: tm_update_.*
-- @mutation tenants_pa_trigger_weg: Trigger tenants_plattform_admins entfernt (neue Betriebe ohne Plattform-Admins) | rot: tenants_trigger_.*
-- @mutation schutz_tenants_weg: Schutz-Trigger a_schutz_plattformfelder auf tenants entfernt | rot: tenants_insert_(m_sa|b_ta)|tenants_max_benutzer_b_ta
-- @mutation storage_logo_sa: INSERT-Policy auf storage.objects (mandant-logos) für jeden system_admin | rot: logo_insert_m_sa
-- @mutation pa_alle_lesen: SELECT-Policy auf plattform_admins USING (true) | rot: pa_select_.*
-- @mutation bp_insert_grant: GRANT INSERT auf bestandsprotokoll an authenticated | rot: bp_insert_pa
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 17 (Stand 28.09.2026).
-- Regeln aus CLAUDE.md, Abschnitte „Plattform-Admin in RLS“ und „Paket- und Systemfelder“:
--   * globale Schreibrechte nur über EXISTS (plattform_admins p WHERE p.user_id = auth.uid()),
--     nie über tenant_memberships.role = 'system_admin' allein,
--   * tenant_memberships: Anlegen und Ändern per API nur für Plattform-Admins (sonst max_benutzer umgehbar),
--     als Benutzer nur das Entfernen (removeMember), und dort nie sich selbst und nie system_admin-Zeilen
--     (außer als Plattform-Admin),
--   * tenants INSERT nur Plattform-Admin; Trigger tenants_plattform_admins trägt alle Plattform-Admins ein.
--
-- Personas (eigener Aufbau, NICHT s112_aufbau – dort ist pa auch im Musterhof Mitglied):
--   pa    Test-Plattform-Admin, VOR Betrieb B angelegt → per Trigger system_admin in B, im Musterhof NICHT Mitglied
--   m_sa  system_admin im Musterhof ohne plattform_admins
--   b_ta  tenant_admin B,  b_w / b_w2  winzer B (alle 6 Module),  neu  angemeldet ohne Betrieb
--   stg   Staging-Konto admin@software112.test (Plattform-Admin, system_admin im Musterhof und per Trigger in B)
--
-- Reihenfolge von BEFORE-Trigger und RLS: Bei INSERT auf tenants läuft der BEFORE-Trigger a_schutz_plattformfelder
-- VOR der RLS-Prüfung und lehnt jeden Benutzer-Insert (außer Plattform-Admins) mit 42501 ab → Code T statt R.
-- Damit die RLS-Schicht darunter trotzdem geprüft wird, wertet pg_temp.t17_policy die Policy-Ausdrücke selbst
-- aus (siehe dort) – ebenso für DELETE auf tenant_memberships, wo die SELECT-Policy den eigentlichen DELETE-
-- Versuch sonst vakuös macht (die Zielzeile ist für Winzer bzw. betriebsfremde Plattform-Admins unsichtbar).

-- Wertet die Policy-Schicht einer Tabelle in public für eine gegebene Zeile aus, als GERADE AKTIVE Rolle:
-- (OR aller PERMISSIVE-Policies) AND (AND aller RESTRICTIVE-Policies) für p_cmd bzw. ALL, Rollen = current_user
-- oder public. INSERT nimmt WITH CHECK (bei ALL ohne WITH CHECK den USING-Ausdruck), sonst USING.
-- Unabhängig von Triggern und von der SELECT-Sichtbarkeit. Ergebnis 'ja' | 'nein' | Fehlercode (R/G/T/E…).
CREATE FUNCTION pg_temp.t17_policy(p_tab text, p_cmd text, p_zeile jsonb) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v_perm  text;
  v_restr text;
  v_ok    boolean;
  v_state text;
  v_msg   text;
BEGIN
  SELECT string_agg('(' || x.ausdruck || ')', ' OR ') FILTER (WHERE x.permissive = 'PERMISSIVE'),
         string_agg('(' || x.ausdruck || ')', ' AND ') FILTER (WHERE x.permissive = 'RESTRICTIVE')
    INTO v_perm, v_restr
    FROM (SELECT p.permissive,
                 CASE WHEN p_cmd = 'INSERT' THEN coalesce(p.with_check, p.qual) ELSE p.qual END AS ausdruck
            FROM pg_policies p
           WHERE p.schemaname = 'public' AND p.tablename = p_tab AND p.cmd IN (p_cmd, 'ALL')
             AND p.roles && ARRAY[current_user::name, 'public'::name]) x
   WHERE x.ausdruck IS NOT NULL;
  IF v_perm IS NULL THEN
    RETURN 'nein';
  END IF;
  EXECUTE format('SELECT (%s) AND (%s) FROM jsonb_populate_record(NULL::public.%I, $1) AS %I',
                 v_perm, coalesce(v_restr, 'true'), p_tab, p_tab)
     INTO v_ok USING p_zeile;
  RETURN CASE WHEN v_ok THEN 'ja' ELSE 'nein' END;
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  RETURN pg_temp.s112_fehlercode(v_state, v_msg);
END $f$;

DO $test$
DECLARE
  c_datei constant text := '17_plattform_admin';
  c_m     constant uuid := '33333333-3333-4333-8333-333333333333';
  v_t0    timestamptz := clock_timestamp();
  v_erg   text[] := '{}';
  v_pa    uuid;
  v_b     uuid;
  v_msa   uuid;
  v_bta   uuid;
  v_bw    uuid;
  v_bw2   uuid;
  v_neu   uuid;
  v_stg   uuid;
  v_rs    uuid;       -- Test-Rebsorte (wird gelöscht)
  v_rs2   uuid;       -- zweite Test-Rebsorte
  v_rn_in uuid;       -- inaktive Test-Release-Note
  v_rn_ak uuid;       -- aktive Test-Release-Note
  v_mf_b  uuid;       -- module_flags-Zeile in B
  v_mf_m  uuid;       -- module_flags-Zeile im Musterhof (selbst angelegt)
  v_tn    uuid := gen_random_uuid();   -- Betrieb, den pa anlegt
  v_tn_z  jsonb;      -- neue tenants-Zeile für die Policy-Auswertung
  v_z_bta jsonb;      -- Mitgliedschaftszeilen für die Policy-Auswertung
  v_z_bw  jsonb;
  v_z_bw2 jsonb;
  v_z_stb jsonb;      -- stg in B
  v_z_stm jsonb;      -- stg im Musterhof
  v_z_msa jsonb;      -- m_sa im Musterhof
  v_logo  text;
  v_n     bigint;
  v_n2    bigint;
  v_txt   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();

  -- ── Aufbau (als postgres) ───────────────────────────────────────────────────────────────────────────
  v_pa  := pg_temp.s112_plattform_admin('{}'::uuid[]);      -- vor B: kommt per Trigger in B
  v_b   := pg_temp.s112_betrieb('S112TEST Betrieb B');
  v_msa := pg_temp.s112_benutzer('system_admin', c_m);
  v_bta := pg_temp.s112_benutzer('tenant_admin', v_b);
  v_bw  := pg_temp.s112_benutzer('winzer', v_b);
  v_bw2 := pg_temp.s112_benutzer('winzer', v_b);
  v_neu := pg_temp.s112_benutzer(NULL, NULL);
  SELECT u.id INTO v_stg FROM auth.users u JOIN public.plattform_admins p ON p.user_id = u.id
   WHERE u.email = 'admin@software112.test';

  SELECT count(*) INTO v_n FROM public.tenant_memberships WHERE user_id = v_pa AND tenant_id = v_b AND role = 'system_admin' AND aktiv;
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_pa_system_admin_in_b', v_n, 1);
  SELECT count(*) INTO v_n FROM public.tenant_memberships WHERE user_id = v_pa AND tenant_id = c_m;
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_pa_nicht_im_musterhof', v_n, 0);
  SELECT count(*) INTO v_n FROM public.tenant_memberships WHERE user_id = v_stg AND tenant_id = v_b AND role = 'system_admin';
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_staging_admin_system_admin_in_b', v_n, 1);
  SELECT count(*) INTO v_n FROM public.plattform_admins WHERE user_id = v_msa;
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_m_sa_kein_plattform_admin', v_n, 0);
  -- Vorbedingung der k0-Prüfungen auf die stg-Zeile im Musterhof: sie existiert (system_admin, aktiv)
  SELECT count(*) INTO v_n FROM public.tenant_memberships WHERE user_id = v_stg AND tenant_id = c_m AND role = 'system_admin' AND aktiv;
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_staging_admin_system_admin_im_musterhof', v_n, 1);
  SELECT count(*) INTO v_n FROM public.tenant_memberships WHERE user_id = v_bw2 AND tenant_id = v_b AND role = 'winzer' AND aktiv;
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_b_w2_winzer_in_b', v_n, 1);

  -- Mitgliedschaftszeilen für die Policy-Auswertung (pg_temp.t17_policy)
  SELECT to_jsonb(m) INTO v_z_bta FROM public.tenant_memberships m WHERE m.tenant_id = v_b AND m.user_id = v_bta;
  SELECT to_jsonb(m) INTO v_z_bw  FROM public.tenant_memberships m WHERE m.tenant_id = v_b AND m.user_id = v_bw;
  SELECT to_jsonb(m) INTO v_z_bw2 FROM public.tenant_memberships m WHERE m.tenant_id = v_b AND m.user_id = v_bw2;
  SELECT to_jsonb(m) INTO v_z_stb FROM public.tenant_memberships m WHERE m.tenant_id = v_b AND m.user_id = v_stg;
  SELECT to_jsonb(m) INTO v_z_stm FROM public.tenant_memberships m WHERE m.tenant_id = c_m AND m.user_id = v_stg;
  SELECT to_jsonb(m) INTO v_z_msa FROM public.tenant_memberships m WHERE m.tenant_id = c_m AND m.user_id = v_msa;
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_zeilen_fuer_policy_auswertung',
    v_z_bta IS NOT NULL AND v_z_bw IS NOT NULL AND v_z_bw2 IS NOT NULL AND v_z_stb IS NOT NULL
    AND v_z_stm IS NOT NULL AND v_z_msa IS NOT NULL, true);
  v_tn_z := jsonb_build_object('id', v_tn, 'name', 'S112TEST neu', 'slug', 's112test-' || v_tn);

  -- Testdaten (als postgres) – alles selbst angelegt, nichts aus dem Staging-Bestand
  INSERT INTO public.rebsorten (kuerzel, name_de, farbe) VALUES ('S112TEST', 'S112TEST Rebsorte', 'weiss') RETURNING id INTO v_rs;
  INSERT INTO public.rebsorten (kuerzel, name_de, farbe) VALUES ('S112TESTM', 'S112TEST Rebsorte M', 'rot') RETURNING id INTO v_rs2;
  INSERT INTO public.release_notes (version, titel, aktiv) VALUES ('s112test-inaktiv', 'S112TEST inaktiv', false) RETURNING id INTO v_rn_in;
  INSERT INTO public.release_notes (version, titel, aktiv) VALUES ('s112test-aktiv', 'S112TEST aktiv', true) RETURNING id INTO v_rn_ak;
  INSERT INTO public.module_flags (tenant_id, module) VALUES (v_b, 'weingarten') RETURNING id INTO v_mf_b;
  -- Der Musterhof hat alle 10 zulässigen Module (CHECK module_flags_module_check). Zwei davon werden hier
  -- (zurückgerollt) entfernt: 'reports' kommt als eigene Testzeile wieder, 'emcs' bleibt frei für die Insert-
  -- Versuche – so liefert eine offene Policy k1 statt E23505.
  DELETE FROM public.module_flags WHERE tenant_id = c_m AND module IN ('emcs', 'reports');
  INSERT INTO public.module_flags (tenant_id, module) VALUES (c_m, 'reports') RETURNING id INTO v_mf_m;
  SELECT count(*) INTO v_n FROM public.module_flags WHERE tenant_id = c_m AND module = 'emcs';
  v_erg := v_erg || pg_temp.s112_erwarte('module_flag_musterhof_emcs_frei', v_n, 0);
  SELECT count(*) INTO v_n FROM public.module_flags WHERE tenant_id = v_b AND module = 'kellerbuch';
  v_erg := v_erg || pg_temp.s112_erwarte('module_flag_b_kellerbuch_frei', v_n, 0);
  INSERT INTO public.bestandsprotokoll (tenant_id, tabelle, datensatz_id, aktion, alt)
  VALUES (c_m, 'verkaufsposten', gen_random_uuid(), 'UPDATE', '{"s112test": true}'),
         (v_b, 'verkaufsposten', gen_random_uuid(), 'UPDATE', '{"s112test": true}');
  v_logo := c_m::text || '/s112test-logo.png';
  INSERT INTO storage.objects (bucket_id, name) VALUES ('mandant-logos', v_logo);

  -- ── Mutationen (nur im Mutationsmodus von run.mjs) ──────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('rebsorten_system_admin',
    $m$CREATE POLICY s112test_rebsorten_sa ON public.rebsorten AS PERMISSIVE FOR ALL TO authenticated
       USING (EXISTS (SELECT 1 FROM public.tenant_memberships m WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role = 'system_admin'))
       WITH CHECK (EXISTS (SELECT 1 FROM public.tenant_memberships m WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role = 'system_admin'))$m$);
  PERFORM pg_temp.s112_mutiere('tm_insert_betriebsadmin',
    $m$CREATE POLICY s112test_tm_insert ON public.tenant_memberships AS PERMISSIVE FOR INSERT TO authenticated
       WITH CHECK (public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin']))$m$);
  PERFORM pg_temp.s112_mutiere('pa_selbstvergabe',
    $m$CREATE POLICY s112test_pa_selbst ON public.plattform_admins AS PERMISSIVE FOR INSERT TO authenticated
       WITH CHECK (user_id = (SELECT auth.uid()))$m$);
  PERFORM pg_temp.s112_mutiere('tm_delete_selbst',
    $m$CREATE POLICY s112test_tm_delete_selbst ON public.tenant_memberships AS PERMISSIVE FOR DELETE TO authenticated
       USING (user_id = (SELECT auth.uid()))$m$);
  PERFORM pg_temp.s112_mutiere('release_notes_alle_lesen',
    $m$CREATE POLICY s112test_rn_alle ON public.release_notes AS PERMISSIVE FOR SELECT TO authenticated USING (true)$m$);
  PERFORM pg_temp.s112_mutiere('bestandsprotokoll_mitglieder',
    $m$CREATE POLICY s112test_bp_alle ON public.bestandsprotokoll AS PERMISSIVE FOR SELECT TO authenticated
       USING (tenant_id IN (SELECT public.get_user_tenant_ids()))$m$);
  PERFORM pg_temp.s112_mutiere('tm_delete_winzer',
    $m$ALTER POLICY "memberships: tenant_admin can delete" ON public.tenant_memberships
       USING (public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin','winzer'])
              AND user_id <> (SELECT auth.uid())
              AND (role <> 'system_admin' OR EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid()))))$m$);
  PERFORM pg_temp.s112_mutiere('tm_delete_pa_ohne_mitglied',
    $m$ALTER POLICY "memberships: tenant_admin can delete" ON public.tenant_memberships
       USING ((public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin'])
               OR EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid())))
              AND user_id <> (SELECT auth.uid())
              AND (role <> 'system_admin' OR EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid()))))$m$);
  PERFORM pg_temp.s112_mutiere('module_flags_delete_offen',
    $m$CREATE POLICY s112test_mf_del ON public.module_flags AS PERMISSIVE FOR DELETE TO authenticated USING (true)$m$);
  PERFORM pg_temp.s112_mutiere('tenants_insert_rls_offen',
    $m$ALTER POLICY "tenants: nur Plattform-Admins legen an" ON public.tenants WITH CHECK (true)$m$);
  PERFORM pg_temp.s112_mutiere('tm_update_ta',
    $m$ALTER POLICY "memberships: nur Plattform-Admins ändern" ON public.tenant_memberships
       USING (public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin']))
       WITH CHECK (public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin']))$m$);
  PERFORM pg_temp.s112_mutiere('tenants_pa_trigger_weg',
    $m$DROP TRIGGER tenants_plattform_admins ON public.tenants$m$);
  PERFORM pg_temp.s112_mutiere('schutz_tenants_weg',
    $m$DROP TRIGGER a_schutz_plattformfelder ON public.tenants$m$);
  PERFORM pg_temp.s112_mutiere('storage_logo_sa',
    $m$CREATE POLICY s112test_logo_sa ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
       WITH CHECK (bucket_id = 'mandant-logos' AND EXISTS (SELECT 1 FROM public.tenant_memberships m
                   WHERE m.user_id = (SELECT auth.uid()) AND m.role = 'system_admin'))$m$);
  PERFORM pg_temp.s112_mutiere('pa_alle_lesen',
    $m$ALTER POLICY pa_eigene_zeile ON public.plattform_admins USING (true)$m$);
  PERFORM pg_temp.s112_mutiere('bp_insert_grant',
    $m$GRANT INSERT ON public.bestandsprotokoll TO authenticated$m$);

  -- ── 1. rebsorten: Schreiben nur Plattform-Admin ─────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_msa);
  v_erg := v_erg || pg_temp.s112_erwarte('rebsorten_insert_m_sa', pg_temp.s112_versuch(
    $s$INSERT INTO public.rebsorten (kuerzel, name_de, farbe) VALUES ('S112TEST2', 'S112TEST neu', 'rot')$s$), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('rebsorten_update_m_sa', pg_temp.s112_versuch(
    format('UPDATE public.rebsorten SET name_de = name_de WHERE id IN (%L, %L)', v_rs, v_rs2)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('rebsorten_delete_m_sa', pg_temp.s112_versuch(
    format('DELETE FROM public.rebsorten WHERE id = %L', v_rs)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('rebsorten_lesen_m_sa', pg_temp.s112_zaehle(
    format('SELECT count(*) FROM public.rebsorten WHERE id IN (%L, %L)', v_rs, v_rs2)), '2');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('rebsorten_insert_b_ta', pg_temp.s112_versuch(
    $s$INSERT INTO public.rebsorten (kuerzel, name_de, farbe) VALUES ('S112TEST2', 'S112TEST neu', 'rot')$s$), 'R');
  PERFORM pg_temp.s112_als(v_pa);
  v_erg := v_erg || pg_temp.s112_erwarte('rebsorten_insert_pa', pg_temp.s112_versuch(
    $s$INSERT INTO public.rebsorten (kuerzel, name_de, farbe) VALUES ('S112TEST2', 'S112TEST neu', 'rot')$s$), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('rebsorten_insert_pa_unvollstaendig', pg_temp.s112_versuch(
    $s$INSERT INTO public.rebsorten (kuerzel) VALUES ('S112TEST3')$s$), 'E23502');
  v_erg := v_erg || pg_temp.s112_erwarte('rebsorten_update_pa', pg_temp.s112_versuch(
    format('UPDATE public.rebsorten SET name_de = name_de WHERE id IN (%L, %L)', v_rs, v_rs2)), 'k2');
  v_erg := v_erg || pg_temp.s112_erwarte('rebsorten_delete_pa', pg_temp.s112_versuch(
    format('DELETE FROM public.rebsorten WHERE id = %L', v_rs)), 'k1');
  PERFORM pg_temp.s112_als(NULL, 'anon');
  v_erg := v_erg || pg_temp.s112_erwarte('rebsorten_insert_anon', pg_temp.s112_versuch(
    $s$INSERT INTO public.rebsorten (kuerzel, name_de, farbe) VALUES ('S112TEST2', 'S112TEST neu', 'rot')$s$), 'R');

  -- ── 2. release_notes ────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_msa);
  v_erg := v_erg || pg_temp.s112_erwarte('release_notes_insert_m_sa', pg_temp.s112_versuch(
    $s$INSERT INTO public.release_notes (version, titel) VALUES ('s112test-neu', 'S112TEST neu')$s$), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('release_notes_update_m_sa', pg_temp.s112_versuch(
    format('UPDATE public.release_notes SET titel = titel WHERE id IN (%L, %L)', v_rn_in, v_rn_ak)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('release_notes_delete_m_sa', pg_temp.s112_versuch(
    format('DELETE FROM public.release_notes WHERE id IN (%L, %L)', v_rn_in, v_rn_ak)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('rn_inaktiv_unsichtbar_m_sa', pg_temp.s112_zaehle(
    format('SELECT count(*) FROM public.release_notes WHERE id = %L', v_rn_in)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('rn_aktiv_sichtbar_m_sa', pg_temp.s112_zaehle(
    format('SELECT count(*) FROM public.release_notes WHERE id = %L', v_rn_ak)), '1');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('rn_inaktiv_unsichtbar_b_w', pg_temp.s112_zaehle(
    format('SELECT count(*) FROM public.release_notes WHERE id = %L', v_rn_in)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('rn_aktiv_sichtbar_b_w', pg_temp.s112_zaehle(
    format('SELECT count(*) FROM public.release_notes WHERE id = %L', v_rn_ak)), '1');
  PERFORM pg_temp.s112_als(v_pa);
  v_erg := v_erg || pg_temp.s112_erwarte('rn_inaktiv_sichtbar_pa', pg_temp.s112_zaehle(
    format('SELECT count(*) FROM public.release_notes WHERE id = %L', v_rn_in)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('release_notes_insert_pa', pg_temp.s112_versuch(
    $s$INSERT INTO public.release_notes (version, titel) VALUES ('s112test-neu', 'S112TEST neu')$s$), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('release_notes_insert_pa_unvollstaendig', pg_temp.s112_versuch(
    $s$INSERT INTO public.release_notes (version) VALUES ('s112test-halb')$s$), 'E23502');
  v_erg := v_erg || pg_temp.s112_erwarte('release_notes_update_pa', pg_temp.s112_versuch(
    format('UPDATE public.release_notes SET titel = titel WHERE id IN (%L, %L)', v_rn_in, v_rn_ak)), 'k2');
  v_erg := v_erg || pg_temp.s112_erwarte('release_notes_delete_pa', pg_temp.s112_versuch(
    format('DELETE FROM public.release_notes WHERE id IN (%L, %L)', v_rn_in, v_rn_ak)), 'k2');

  -- ── 3. module_flags: INSERT/UPDATE nur Plattform-Admin, DELETE niemand per API ──────────────────────
  -- (keine DELETE-Policy: Module schaltet die Mandantenverwaltung per aktiv-Flag bzw. Service-Role)
  PERFORM pg_temp.s112_als(v_msa);
  v_erg := v_erg || pg_temp.s112_erwarte('module_flags_m_sa_sieht_eigene', pg_temp.s112_zaehle(
    format('SELECT count(*) FROM public.module_flags WHERE id = %L', v_mf_m)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('module_flags_insert_m_sa', pg_temp.s112_versuch(
    format('INSERT INTO public.module_flags (tenant_id, module) VALUES (%L, %L)', c_m, 'emcs')), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('module_flags_update_m_sa', pg_temp.s112_versuch(
    format('UPDATE public.module_flags SET aktiv = NOT aktiv WHERE id = %L', v_mf_m)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('module_flags_delete_m_sa', pg_temp.s112_versuch(
    format('DELETE FROM public.module_flags WHERE id = %L', v_mf_m)), 'k0');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('module_flags_b_ta_sieht_eigene', pg_temp.s112_zaehle(
    format('SELECT count(*) FROM public.module_flags WHERE id = %L', v_mf_b)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('module_flags_insert_b_ta', pg_temp.s112_versuch(
    format('INSERT INTO public.module_flags (tenant_id, module) VALUES (%L, %L)', v_b, 'kellerbuch')), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('module_flags_update_b_ta', pg_temp.s112_versuch(
    format('UPDATE public.module_flags SET aktiv = NOT aktiv WHERE id = %L', v_mf_b)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('module_flags_delete_b_ta', pg_temp.s112_versuch(
    format('DELETE FROM public.module_flags WHERE id = %L', v_mf_b)), 'k0');
  PERFORM pg_temp.s112_als(v_pa);
  v_erg := v_erg || pg_temp.s112_erwarte('module_flags_pa_sieht_b', pg_temp.s112_zaehle(
    format('SELECT count(*) FROM public.module_flags WHERE id = %L', v_mf_b)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('module_flags_insert_pa', pg_temp.s112_versuch(
    format('INSERT INTO public.module_flags (tenant_id, module) VALUES (%L, %L)', v_b, 'kellerbuch')), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('module_flags_update_pa', pg_temp.s112_versuch(
    format('UPDATE public.module_flags SET aktiv = NOT aktiv WHERE id = %L', v_mf_b)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('module_flags_delete_pa', pg_temp.s112_versuch(
    format('DELETE FROM public.module_flags WHERE id = %L', v_mf_b)), 'k0');

  -- ── 4. tenants INSERT ───────────────────────────────────────────────────────────────────────────────
  -- BEFORE-Trigger a_schutz_plattformfelder lehnt vor der RLS ab (42501 → T), siehe Kopf.
  PERFORM pg_temp.s112_als(v_msa);
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_insert_m_sa', pg_temp.s112_versuch(
    format('INSERT INTO public.tenants (id, name, slug) VALUES (%L, %L, %L)', v_tn, 'S112TEST neu m_sa', 's112test-' || v_tn)), 'T');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_insert_b_ta', pg_temp.s112_versuch(
    format('INSERT INTO public.tenants (id, name, slug) VALUES (%L, %L, %L)', v_tn, 'S112TEST neu b_ta', 's112test-' || v_tn)), 'T');
  -- max_benutzer ist Paketfeld: der Betriebs-Admin hebt sein Benutzerlimit nicht selbst an
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_max_benutzer_b_ta', pg_temp.s112_versuch(
    format('UPDATE public.tenants SET max_benutzer = coalesce(max_benutzer, 0) + 10 WHERE id = %L', v_b)), 'T');
  PERFORM pg_temp.s112_als(v_pa);
  v_txt := pg_temp.s112_fehlertext(
    format('INSERT INTO public.tenants (id, name, slug) VALUES (%L, %L, %L)', v_tn, 'S112TEST neu pa', 's112test-' || v_tn));
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_insert_pa', v_txt, 'ok');

  -- RLS-Schicht unter dem Trigger: die INSERT-Policies selbst lassen nur Plattform-Admins zu
  PERFORM pg_temp.s112_als(v_msa);
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_insert_policy_m_sa', pg_temp.t17_policy('tenants', 'INSERT', v_tn_z), 'nein');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_insert_policy_b_ta', pg_temp.t17_policy('tenants', 'INSERT', v_tn_z), 'nein');
  PERFORM pg_temp.s112_als(v_neu);
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_insert_policy_neu', pg_temp.t17_policy('tenants', 'INSERT', v_tn_z), 'nein');
  PERFORM pg_temp.s112_als(v_pa);
  -- Positivkontrolle: die Auswertung liefert überhaupt 'ja'
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_insert_policy_pa_positiv', pg_temp.t17_policy('tenants', 'INSERT', v_tn_z), 'ja');
  PERFORM pg_temp.s112_als_postgres();
  -- statisch: jede PERMISSIVE-INSERT-Policy auf tenants verlangt plattform_admins
  SELECT count(*) FILTER (WHERE coalesce(p.with_check, p.qual, '') NOT LIKE '%plattform_admins%'), count(*)
    INTO v_n, v_n2
    FROM pg_policies p
   WHERE p.schemaname = 'public' AND p.tablename = 'tenants' AND p.permissive = 'PERMISSIVE' AND p.cmd IN ('INSERT', 'ALL');
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_insert_policy_nur_pa', v_n, 0);
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_insert_policy_vorhanden', v_n2 >= 1, true);
  SELECT count(*) INTO v_n FROM public.tenant_memberships m
   WHERE m.tenant_id = v_tn AND m.role = 'system_admin' AND m.aktiv
     AND EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = m.user_id);
  SELECT count(*) INTO v_n2 FROM public.plattform_admins;
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_trigger_alle_plattform_admins', v_n, v_n2);
  SELECT count(*) INTO v_n FROM public.tenant_memberships WHERE tenant_id = v_tn;
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_trigger_nur_plattform_admins', v_n, v_n2);

  -- ── 5. tenant_memberships ───────────────────────────────────────────────────────────────────────────
  -- INSERT: kein Betriebsbenutzer lädt selbst ein (Benutzerlimit max_benutzer nicht umgehbar)
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('tm_insert_b_ta', pg_temp.s112_versuch(
    format('INSERT INTO public.tenant_memberships (tenant_id, user_id, role) VALUES (%L, %L, %L)', v_b, v_neu, 'leser')), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('tm_insert_b_ta_als_system_admin', pg_temp.s112_versuch(
    format('INSERT INTO public.tenant_memberships (tenant_id, user_id, role) VALUES (%L, %L, %L)', v_b, v_neu, 'system_admin')), 'R');
  PERFORM pg_temp.s112_als(v_msa);
  v_erg := v_erg || pg_temp.s112_erwarte('tm_insert_m_sa', pg_temp.s112_versuch(
    format('INSERT INTO public.tenant_memberships (tenant_id, user_id, role) VALUES (%L, %L, %L)', c_m, v_neu, 'leser')), 'R');
  PERFORM pg_temp.s112_als(v_pa);
  v_erg := v_erg || pg_temp.s112_erwarte('tm_insert_pa', pg_temp.s112_versuch(
    format('INSERT INTO public.tenant_memberships (tenant_id, user_id, role) VALUES (%L, %L, %L)', v_b, v_neu, 'leser')), 'k1');

  -- UPDATE: Rollen und aktiv-Flag nur Plattform-Admin
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('tm_update_eigene_rolle_b_ta', pg_temp.s112_versuch(
    format('UPDATE public.tenant_memberships SET role = %L WHERE tenant_id = %L AND user_id = %L', 'system_admin', v_b, v_bta)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('tm_update_aktiv_b_w_b_ta', pg_temp.s112_versuch(
    format('UPDATE public.tenant_memberships SET aktiv = false WHERE tenant_id = %L AND user_id = %L', v_b, v_bw)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('tm_update_module_b_w_b_ta', pg_temp.s112_versuch(
    format('UPDATE public.tenant_memberships SET schreibmodule = %L::text[] WHERE tenant_id = %L AND user_id = %L', '{crm}', v_b, v_bw)), 'k0');
  PERFORM pg_temp.s112_als(v_msa);
  -- Vorbedingung: m_sa sieht die stg-Zeile im Musterhof, sonst wären die k0-Prüfungen darauf wertlos
  v_erg := v_erg || pg_temp.s112_erwarte('tm_m_sa_sieht_stg_im_musterhof', pg_temp.s112_zaehle(
    format('SELECT count(*) FROM public.tenant_memberships WHERE tenant_id = %L AND user_id = %L', c_m, v_stg)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('tm_update_aktiv_staging_admin_m_sa', pg_temp.s112_versuch(
    format('UPDATE public.tenant_memberships SET aktiv = false WHERE tenant_id = %L AND user_id = %L', c_m, v_stg)), 'k0');
  PERFORM pg_temp.s112_als(v_pa);
  v_erg := v_erg || pg_temp.s112_erwarte('tm_update_rolle_b_ta_pa', pg_temp.s112_versuch(
    format('UPDATE public.tenant_memberships SET role = %L WHERE tenant_id = %L AND user_id = %L', 'system_admin', v_b, v_bta)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('tm_update_aktiv_b_w_pa', pg_temp.s112_versuch(
    format('UPDATE public.tenant_memberships SET aktiv = false WHERE tenant_id = %L AND user_id = %L', v_b, v_bw)), 'k1');

  -- DELETE: nur SA/TA, nie sich selbst, system_admin-Zeilen nur Plattform-Admin
  PERFORM pg_temp.s112_als(v_bta);
  -- Vorbedingung: b_ta sieht die system_admin-Zeilen von pa und stg in B
  v_erg := v_erg || pg_temp.s112_erwarte('tm_b_ta_sieht_pa_und_stg_in_b', pg_temp.s112_zaehle(
    format('SELECT count(*) FROM public.tenant_memberships WHERE tenant_id = %L AND user_id IN (%L, %L)', v_b, v_pa, v_stg)), '2');
  -- Policy-Schicht direkt (unabhängig von der SELECT-Sichtbarkeit), mit Positivkontrolle
  v_erg := v_erg || pg_temp.s112_erwarte('tm_delete_policy_b_ta_b_w_positiv', pg_temp.t17_policy('tenant_memberships', 'DELETE', v_z_bw), 'ja');
  v_erg := v_erg || pg_temp.s112_erwarte('tm_delete_policy_b_ta_selbst', pg_temp.t17_policy('tenant_memberships', 'DELETE', v_z_bta), 'nein');
  v_erg := v_erg || pg_temp.s112_erwarte('tm_delete_policy_b_ta_stg', pg_temp.t17_policy('tenant_memberships', 'DELETE', v_z_stb), 'nein');
  v_erg := v_erg || pg_temp.s112_erwarte('tm_delete_b_w_b_ta', pg_temp.s112_versuch(
    format('DELETE FROM public.tenant_memberships WHERE tenant_id = %L AND user_id = %L', v_b, v_bw)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('tm_delete_selbst_b_ta', pg_temp.s112_versuch(
    format('DELETE FROM public.tenant_memberships WHERE tenant_id = %L AND user_id = %L', v_b, v_bta)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('tm_delete_system_admin_pa_b_ta', pg_temp.s112_versuch(
    format('DELETE FROM public.tenant_memberships WHERE tenant_id = %L AND user_id = %L', v_b, v_pa)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('tm_delete_system_admin_stg_b_ta', pg_temp.s112_versuch(
    format('DELETE FROM public.tenant_memberships WHERE tenant_id = %L AND user_id = %L', v_b, v_stg)), 'k0');
  PERFORM pg_temp.s112_als(v_bw);
  -- Winzer: der DELETE-Versuch allein wäre vakuös (die Zielzeilen sind per SELECT-Policy unsichtbar), deshalb
  -- zusätzlich die DELETE-Policy selbst auswerten – sie darf keinem Winzer das Löschen erlauben.
  v_erg := v_erg || pg_temp.s112_erwarte('tm_delete_policy_b_w_b_ta', pg_temp.t17_policy('tenant_memberships', 'DELETE', v_z_bta), 'nein');
  v_erg := v_erg || pg_temp.s112_erwarte('tm_delete_policy_b_w_b_w2', pg_temp.t17_policy('tenant_memberships', 'DELETE', v_z_bw2), 'nein');
  v_erg := v_erg || pg_temp.s112_erwarte('tm_delete_b_ta_b_w', pg_temp.s112_versuch(
    format('DELETE FROM public.tenant_memberships WHERE tenant_id = %L AND user_id = %L', v_b, v_bta)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('tm_delete_b_w2_b_w', pg_temp.s112_versuch(
    format('DELETE FROM public.tenant_memberships WHERE tenant_id = %L AND user_id = %L', v_b, v_bw2)), 'k0');
  -- die eigene Zeile sieht der Winzer – hier ist k0 nicht vakuös
  v_erg := v_erg || pg_temp.s112_erwarte('tm_delete_selbst_b_w', pg_temp.s112_versuch(
    format('DELETE FROM public.tenant_memberships WHERE tenant_id = %L AND user_id = %L', v_b, v_bw)), 'k0');
  PERFORM pg_temp.s112_als(v_msa);
  -- system_admin im eigenen Betrieb, aber kein Plattform-Admin: fremde system_admin-Zeile bleibt
  v_erg := v_erg || pg_temp.s112_erwarte('tm_delete_policy_m_sa_stg', pg_temp.t17_policy('tenant_memberships', 'DELETE', v_z_stm), 'nein');
  v_erg := v_erg || pg_temp.s112_erwarte('tm_delete_system_admin_stg_m_sa', pg_temp.s112_versuch(
    format('DELETE FROM public.tenant_memberships WHERE tenant_id = %L AND user_id = %L', c_m, v_stg)), 'k0');
  PERFORM pg_temp.s112_als(v_pa);
  v_erg := v_erg || pg_temp.s112_erwarte('tm_delete_policy_pa_stg_in_b_positiv', pg_temp.t17_policy('tenant_memberships', 'DELETE', v_z_stb), 'ja');
  v_erg := v_erg || pg_temp.s112_erwarte('tm_delete_system_admin_stg_pa', pg_temp.s112_versuch(
    format('DELETE FROM public.tenant_memberships WHERE tenant_id = %L AND user_id = %L', v_b, v_stg)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('tm_delete_pa_selbst', pg_temp.s112_versuch(
    format('DELETE FROM public.tenant_memberships WHERE tenant_id = %L AND user_id = %L', v_b, v_pa)), 'k0');
  -- Musterhof: pa ist dort nicht Mitglied → user_has_role_in_tenant falsch, kein Löschen. Die Zeile ist für pa
  -- auch unsichtbar, deshalb entscheidet erst die Policy-Auswertung.
  v_erg := v_erg || pg_temp.s112_erwarte('tm_delete_policy_pa_musterhof', pg_temp.t17_policy('tenant_memberships', 'DELETE', v_z_msa), 'nein');
  v_erg := v_erg || pg_temp.s112_erwarte('tm_delete_musterhof_pa_nicht_mitglied', pg_temp.s112_versuch(
    format('DELETE FROM public.tenant_memberships WHERE tenant_id = %L AND user_id = %L', c_m, v_msa)), 'k0');

  -- SELECT
  PERFORM pg_temp.s112_als_postgres();
  -- B: b_ta, b_w, b_w2 und per Trigger alle Plattform-Admins (unabhängig davon, wie viele Staging hat)
  SELECT count(*) INTO v_n2 FROM public.plattform_admins;
  SELECT count(*) INTO v_n FROM public.tenant_memberships WHERE tenant_id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('tm_b_mitglieder_drei_plus_plattform_admins', v_n, 3 + v_n2);
  SELECT count(*) INTO v_n2 FROM public.tenant_memberships WHERE tenant_id = c_m;
  v_erg := v_erg || pg_temp.s112_erwarte('tm_musterhof_hat_mitglieder', v_n2 > 0, true);
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('tm_select_b_w_nur_eigene', pg_temp.s112_zaehle(
    'SELECT count(*) FROM public.tenant_memberships'), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('tm_select_b_w_eigene_zeile', pg_temp.s112_zaehle(
    format('SELECT count(*) FROM public.tenant_memberships WHERE user_id = %L', v_bw)), '1');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('tm_select_b_ta_alle_in_b', pg_temp.s112_zaehle(
    format('SELECT count(*) FROM public.tenant_memberships WHERE tenant_id = %L', v_b)), v_n::text);
  v_erg := v_erg || pg_temp.s112_erwarte('tm_select_b_ta_keine_aus_m', pg_temp.s112_zaehle(
    format('SELECT count(*) FROM public.tenant_memberships WHERE tenant_id = %L', c_m)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('tm_select_b_ta_gesamt', pg_temp.s112_zaehle(
    'SELECT count(*) FROM public.tenant_memberships'), v_n::text);
  PERFORM pg_temp.s112_als(v_pa);
  v_erg := v_erg || pg_temp.s112_erwarte('tm_select_pa_keine_aus_m', pg_temp.s112_zaehle(
    format('SELECT count(*) FROM public.tenant_memberships WHERE tenant_id = %L', c_m)), '0');

  -- ── 6. plattform_admins: nur eigene Zeile lesbar, keine Vergabe per API ─────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  SELECT count(*) INTO v_n FROM public.plattform_admins;
  v_erg := v_erg || pg_temp.s112_erwarte('pa_mindestens_zwei_zeilen', v_n >= 2, true);
  PERFORM pg_temp.s112_als(v_pa);
  v_erg := v_erg || pg_temp.s112_erwarte('pa_select_pa_nur_eigene', pg_temp.s112_zaehle(
    'SELECT count(*) FROM public.plattform_admins'), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('pa_select_pa_eigene_zeile', pg_temp.s112_zaehle(
    format('SELECT count(*) FROM public.plattform_admins WHERE user_id = %L', v_pa)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('pa_insert_anderer_pa', pg_temp.s112_versuch(
    format('INSERT INTO public.plattform_admins (user_id, hinweis) VALUES (%L, %L)', v_bta, 'S112TEST')), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('pa_update_pa', pg_temp.s112_versuch(
    format('UPDATE public.plattform_admins SET hinweis = hinweis WHERE user_id = %L', v_pa)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('pa_delete_eigene_pa', pg_temp.s112_versuch(
    format('DELETE FROM public.plattform_admins WHERE user_id = %L', v_pa)), 'k0');
  PERFORM pg_temp.s112_als(v_msa);
  v_erg := v_erg || pg_temp.s112_erwarte('pa_select_m_sa', pg_temp.s112_zaehle(
    'SELECT count(*) FROM public.plattform_admins'), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('pa_insert_selbst_m_sa', pg_temp.s112_versuch(
    format('INSERT INTO public.plattform_admins (user_id, hinweis) VALUES (%L, %L)', v_msa, 'S112TEST')), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('pa_update_m_sa', pg_temp.s112_versuch(
    format('UPDATE public.plattform_admins SET user_id = %L WHERE user_id = %L', v_msa, v_pa)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('pa_delete_m_sa', pg_temp.s112_versuch(
    format('DELETE FROM public.plattform_admins WHERE user_id IN (%L, %L)', v_pa, v_stg)), 'k0');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('pa_select_b_ta', pg_temp.s112_zaehle(
    'SELECT count(*) FROM public.plattform_admins'), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('pa_insert_selbst_b_ta', pg_temp.s112_versuch(
    format('INSERT INTO public.plattform_admins (user_id, hinweis) VALUES (%L, %L)', v_bta, 'S112TEST')), 'R');
  PERFORM pg_temp.s112_als(NULL, 'anon');
  v_erg := v_erg || pg_temp.s112_erwarte('pa_select_anon', pg_temp.s112_zaehle(
    'SELECT count(*) FROM public.plattform_admins'), '0');

  -- ── 7. Storage mandant-logos: Lesen öffentlich, Schreiben nur Plattform-Admin ───────────────────────
  PERFORM pg_temp.s112_als(NULL, 'anon');
  v_erg := v_erg || pg_temp.s112_erwarte('logo_select_anon', pg_temp.s112_zaehle(
    format('SELECT count(*) FROM storage.objects WHERE bucket_id = %L AND name = %L', 'mandant-logos', v_logo)), '1');
  PERFORM pg_temp.s112_als(v_msa);
  v_erg := v_erg || pg_temp.s112_erwarte('logo_select_m_sa', pg_temp.s112_zaehle(
    format('SELECT count(*) FROM storage.objects WHERE bucket_id = %L AND name = %L', 'mandant-logos', v_logo)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('logo_insert_m_sa', pg_temp.s112_versuch(
    format('INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L)', 'mandant-logos', c_m::text || '/s112test-neu.png')), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('logo_update_m_sa', pg_temp.s112_versuch(
    format('UPDATE storage.objects SET metadata = %L::jsonb WHERE bucket_id = %L AND name = %L', '{"s112test":1}', 'mandant-logos', v_logo)), 'k0');
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  v_erg := v_erg || pg_temp.s112_erwarte('logo_delete_m_sa', pg_temp.s112_versuch(
    format('DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L', 'mandant-logos', v_logo)), 'k0');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('logo_insert_b_ta_eigener_ordner', pg_temp.s112_versuch(
    format('INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L)', 'mandant-logos', v_b::text || '/s112test-neu.png')), 'R');
  PERFORM pg_temp.s112_als(v_pa);
  v_erg := v_erg || pg_temp.s112_erwarte('logo_insert_pa', pg_temp.s112_versuch(
    format('INSERT INTO storage.objects (bucket_id, name) VALUES (%L, %L)', 'mandant-logos', c_m::text || '/s112test-neu.png')), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('logo_update_pa', pg_temp.s112_versuch(
    format('UPDATE storage.objects SET metadata = %L::jsonb WHERE bucket_id = %L AND name = %L', '{"s112test":1}', 'mandant-logos', v_logo)), 'k1');
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  v_erg := v_erg || pg_temp.s112_erwarte('logo_delete_pa', pg_temp.s112_versuch(
    format('DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L', 'mandant-logos', v_logo)), 'k1');

  -- ── 8. bestandsprotokoll: SA/TA des Betriebs und Plattform-Admins lesen, Winzer nie ─────────────────
  PERFORM pg_temp.s112_als_postgres();
  SELECT count(*) INTO v_n FROM public.bestandsprotokoll WHERE tenant_id = c_m AND alt ? 's112test';
  v_erg := v_erg || pg_temp.s112_erwarte('bp_musterhof_zeile_vorhanden', v_n, 1);
  SELECT count(*) INTO v_n FROM public.bestandsprotokoll WHERE tenant_id = v_b AND alt ? 's112test';
  v_erg := v_erg || pg_temp.s112_erwarte('bp_b_zeile_vorhanden', v_n, 1);
  PERFORM pg_temp.s112_als(v_pa);
  -- Ist-Stand, laut Policy gewollt: Plattform-Admin liest das Protokoll auch betriebsfremd (Musterhof)
  v_erg := v_erg || pg_temp.s112_erwarte('bp_pa_liest_betriebsfremd', pg_temp.s112_zaehle(
    format('SELECT count(*) FROM public.bestandsprotokoll WHERE tenant_id = %L AND alt ? %L', c_m, 's112test')), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('bp_insert_pa', pg_temp.s112_versuch(
    format('INSERT INTO public.bestandsprotokoll (tenant_id, tabelle, aktion) VALUES (%L, %L, %L)', v_b, 'verkaufsposten', 'UPDATE')), 'G');
  PERFORM pg_temp.s112_als(v_msa);
  v_erg := v_erg || pg_temp.s112_erwarte('bp_m_sa_liest_eigenen', pg_temp.s112_zaehle(
    format('SELECT count(*) FROM public.bestandsprotokoll WHERE tenant_id = %L AND alt ? %L', c_m, 's112test')), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('bp_m_sa_nicht_fremd', pg_temp.s112_zaehle(
    format('SELECT count(*) FROM public.bestandsprotokoll WHERE tenant_id = %L', v_b)), '0');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('bp_b_ta_liest_eigenen', pg_temp.s112_zaehle(
    format('SELECT count(*) FROM public.bestandsprotokoll WHERE tenant_id = %L AND alt ? %L', v_b, 's112test')), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('bp_b_ta_nicht_fremd', pg_temp.s112_zaehle(
    format('SELECT count(*) FROM public.bestandsprotokoll WHERE tenant_id = %L', c_m)), '0');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('bp_b_w_unsichtbar', pg_temp.s112_zaehle(
    'SELECT count(*) FROM public.bestandsprotokoll'), '0');

  PERFORM pg_temp.s112_als_postgres();
  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 120);
END
$test$;
