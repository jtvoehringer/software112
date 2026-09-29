-- @bereich: Inaktive (gesperrte) Mitgliedschaft
-- @ziel: aktiv = false entzieht sofort jeden Lese- und Schreibzugriff auf den Betrieb – über RLS (dynamisch über
-- @ziel: alle T/K-Tabellen), RPCs und Storage. Kontrolle: dieselbe Persona, als postgres auf aktiv = true
-- @ziel: umgeschaltet, sieht bzw. ändert die Zeilen – aktiv ist also die Ursache. Bekannte Ausnahmen (tenants-Zeile,
-- @ziel: get_behandlungen_fuer_grundstuecke, NULL-Falle bei globalen Zeilen) werden als Ratsche sichtbar gezählt.
-- @mutation gesperrte_tenants_leer: s112_gesperrte_tenants() liefert nichts mehr – alle mitgliedschaft_aktiv-Policies wirkungslos | rot: select_inaktiv_.*|tenant_memberships_eigene_inaktiv_unsichtbar
-- @mutation meine_tenants_ohne_aktiv: s112_meine_tenants() filtert nicht mehr auf aktiv (Storage, RPC-Hilfe) | rot: storage_.*|rpc_meine_tenants_ohne_m
-- @mutation pruefe_zugriff_ohne_aktiv: pruefe_tenant_zugriff() prüft aktiv nicht mehr | rot: rpc_pruefe_tenant_zugriff_.*|rpc_get_next_rechnungsnummer_inaktiv
-- @mutation keller_freigabe_ohne_aktiv: keller_freigaben_select über get_user_tenant_ids() (SECURITY DEFINER, filtert aktiv nicht) | rot: keller_inaktiv_.*
-- @mutation keller_behaelter_ohne_aktiv: behaelter_select – Kellergemeinschaft über get_user_tenant_ids() und behaelter_nutzbar() statt der tenant_memberships-Unterabfrage | rot: keller_inaktiv_.*
--
-- software:112 – SQL-Testsuite, Datei 13 (Stand 28.09.2026). Nur Staging; EINE Transaktion, endet mit
-- pg_temp.s112_ende(…) = RAISE → alles zurückgerollt.
--
-- Personas: m_inak (winzer im Musterhof, aktiv = false, alle sechs Module, aus s112_aufbau), m_ta_inak
-- (tenant_admin im Musterhof, aktiv = false, hier angelegt), mix (winzer aktiv in B, inaktiv im Musterhof).
--
-- Geprüft wird:
--   1. Katalog: tenant_memberships.aktiv ist NOT NULL DEFAULT true (kein dritter Zustand, den Policies übersehen).
--   2. Dynamisch über alle T/K-Tabellen (s112_mandantentabellen): Musterhof-Beispielzeile existiert (als postgres),
--      m_inak sieht sie nicht (0) – ausdrücklich auch die GUT-Kindtabellen ama_meldepositionen,
--      behandlung_grundstuecke, ernte_parzellen, weingarten_rebsorten (Eltern-RLS greift: harte Prüfung).
--      m_ta_inak: INSERT-Klon → R/G/T, UPDATE/DELETE → k0 (G = kein Recht, ebenfalls sicher).
--   3. tenant_memberships: eigene inaktive Zeile unsichtbar; tenants: Betriebszeile noch sichtbar (Ratsche B4).
--   4. RPCs: pruefe_tenant_zugriff, get_next_rechnungsnummer → 42501; get_user_role_in_tenant → NULL;
--      s112_meine_tenants ohne M; s112_darf_schreiben = false; s112_mandant_mitglieder → 0 Zeilen;
--      get_behandlungen_fuer_grundstuecke liefert weiter Behandlungen (Ratsche B4, Grundstück-IDs als postgres).
--   5. NULL-Falle (mix): globale Zeilen (tenant_id NULL) in ea_kategorien, duengemittel, pflanzenschutzmittel,
--      saetze_massnahmen verschwinden (Ratsche B5); Kontrolle b_w sieht sie.
--   6. Storage ea-belege: Objekt im Musterhof-Ordner unsichtbar, Upload → R, Löschen → k0.
--   7. Kontrolle: m_inak und m_ta_inak als postgres auf aktiv = true → dieselben Zeilen sichtbar, RPCs erlaubt,
--      Schreiben möglich – auch dieselben INSERT-Klone, UPDATEs und DELETEs aus Abschnitt 2 gehen als aktiver
--      tenant_admin in der großen Mehrheit der Tabellen durch (k1 oder Fehler der Klasse 23 = RLS passiert,
--      Mindestzahl), sonst wären die insert_/update_/delete_inaktiv_*-Prüfungen aussagelos. bestandsprotokoll und
--      zeiterfassung (für winzer nie lesbar) zusätzlich als tenant_admin: inaktiv 0, aktiv 1.
--   8. Kellergemeinschaft: aktive Freigabe M → B, gemeinsamer Behälter in M; b_w sieht Behälter und Freigabe,
--      mit aktiv = false in B beides nicht mehr (die RESTRICTIVE mitgliedschaft_aktiv auf behaelter prüft den
--      Eigentümer M – den Ausschluss leistet nur die tenant_memberships-Unterabfrage der Policies).
--   9. tenants.active = false (Betrieb B deaktiviert): b_w liest und schreibt weiter – Ist-Stand als Ratsche B16
--      (Soll zu klären; die App wertet die Spalte nur im Morgenbericht aus).

