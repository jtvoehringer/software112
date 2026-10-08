-- @bereich: Mandantentrennung beim Lesen (alle Tabellen dynamisch, beide Richtungen, anon, Sonderfälle, Kellergemeinschaft)
-- @ziel: Kein Benutzer eines Betriebs sieht Zeilen eines anderen Betriebs – für jede Tabelle aus dem Katalog
-- @ziel: (pg_temp.s112_mandantentabellen, also auch künftige), in beide Richtungen (B → M und M/C → B), mit
-- @ziel: Positivkontrolle je Tabelle. anon liest nirgends Mandantendaten und scheitert nie an Hilfsfunktionen
-- @ziel: (Policy ohne TO authenticated). Der einzige gewollte mandantenübergreifende Lesepfad (Kellergemeinschaft)
-- @ziel: bleibt auf gemeinsam = true, aktive Freigabe, den Nutzer-Betrieb und reines Lesen beschränkt.
-- @mutation behaelter_select_offen: zusätzliche PERMISSIVE-Policy USING (true) auf behaelter – fremde Behälter sichtbar | rot: lesen_fremd:behaelter:.*|fremd_tid:behaelter:.*
-- @mutation tm_select_offen: zusätzliche PERMISSIVE-Policy USING (true) auf tenant_memberships | rot: lesen_fremd:tenant_memberships:.*|fremd_tid:tenant_memberships:.*|tm_.*
-- @mutation firmen_policy_ohne_to: SELECT-Policy auf firmen ohne TO (gilt für PUBLIC) mit s112_meine_tenants – anon scheitert an der Hilfsfunktion | rot: anon_lesen:firmen
-- @mutation keller_ohne_gemeinsam_aktiv: Keller-Freigabe-Policy auf behaelter ohne Prüfung von gemeinsam und aktiv | rot: keller_.*
-- @mutation leck_ausser_musterhof: kontakte-Policy USING (tenant_id <> Musterhof) – alle Betriebe außer M gegenseitig lesbar (nur die Gegenrichtung sieht das) | rot: lesen_fremd_rueck:kontakte:.*|fremd_tid_rueck:kontakte:.*
-- @mutation kontakte_leads_offen: kontakte-Policy USING (is_lead) – bedingtes Leck, erkannt über die eigenen Varianten-Zeilen (nicht über den Demo-Stand) | rot: fremd_tid:kontakte:.*|fremd_tid_rueck:kontakte:.*
-- @mutation k_tabelle_offen: pressung_behaelter (K-Tabelle ohne tenant_id) mit Policy USING (true) | rot: lesen_fremd(_rueck)?:pressung_behaelter:.*|fremd_tid(_rueck)?:pressung_behaelter:.*
-- @mutation gut_ohne_mandant: get_user_tenant_ids() liefert alle Betriebe | rot: lesen_fremd(_rueck)?:(weingarten|behandlungen|weinjahrgaenge|weinanalysen):.*|fremd_tid(_rueck)?:(weingarten|behandlungen|weinjahrgaenge|weinanalysen):.*|tenants_.*
-- @mutation neue_tabelle_offen: neue Mandantentabelle s112test_neu mit RLS und Policy USING (true) – der Katalog erfasst sie ohne Pflege | rot: lesen_fremd(_rueck)?:s112test_neu:.*|fremd_tid(_rueck)?:s112test_neu:.*
-- @mutation eigner_zu_mandant: benachrichtigungen zusätzlich für jedes Mitglied des Betriebs lesbar statt nur für den Eigentümer | rot: rolle_lesen:benachrichtigungen:.*
-- @mutation view_ohne_invoker: View auf kontakte ohne security_invoker (läuft mit den Rechten des Eigentümers) | rot: view_fremd:s112test_v:.*|anon_lesen:s112test_v
-- @mutation globale_versteckt: RESTRICTIVE-Policy versteckt globale duengemittel (tenant_id NULL) | rot: global_sichtbar:duengemittel
-- @mutation positiv_weg: RESTRICTIVE-Policy USING (false) auf kontakte – niemand sieht etwas, jede 0 wäre wertlos | rot: leer:kontakte
-- @mutation tenants_offen: tenants für alle angemeldeten Benutzer lesbar | rot: tenants_.*|lesen_fremd(_rueck)?:tenants:.*
-- @mutation rn_inaktiv_offen: inaktive Release-Notes für alle angemeldeten Benutzer lesbar | rot: release_note_inaktiv_b_ta
--
-- software:112 – SQL-Testsuite gegen STAGING, Datei 10 (Stand 28.09.2026).
-- Nur Staging. Die ganze Datei ist EINE Transaktion und endet mit pg_temp.s112_ende(…) = RAISE → nichts bleibt.
--
-- Was geprüft wird:
--   1. Beispielzeilen: je T/K-Tabelle eine Musterhof-Zeile (vorhanden – die nach PK erste – oder per Generator)
--      und eine B-Zeile; Existenz als postgres belegt. Fehlt eine → FEHLER leer:<tab>. Dazu Varianten-Zeilen in
--      M und B (kontakte/firmen is_lead true und false, behaelter gemeinsam true und false), damit bedingte Lecks
--      nicht vom Demo-Stand abhängen. Fremde Zeilen je Blickwinkel (B, M, C) als postgres belegt (existiert_fremd:*).
--   2. Sweep (vor der Keller-Freigabe) in beide Richtungen:
--      a) b_ta, b_w, b_l sehen die M-Zeile nicht (lesen_fremd:<tab>:<persona>) und keine Zeile eines anderen
--         Betriebs (fremd_tid:<tab>:<persona>);
--      b) m_ta, m_w, m_l und c_ta sehen die B-Zeile nicht (lesen_fremd_rueck:<tab>:<persona>) und keine Zeile
--         eines anderen Betriebs (fremd_tid_rueck:<tab>:<persona>).
--      „Zeile eines anderen Betriebs“: bei T über tenant_id; bei K über eine als postgres ermittelte PK-Liste
--      (bis 50 Zeilen, nach PK sortiert), deren Elternzeile einem anderen Betrieb gehört.
--   3. Positivkontrolle: m_ta sieht die M-Zeile, b_ta die B-Zeile. Ausnahmen: stripe_zahlungen_log und
--      system_ereignisse (niemand), benachrichtigungen, user_email_connections und assistent_* (nur Eigentümer, B14),
--      zeiterfassung und bestandsprotokoll (nur SA/TA/PA; sumup_terminals liest jedes Mitglied – Ist-Stand), tenant_memberships (W/L nur die eigene Zeile).
--   4. Globale Zeilen (tenant_id NULL) für b_w sichtbar; Sonderfälle tenants, tenant_memberships,
--      plattform_admins, rebsorten, svs_parameter, release_notes(_gesehen), profiles (Lücke B3), Views.
--   5. Kellergemeinschaft: nur gemeinsam = true, nur aktive Freigabe, nur der Nutzer-Betrieb, nur Lesen.
--   6. anon: jede Relation in public liefert 0 Zeilen oder „permission denied for table“ (rebsorten gewollt > 0).
--   7. Ist-Stand Modul-Schalter: Leser und Winzer ohne Schreibmodul lesen alle Module (module_flags und
--      tenant_einstellungen.modul_* stehen nicht in RLS) – kein Bezug zur Mandantentrennung.
--
-- Abgrenzung und Grenzen:
--   * Tabellen OHNE RLS nimmt der Katalog nicht auf (relrowsecurity-Filter). Geprüft werden sie in
--     01_katalog_invarianten (rls_an:*); hier fallen sie nur über anon auf (anon_lesen:*, anon_ohne_grant_liste).
--   * Die Mutationen stehen direkt nach s112_aufbau und VOR dem Katalog-Durchlauf für die Beispielzeilen: so
--     erfasst der Katalog eine neue Tabelle wie im echten Betrieb, wo es sie schon vor dem Lauf gibt.
--   * Abhängigkeit vom Staging-Datenstand (schlägt laut fehl, nicht stumm): Musterhof-Behälter mit gemeinsam = true,
--     weinausbau, keller_behandlungen und weinanalysen im Musterhof, ea_kategorien global ≥ 21, rebsorten ≥ 25,
--     svs_parameter ≥ 1, Daten der v_modtab-Tabellen im Musterhof. Nach einem Demo-Reset kann die Datei rot
--     werden, ohne dass es eine Regression gibt.