DO $test$
DECLARE
  c_datei constant text := '13_inaktive_mitgliedschaft';
  c_m     constant uuid := '33333333-3333-4333-8333-333333333333';
  -- Tabellen, deren Musterhof-Beispielzeile auch ein AKTIVER winzer nicht lesen darf (keine Lese-Policy für
  -- winzer bzw. nur für SA/TA oder Service) – dort ist die Kontrolle 0 statt 1. (sumup_terminals: lesen darf
  -- jedes Mitglied, nur Schreiben ist SA/TA vorbehalten.)
  c_winzer_liest_nicht constant text[] := ARRAY['bestandsprotokoll', 'stripe_zahlungen_log',
    'system_ereignisse', 'zeiterfassung'];
  v_t0    timestamptz := clock_timestamp();
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_inak  uuid;
  v_ta_inak uuid;
  v_mix   uuid;
  v_bw    uuid;
  r       record;
  v_tabs  text[] := '{}';
  v_zeilen jsonb[] := '{}';
  v_wheres text[] := '{}';
  v_upds  text[] := '{}';
  v_i     int;
  v_tab   text;
  v_zeile jsonb;
  v_where text;
  v_txt   text;
  v_n     bigint;
  v_n2    bigint;
  v_bool  boolean;
  v_gids  uuid[];
  v_beh_soll bigint;
  v_kontakt jsonb;
  v_obj_name text;
  v_glob  text[] := ARRAY['ea_kategorien', 'duengemittel', 'pflanzenschutzmittel', 'saetze_massnahmen'];
  v_glob_n bigint[] := '{}';
  v_mitglieder_aktiv bigint;
  v_kontrolle_sichtbar int := 0;
  -- Kontrolle der Schreibprüfungen (Abschnitt 7) sowie Kellergemeinschaft und B16 (Abschnitte 8, 9)
  c_ta_liest   constant text[] := ARRAY['bestandsprotokoll', 'zeiterfassung'];
  c_min_ins    constant int := 75;
  c_min_upd    constant int := 70;
  c_min_del    constant int := 70;
  c_ok_re      constant text := '^(k[1-9][0-9]*|E23[0-9A-Z]{3})$';
  v_ok_ins     int := 0;
  v_ok_upd     int := 0;
  v_ok_del     int := 0;
  v_n_upd      int := 0;
  v_nicht_ins  text[] := '{}';
  v_nicht_upd  text[] := '{}';
  v_nicht_del  text[] := '{}';
  v_beh_g      uuid;
  v_kf         uuid;
  v_kontakt_b  jsonb;
  c_b16        constant text := 'B16 tenants.active wird in der DB nicht durchgesetzt – deaktivierter Betrieb bleibt les- und schreibbar (Soll zu klären)';