-- Zählt und liefert die Zahl als Text – oder '<SQLSTATE>: <Meldung>' (anders als s112_zaehle mit Meldungstext,
-- damit „permission denied for table“ und „… for function“ unterscheidbar sind).
CREATE FUNCTION pg_temp.t10_zaehle_text(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v_n bigint;
  v_state text;
  v_msg text;
BEGIN
  EXECUTE p_sql INTO v_n;
  RETURN coalesce(v_n::text, 'NULL');
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  RETURN v_state || ': ' || v_msg;
END $f$;

-- ORDER-BY-Liste über den Primärschlüssel (Alias p_alias) – macht die Auswahl der Beispielzeilen deterministisch.
CREATE FUNCTION pg_temp.t10_pk_order(p_alias text, p_pk text[]) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT coalesce((SELECT string_agg(format('%I.%I', p_alias, u.c), ', ' ORDER BY u.o)
                     FROM unnest(p_pk) WITH ORDINALITY u(c, o)), '1')
$f$;

-- Vorhandene Zeile eines Betriebs (T: über tenant_id, K: über die Elterntabelle) als jsonb oder NULL –
-- deterministisch die nach PK erste Zeile.
CREATE FUNCTION pg_temp.t10_vorhandene_zeile(p_tab text, p_klasse text, p_eltern_spalte text, p_eltern_tabelle text,
                                             p_eltern_ref text, p_pk text[], p_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v jsonb;
BEGIN
  IF p_klasse = 'T' THEN
    EXECUTE format('SELECT to_jsonb(x.*) FROM public.%I x WHERE x.tenant_id = %L ORDER BY %s LIMIT 1',
                   p_tab, p_tenant, pg_temp.t10_pk_order('x', p_pk)) INTO v;
  ELSIF p_klasse = 'K' THEN
    EXECUTE format('SELECT to_jsonb(k.*) FROM public.%I k JOIN public.%I p ON p.%I = k.%I WHERE p.tenant_id = %L ORDER BY %s LIMIT 1',
                   p_tab, p_eltern_tabelle, p_eltern_ref, p_eltern_spalte, p_tenant, pg_temp.t10_pk_order('k', p_pk)) INTO v;
  END IF;
  RETURN v;
END $f$;

-- Abfrage „Zeilen anderer Betriebe“ aus Sicht von p_eigen (SELECT count(*) …; als Persona Soll 0).
-- T: tenant_id IS NOT NULL AND tenant_id <> p_eigen. K: PK-Liste (bis 50 Zeilen, nach PK sortiert), als postgres
-- ermittelt, deren Elternzeile einem anderen Betrieb gehört – NULL, wenn es keine solche Zeile gibt.
CREATE FUNCTION pg_temp.t10_fremd_sql(p_tab text, p_klasse text, p_eltern_spalte text, p_eltern_tabelle text,
                                      p_eltern_ref text, p_pk text[], p_eigen uuid)
RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v text;
BEGIN
  IF p_klasse = 'T' THEN
    RETURN format('SELECT count(*) FROM public.%I WHERE tenant_id IS NOT NULL AND tenant_id <> %L::uuid', p_tab, p_eigen);
  END IF;
  EXECUTE format('SELECT string_agg(''('' || pg_temp.s112_pk_where(%L, q.z) || '')'', '' OR '')
                    FROM (SELECT to_jsonb(k.*) AS z FROM public.%I k JOIN public.%I p ON p.%I = k.%I
                           WHERE p.tenant_id IS NOT NULL AND p.tenant_id <> %L::uuid ORDER BY %s LIMIT 50) q',
                 p_tab, p_tab, p_eltern_tabelle, p_eltern_ref, p_eltern_spalte, p_eigen, pg_temp.t10_pk_order('k', p_pk)) INTO v;
  RETURN CASE WHEN v IS NULL THEN NULL ELSE format('SELECT count(*) FROM public.%I WHERE %s', p_tab, v) END;
END $f$;

DO $test$
DECLARE
  c_datei     constant text := '10_mandantentrennung_lesen';
  -- Lesen nur für niemanden per API / nur Eigentümer / nur SA, TA, PA
  c_niemand   constant text[] := ARRAY['stripe_zahlungen_log', 'system_ereignisse'];
  -- assistent_*: Verläufe privat je Benutzer (KAN-159 B14)
  c_eigner    constant text[] := ARRAY['benachrichtigungen', 'user_email_connections',
                                       'assistent_unterhaltungen', 'assistent_nachrichten', 'assistent_aktionen'];
  c_nur_admin constant text[] := ARRAY['zeiterfassung', 'bestandsprotokoll'];
  -- sumup_terminals: Schreiben nur SA/TA, Lesen bewusst jedes Mitglied (Policy sumup_terminals_select, legacy 097;
  -- Winzer wählt das Terminal an der Kasse, keine Geheimnisse in der Tabelle) – Ist-Stand wird festgehalten.
  c_mitglied_liest constant text[] := ARRAY['sumup_terminals'];
  -- Tabellen, die anon derzeit gar nicht lesen darf (kein SELECT-Grant) – erlaubt, aber als Liste festgehalten
  c_anon_ohne_grant constant text[] := ARRAY['bestandsprotokoll', 'betriebsmittel', 'betriebsmittel_lager_bewegungen', 'fuellung_bewegungen', 'meldung_abgaben',
    'kat_buchungsart', 'kat_erzeugnis', 'kat_farbe', 'kat_land', 'kat_qualitaetsstufe', 'katalog_mapping',
    'kellerbuch_buchungen', 'kellerbuch_abschluesse', 'charge_herkunft', 'pruefnummer_ereignisse', 'pruefnummer_chargen', 'charge_umstufungen', 'keller_verarbeitungen', 'keller_zugangskorrekturen', 'fuellung_etikettierungen', 'kellermittel', 'kellermittel_buchungen', 'reifemessungen', 'sonstige_artikel_bewegungen', 'lieferadressen',
    'elabel_zutaten', 'elabels', 'elabel_umleitungen', 'produktionen', 'produktion_eingaenge', 'rechnungen', 'psm_uebermittlungen', 'lohnversektungen'];   -- KAN-167, KAN-37 B, KAN-39, KAN-40, KAN-192, KAN-97, KAN-99, KAN-82, KAN-216: REVOKE ALL … FROM anon
  -- Varianten-Zeilen (Tabelle:boolesche Spalte) – je Betrieb M und B einmal true, einmal false
  c_varianten constant text[] := ARRAY['kontakte:is_lead', 'firmen:is_lead', 'behaelter:gemeinsam'];
  -- Gegenrichtung: Personas aus M und C gegen die B-Zeile
  c_rueck     constant text[] := ARRAY['m_ta', 'm_w', 'm_l', 'c_ta'];
  v_t0        timestamptz := clock_timestamp();
  v_erg       text[] := '{}';
  v_a         jsonb;
  v_m         uuid;
  v_b         uuid;
  v_c         uuid;
  v_m_ta      uuid;
  v_b_ta      uuid;
  v_b_w       uuid;
  v_b_l       uuid;
  v_c_ta      uuid;
  v_pa        uuid;
  r           record;
  v_i         int;
  v_tab       text;
  v_spalte    text;
  v_pers      text;
  v_uid       uuid;
  v_ten       uuid;
  v_wert      boolean;
  v_z         jsonb;
  v_zb        jsonb;
  v_n         bigint;
  v_n2        bigint;
  v_txt       text;
  v_ist       text;
  v_leer      text[] := '{}';
  -- vorberechnete Prüfungen (Index = Tabelle)
  v_tabs      text[] := '{}';
  v_klassen   text[] := '{}';
  v_sql_m     text[] := '{}';
  v_sql_b     text[] := '{}';
  v_sql_fremd text[] := '{}';   -- Zeilen anderer Betriebe aus Sicht von B
  v_sql_fm    text[] := '{}';   -- … aus Sicht von M
  v_sql_fc    text[] := '{}';   -- … aus Sicht von C
  v_personas  text[] := ARRAY['b_ta', 'b_w', 'b_l'];
  v_rn        uuid;
  v_kf        uuid;
  v_beh_ng    uuid;
  v_beh_g     uuid;
  v_n_gem     bigint;
  v_upd       text;
  v_anon_tabs text[] := '{}';
  v_anon_pg   bigint[] := '{}';
  v_anon_ist  text[] := '{}';
  v_anon_g    text[] := '{}';
  v_modtab    text[] := ARRAY['kontakte', 'behaelter', 'weingarten', 'verkaufsposten', 'ea_transaktionen', 'kostenstellen', 'fristen', 'weinanalysen'];
  v_modsoll   bigint[] := '{}';
  v_abw       text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();

  -- ── 0. Aufbau (als postgres) ───────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau(true);
  v_m := (v_a ->> 'm')::uuid;
  v_b := (v_a ->> 'b')::uuid;
  v_c := (v_a ->> 'c')::uuid;
  v_m_ta := (v_a ->> 'm_ta')::uuid;
  v_b_ta := (v_a ->> 'b_ta')::uuid;
  v_b_w := (v_a ->> 'b_w')::uuid;
  v_b_l := (v_a ->> 'b_l')::uuid;
  v_c_ta := (v_a ->> 'c_ta')::uuid;
  v_pa := (v_a ->> 'pa')::uuid;

  -- ── Mutationen (nur im Mutationsmodus): direkt nach dem Aufbau und VOR dem Katalog-Durchlauf, damit eine
  --    neue Tabelle wie im echten Betrieb schon im Katalog steht; vor allen Prüfungen ────────────────────────
  PERFORM pg_temp.s112_mutiere('behaelter_select_offen',
    $m$CREATE POLICY s112test_mut_beh ON public.behaelter AS PERMISSIVE FOR SELECT TO authenticated USING (true)$m$);
  PERFORM pg_temp.s112_mutiere('tm_select_offen',
    $m$CREATE POLICY s112test_mut_tm ON public.tenant_memberships AS PERMISSIVE FOR SELECT TO authenticated USING (true)$m$);
  PERFORM pg_temp.s112_mutiere('firmen_policy_ohne_to',
    $m$CREATE POLICY s112test_mut_firmen ON public.firmen AS PERMISSIVE FOR SELECT USING (tenant_id IN (SELECT public.s112_meine_tenants()))$m$);
  PERFORM pg_temp.s112_mutiere('keller_ohne_gemeinsam_aktiv',
    $m$CREATE POLICY s112test_mut_keller ON public.behaelter AS PERMISSIVE FOR SELECT TO authenticated
       USING (EXISTS (SELECT 1 FROM public.keller_freigaben f
                       WHERE f.eigentuemer_tenant_id = behaelter.tenant_id
                         AND f.nutzer_tenant_id IN (SELECT public.s112_meine_tenants())))$m$);
  PERFORM pg_temp.s112_mutiere('leck_ausser_musterhof',
    $m$CREATE POLICY s112test_mut_am ON public.kontakte AS PERMISSIVE FOR SELECT TO authenticated
       USING (tenant_id <> '33333333-3333-4333-8333-333333333333'::uuid)$m$);
  PERFORM pg_temp.s112_mutiere('kontakte_leads_offen',
    $m$CREATE POLICY s112test_mut_lead ON public.kontakte AS PERMISSIVE FOR SELECT TO authenticated USING (is_lead)$m$);
  PERFORM pg_temp.s112_mutiere('k_tabelle_offen',
    $m$CREATE POLICY s112test_mut_pb ON public.pressung_behaelter AS PERMISSIVE FOR SELECT TO authenticated USING (true)$m$);
  PERFORM pg_temp.s112_mutiere('gut_ohne_mandant',
    $m$CREATE OR REPLACE FUNCTION public.get_user_tenant_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
       SET search_path = public AS 'SELECT id FROM public.tenants'$m$);
  PERFORM pg_temp.s112_mutiere('neue_tabelle_offen',
    $m$CREATE TABLE public.s112test_neu (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
         tenant_id uuid NOT NULL REFERENCES public.tenants, notiz text);
       ALTER TABLE public.s112test_neu ENABLE ROW LEVEL SECURITY;
       GRANT SELECT ON public.s112test_neu TO authenticated, anon;
       CREATE POLICY s112test_neu_sel ON public.s112test_neu FOR SELECT TO authenticated USING (true)$m$);
  PERFORM pg_temp.s112_mutiere('eigner_zu_mandant',
    $m$CREATE POLICY s112test_mut_ben ON public.benachrichtigungen AS PERMISSIVE FOR SELECT TO authenticated
       USING (tenant_id IN (SELECT public.s112_meine_tenants()))$m$);
  PERFORM pg_temp.s112_mutiere('view_ohne_invoker',
    $m$CREATE VIEW public.s112test_v AS SELECT id, tenant_id FROM public.kontakte;
       GRANT SELECT ON public.s112test_v TO authenticated, anon$m$);
  PERFORM pg_temp.s112_mutiere('globale_versteckt',
    $m$CREATE POLICY s112test_mut_glob ON public.duengemittel AS RESTRICTIVE FOR SELECT TO authenticated USING (tenant_id IS NOT NULL)$m$);
  PERFORM pg_temp.s112_mutiere('positiv_weg',
    $m$CREATE POLICY s112test_mut_nix ON public.kontakte AS RESTRICTIVE FOR SELECT TO authenticated USING (false)$m$);
  PERFORM pg_temp.s112_mutiere('tenants_offen',
    $m$CREATE POLICY s112test_mut_ten ON public.tenants AS PERMISSIVE FOR SELECT TO authenticated USING (true)$m$);
  PERFORM pg_temp.s112_mutiere('rn_inaktiv_offen',
    $m$CREATE POLICY s112test_mut_rn ON public.release_notes AS PERMISSIVE FOR SELECT TO authenticated USING (true)$m$);

  -- Globale Zeilen (tenant_id NULL): Staging hat keine duengemittel, pflanzenschutzmittel, saetze_massnahmen
  FOREACH v_tab IN ARRAY ARRAY['duengemittel', 'pflanzenschutzmittel', 'saetze_massnahmen'] LOOP
    BEGIN
      PERFORM pg_temp.s112_zeile(v_tab, NULL, '{"tenant_id": null}'::jsonb);
    EXCEPTION WHEN OTHERS THEN
      v_erg := v_erg || pg_temp.s112_fehler('global_anlegen:' || v_tab, SQLSTATE || ' ' || SQLERRM);
    END;
  END LOOP;

  -- Inaktive Release-Note (nur Plattform-Admins sehen sie) und eine Gesehen-Zeile von m_ta
  INSERT INTO public.release_notes (version, titel, aktiv) VALUES ('s112test', 'S112TEST inaktive Note', false) RETURNING id INTO v_rn;
  INSERT INTO public.release_notes_gesehen (user_id, release_note_id) VALUES (v_m_ta, v_rn);

  -- Varianten-Zeilen: je Betrieb M und B eine Zeile mit Spalte = true und eine mit = false (vor dem Katalog-
  -- Durchlauf, damit auch die K-Listen der Kindtabellen sie sehen könnten)
  FOREACH v_txt IN ARRAY c_varianten LOOP
    v_tab := split_part(v_txt, ':', 1);
    v_spalte := split_part(v_txt, ':', 2);
    FOREACH v_ten IN ARRAY ARRAY[v_m, v_b] LOOP
      FOREACH v_wert IN ARRAY ARRAY[true, false] LOOP
        BEGIN
          PERFORM pg_temp.s112_beispiel(v_tab, v_ten, CASE WHEN v_ten = v_m THEN v_m_ta ELSE v_b_ta END,
                                        jsonb_build_object(v_spalte, v_wert::text));
        EXCEPTION WHEN OTHERS THEN
          v_erg := v_erg || pg_temp.s112_fehler('variante_anlegen:' || v_tab || ':' || v_spalte || '=' || v_wert,
                                                SQLSTATE || ' ' || SQLERRM);
        END;
      END LOOP;
    END LOOP;
  END LOOP;

  -- Beispielzeilen je T/K-Tabelle: M (vorhanden oder neu) und B (neu)
  FOR r IN SELECT * FROM pg_temp.s112_mandantentabellen() WHERE klasse IN ('T', 'K') ORDER BY tabelle LOOP
    v_z := NULL;
    v_zb := NULL;
    BEGIN
      IF r.tabelle = 'tenant_memberships' THEN
        SELECT to_jsonb(t.*) INTO v_z FROM public.tenant_memberships t WHERE t.tenant_id = v_m AND t.user_id = (v_a ->> 'm_w')::uuid;
      ELSIF r.tabelle = ANY (c_eigner) THEN
        v_z := pg_temp.s112_beispiel(r.tabelle, v_m, v_m_ta);          -- Eigentümer = m_ta
      ELSE
        v_z := pg_temp.t10_vorhandene_zeile(r.tabelle, r.klasse, r.eltern_spalte, r.eltern_tabelle, r.eltern_ref, r.pk, v_m);
        IF v_z IS NULL THEN
          v_z := pg_temp.s112_beispiel(r.tabelle, v_m, v_m_ta);
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_erg := v_erg || pg_temp.s112_fehler('leer:' || r.tabelle, 'M-Zeile nicht anlegbar: ' || SQLSTATE || ' ' || SQLERRM);
      v_leer := v_leer || r.tabelle;
      v_z := NULL;
    END;
    BEGIN
      IF r.tabelle = 'tenant_memberships' THEN
        SELECT to_jsonb(t.*) INTO v_zb FROM public.tenant_memberships t WHERE t.tenant_id = v_b AND t.user_id = v_b_w;
      ELSE
        v_zb := pg_temp.s112_beispiel(r.tabelle, v_b, v_b_ta);          -- Eigentümer = b_ta
      END IF;
    EXCEPTION WHEN OTHERS THEN
      IF NOT r.tabelle = ANY (v_leer) THEN
        v_erg := v_erg || pg_temp.s112_fehler('leer:' || r.tabelle, 'B-Zeile nicht anlegbar: ' || SQLSTATE || ' ' || SQLERRM);
        v_leer := v_leer || r.tabelle;
      END IF;
      v_zb := NULL;
    END;
    IF v_z IS NULL OR v_zb IS NULL THEN
      IF NOT r.tabelle = ANY (v_leer) THEN
        v_erg := v_erg || pg_temp.s112_fehler('leer:' || r.tabelle, 'keine Beispielzeile (M=' || (v_z IS NOT NULL) || ', B=' || (v_zb IS NOT NULL) || ')');
        v_leer := v_leer || r.tabelle;
      END IF;
      CONTINUE;
    END IF;
    v_tabs := v_tabs || r.tabelle;
    v_klassen := v_klassen || r.klasse;
    v_sql_m := v_sql_m || format('SELECT count(*) FROM public.%I WHERE %s', r.tabelle, pg_temp.s112_pk_where(r.tabelle, v_z));
    v_sql_b := v_sql_b || format('SELECT count(*) FROM public.%I WHERE %s', r.tabelle, pg_temp.s112_pk_where(r.tabelle, v_zb));
    -- K-Listen erst nach allen Beispielzeilen (unten) – Platzhalter
    v_sql_fremd := v_sql_fremd || NULL::text;
    v_sql_fm := v_sql_fm || NULL::text;
    v_sql_fc := v_sql_fc || NULL::text;
  END LOOP;

  -- Abfragen „Zeilen anderer Betriebe“ je Blickwinkel (B, M, C) – nach allen Beispielzeilen, als postgres
  FOR r IN SELECT * FROM pg_temp.s112_mandantentabellen() WHERE klasse IN ('T', 'K') ORDER BY tabelle LOOP
    v_i := array_position(v_tabs, r.tabelle);
    CONTINUE WHEN v_i IS NULL;
    BEGIN
      v_sql_fremd[v_i] := pg_temp.t10_fremd_sql(r.tabelle, r.klasse, r.eltern_spalte, r.eltern_tabelle, r.eltern_ref, r.pk, v_b);
      v_sql_fm[v_i] := pg_temp.t10_fremd_sql(r.tabelle, r.klasse, r.eltern_spalte, r.eltern_tabelle, r.eltern_ref, r.pk, v_m);
      v_sql_fc[v_i] := pg_temp.t10_fremd_sql(r.tabelle, r.klasse, r.eltern_spalte, r.eltern_tabelle, r.eltern_ref, r.pk, v_c);
    EXCEPTION WHEN OTHERS THEN
      v_erg := v_erg || pg_temp.s112_fehler('leer_fremd:' || r.tabelle, 'Fremd-Abfrage nicht baubar: ' || SQLSTATE || ' ' || SQLERRM);
    END;
  END LOOP;

  -- Existenz als postgres belegen (sonst wäre jede „0 sichtbar“ wertlos)
  FOR v_i IN 1 .. coalesce(array_length(v_tabs, 1), 0) LOOP
    v_ist := pg_temp.s112_zaehle(v_sql_m[v_i]) || '/' || pg_temp.s112_zaehle(v_sql_b[v_i]);
    IF v_ist = '1/1' THEN
      v_erg := v_erg || pg_temp.s112_ok('existiert:' || v_tabs[v_i]);
    ELSE
      v_erg := v_erg || pg_temp.s112_fehler('leer:' || v_tabs[v_i], 'M/B-Zeile als postgres: ' || v_ist);
      v_leer := v_leer || v_tabs[v_i];
    END IF;
    -- fremde Zeilen je Blickwinkel: B- und M-Blick haben mindestens die Beispielzeile des anderen Betriebs,
    -- der C-Blick beide
    v_ist := coalesce(pg_temp.s112_zaehle(v_sql_fremd[v_i]), 'NULL');
    v_erg := v_erg || pg_temp.s112_erwarte('existiert_fremd:' || v_tabs[v_i] || ':b', v_ist ~ '^\d+$' AND v_ist::bigint >= 1, true);
    v_ist := coalesce(pg_temp.s112_zaehle(v_sql_fm[v_i]), 'NULL');
    v_erg := v_erg || pg_temp.s112_erwarte('existiert_fremd:' || v_tabs[v_i] || ':m', v_ist ~ '^\d+$' AND v_ist::bigint >= 1, true);
    v_ist := coalesce(pg_temp.s112_zaehle(v_sql_fc[v_i]), 'NULL');
    v_erg := v_erg || pg_temp.s112_erwarte('existiert_fremd:' || v_tabs[v_i] || ':c', v_ist ~ '^\d+$' AND v_ist::bigint >= 2, true);
  END LOOP;
  SELECT count(*) INTO v_n FROM pg_temp.s112_mandantentabellen() WHERE klasse IN ('T', 'K');
  v_erg := v_erg || pg_temp.s112_erwarte('katalog_t_k_mindestens_90', v_n >= 90, true);
  v_erg := v_erg || pg_temp.s112_erwarte('katalog_alle_t_k_mit_beispiel', coalesce(array_length(v_tabs, 1), 0), v_n::int);
  -- Varianten belegt (bedingte Lecks hängen sonst am Demo-Stand)
  FOREACH v_txt IN ARRAY c_varianten LOOP
    v_tab := split_part(v_txt, ':', 1);
    v_spalte := split_part(v_txt, ':', 2);
    EXECUTE format('SELECT count(DISTINCT (tenant_id, %I)) FROM public.%I WHERE tenant_id IN (%L::uuid, %L::uuid) AND %I IS NOT NULL',
                   v_spalte, v_tab, v_m, v_b, v_spalte) INTO v_n;
    v_erg := v_erg || pg_temp.s112_erwarte('variante_vorhanden:' || v_tab || ':' || v_spalte, v_n, 4::bigint);
  END LOOP;

  -- ── 1. Sweep: Personas aus B sehen keine M-Zeile und keine Zeile anderer Betriebe (vor der Keller-Freigabe)
  FOREACH v_pers IN ARRAY v_personas LOOP
    PERFORM pg_temp.s112_als((v_a ->> v_pers)::uuid);
    FOR v_i IN 1 .. coalesce(array_length(v_tabs, 1), 0) LOOP
      v_erg := v_erg || pg_temp.s112_erwarte('lesen_fremd:' || v_tabs[v_i] || ':' || v_pers, pg_temp.s112_zaehle(v_sql_m[v_i]), '0');
      IF v_sql_fremd[v_i] IS NOT NULL THEN
        v_erg := v_erg || pg_temp.s112_erwarte('fremd_tid:' || v_tabs[v_i] || ':' || v_pers, pg_temp.s112_zaehle(v_sql_fremd[v_i]), '0');
      END IF;
    END LOOP;
  END LOOP;
  -- Gegenrichtung: Personas aus M und C sehen die B-Zeile nicht und keine Zeile anderer Betriebe
  FOREACH v_pers IN ARRAY c_rueck LOOP
    PERFORM pg_temp.s112_als((v_a ->> v_pers)::uuid);
    FOR v_i IN 1 .. coalesce(array_length(v_tabs, 1), 0) LOOP
      v_erg := v_erg || pg_temp.s112_erwarte('lesen_fremd_rueck:' || v_tabs[v_i] || ':' || v_pers, pg_temp.s112_zaehle(v_sql_b[v_i]), '0');
      v_txt := CASE WHEN v_pers LIKE 'c\_%' THEN v_sql_fc[v_i] ELSE v_sql_fm[v_i] END;
      IF v_txt IS NOT NULL THEN
        v_erg := v_erg || pg_temp.s112_erwarte('fremd_tid_rueck:' || v_tabs[v_i] || ':' || v_pers, pg_temp.s112_zaehle(v_txt), '0');
      END IF;
    END LOOP;
  END LOOP;
  PERFORM pg_temp.s112_als_postgres();

  -- ── 2. Positivkontrollen (ohne sie ist jede 0 wertlos → leer:<tab>) ───────────────────────────────────
  FOREACH v_pers IN ARRAY ARRAY['m_ta', 'b_ta'] LOOP
    PERFORM pg_temp.s112_als((v_a ->> v_pers)::uuid);
    FOR v_i IN 1 .. coalesce(array_length(v_tabs, 1), 0) LOOP
      v_ist := pg_temp.s112_zaehle(CASE WHEN v_pers = 'm_ta' THEN v_sql_m[v_i] ELSE v_sql_b[v_i] END);
      IF v_tabs[v_i] = ANY (c_niemand) THEN
        -- niemand liest per API; Existenz ist oben als postgres belegt
        v_erg := v_erg || pg_temp.s112_erwarte('lesen_niemand:' || v_tabs[v_i] || ':' || v_pers, v_ist, '0');
      ELSIF v_ist = '1' THEN
        v_erg := v_erg || pg_temp.s112_ok('positiv:' || v_tabs[v_i] || ':' || v_pers);
      ELSE
        v_erg := v_erg || pg_temp.s112_fehler('leer:' || v_tabs[v_i], v_pers || ' sieht die eigene Zeile nicht (ist=' || v_ist || ')');
      END IF;
    END LOOP;
  END LOOP;
  -- Rollen- und Eigentümerbeschränkungen innerhalb von B (Winzer/Leser sehen die B-Zeile von b_ta nicht)
  FOREACH v_pers IN ARRAY ARRAY['b_w', 'b_l'] LOOP
    PERFORM pg_temp.s112_als((v_a ->> v_pers)::uuid);
    FOR v_i IN 1 .. coalesce(array_length(v_tabs, 1), 0) LOOP
      IF v_tabs[v_i] = ANY (c_eigner || c_nur_admin || c_niemand) THEN
        v_erg := v_erg || pg_temp.s112_erwarte('rolle_lesen:' || v_tabs[v_i] || ':' || v_pers, pg_temp.s112_zaehle(v_sql_b[v_i]), '0');
      ELSIF v_tabs[v_i] = ANY (c_mitglied_liest) THEN
        v_erg := v_erg || pg_temp.s112_erwarte('rolle_lesen_mitglied:' || v_tabs[v_i] || ':' || v_pers, pg_temp.s112_zaehle(v_sql_b[v_i]), '1');
      END IF;
    END LOOP;
  END LOOP;

  -- ── 3. Globale Zeilen (tenant_id NULL) für b_w sichtbar ───────────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  SELECT count(*) INTO v_n FROM public.ea_kategorien WHERE tenant_id IS NULL;
  v_erg := v_erg || pg_temp.s112_erwarte('global_vorhanden:ea_kategorien_mind_21', v_n >= 21, true);
  FOREACH v_tab IN ARRAY ARRAY['ea_kategorien', 'duengemittel', 'pflanzenschutzmittel', 'saetze_massnahmen'] LOOP
    PERFORM pg_temp.s112_als_postgres();
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id IS NULL', v_tab) INTO v_n;
    v_erg := v_erg || pg_temp.s112_erwarte('global_vorhanden:' || v_tab, v_n > 0, true);
    PERFORM pg_temp.s112_als(v_b_w);
    v_erg := v_erg || pg_temp.s112_erwarte('global_sichtbar:' || v_tab,
      pg_temp.s112_zaehle(format('SELECT count(*) FROM public.%I WHERE tenant_id IS NULL', v_tab)), v_n::text);
  END LOOP;

  -- ── 4. Sonderfälle ────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  SELECT count(*) INTO v_n FROM public.tenants WHERE id IN (v_m, v_b, v_c);
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_vorhanden', v_n, 3::bigint);
  SELECT count(*) INTO v_n FROM public.tenant_memberships WHERE tenant_id = v_b;
  SELECT count(*) INTO v_n2 FROM public.tenant_memberships m JOIN public.plattform_admins p ON p.user_id = m.user_id WHERE m.tenant_id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('tm_pa_automatisch_in_b', v_n2 >= 2, true);
  SELECT count(*) INTO v_ist FROM public.plattform_admins;
  v_erg := v_erg || pg_temp.s112_erwarte('plattform_admins_vorhanden', v_ist::int >= 2, true);
  SELECT count(*) INTO v_txt FROM public.profiles WHERE id = v_m_ta;
  v_erg := v_erg || pg_temp.s112_erwarte('profil_m_ta_vorhanden', v_txt, '1');

  PERFORM pg_temp.s112_als(v_b_ta);
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_b_ta_genau_eine', pg_temp.s112_zaehle('SELECT count(*) FROM public.tenants'), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_b_ta_eigener',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.tenants WHERE id = %L::uuid', v_b)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('tm_b_ta_alle_b_zeilen', pg_temp.s112_zaehle('SELECT count(*) FROM public.tenant_memberships'), v_n::text);
  v_erg := v_erg || pg_temp.s112_erwarte('tm_b_ta_pa_zeilen',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.tenant_memberships WHERE tenant_id = %L::uuid AND role = %L', v_b, 'system_admin')), v_n2::text);
  v_erg := v_erg || pg_temp.s112_erwarte('plattform_admins_b_ta', pg_temp.s112_zaehle('SELECT count(*) FROM public.plattform_admins'), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('release_note_inaktiv_b_ta',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.release_notes WHERE id = %L::uuid', v_rn)), '0');
  -- Gegenrichtung für tenants: m_ta und c_ta sehen genau den eigenen Betrieb
  PERFORM pg_temp.s112_als(v_m_ta);
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_m_ta_genau_eine', pg_temp.s112_zaehle('SELECT count(*) FROM public.tenants'), '1');
  PERFORM pg_temp.s112_als(v_c_ta);
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_c_ta_genau_eine', pg_temp.s112_zaehle('SELECT count(*) FROM public.tenants'), '1');

  PERFORM pg_temp.s112_als(v_b_w);
  v_erg := v_erg || pg_temp.s112_erwarte('tm_b_w_nur_eigene', pg_temp.s112_zaehle('SELECT count(*) FROM public.tenant_memberships'), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('tm_b_w_eigene_zeile',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.tenant_memberships WHERE user_id = %L::uuid', v_b_w)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('tm_b_w_nicht_b_ta',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.tenant_memberships WHERE user_id = %L::uuid', v_b_ta)), '0');
  v_ist := pg_temp.s112_zaehle('SELECT count(*) FROM public.rebsorten');
  v_erg := v_erg || pg_temp.s112_erwarte('rebsorten_b_w_mind_25', v_ist ~ '^\d+$' AND v_ist::int >= 25, true);
  v_ist := pg_temp.s112_zaehle('SELECT count(*) FROM public.svs_parameter');
  v_erg := v_erg || pg_temp.s112_erwarte('svs_parameter_b_w_mind_1', v_ist ~ '^\d+$' AND v_ist::int >= 1, true);
  v_erg := v_erg || pg_temp.s112_erwarte('rng_fremd_b_w',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.release_notes_gesehen WHERE user_id = %L::uuid', v_m_ta)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('profil_eigenes_b_w',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.profiles WHERE id = %L::uuid', v_b_w)), '1');
  -- KAN-159 B3: Profile nur im eigenen Umfeld (gemeinsame Betriebe), nicht plattformweit
  v_erg := v_erg || pg_temp.s112_erwarte('profil_fremder_betrieb_b_w',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.profiles WHERE id = %L::uuid', v_m_ta)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('profil_gleicher_betrieb_b_w',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.profiles WHERE id = %L::uuid', v_b_ta)), '1');

  PERFORM pg_temp.s112_als(v_m_ta);
  v_erg := v_erg || pg_temp.s112_erwarte('rng_eigen_m_ta',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.release_notes_gesehen WHERE user_id = %L::uuid', v_m_ta)), '1');
  PERFORM pg_temp.s112_als(v_pa);
  v_erg := v_erg || pg_temp.s112_erwarte('release_note_inaktiv_pa',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.release_notes WHERE id = %L::uuid', v_rn)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('plattform_admins_pa_eigene',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.plattform_admins WHERE user_id = %L::uuid', v_pa)), '1');

  -- Views in public mit tenant_id: b_w sieht keine M-Zeilen (nur wenn M dort Zeilen hat)
  PERFORM pg_temp.s112_als_postgres();
  FOR r IN SELECT c.relname::text AS v FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
              AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
            ORDER BY 1 LOOP
    PERFORM pg_temp.s112_als_postgres();
    v_ist := pg_temp.s112_zaehle(format('SELECT count(*) FROM public.%I WHERE tenant_id = %L::uuid', r.v, v_m));
    IF v_ist IN ('0', 'G') THEN
      v_erg := v_erg || pg_temp.s112_fehler('leer:' || r.v, 'View ohne M-Zeilen als postgres (ist=' || v_ist || ')');
      CONTINUE;
    END IF;
    PERFORM pg_temp.s112_als(v_b_w);
    v_erg := v_erg || pg_temp.s112_erwarte('view_fremd:' || r.v || ':b_w',
      pg_temp.s112_zaehle(format('SELECT count(*) FROM public.%I WHERE tenant_id = %L::uuid', r.v, v_m)), '0');
  END LOOP;

  -- ── 5. Kellergemeinschaft (einziger gewollter mandantenübergreifender Lesepfad) ───────────────────────
  PERFORM pg_temp.s112_als_postgres();
  SELECT id INTO v_beh_ng FROM public.behaelter WHERE tenant_id = v_m ORDER BY id LIMIT 1;
  UPDATE public.behaelter SET gemeinsam = false WHERE id = v_beh_ng;
  SELECT id INTO v_beh_g FROM public.behaelter WHERE tenant_id = v_m AND gemeinsam ORDER BY id LIMIT 1;
  SELECT count(*) INTO v_n_gem FROM public.behaelter WHERE tenant_id = v_m AND gemeinsam;
  v_erg := v_erg || pg_temp.s112_erwarte('keller_gemeinsame_vorhanden', v_n_gem > 0 AND v_beh_g IS NOT NULL, true);
  v_erg := v_erg || pg_temp.s112_erwarte('keller_nicht_gemeinsamer_vorhanden',
    (SELECT count(*) FROM public.behaelter WHERE id = v_beh_ng AND NOT gemeinsam), 1::bigint);
  SELECT count(*) INTO v_n FROM public.keller_freigaben WHERE v_m IN (eigentuemer_tenant_id, nutzer_tenant_id) OR v_b IN (eigentuemer_tenant_id, nutzer_tenant_id);
  v_erg := v_erg || pg_temp.s112_erwarte('keller_vorher_keine_freigabe', v_n, 0::bigint);
  INSERT INTO public.keller_freigaben (eigentuemer_tenant_id, nutzer_tenant_id, aktiv, notizen)
  VALUES (v_m, v_b, true, 'S112TEST Freigabe') RETURNING id INTO v_kf;
  -- KAN-212: inaktive CRM-Freigabe (nur damit die Tabelle für die anon-Prüfung eine Zeile hat; wirkt nicht – DB-Test 43)
  INSERT INTO public.crm_freigaben (eigentuemer_tenant_id, nutzer_tenant_id, aktiv, notizen)
  VALUES (v_m, v_b, false, 'S112TEST inaktiv');
  FOREACH v_tab IN ARRAY ARRAY['weinausbau', 'keller_behandlungen', 'weinanalysen'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id = %L::uuid', v_tab, v_m) INTO v_n;
    v_erg := v_erg || pg_temp.s112_erwarte('keller_m_daten_vorhanden:' || v_tab, v_n > 0, true);
  END LOOP;
  SELECT upd_spalte INTO v_upd FROM pg_temp.s112_mandantentabellen() WHERE tabelle = 'behaelter';

  -- a) Freigabe M → B aktiv
  PERFORM pg_temp.s112_als(v_b_w);
  v_erg := v_erg || pg_temp.s112_erwarte('keller_gemeinsam_sichtbar:b_w',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.behaelter WHERE tenant_id = %L::uuid', v_m)), v_n_gem::text);
  v_erg := v_erg || pg_temp.s112_erwarte('keller_nicht_gemeinsam:b_w',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.behaelter WHERE id = %L::uuid', v_beh_ng)), '0');
  FOREACH v_tab IN ARRAY ARRAY['weinausbau', 'keller_behandlungen', 'weinanalysen'] LOOP
    v_erg := v_erg || pg_temp.s112_erwarte('keller_kein_weiterer_pfad:' || v_tab,
      pg_temp.s112_zaehle(format('SELECT count(*) FROM public.%I WHERE tenant_id = %L::uuid', v_tab, v_m)), '0');
  END LOOP;
  -- mit aktiver Freigabe öffnet sich außer behaelter keine andere Tabelle
  FOR v_i IN 1 .. coalesce(array_length(v_tabs, 1), 0) LOOP
    IF v_tabs[v_i] <> 'behaelter' THEN
      v_erg := v_erg || pg_temp.s112_erwarte('keller_fremd_m:' || v_tabs[v_i], pg_temp.s112_zaehle(v_sql_m[v_i]), '0');
      IF v_sql_fremd[v_i] IS NOT NULL THEN
        v_erg := v_erg || pg_temp.s112_erwarte('keller_fremd_tid:' || v_tabs[v_i], pg_temp.s112_zaehle(v_sql_fremd[v_i]), '0');
      END IF;
    END IF;
  END LOOP;
  v_erg := v_erg || pg_temp.s112_erwarte('keller_update_fremd:b_w',
    pg_temp.s112_versuch(format('UPDATE public.behaelter SET %I = %I WHERE id = %L::uuid', v_upd, v_upd, v_beh_g)), 'k0');
  PERFORM pg_temp.s112_als(v_b_ta);
  v_erg := v_erg || pg_temp.s112_erwarte('keller_gemeinsam_sichtbar:b_ta',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.behaelter WHERE id = %L::uuid', v_beh_g)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('keller_update_fremd:b_ta',
    pg_temp.s112_versuch(format('UPDATE public.behaelter SET %I = %I WHERE id = %L::uuid', v_upd, v_upd, v_beh_g)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('keller_delete_fremd:b_ta',
    pg_temp.s112_versuch(format('DELETE FROM public.behaelter WHERE id = %L::uuid', v_beh_g)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('keller_freigabe_nutzer_sichtbar:b_ta',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.keller_freigaben WHERE id = %L::uuid', v_kf)), '1');
  PERFORM pg_temp.s112_als(v_m_ta);
  v_erg := v_erg || pg_temp.s112_erwarte('keller_freigabe_eigentuemer_sichtbar:m_ta',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.keller_freigaben WHERE id = %L::uuid', v_kf)), '1');
  PERFORM pg_temp.s112_als(v_c_ta);
  v_erg := v_erg || pg_temp.s112_erwarte('keller_freigabe_fremd:c_ta',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.keller_freigaben WHERE id = %L::uuid', v_kf)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('keller_ohne_freigabe:c_ta',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.behaelter WHERE tenant_id = %L::uuid', v_m)), '0');

  -- b) Freigabe inaktiv
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.keller_freigaben SET aktiv = false WHERE id = v_kf;
  PERFORM pg_temp.s112_als(v_b_w);
  v_erg := v_erg || pg_temp.s112_erwarte('keller_inaktiv:b_w',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.behaelter WHERE tenant_id = %L::uuid', v_m)), '0');

  -- c) Freigabe an Betrieb C (aktiv) – B sieht nichts, C sieht die gemeinsamen Behälter
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.keller_freigaben SET nutzer_tenant_id = v_c, aktiv = true WHERE id = v_kf;
  PERFORM pg_temp.s112_als(v_b_w);
  v_erg := v_erg || pg_temp.s112_erwarte('keller_freigabe_an_c:b_w',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.behaelter WHERE tenant_id = %L::uuid', v_m)), '0');
  PERFORM pg_temp.s112_als(v_b_ta);
  v_erg := v_erg || pg_temp.s112_erwarte('keller_freigabe_an_c_unsichtbar:b_ta',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.keller_freigaben WHERE id = %L::uuid', v_kf)), '0');
  PERFORM pg_temp.s112_als(v_c_ta);
  v_erg := v_erg || pg_temp.s112_erwarte('keller_freigabe_an_c:c_ta',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.behaelter WHERE tenant_id = %L::uuid', v_m)), v_n_gem::text);
  v_erg := v_erg || pg_temp.s112_erwarte('keller_nicht_gemeinsam:c_ta',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.behaelter WHERE id = %L::uuid', v_beh_ng)), '0');

  -- ── 6. anon: jede Relation in public → 0 Zeilen oder „permission denied for table“ ───────────────────
  PERFORM pg_temp.s112_als_postgres();
  FOR r IN SELECT c.relname::text AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') ORDER BY 1 LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', r.t) INTO v_n;
    v_anon_tabs := v_anon_tabs || r.t;
    v_anon_pg := v_anon_pg || v_n;
  END LOOP;
  PERFORM pg_temp.s112_als(NULL, 'anon');
  FOR v_i IN 1 .. coalesce(array_length(v_anon_tabs, 1), 0) LOOP
    v_anon_ist := v_anon_ist || pg_temp.t10_zaehle_text(format('SELECT count(*) FROM public.%I', v_anon_tabs[v_i]));
  END LOOP;
  v_erg := v_erg || pg_temp.s112_erwarte('anon_te_erlaubte_spalte',
    pg_temp.s112_versuch('SELECT betrieb_name FROM public.tenant_einstellungen'), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('anon_te_stern_verweigert',
    pg_temp.s112_versuch('SELECT * FROM public.tenant_einstellungen'), 'G');
  PERFORM pg_temp.s112_als_postgres();
  FOR v_i IN 1 .. coalesce(array_length(v_anon_tabs, 1), 0) LOOP
    v_tab := v_anon_tabs[v_i];
    v_ist := v_anon_ist[v_i];
    IF v_anon_pg[v_i] = 0 THEN
      v_erg := v_erg || pg_temp.s112_fehler('leer_anon:' || v_tab, 'keine Zeilen als postgres – anon-Prüfung wertlos (anon ist=' || v_ist || ')');
    ELSIF v_tab = 'rebsorten' THEN
      v_erg := v_erg || pg_temp.s112_erwarte('anon_lesen:rebsorten_gewollt', v_ist, v_anon_pg[v_i]::text);
    ELSIF v_ist = '0' THEN
      v_erg := v_erg || pg_temp.s112_ok('anon_lesen:' || v_tab);
    ELSIF v_ist IN ('42501: permission denied for table ' || v_tab, '42501: permission denied for view ' || v_tab) THEN   -- KAN-192: Sicht charge_herkunft
      v_anon_g := v_anon_g || v_tab;
      v_erg := v_erg || pg_temp.s112_ok('anon_lesen:' || v_tab);
    ELSE
      v_erg := v_erg || pg_temp.s112_fehler('anon_lesen:' || v_tab, 'ist=' || v_ist || ' (erlaubt: 0 oder permission denied for table)');
    END IF;
  END LOOP;
  v_erg := v_erg || pg_temp.s112_erwarte('anon_ohne_grant_liste',
    (SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM unnest(v_anon_g) x)::text,
    (SELECT array_agg(x ORDER BY x) FROM unnest(c_anon_ohne_grant) x)::text);
  v_erg := v_erg || pg_temp.s112_erwarte('anon_relationen_mind_100', coalesce(array_length(v_anon_tabs, 1), 0) >= 100, true);

  -- ── 7. Ist-Stand Modul-Schalter: Lesen hängt an keinem Modul ─────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  SELECT string_agg(format('%I = false', a.attname), ', ') INTO v_txt
    FROM pg_attribute a WHERE a.attrelid = 'public.tenant_einstellungen'::regclass AND a.attname LIKE 'modul\_%'
     AND a.atttypid = 'boolean'::regtype AND NOT a.attisdropped;
  EXECUTE format('UPDATE public.tenant_einstellungen SET %s WHERE tenant_id = %L::uuid', v_txt, v_m);
  UPDATE public.module_flags SET aktiv = false WHERE tenant_id = v_m;
  FOREACH v_tab IN ARRAY v_modtab LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id = %L::uuid', v_tab, v_m) INTO v_n;
    v_modsoll := v_modsoll || v_n;
  END LOOP;
  v_abw := '';
  FOREACH v_pers IN ARRAY ARRAY['m_l', 'm_w0'] LOOP
    PERFORM pg_temp.s112_als((v_a ->> v_pers)::uuid);
    FOR v_i IN 1 .. array_length(v_modtab, 1) LOOP
      v_ist := pg_temp.s112_zaehle(format('SELECT count(*) FROM public.%I WHERE tenant_id = %L::uuid', v_modtab[v_i], v_m));
      IF v_modsoll[v_i] = 0 OR v_ist IS DISTINCT FROM v_modsoll[v_i]::text THEN
        v_abw := v_abw || v_pers || '/' || v_modtab[v_i] || '=' || v_ist || '(soll ' || v_modsoll[v_i] || ') ';
      END IF;
    END LOOP;
  END LOOP;
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('lesen_alle_module', v_abw, '');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 2200);
END
$test$;