BEGIN
  PERFORM pg_temp.s112_nur_staging();

  -- ── Aufbau (als postgres) ────────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_inak := (v_a ->> 'm_inak')::uuid;
  v_mix := (v_a ->> 'mix')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_ta_inak := pg_temp.s112_benutzer('tenant_admin', c_m, NULL, false);

  -- Personas belegen
  SELECT count(*) INTO v_n FROM public.tenant_memberships
   WHERE user_id = v_inak AND tenant_id = c_m AND NOT aktiv AND role = 'winzer'
     AND schreibmodule @> pg_temp.s112_soll_liste('schreibmodule');
  v_erg := v_erg || pg_temp.s112_erwarte('persona_m_inak_inaktiv_alle_module', v_n, 1);
  SELECT count(*) INTO v_n FROM public.tenant_memberships WHERE user_id = v_ta_inak AND tenant_id = c_m AND NOT aktiv AND role = 'tenant_admin';
  v_erg := v_erg || pg_temp.s112_erwarte('persona_m_ta_inak_inaktiv', v_n, 1);
  SELECT count(*) INTO v_n FROM public.tenant_memberships
   WHERE user_id = v_mix AND ((tenant_id = c_m AND NOT aktiv) OR (tenant_id = v_b AND aktiv AND role = 'winzer'));
  v_erg := v_erg || pg_temp.s112_erwarte('persona_mix_aktiv_b_inaktiv_m', v_n, 2);

  -- 1. Katalog: aktiv NOT NULL DEFAULT true
  SELECT a.attnotnull, pg_get_expr(d.adbin, d.adrelid) INTO v_bool, v_txt
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.tenant_memberships'::regclass AND a.attname = 'aktiv' AND NOT a.attisdropped;
  v_erg := v_erg || pg_temp.s112_erwarte('katalog_aktiv_not_null', v_bool, true);
  v_erg := v_erg || pg_temp.s112_erwarte('katalog_aktiv_default_true', v_txt, 'true');

  -- Beispielzeilen im Musterhof je T/K-Tabelle (vorhandene Zeile, sonst s112_beispiel mit Eigentümer m_inak)
  FOR r IN SELECT * FROM pg_temp.s112_mandantentabellen() t WHERE t.klasse IN ('T', 'K') ORDER BY t.tabelle LOOP
    v_zeile := NULL;
    BEGIN
      IF r.tabelle = 'tenant_memberships' THEN
        SELECT to_jsonb(x.*) INTO v_zeile FROM public.tenant_memberships x WHERE x.user_id = v_inak AND x.tenant_id = c_m;
      ELSIF r.klasse = 'T' THEN
        EXECUTE format('SELECT to_jsonb(x.*) FROM public.%I x WHERE x.tenant_id = %L LIMIT 1', r.tabelle, c_m) INTO v_zeile;
      ELSE
        EXECUTE format('SELECT to_jsonb(x.*) FROM public.%I x JOIN public.%I p ON p.%I = x.%I WHERE p.tenant_id = %L LIMIT 1',
                       r.tabelle, r.eltern_tabelle, r.eltern_ref, r.eltern_spalte, c_m) INTO v_zeile;
      END IF;
      IF v_zeile IS NULL THEN
        v_zeile := pg_temp.s112_beispiel(r.tabelle, c_m, v_inak);
      END IF;
      v_where := pg_temp.s112_pk_where(r.tabelle, v_zeile);
      v_tabs := v_tabs || r.tabelle;
      v_zeilen := v_zeilen || v_zeile;
      v_wheres := v_wheres || v_where;
      v_upds := v_upds || coalesce(r.upd_spalte, '');
    EXCEPTION WHEN OTHERS THEN
      v_erg := v_erg || pg_temp.s112_fehler('beispiel_' || r.tabelle, SQLSTATE || ' ' || SQLERRM);
    END;
  END LOOP;
  v_erg := v_erg || pg_temp.s112_erwarte('mandantentabellen_abgedeckt', coalesce(array_length(v_tabs, 1), 0) >= 95, true);
  v_erg := v_erg || pg_temp.s112_erwarte('gut_kindtabellen_abgedeckt',
    ARRAY['ama_meldepositionen', 'behandlung_grundstuecke', 'ernte_parzellen', 'weingarten_rebsorten'] <@ v_tabs, true);

  -- Beispielzeilen existieren (als postgres) – sonst wäre „0 sichtbar“ wertlos
  FOR v_i IN 1 .. coalesce(array_length(v_tabs, 1), 0) LOOP
    v_erg := v_erg || pg_temp.s112_erwarte('existiert_' || v_tabs[v_i],
      pg_temp.s112_zaehle(format('SELECT count(*) FROM public.%I WHERE %s', v_tabs[v_i], v_wheres[v_i])), '1');
  END LOOP;

  -- get_behandlungen_fuer_grundstuecke: Grundstück-IDs und erwartete Zeilenzahl als postgres (nicht unter RLS!)
  SELECT array_agg(g.id ORDER BY g.id) INTO v_gids FROM public.grundstuecke g WHERE g.tenant_id = c_m;
  SELECT count(*) INTO v_beh_soll FROM (
    SELECT 1 FROM public.behandlung_grundstuecke bg
      JOIN public.behandlungen b ON b.id = bg.behandlung_id
      JOIN public.grundstuecke gst ON gst.id = bg.grundstueck_id
      JOIN public.weingarten wg ON wg.id = gst.weingarten_id
      LEFT JOIN public.pflanzenschutzmittel psm ON psm.id = b.psm_id
     WHERE bg.grundstueck_id = ANY (v_gids) AND b.tenant_id = c_m
     GROUP BY b.id, psm.name, wg.name) x;
  v_erg := v_erg || pg_temp.s112_erwarte('behandlungen_musterhof_vorhanden', v_beh_soll > 0, true);

  -- NULL-Falle: globale Zeilen (ea_kategorien vorhanden, die übrigen hier angelegt)
  PERFORM pg_temp.s112_zeile('duengemittel', NULL, '{"name": "s112test Dünger global"}');
  PERFORM pg_temp.s112_zeile('pflanzenschutzmittel', NULL, '{"name": "s112test PSM global"}');
  PERFORM pg_temp.s112_zeile('saetze_massnahmen', NULL, '{}');
  FOREACH v_tab IN ARRAY v_glob LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id IS NULL', v_tab) INTO v_n;
    v_glob_n := v_glob_n || v_n;
    v_erg := v_erg || pg_temp.s112_erwarte('global_vorhanden_' || v_tab, v_n > 0, true);
  END LOOP;

  -- Storage: Objekt im Musterhof-Ordner von ea-belege
  v_obj_name := c_m::text || '/s112test/beleg-inaktiv.pdf';
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('ea-belege', v_obj_name, NULL);
  SELECT count(*) INTO v_n FROM storage.objects WHERE bucket_id = 'ea-belege' AND name = v_obj_name;
  v_erg := v_erg || pg_temp.s112_erwarte('storage_objekt_existiert', v_n, 1);

  SELECT to_jsonb(k.*) INTO v_kontakt FROM public.kontakte k WHERE k.tenant_id = c_m ORDER BY k.id LIMIT 1;
  v_erg := v_erg || pg_temp.s112_erwarte('musterhof_kontakt_existiert', v_kontakt IS NOT NULL, true);
  SELECT count(*) INTO v_n FROM public.tenants WHERE id = c_m;
  v_erg := v_erg || pg_temp.s112_erwarte('musterhof_tenant_existiert', v_n, 1);

  -- ── Mutationen (nur im Mutationsmodus) ───────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('gesperrte_tenants_leer',
    $m$CREATE OR REPLACE FUNCTION public.s112_gesperrte_tenants() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'public' AS $x$ SELECT NULL::uuid WHERE false $x$$m$);
  PERFORM pg_temp.s112_mutiere('meine_tenants_ohne_aktiv',
    $m$CREATE OR REPLACE FUNCTION public.s112_meine_tenants() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path TO 'public' AS $x$ SELECT m.tenant_id FROM tenant_memberships m WHERE m.user_id = (SELECT auth.uid()) $x$$m$);
  PERFORM pg_temp.s112_mutiere('pruefe_zugriff_ohne_aktiv',
    $m$CREATE OR REPLACE FUNCTION public.pruefe_tenant_zugriff(p_tenant_id uuid, p_rollen text[] DEFAULT NULL::text[])
       RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $x$
       BEGIN
         IF NOT public.ist_service_kontext() AND (p_tenant_id IS NULL OR NOT EXISTS (SELECT 1 FROM tenant_memberships WHERE user_id = auth.uid()
              AND tenant_id = p_tenant_id AND (p_rollen IS NULL OR role = ANY (p_rollen)))) THEN
           RAISE EXCEPTION 'Kein Zugriff auf diesen Betrieb' USING ERRCODE = '42501';
         END IF;
       END $x$$m$);
  PERFORM pg_temp.s112_mutiere('keller_freigabe_ohne_aktiv',
    $m$ALTER POLICY keller_freigaben_select ON public.keller_freigaben
       USING (eigentuemer_tenant_id IN (SELECT public.get_user_tenant_ids()) OR nutzer_tenant_id IN (SELECT public.get_user_tenant_ids()))$m$);
  PERFORM pg_temp.s112_mutiere('keller_behaelter_ohne_aktiv',
    $m$ALTER POLICY behaelter_select ON public.behaelter
       USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_memberships tm WHERE tm.user_id = (SELECT auth.uid()))
              OR (gemeinsam AND EXISTS (SELECT 1 FROM public.get_user_tenant_ids() t (id) WHERE public.behaelter_nutzbar(behaelter.id, t.id))))$m$);

  -- ── 2. Lesen als m_inak: jede Musterhof-Zeile unsichtbar ─────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_inak);
  FOR v_i IN 1 .. coalesce(array_length(v_tabs, 1), 0) LOOP
    v_erg := v_erg || pg_temp.s112_erwarte('select_inaktiv_' || v_tabs[v_i],
      pg_temp.s112_zaehle(format('SELECT count(*) FROM public.%I WHERE %s', v_tabs[v_i], v_wheres[v_i])), '0');
  END LOOP;

  -- 3. tenant_memberships (eigene inaktive Zeile) und tenants (Betriebszeile)
  v_erg := v_erg || pg_temp.s112_erwarte('tenant_memberships_eigene_inaktiv_unsichtbar',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.tenant_memberships WHERE user_id = %L AND tenant_id = %L', v_inak, c_m)), '0');
  v_erg := v_erg || pg_temp.s112_luecke('tenants_inaktiv_sichtbar',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.tenants WHERE id = %L', c_m)), '0', '1',
    'B4 tenants für inaktive Mitglieder sichtbar – get_user_tenant_ids ohne aktiv, keine mitgliedschaft_aktiv-Policy');

  -- 4. RPCs als m_inak
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_pruefe_tenant_zugriff_inaktiv',
    pg_temp.s112_versuch(format('SELECT public.pruefe_tenant_zugriff(%L::uuid, NULL::text[])', c_m)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_get_next_rechnungsnummer_inaktiv',
    pg_temp.s112_versuch(format('SELECT public.get_next_rechnungsnummer(%L::uuid)', c_m)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_get_user_role_in_tenant_inaktiv', public.get_user_role_in_tenant(c_m), NULL::text);
  SELECT c_m IN (SELECT public.s112_meine_tenants()) INTO v_bool;
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_meine_tenants_ohne_m', v_bool, false);
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_darf_schreiben_inaktiv', public.s112_darf_schreiben(c_m, 'crm'), false);
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_mandant_mitglieder_inaktiv',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.s112_mandant_mitglieder(%L::uuid)', c_m)), '0');
  v_erg := v_erg || pg_temp.s112_luecke('rpc_get_behandlungen_inaktiv',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.get_behandlungen_fuer_grundstuecke(%L::uuid[], %L::uuid)', v_gids, c_m)),
    '0', v_beh_soll::text,
    'B4 get_behandlungen_fuer_grundstuecke: inaktive Mitglieder lesen Behandlungen, ohne pruefe_tenant_zugriff');

  -- 6. Storage als m_inak
  v_erg := v_erg || pg_temp.s112_erwarte('storage_select_inaktiv',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM storage.objects WHERE bucket_id = %L AND name = %L', 'ea-belege', v_obj_name)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('storage_upload_inaktiv',
    pg_temp.s112_versuch(format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L::uuid)',
      'ea-belege', c_m::text || '/s112test/upload-inaktiv.pdf', v_inak)), 'R');
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  v_erg := v_erg || pg_temp.s112_erwarte('storage_delete_inaktiv',
    pg_temp.s112_versuch(format('DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L', 'ea-belege', v_obj_name)), 'k0');

  -- ── 2. Schreiben als m_ta_inak ───────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_ta_inak);
  -- Lesen als inaktiver tenant_admin dort, wo ein winzer auch aktiv nichts sieht (Kontrolle in Abschnitt 7)
  FOREACH v_tab IN ARRAY c_ta_liest LOOP
    v_i := array_position(v_tabs, v_tab);
    IF v_i IS NULL THEN
      v_erg := v_erg || pg_temp.s112_fehler('select_inaktiv_ta_' || v_tab, 'keine Beispielzeile');
    ELSE
      v_erg := v_erg || pg_temp.s112_erwarte('select_inaktiv_ta_' || v_tab,
        pg_temp.s112_zaehle(format('SELECT count(*) FROM public.%I WHERE %s', v_tab, v_wheres[v_i])), '0');
    END IF;
  END LOOP;
  FOR v_i IN 1 .. coalesce(array_length(v_tabs, 1), 0) LOOP
    v_txt := pg_temp.s112_versuch(pg_temp.s112_klon_sql(v_tabs[v_i], v_zeilen[v_i]));
    v_erg := v_erg || pg_temp.s112_erwarte('insert_inaktiv_' || v_tabs[v_i],
      CASE WHEN v_txt IN ('R', 'G', 'T') THEN 'R|G|T' ELSE v_txt END, 'R|G|T');
    IF v_upds[v_i] <> '' THEN
      v_txt := pg_temp.s112_versuch(format('UPDATE public.%I SET %I = %I WHERE %s', v_tabs[v_i], v_upds[v_i], v_upds[v_i], v_wheres[v_i]));
    ELSE
      v_txt := 'G';   -- keine für authenticated änderbare Spalte
    END IF;
    v_erg := v_erg || pg_temp.s112_erwarte('update_inaktiv_' || v_tabs[v_i],
      CASE WHEN v_txt IN ('k0', 'G') THEN 'k0|G' ELSE v_txt END, 'k0|G');
    v_txt := pg_temp.s112_versuch(format('DELETE FROM public.%I WHERE %s', v_tabs[v_i], v_wheres[v_i]));
    v_erg := v_erg || pg_temp.s112_erwarte('delete_inaktiv_' || v_tabs[v_i],
      CASE WHEN v_txt IN ('k0', 'G') THEN 'k0|G' ELSE v_txt END, 'k0|G');
  END LOOP;
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_update_ta_inaktiv',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET bio_status = bio_status WHERE id = %L', c_m)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_pruefe_tenant_zugriff_ta_inaktiv',
    pg_temp.s112_versuch(format('SELECT public.pruefe_tenant_zugriff(%L::uuid, ARRAY[%L, %L])', c_m, 'system_admin', 'tenant_admin')), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('tenant_memberships_ta_inaktiv_sieht_keine',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.tenant_memberships WHERE tenant_id = %L', c_m)), '0');

  -- ── 5. NULL-Falle als mix (aktiv in B, inaktiv im Musterhof) ─────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_mix);
  FOR v_i IN 1 .. array_length(v_glob, 1) LOOP
    v_erg := v_erg || pg_temp.s112_luecke('null_falle_mix_' || v_glob[v_i],
      pg_temp.s112_zaehle(format('SELECT count(*) FROM public.%I WHERE tenant_id IS NULL', v_glob[v_i])),
      v_glob_n[v_i]::text, '0',
      'B5 NULL-Falle mitgliedschaft_aktiv: globale ' || v_glob[v_i] || ' unsichtbar bei irgendeiner inaktiven Mitgliedschaft');
  END LOOP;
  v_erg := v_erg || pg_temp.s112_erwarte('mix_select_m_kontakt',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.kontakte WHERE %s', pg_temp.s112_pk_where('kontakte', v_kontakt))), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('mix_eigene_mitgliedschaften',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.tenant_memberships WHERE user_id = %L', v_mix)), '1');
  SELECT c_m IN (SELECT public.s112_meine_tenants()), v_b IN (SELECT public.s112_meine_tenants()) INTO v_bool, v_txt;
  v_erg := v_erg || pg_temp.s112_erwarte('mix_meine_tenants_b_ohne_m', v_bool::text || '/' || v_txt, 'false/true');

  -- Kontrolle NULL-Falle: b_w (keine inaktive Mitgliedschaft) sieht die globalen Zeilen
  PERFORM pg_temp.s112_als(v_bw);
  FOR v_i IN 1 .. array_length(v_glob, 1) LOOP
    v_erg := v_erg || pg_temp.s112_erwarte('kontrolle_global_b_w_' || v_glob[v_i],
      pg_temp.s112_zaehle(format('SELECT count(*) FROM public.%I WHERE tenant_id IS NULL', v_glob[v_i])), v_glob_n[v_i]::text);
  END LOOP;

  -- ── 8. Kellergemeinschaft: in B gesperrtes Mitglied sieht die freigegebenen Behälter von M nicht ─────
  PERFORM pg_temp.s112_als_postgres();
  SELECT b.id INTO v_beh_g FROM public.behaelter b WHERE b.tenant_id = c_m ORDER BY b.id LIMIT 1;
  UPDATE public.behaelter SET gemeinsam = true WHERE id = v_beh_g;
  INSERT INTO public.keller_freigaben (eigentuemer_tenant_id, nutzer_tenant_id, aktiv, notizen)
  VALUES (c_m, v_b, true, 'S112TEST Freigabe inaktives Mitglied') RETURNING id INTO v_kf;
  v_erg := v_erg || pg_temp.s112_erwarte('keller_behaelter_gemeinsam_existiert',
    (SELECT count(*) FROM public.behaelter WHERE id = v_beh_g AND gemeinsam AND tenant_id = c_m), 1::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('keller_freigabe_aktiv_existiert',
    (SELECT count(*) FROM public.keller_freigaben WHERE id = v_kf AND aktiv AND nutzer_tenant_id = v_b), 1::bigint);
  -- Positivkontrolle: b_w (aktiv in B) sieht Behälter und Freigabe
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('keller_kontrolle_behaelter_b_w',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.behaelter WHERE id = %L::uuid', v_beh_g)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('keller_kontrolle_freigabe_b_w',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.keller_freigaben WHERE id = %L::uuid', v_kf)), '1');
  -- b_w in B sperren
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.tenant_memberships SET aktiv = false WHERE user_id = v_bw AND tenant_id = v_b;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_erg := v_erg || pg_temp.s112_erwarte('keller_b_w_gesperrt', v_n, 1::bigint);
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('keller_inaktiv_behaelter',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.behaelter WHERE id = %L::uuid', v_beh_g)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('keller_inaktiv_behaelter_m',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.behaelter WHERE tenant_id = %L::uuid', c_m)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('keller_inaktiv_freigabe',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.keller_freigaben WHERE id = %L::uuid', v_kf)), '0');
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.tenant_memberships SET aktiv = true WHERE user_id = v_bw AND tenant_id = v_b;

  -- ── 9. tenants.active = false: Ist-Stand festhalten (Ratsche B16) ────────────────────────────────────
  v_kontakt_b := pg_temp.s112_beispiel('kontakte', v_b, v_bw);
  UPDATE public.tenants SET active = false WHERE id = v_b;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_erg := v_erg || pg_temp.s112_erwarte('b16_betrieb_b_deaktiviert', v_n, 1::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('b16_kontakt_b_existiert',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.kontakte WHERE %s', pg_temp.s112_pk_where('kontakte', v_kontakt_b))), '1');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_luecke('b16_betrieb_inaktiv_lesen',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.kontakte WHERE %s', pg_temp.s112_pk_where('kontakte', v_kontakt_b))), '0', '1', c_b16);
  v_erg := v_erg || pg_temp.s112_luecke('b16_betrieb_inaktiv_schreiben',
    pg_temp.s112_versuch(format('UPDATE public.kontakte SET nachname = nachname WHERE %s', pg_temp.s112_pk_where('kontakte', v_kontakt_b))), 'k0', 'k1', c_b16);
  v_erg := v_erg || pg_temp.s112_luecke('b16_betrieb_inaktiv_einfuegen',
    pg_temp.s112_versuch(format('INSERT INTO public.kontakte (tenant_id, nachname) VALUES (%L, %L)', v_b, 'S112TEST B16')), 'R', 'k1', c_b16);
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.tenants SET active = true WHERE id = v_b;

  -- ── 7. Kontrolle: dieselben Personas aktiv → Zugriff da ──────────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.tenant_memberships SET aktiv = true WHERE tenant_id = c_m AND user_id IN (v_inak, v_ta_inak);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_erg := v_erg || pg_temp.s112_erwarte('kontrolle_aktiviert', v_n, 2);
  SELECT count(*) INTO v_mitglieder_aktiv FROM public.tenant_memberships WHERE tenant_id = c_m AND aktiv;

  PERFORM pg_temp.s112_als(v_inak);
  FOR v_i IN 1 .. coalesce(array_length(v_tabs, 1), 0) LOOP
    v_txt := pg_temp.s112_zaehle(format('SELECT count(*) FROM public.%I WHERE %s', v_tabs[v_i], v_wheres[v_i]));
    IF v_txt = '1' THEN
      v_kontrolle_sichtbar := v_kontrolle_sichtbar + 1;
    END IF;
    v_erg := v_erg || pg_temp.s112_erwarte('kontrolle_select_aktiv_' || v_tabs[v_i], v_txt,
      CASE WHEN v_tabs[v_i] = ANY (c_winzer_liest_nicht) THEN '0' ELSE '1' END);
  END LOOP;
  v_erg := v_erg || pg_temp.s112_erwarte('kontrolle_tenants_sichtbar',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.tenants WHERE id = %L', c_m)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('kontrolle_pruefe_tenant_zugriff',
    pg_temp.s112_versuch(format('SELECT public.pruefe_tenant_zugriff(%L::uuid, NULL::text[])', c_m)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('kontrolle_get_next_rechnungsnummer',
    pg_temp.s112_versuch(format('SELECT public.get_next_rechnungsnummer(%L::uuid)', c_m)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('kontrolle_get_user_role_in_tenant', public.get_user_role_in_tenant(c_m), 'winzer');
  SELECT c_m IN (SELECT public.s112_meine_tenants()) INTO v_bool;
  v_erg := v_erg || pg_temp.s112_erwarte('kontrolle_meine_tenants_mit_m', v_bool, true);
  v_erg := v_erg || pg_temp.s112_erwarte('kontrolle_darf_schreiben', public.s112_darf_schreiben(c_m, 'crm'), true);
  v_erg := v_erg || pg_temp.s112_erwarte('kontrolle_mandant_mitglieder',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.s112_mandant_mitglieder(%L::uuid)', c_m)), v_mitglieder_aktiv::text);
  v_erg := v_erg || pg_temp.s112_erwarte('kontrolle_get_behandlungen',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.get_behandlungen_fuer_grundstuecke(%L::uuid[], %L::uuid)', v_gids, c_m)),
    v_beh_soll::text);
  v_erg := v_erg || pg_temp.s112_erwarte('kontrolle_storage_select',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM storage.objects WHERE bucket_id = %L AND name = %L', 'ea-belege', v_obj_name)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('kontrolle_storage_upload',
    pg_temp.s112_versuch(format('INSERT INTO storage.objects (bucket_id, name, owner) VALUES (%L, %L, %L::uuid)',
      'ea-belege', c_m::text || '/s112test/upload-aktiv.pdf', v_inak)), 'k1');

  PERFORM pg_temp.s112_als(v_ta_inak);
  FOREACH v_tab IN ARRAY c_ta_liest LOOP
    v_i := array_position(v_tabs, v_tab);
    IF v_i IS NOT NULL THEN
      v_erg := v_erg || pg_temp.s112_erwarte('kontrolle_select_aktiv_ta_' || v_tab,
        pg_temp.s112_zaehle(format('SELECT count(*) FROM public.%I WHERE %s', v_tab, v_wheres[v_i])), '1');
    END IF;
  END LOOP;
  -- Dieselben Anweisungen wie in Abschnitt 2, jetzt als aktiver tenant_admin: k1 oder ein Fehler der Klasse 23
  -- (Eindeutigkeit, FK, NOT NULL, CHECK) belegt, dass RLS und Rechte die Anweisung durchlassen – dort war also
  -- aktiv = false die Ursache der Ablehnung. Mindestzahlen nach Planungsprobe 28.09.2026 (80 / 74 / 74 von 98).
  FOR v_i IN 1 .. coalesce(array_length(v_tabs, 1), 0) LOOP
    v_txt := pg_temp.s112_versuch(pg_temp.s112_klon_sql(v_tabs[v_i], v_zeilen[v_i]));
    IF v_txt ~ c_ok_re THEN v_ok_ins := v_ok_ins + 1; ELSE v_nicht_ins := v_nicht_ins || (v_tabs[v_i] || '=' || v_txt); END IF;
    IF v_upds[v_i] <> '' THEN
      v_n_upd := v_n_upd + 1;
      v_txt := pg_temp.s112_versuch(format('UPDATE public.%I SET %I = %I WHERE %s', v_tabs[v_i], v_upds[v_i], v_upds[v_i], v_wheres[v_i]));
      IF v_txt ~ c_ok_re THEN v_ok_upd := v_ok_upd + 1; ELSE v_nicht_upd := v_nicht_upd || (v_tabs[v_i] || '=' || v_txt); END IF;
    END IF;
    v_txt := pg_temp.s112_versuch(format('DELETE FROM public.%I WHERE %s', v_tabs[v_i], v_wheres[v_i]));
    IF v_txt ~ c_ok_re THEN v_ok_del := v_ok_del + 1; ELSE v_nicht_del := v_nicht_del || (v_tabs[v_i] || '=' || v_txt); END IF;
  END LOOP;
  v_erg := v_erg || pg_temp.s112_erwarte('kontrolle_ta_insert_klon_mindestens',
    CASE WHEN v_ok_ins >= c_min_ins THEN 'ok'
         ELSE v_ok_ins || ' von ' || array_length(v_tabs, 1) || ' (nicht: ' || array_to_string(v_nicht_ins, ',') || ')' END, 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('kontrolle_ta_update_mindestens',
    CASE WHEN v_ok_upd >= c_min_upd THEN 'ok'
         ELSE v_ok_upd || ' von ' || v_n_upd || ' (nicht: ' || array_to_string(v_nicht_upd, ',') || ')' END, 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('kontrolle_ta_delete_mindestens',
    CASE WHEN v_ok_del >= c_min_del THEN 'ok'
         ELSE v_ok_del || ' von ' || array_length(v_tabs, 1) || ' (nicht: ' || array_to_string(v_nicht_del, ',') || ')' END, 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('kontrolle_ta_update_kontakt',
    pg_temp.s112_versuch(format('UPDATE public.kontakte SET nachname = nachname WHERE %s', pg_temp.s112_pk_where('kontakte', v_kontakt))), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('kontrolle_ta_insert_kontakt',
    pg_temp.s112_versuch(format('INSERT INTO public.kontakte (tenant_id, nachname) VALUES (%L, %L)', c_m, 'S112TEST Kontrolle')), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('kontrolle_ta_update_tenants',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET bio_status = bio_status WHERE id = %L', c_m)), 'k1');
  PERFORM pg_temp.s112_als_postgres();

  v_erg := v_erg || pg_temp.s112_erwarte('kontrolle_mehrheit_sichtbar',
    v_kontrolle_sichtbar >= coalesce(array_length(v_tabs, 1), 0) - coalesce(array_length(c_winzer_liest_nicht, 1), 0), true);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 420);
END
$test$;
