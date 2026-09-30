-- @bereich: Sperren, Protokoll- und Konsistenz-Trigger
-- @ziel: Was die Datenbank als Sperre durchsetzt, hält: ea_transaktionen.is_locked (weder ändern, löschen, sperren
-- @ziel: noch entsperren durch Benutzer; sperre_ea_monat/sperre_ea_uva wirken), AMA-Status (bestätigte Meldung und
-- @ziel: ihre Positionen unveränderlich), TRUNCATE-Verbot auf den 20 Protokolltabellen, Bestandsprotokoll (UPDATE
-- @ziel: überwachter Spalten und DELETE werden mit Mandant, Benutzer und Rolle protokolliert, kein Bypass für
-- @ziel: Benutzer oder echte Mandanten, Tabelle für Benutzer nur lesbar) sowie die Mandantengleichheit von Gebinden
-- @ziel: (weinausbau_gebinde_pruefen, Kellergemeinschaft) und Anlagen/Buchungen (trg_ea_*_tenant); keller_freigaben
-- @ziel: sind für Benutzer nicht schreibbar. Was nur die App prüft (Periodensperren, Storno, Jahrgangsabschluss,
-- @ziel: Löschen bestätigter AMA-Meldungen), steht als bekannte Lücke (B7, B8) mit Ratsche im Bericht.
-- @mutation is_locked_offen: ea_tx_update ohne NOT is_locked | rot: ea_locked_.*|ea_sperren_offen
-- @mutation ama_status_offen: UPDATE-Policy der AMA-Meldung ohne Statusprüfung | rot: ama_bestaetigt_update
-- @mutation ama_pos_delete_offen: DELETE-Policy auf ama_meldepositionen ohne Statusprüfung | rot: ama_pos_delete_bestaetigt
-- @mutation truncate_trigger_weg: DROP TRIGGER z_protokoll_truncate auf keller_umzuege | rot: truncate(_|:).*
-- @mutation protokoll_aendern_weg: DROP TRIGGER z_protokoll_aendern auf weinausbau | rot: protokoll_update_.*
-- @mutation protokoll_loeschen_weg: DROP TRIGGER z_protokoll_loeschen auf keller_umzuege | rot: protokoll_delete_.*|bypass_.*|bp_select_.*
-- @mutation gebinde_offen: weinausbau_gebinde_pruefen lässt alles durch | rot: gebinde_.*
-- @mutation gebinde_freigabe_inaktiv: weinausbau_gebinde_pruefen ignoriert keller_freigaben.aktiv | rot: gebinde_gemeinsam_freigabe_inaktiv
-- @mutation sperre_monat_fremd: sperre_ea_monat prüft den eigenen Admin-Betrieb statt p_tenant_id | rot: ea_sperre_monat_fremd
-- @mutation anlage_tenant_offen: trg_ea_transaktion_anlage_tenant lässt fremde Anlagen zu | rot: anlage_fremd
-- @mutation freigaben_schreibbar: PERMISSIVE-Policy ALL USING/WITH CHECK (true) auf keller_freigaben | rot: freigabe_.*
-- @mutation kind_tenant_ama_weg: bestandsprotokoll_schreiben() ohne CASE-Zweig ama_meldepositionen (kein Ersatzweg) – Protokollzeile mit tenant_id NULL | rot: protokoll_kind_tenant:.*
--
-- software:112 – SQL-Testsuite, Datei 20 (Stand 28.09.2026). Nur Staging; die ganze Datei ist EINE Transaktion
-- und endet mit pg_temp.s112_ende(…) = RAISE → nichts bleibt (Ausnahme: bestandsprotokoll_id_seq ist nicht
-- transaktional, es entstehen harmlose Nummernlücken).
--
-- Alle Beispieldaten legt die Datei selbst an (als postgres, im Musterhof M = v_a ->> 'm' bzw. in B): gesperrte
-- Buchung, gesperrte UVA und Monatsabschluss 2032, bestätigte AMA-Meldung samt Position, abgeschlossener
-- Jahrgang, stornierter Verkaufsposten, Wein mit Menge, gemeinsamer belegter Behälter – unabhängig vom
-- Demo-Datenstand (ein Demo-Reset macht den Test nicht rot).
--
-- Geprüft:
--   1. E&A: is_locked-Buchung als m_ta weder änderbar noch löschbar (k0), sperren (R) und entsperren (k0) geht
--      nicht; sperre_ea_monat sperrt alle Buchungen des Monats und legt ea_monatsabschluss an; sperre_ea_uva
--      verlangt vollständige Monatsabschlüsse (P0001) und sperrt sonst UVA und Buchungen; m_w darf nicht sperren,
--      b_ta keinen Monat von M (T, danach kein Abschluss für M angelegt).
--   2. AMA: bestätigte Meldung und ihre Positionen sind unveränderlich (k0/R; Positionen auch nicht löschbar),
--      unter einem Entwurf erlaubt (k1).
--   3. Bekannte Lücken B7/B8 (Ratsche s112_luecke, Planungsprobe 28.09.2026 jeweils k1).
--   4. Bestandsprotokoll: UPDATE überwachter Spalte (aus pg_trigger.tgargs) → genau 1 Zeile mit Mandant, Tabelle,
--      Aktion, Spalten, Benutzer und db_rolle; nicht überwachte Spalte → 0; DELETE mit alt; Kindzeile
--      (pressung_behaelter) mit Mandant über die Eltern; dazu dynamisch JEDE Protokolltabelle ohne tenant_id
--      (s112_soll_liste('protokoll_tabellen'), also auch künftige Kindtabellen): Beispielzeile in B löschen →
--      genau eine Protokollzeile mit tenant_id = B (protokoll_kind_tenant:<tab>); Bypass s112.protokoll_aus nur als
--      postgres für den Musterhof; authenticated hat auf bestandsprotokoll nur SELECT (nur SA/TA/PA sehen Zeilen).
--   5. Mandantengleichheit: Gebinde fremder Betriebe (nicht gemeinsam, ohne Freigabe, nur inaktive Freigabe,
--      belegt) → P0001; gemeinsames leeres Gebinde mit aktiver Freigabe → erlaubt; Anlage/Buchung eines fremden
--      Betriebs → P0001.
--   6. keller_freigaben: b_ta sieht die Freigabe, schreibt sie aber nicht (R/k0).
--   7. TRUNCATE als postgres auf jeder Protokolltabelle → 42501 (bei FK-Verweisen mit CASCADE, damit der
--      Trigger und nicht die FK-Prüfung antwortet), Zeilenzahl unverändert – zum Schluss, weil ein Erfolg
--      (Mutation) die Tabelle bis zum Ende leert.

-- Führt p_sql aus und rollt die Wirkung SOFORT zurück. Ergebnis 'ok:<n>' oder '<SQLSTATE>: <Meldung>'.
CREATE FUNCTION pg_temp.t20_probe(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v_n bigint;
  v_state text;
  v_msg text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'S1T20', MESSAGE = v_n::text;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    IF v_state = 'S1T20' THEN
      RETURN 'ok:' || v_msg;
    END IF;
    RETURN v_state || ': ' || v_msg;
  END;
END $f$;

-- p_ist passt auf das LIKE-Muster → p_kurz, sonst p_ist (als Beleg im FEHLER).
CREATE FUNCTION pg_temp.t20_muster(p_ist text, p_like text, p_kurz text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN p_ist LIKE p_like THEN p_kurz ELSE coalesce(p_ist, 'NULL') END
$f$;

-- Protokollzeilen zu einem Datensatz (als postgres).
CREATE FUNCTION pg_temp.t20_bp(p_tab text, p_id uuid) RETURNS bigint LANGUAGE sql STABLE AS $f$
  SELECT count(*) FROM public.bestandsprotokoll b WHERE b.tabelle = p_tab AND b.datensatz_id = p_id
$f$;

-- Überwachte Spalten eines z_protokoll_aendern-Triggers (Trigger-Argumente aus pg_trigger.tgargs).
CREATE FUNCTION pg_temp.t20_tgargs(p_tab text) RETURNS text[] LANGUAGE sql STABLE AS $f$
  SELECT coalesce(array_remove(regexp_split_to_array(encode(t.tgargs, 'escape'), '\\000'), ''), '{}'::text[])
    FROM pg_trigger t
   WHERE t.tgrelid = to_regclass(format('public.%I', p_tab)) AND t.tgname = 'z_protokoll_aendern' AND NOT t.tgisinternal
$f$;

-- Mutationshilfe: ersetzt in der Definition von p_fn das Muster p_muster durch p_ersatz und legt die Funktion
-- neu an; greift das Muster nicht, bricht sie ab (sonst liefe die Mutation unbemerkt ins Leere).
CREATE FUNCTION pg_temp.t20_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't20_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

DO $test$
DECLARE
  c_datei      constant text := '20_sperren_protokoll_trigger';
  v_m          uuid;
  v_t0         timestamptz := clock_timestamp();
  v_erg        text[] := '{}';
  v_a          jsonb;
  v_b          uuid;
  v_mta        uuid;
  v_mw         uuid;
  v_bta        uuid;
  v_n          bigint;
  v_n2         bigint;
  v_txt        text;
  v_arr        text[];
  v_t1         text;
  v_t2         text;
  v_t3         text;
  v_z          jsonb;
  r            record;
  -- E&A
  v_tx_locked  uuid;
  v_tx_offen   uuid;
  v_tx_jan     uuid;
  v_tx_feb     uuid;
  v_tx_mai     uuid;
  v_tx_mai_z   jsonb;
  v_uva_neu    uuid;
  v_uva_gesp   uuid;
  v_ma         uuid;
  v_ma_datum   date;
  -- AMA
  v_ama_best   uuid;
  v_ama_entw   uuid;
  v_pos_best   jsonb;
  v_pos_entw   jsonb;
  -- sonstige Sperren
  v_jg_abg     uuid;
  v_jg_ama     uuid;
  v_vp_storno  uuid;
  v_beh_m      uuid;
  -- Protokoll
  v_wa_m       uuid;
  v_spalte_frei text;
  v_ku         uuid[] := '{}';
  v_ku_b1      uuid;
  v_ku_b2      uuid;
  v_pb         uuid;
  v_bp         record;
  -- Mandantengleichheit
  v_beh_ng     uuid;
  v_beh_gl     uuid;
  v_beh_bel    uuid;
  v_wa_b       uuid;
  v_freigabe   uuid;
  v_anl_m      uuid;
  v_anl_b      uuid;
  v_tx_b       uuid;
  v_tx_m       uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();

  -- ── 0. Aufbau (als postgres) ─────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_m := (v_a ->> 'm')::uuid;
  v_b := (v_a ->> 'b')::uuid;
  v_mta := (v_a ->> 'm_ta')::uuid;
  v_mw := (v_a ->> 'm_w')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;

  -- E&A: eigene gesperrte Buchung, gesperrte UVA und Monatsabschluss 2032/06 im Musterhof
  v_tx_locked := (pg_temp.s112_beispiel('ea_transaktionen', v_m, v_mta, '{"datum": "2032-06-15", "is_locked": "true"}') ->> 'id')::uuid;
  v_uva_gesp := (pg_temp.s112_zeile('ea_uva', v_m, '{"jahr": "2032", "zeitraum": "Q2", "gesperrt": "true"}') ->> 'id')::uuid;
  v_ma := (pg_temp.s112_zeile('ea_monatsabschluss', v_m, '{"jahr": "2032", "monat": "6"}') ->> 'id')::uuid;
  v_ma_datum := DATE '2032-06-15';
  -- eigene offene Buchungen 2031 (Monate ohne Abschluss) und eine offene UVA 2031 Q1
  v_tx_jan := (pg_temp.s112_beispiel('ea_transaktionen', v_m, v_mta, '{"datum": "2031-01-15", "is_locked": "false"}') ->> 'id')::uuid;
  v_tx_feb := (pg_temp.s112_beispiel('ea_transaktionen', v_m, v_mta, '{"datum": "2031-02-15", "is_locked": "false"}') ->> 'id')::uuid;
  v_tx_offen := (pg_temp.s112_beispiel('ea_transaktionen', v_m, v_mta, '{"datum": "2031-03-15", "is_locked": "false"}') ->> 'id')::uuid;
  v_tx_mai_z := pg_temp.s112_beispiel('ea_transaktionen', v_m, v_mta, '{"datum": "2031-05-10", "is_locked": "false"}');
  v_tx_mai := (v_tx_mai_z ->> 'id')::uuid;
  v_uva_neu := (pg_temp.s112_zeile('ea_uva', v_m, '{"jahr": "2031", "zeitraum": "Q1", "gesperrt": "false"}') ->> 'id')::uuid;

  -- abgeschlossener Jahrgang (eigener, nächstes freies Jahr), stornierter Verkaufsposten
  v_jg_abg := (pg_temp.s112_zeile('weinjahrgaenge', v_m, '{"abgeschlossen": "true"}') ->> 'id')::uuid;
  v_vp_storno := (pg_temp.s112_beispiel('verkaufsposten', v_m, v_mta, '{"storniert": "true"}') ->> 'id')::uuid;

  -- AMA: eigene Meldung mit Position, danach bestätigt (eigener Jahrgang, UNIQUE tenant_id/jahrgang_id);
  -- eigener Entwurf samt Position
  v_jg_ama := (pg_temp.s112_zeile('weinjahrgaenge', v_m) ->> 'id')::uuid;
  v_ama_best := (pg_temp.s112_beispiel('ama_erntemeldungen', v_m, v_mta, jsonb_build_object('jahrgang_id', v_jg_ama)) ->> 'id')::uuid;
  v_pos_best := pg_temp.s112_zeile('ama_meldepositionen', v_m, jsonb_build_object('meldung_id', v_ama_best));
  UPDATE public.ama_erntemeldungen SET status = 'bestaetigt' WHERE id = v_ama_best;
  v_ama_entw := (pg_temp.s112_beispiel('ama_erntemeldungen', v_m, v_mta) ->> 'id')::uuid;
  v_pos_entw := pg_temp.s112_zeile('ama_meldepositionen', v_m, jsonb_build_object('meldung_id', v_ama_entw));

  -- Protokoll: eigener Wein im Musterhof mit Menge in einem eigenen Behälter, eigene keller_umzuege (3 × M, 2 × B),
  -- eigene pressung_behaelter
  v_beh_m := (pg_temp.s112_zeile('behaelter', v_m, '{"name": "S112TEST eigen", "gemeinsam": "false"}') ->> 'id')::uuid;
  v_wa_m := (pg_temp.s112_beispiel('weinausbau', v_m, v_mta,
               jsonb_build_object('menge_liter', 100, 'aktiv', true, 'behaelter_id', v_beh_m)) ->> 'id')::uuid;
  v_ku := ARRAY[(pg_temp.s112_beispiel('keller_umzuege', v_m, v_mta) ->> 'id')::uuid,
                (pg_temp.s112_beispiel('keller_umzuege', v_m, v_mta) ->> 'id')::uuid,
                (pg_temp.s112_beispiel('keller_umzuege', v_m, v_mta) ->> 'id')::uuid];
  v_ku_b1 := (pg_temp.s112_beispiel('keller_umzuege', v_b, v_bta) ->> 'id')::uuid;
  v_ku_b2 := (pg_temp.s112_beispiel('keller_umzuege', v_b, v_bta) ->> 'id')::uuid;
  v_pb := (pg_temp.s112_beispiel('pressung_behaelter', v_m, v_mta) ->> 'id')::uuid;
  SELECT a.attname::text INTO v_spalte_frei FROM pg_attribute a
   WHERE a.attrelid = 'public.weinausbau'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
     AND a.atttypid = 'text'::regtype AND NOT (a.attname::text = ANY (pg_temp.t20_tgargs('weinausbau')))
     AND has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
   ORDER BY (a.attname = 'notizen') DESC, a.attnum LIMIT 1;

  -- Mandantengleichheit: M-Behälter nicht gemeinsam, M-Behälter gemeinsam und leer, gemeinsam und von M belegt
  v_beh_ng := (pg_temp.s112_zeile('behaelter', v_m, '{"name": "S112TEST nicht gemeinsam", "gemeinsam": "false"}') ->> 'id')::uuid;
  v_beh_gl := (pg_temp.s112_zeile('behaelter', v_m, '{"name": "S112TEST gemeinsam leer", "gemeinsam": "true"}') ->> 'id')::uuid;
  v_beh_bel := (pg_temp.s112_zeile('behaelter', v_m, '{"name": "S112TEST gemeinsam belegt", "gemeinsam": "true"}') ->> 'id')::uuid;
  PERFORM pg_temp.s112_beispiel('weinausbau', v_m, v_mta,
            jsonb_build_object('menge_liter', 100, 'aktiv', true, 'behaelter_id', v_beh_bel));
  v_wa_b := (pg_temp.s112_beispiel('weinausbau', v_b, v_bta, '{"menge_liter": "100", "aktiv": "true"}') ->> 'id')::uuid;
  v_anl_m := (pg_temp.s112_zeile('ea_anlagen', v_m) ->> 'id')::uuid;
  v_anl_b := (pg_temp.s112_beispiel('ea_anlagen', v_b, v_bta) ->> 'id')::uuid;
  v_tx_b := (pg_temp.s112_beispiel('ea_transaktionen', v_b, v_bta) ->> 'id')::uuid;
  v_tx_m := v_tx_mai;

  -- Belege: die Beispielzeilen existieren (sonst wären k0/0-Ergebnisse unten wertlos)
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_tx_locked', (SELECT count(*) FROM public.ea_transaktionen WHERE id = v_tx_locked AND is_locked), 1::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_uva_gesperrt', (SELECT count(*) FROM public.ea_uva WHERE id = v_uva_gesp AND gesperrt), 1::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_monatsabschluss', v_ma IS NOT NULL AND v_ma_datum IS NOT NULL, true);
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_ama_bestaetigt',
    (SELECT status FROM public.ama_erntemeldungen WHERE id = v_ama_best) || '/' || (v_pos_best IS NOT NULL), 'bestaetigt/true');
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_ama_entwurf', (SELECT status FROM public.ama_erntemeldungen WHERE id = v_ama_entw), 'entwurf');
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_jahrgang_abgeschlossen', v_jg_abg IS NOT NULL, true);
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_verkaufsposten_storniert', v_vp_storno IS NOT NULL, true);
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_weinausbau_m', v_wa_m IS NOT NULL, true);
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_spalte_nicht_ueberwacht', v_spalte_frei IS NOT NULL, true);
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_behaelter_belegt', v_beh_bel IS NOT NULL, true);
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_2031_offen',
    (SELECT count(*) FROM public.ea_monatsabschluss WHERE tenant_id = v_m AND jahr = 2031), 0::bigint);

  -- ── Mutationen (nur im Mutationsmodus; nach dem Aufbau, vor den Prüfungen) ──────────────────────────
  PERFORM pg_temp.s112_mutiere('is_locked_offen',
    $m$ALTER POLICY ea_tx_update ON public.ea_transaktionen USING (tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m
         WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role = ANY (ARRAY['system_admin', 'tenant_admin', 'winzer'])))$m$);
  PERFORM pg_temp.s112_mutiere('ama_status_offen',
    $m$ALTER POLICY "ama: winzer+ can update (nur Entwurf)" ON public.ama_erntemeldungen USING (tenant_id IN (SELECT m.tenant_id
         FROM public.tenant_memberships m WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv
          AND m.role = ANY (ARRAY['system_admin', 'tenant_admin', 'winzer'])))$m$);
  PERFORM pg_temp.s112_mutiere('truncate_trigger_weg', $m$DROP TRIGGER z_protokoll_truncate ON public.keller_umzuege$m$);
  PERFORM pg_temp.s112_mutiere('protokoll_aendern_weg', $m$DROP TRIGGER z_protokoll_aendern ON public.weinausbau$m$);
  PERFORM pg_temp.s112_mutiere('protokoll_loeschen_weg', $m$DROP TRIGGER z_protokoll_loeschen ON public.keller_umzuege$m$);
  PERFORM pg_temp.s112_mutiere('gebinde_offen',
    $m$CREATE OR REPLACE FUNCTION public.weinausbau_gebinde_pruefen() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
       SET search_path = public AS $x$ BEGIN RETURN NEW; END $x$$m$);
  PERFORM pg_temp.s112_mutiere('gebinde_freigabe_inaktiv',
    $m$SELECT pg_temp.t20_ersetze('public.weinausbau_gebinde_pruefen()'::regprocedure, 'AND f[.]aktiv[)][)] THEN', ')) THEN')$m$);
  PERFORM pg_temp.s112_mutiere('sperre_monat_fremd',
    $m$SELECT pg_temp.t20_ersetze('public.sperre_ea_monat(uuid,smallint,smallint)'::regprocedure,
       'pruefe_tenant_zugriff[(]p_tenant_id,',
       'pruefe_tenant_zugriff((SELECT m.tenant_id FROM public.tenant_memberships m WHERE m.user_id = auth.uid() AND m.aktiv AND m.role IN (''system_admin'', ''tenant_admin'') ORDER BY m.tenant_id LIMIT 1),')$m$);
  PERFORM pg_temp.s112_mutiere('ama_pos_delete_offen',
    $m$CREATE POLICY s112test_ama_pos_delete_offen ON public.ama_meldepositionen FOR DELETE TO authenticated
       USING (meldung_id IN (SELECT m.id FROM public.ama_erntemeldungen m WHERE m.tenant_id IN (SELECT public.get_user_tenant_ids())))$m$);
  PERFORM pg_temp.s112_mutiere('anlage_tenant_offen',
    $m$CREATE OR REPLACE FUNCTION public.trg_ea_transaktion_anlage_tenant() RETURNS trigger LANGUAGE plpgsql
       SET search_path = public, extensions AS $x$ BEGIN RETURN NEW; END $x$$m$);
  PERFORM pg_temp.s112_mutiere('kind_tenant_ama_weg',
    $m$SELECT pg_temp.t20_ersetze('public.bestandsprotokoll_schreiben()'::regprocedure,
       'WHEN ''ama_meldepositionen'' THEN', 'WHEN ''s112test_nie'' THEN')$m$);
  PERFORM pg_temp.s112_mutiere('freigaben_schreibbar',
    $m$CREATE POLICY s112test_freigaben_offen ON public.keller_freigaben FOR ALL TO authenticated USING (true) WITH CHECK (true)$m$);

  -- ── 1. E&A-Sperren ────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('ea_locked_sichtbar',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.ea_transaktionen WHERE id = %L AND is_locked', v_tx_locked)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('ea_locked_update',
    pg_temp.s112_versuch(format('UPDATE public.ea_transaktionen SET beschreibung = beschreibung WHERE id = %L', v_tx_locked)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('ea_locked_delete',
    pg_temp.s112_versuch(format('DELETE FROM public.ea_transaktionen WHERE id = %L', v_tx_locked)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('ea_locked_entsperren',
    pg_temp.s112_versuch(format('UPDATE public.ea_transaktionen SET is_locked = false WHERE id = %L', v_tx_locked)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('ea_offen_update_erlaubt',
    pg_temp.s112_versuch(format('UPDATE public.ea_transaktionen SET beschreibung = beschreibung WHERE id = %L', v_tx_offen)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('ea_sperren_offen',
    pg_temp.s112_versuch(format('UPDATE public.ea_transaktionen SET is_locked = true WHERE id = %L', v_tx_offen)), 'R');
  PERFORM pg_temp.s112_als_postgres();

  -- sperre_ea_monat: m_w darf nicht; m_ta sperrt 2031-01..03 (Zahl gesperrter Buchungen steigt um 3)
  PERFORM pg_temp.s112_als(v_mw);
  v_erg := v_erg || pg_temp.s112_erwarte('ea_sperre_monat_winzer',
    pg_temp.s112_versuch(format('SELECT public.sperre_ea_monat(%L::uuid, 2031::smallint, 1::smallint)', v_m)), 'T');
  -- fremder Betrieb: b_ta (tenant_admin in B) darf keinen Monat von M sperren; s112_fehlertext rollt einen
  -- Erfolg nicht zurück, deshalb danach der Beleg, dass für M 2031/04 kein Abschluss entstanden ist
  PERFORM pg_temp.s112_als(v_bta);
  v_txt := pg_temp.s112_fehlertext(format('SELECT public.sperre_ea_monat(%L::uuid, 2031::smallint, 4::smallint)', v_m));
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('ea_sperre_monat_fremd',
    pg_temp.t20_muster(v_txt, '42501:%', '42501') || '/'
      || (SELECT count(*) FROM public.ea_monatsabschluss WHERE tenant_id = v_m AND jahr = 2031 AND monat = 4), '42501/0');
  SELECT count(*) INTO v_n FROM public.ea_transaktionen WHERE tenant_id = v_m AND is_locked;
  PERFORM pg_temp.s112_als(v_mta);
  v_txt := pg_temp.s112_fehlertext(format('SELECT public.sperre_ea_uva(%L::uuid, 2031::smallint, %L)', v_m, 'Q1'));
  v_erg := v_erg || pg_temp.s112_erwarte('ea_sperre_uva_ohne_abschluss',
    pg_temp.t20_muster(v_txt, 'P0001: Monatsabschluss fehlt%', 'P0001 Monatsabschluss fehlt'), 'P0001 Monatsabschluss fehlt');
  v_arr := ARRAY[
    pg_temp.s112_fehlertext(format('SELECT public.sperre_ea_monat(%L::uuid, 2031::smallint, 1::smallint)', v_m)),
    pg_temp.s112_fehlertext(format('SELECT public.sperre_ea_monat(%L::uuid, 2031::smallint, 2::smallint)', v_m)),
    pg_temp.s112_fehlertext(format('SELECT public.sperre_ea_monat(%L::uuid, 2031::smallint, 3::smallint)', v_m))];
  v_erg := v_erg || pg_temp.s112_erwarte('ea_sperre_monat_aufruf', array_to_string(v_arr, ','), 'ok,ok,ok');
  PERFORM pg_temp.s112_als_postgres();
  SELECT count(*) INTO v_n2 FROM public.ea_transaktionen WHERE tenant_id = v_m AND is_locked;
  v_erg := v_erg || pg_temp.s112_erwarte('ea_sperre_monat_anzahl_steigt', v_n2 - v_n, 3::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('ea_sperre_monat_buchungen',
    (SELECT count(*) FROM public.ea_transaktionen WHERE id IN (v_tx_jan, v_tx_feb, v_tx_offen) AND is_locked), 3::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('ea_sperre_monat_abschluss',
    (SELECT count(*) FROM public.ea_monatsabschluss WHERE tenant_id = v_m AND jahr = 2031 AND monat IN (1, 2, 3)), 3::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('ea_sperre_monat_mai_offen',
    (SELECT count(*) FROM public.ea_transaktionen WHERE id = v_tx_mai AND NOT is_locked), 1::bigint);
  -- sperre_ea_uva: Q1 jetzt vollständig → ok und UVA gesperrt; Q2 ohne Abschlüsse → P0001
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('ea_sperre_uva_q1',
    pg_temp.s112_fehlertext(format('SELECT public.sperre_ea_uva(%L::uuid, 2031::smallint, %L)', v_m, 'Q1')), 'ok');
  v_txt := pg_temp.s112_fehlertext(format('SELECT public.sperre_ea_uva(%L::uuid, 2031::smallint, %L)', v_m, 'Q2'));
  v_erg := v_erg || pg_temp.s112_erwarte('ea_sperre_uva_q2_unvollstaendig',
    pg_temp.t20_muster(v_txt, 'P0001: Monatsabschluss fehlt%', 'P0001 Monatsabschluss fehlt'), 'P0001 Monatsabschluss fehlt');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('ea_sperre_uva_q1_gesperrt',
    (SELECT gesperrt FROM public.ea_uva WHERE id = v_uva_neu), true);
  v_erg := v_erg || pg_temp.s112_erwarte('ea_sperre_uva_q2_mai_offen',
    (SELECT count(*) FROM public.ea_transaktionen WHERE id = v_tx_mai AND NOT is_locked), 1::bigint);

  -- ── 2. AMA-Status ─────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('ama_bestaetigt_sichtbar',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.ama_erntemeldungen WHERE id = %L', v_ama_best)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('ama_bestaetigt_update',
    pg_temp.s112_versuch(format('UPDATE public.ama_erntemeldungen SET notizen = notizen WHERE id = %L', v_ama_best)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('ama_entwurf_update',
    pg_temp.s112_versuch(format('UPDATE public.ama_erntemeldungen SET notizen = notizen WHERE id = %L', v_ama_entw)), 'k1');
  -- KAN-148 C2: Trigger a_ama_position_schutz lehnt vor der RLS-Prüfung ab (T statt R)
  v_erg := v_erg || pg_temp.s112_erwarte('ama_pos_insert_bestaetigt',
    pg_temp.s112_versuch(pg_temp.s112_klon_sql('ama_meldepositionen', v_pos_best)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('ama_pos_update_bestaetigt',
    pg_temp.s112_versuch(format('UPDATE public.ama_meldepositionen SET menge_kg = menge_kg WHERE meldung_id = %L', v_ama_best)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('ama_pos_bestaetigt_sichtbar',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.ama_meldepositionen WHERE meldung_id = %L', v_ama_best)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('ama_pos_delete_bestaetigt',
    pg_temp.s112_versuch(format('DELETE FROM public.ama_meldepositionen WHERE meldung_id = %L', v_ama_best)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('ama_pos_insert_entwurf',
    pg_temp.s112_versuch(pg_temp.s112_klon_sql('ama_meldepositionen', v_pos_entw)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('ama_pos_update_entwurf',
    pg_temp.s112_versuch(format('UPDATE public.ama_meldepositionen SET menge_kg = menge_kg WHERE id = %L', v_pos_entw ->> 'id')), 'k1');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('ama_pos_bestaetigt_existiert',
    (SELECT count(*) > 0 FROM public.ama_meldepositionen WHERE meldung_id = v_ama_best), true);

  -- ── 3. Bekannte Lücken B7/B8: nur in der App gesperrt (Soll: verweigert) ─────────────────────────────
  PERFORM pg_temp.s112_als(v_mw);
  v_erg := v_erg || pg_temp.s112_luecke('luecke_ea_insert_abgeschlossener_monat',
    pg_temp.s112_versuch(pg_temp.s112_klon_sql('ea_transaktionen', v_tx_mai_z, jsonb_build_object('datum', v_ma_datum))),
    'R'::text, 'k1'::text, 'B7 E&A-Periode nur in der App gesperrt: Buchung in abgeschlossenen Monat einfügbar');
  v_erg := v_erg || pg_temp.s112_luecke('luecke_ea_insert_is_locked',
    pg_temp.s112_versuch(pg_temp.s112_klon_sql('ea_transaktionen', v_tx_mai_z, '{"is_locked": true}'::jsonb)),
    'R'::text, 'k1'::text, 'B7 E&A: Buchung gleich mit is_locked = true einfügbar');
  v_erg := v_erg || pg_temp.s112_luecke('luecke_ea_datum_in_abgeschlossenen_monat',
    pg_temp.s112_versuch(format('UPDATE public.ea_transaktionen SET datum = %L::date WHERE id = %L', v_ma_datum, v_tx_mai)),
    'R'::text, 'k1'::text, 'B7 E&A: offene Buchung per Datum in abgeschlossenen Monat verschiebbar');
  v_erg := v_erg || pg_temp.s112_luecke('luecke_ea_uva_entsperren',
    pg_temp.s112_versuch(format('UPDATE public.ea_uva SET gesperrt = false WHERE id = %L', v_uva_gesp)),
    'k0'::text, 'k1'::text, 'B7 E&A: gesperrte UVA per UPDATE entsperrbar (winzer)');
  v_erg := v_erg || pg_temp.s112_luecke('luecke_ea_uva_loeschen',
    pg_temp.s112_versuch(format('DELETE FROM public.ea_uva WHERE id = %L', v_uva_gesp)),
    'k0'::text, 'k1'::text, 'B7 E&A: gesperrte UVA löschbar (winzer)');
  v_erg := v_erg || pg_temp.s112_luecke('luecke_jahrgang_abgeschlossen_update',
    pg_temp.s112_versuch(format('UPDATE public.weinjahrgaenge SET abgeschlossen = false WHERE id = %L', v_jg_abg)),
    'k0'::text, 'k1'::text, 'B8 abgeschlossener Jahrgang änderbar (winzer)');
  -- B8 behoben (KAN-149 D1, Trigger a_verkauf_storno_schutz): Storno eines Verkaufs nicht rückgängig machbar
  v_erg := v_erg || pg_temp.s112_erwarte('storno_rueckgaengig',
    pg_temp.s112_versuch(format('UPDATE public.verkaufsposten SET storniert = false WHERE id = %L', v_vp_storno)), 'T');
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_luecke('luecke_monatsabschluss_loeschen',
    pg_temp.s112_versuch(format('DELETE FROM public.ea_monatsabschluss WHERE id = %L', v_ma)),
    'k0'::text, 'k1'::text, 'B7 E&A: Monatsabschluss löschbar (tenant_admin öffnet den Monat wieder)');
  -- B8 behoben (KAN-148 C2, Trigger a_ama_schutz): bestätigte AMA-Meldung nicht löschbar, auch nicht als tenant_admin
  v_erg := v_erg || pg_temp.s112_erwarte('ama_bestaetigt_loeschen',
    pg_temp.s112_versuch(format('DELETE FROM public.ama_erntemeldungen WHERE id = %L', v_ama_best)), 'T');
  PERFORM pg_temp.s112_als_postgres();

  -- ── 4. Bestandsprotokoll ──────────────────────────────────────────────────────────────────────────────
  v_arr := pg_temp.t20_tgargs('weinausbau');
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_update_menge_ueberwacht', 'menge_liter' = ANY (v_arr), true);
  -- UPDATE überwachter Spalte als m_ta → genau 1 Zeile
  v_n := pg_temp.t20_bp('weinausbau', v_wa_m);
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_update_ausfuehren',
    pg_temp.s112_fehlertext(format('UPDATE public.weinausbau SET menge_liter = menge_liter + 1 WHERE id = %L', v_wa_m)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_update_eine_zeile', pg_temp.t20_bp('weinausbau', v_wa_m) - v_n, 1::bigint);
  SELECT b.* INTO v_bp FROM public.bestandsprotokoll b
   WHERE b.tabelle = 'weinausbau' AND b.datensatz_id = v_wa_m ORDER BY b.id DESC LIMIT 1;
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_update_inhalt',
    concat_ws('|', v_bp.tenant_id, v_bp.aktion, array_to_string(v_bp.geaenderte_spalten, ','), v_bp.benutzer_id, v_bp.db_rolle,
              (v_bp.neu ->> 'menge_liter')::numeric - (v_bp.alt ->> 'menge_liter')::numeric = 1),
    concat_ws('|', v_m, 'UPDATE', 'menge_liter', v_mta, 'authenticated', true));
  -- nicht überwachte Spalte → keine Zeile
  v_n := pg_temp.t20_bp('weinausbau', v_wa_m);
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_update_frei_ausfuehren',
    pg_temp.s112_fehlertext(format('UPDATE public.weinausbau SET %I = coalesce(%I, '''') || '' s112test'' WHERE id = %L',
                                   v_spalte_frei, v_spalte_frei, v_wa_m)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_update_frei_keine_zeile', pg_temp.t20_bp('weinausbau', v_wa_m) - v_n, 0::bigint);

  -- DELETE keller_umzuege (m_ta) → Zeile 'DELETE' mit alt. Seit KAN-145 B4 direkt gesperrt: stornieren, dann
  -- endgültig löschen über s112_storniert_loeschen (auth.uid() bleibt der Benutzer)
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_delete_direkt_gesperrt',
    pg_temp.s112_fehlertext(format('DELETE FROM public.keller_umzuege WHERE id = %L', v_ku[1])) || '/'
      || (SELECT count(*) FROM public.keller_umzuege WHERE id = v_ku[1]), 'ok/1');
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_delete_ausfuehren',
    pg_temp.s112_fehlertext(format('UPDATE public.keller_umzuege SET storniert_am = now(), storno_grund = %L WHERE id = %L', 's112test Storno Protokoll', v_ku[1]))
      || '/' || pg_temp.s112_fehlertext(format('SELECT public.s112_storniert_loeschen(%L, %L, %L, %L)', v_m, 'keller_umzuege', v_ku[1], 's112test endgültig löschen')),
    'ok/ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_delete_geloescht', (SELECT count(*) FROM public.keller_umzuege WHERE id = v_ku[1]), 0::bigint);
  SELECT count(*), max(b.aktion), max(b.tenant_id::text), bool_and(b.alt ->> 'id' = v_ku[1]::text)::text, max(b.benutzer_id::text)
    INTO v_n, v_txt, v_t1, v_t2, v_t3
    FROM public.bestandsprotokoll b WHERE b.tabelle = 'keller_umzuege' AND b.datensatz_id = v_ku[1]
     AND b.aktion = 'DELETE';   -- davor protokolliert: das Storno (UPDATE)
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_delete_zeile',
    concat_ws('|', v_n, v_txt, v_t1, v_t2, v_t3), concat_ws('|', 1, 'DELETE', v_m, 'true', v_mta));
  -- DELETE einer Kindzeile ohne tenant_id → Mandant über die Eltern (pressungen). Seit KAN-148 C1d gesperrt – als
  -- Wartung (postgres) mit Flag
  PERFORM set_config('s112.loeschen_erlaubt', v_m::text, true);
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_delete_kind_ausfuehren',
    pg_temp.s112_fehlertext(format('DELETE FROM public.pressung_behaelter WHERE id = %L', v_pb)), 'ok');
  PERFORM set_config('s112.loeschen_erlaubt', '', true);
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_delete_kind_tenant',
    (SELECT string_agg(coalesce(b.tenant_id::text, 'NULL') || '/' || b.aktion, ',') FROM public.bestandsprotokoll b
      WHERE b.tabelle = 'pressung_behaelter' AND b.datensatz_id = v_pb), v_m::text || '/DELETE');

  -- Alle Protokolltabellen ohne tenant_id (Mandant über CASE TG_TABLE_NAME in bestandsprotokoll_schreiben):
  -- Beispielzeile in B anlegen und als postgres löschen → genau eine Zeile mit tenant_id = B. Eine neue
  -- Kindtabelle ohne CASE-Zweig oder ein falscher Spaltenname im Zweig ergäbe tenant_id NULL.
  v_arr := '{}';
  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);   -- KAN-145 B4: Wartungs-Flag für die Löschsperre
  FOR r IN SELECT x AS tab FROM unnest(pg_temp.s112_soll_liste('protokoll_tabellen')) x
            WHERE to_regclass(format('public.%I', x)) IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass(format('public.%I', x))
                                 AND a.attname = 'tenant_id' AND NOT a.attisdropped)
            ORDER BY 1 LOOP
    BEGIN
      v_z := pg_temp.s112_beispiel(r.tab, v_b, v_bta);
      EXECUTE format('DELETE FROM public.%I WHERE %s', r.tab, pg_temp.s112_pk_where(r.tab, v_z));
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_erg := v_erg || pg_temp.s112_erwarte('protokoll_kind_tenant:' || r.tab,
        v_n || '|' || coalesce((SELECT string_agg(coalesce(b.tenant_id::text, 'NULL') || '/' || b.aktion, ',')
                                  FROM public.bestandsprotokoll b
                                 WHERE b.tabelle = r.tab AND b.datensatz_id = (v_z ->> 'id')::uuid), '(keine Zeile)'),
        '1|' || v_b::text || '/DELETE');
      v_arr := v_arr || r.tab;
    EXCEPTION WHEN OTHERS THEN
      v_erg := v_erg || pg_temp.s112_fehler('protokoll_kind_tenant:' || r.tab, SQLSTATE || ' ' || SQLERRM);
    END;
  END LOOP;
  PERFORM set_config('s112.loeschen_erlaubt', '', true);
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_kind_abgedeckt',
    ARRAY['ama_meldepositionen', 'ernte_parzellen', 'pressung_behaelter', 'pressung_weingaerten', 'verschneidung_quellen'] <@ v_arr, true);

  -- Bypass s112.protokoll_aus: als m_ta wirkungslos; als postgres nur für den Musterhof
  -- (als authenticated an einem UPDATE geprüft – DELETE auf keller_umzuege ist dort seit KAN-145 B4 gesperrt)
  v_n := pg_temp.t20_bp('weinausbau', v_wa_m);
  PERFORM pg_temp.s112_als(v_mta);
  PERFORM set_config('s112.protokoll_aus', v_m::text, true);
  v_txt := pg_temp.s112_fehlertext(format('UPDATE public.weinausbau SET menge_liter = menge_liter + 1 WHERE id = %L', v_wa_m));
  PERFORM set_config('s112.protokoll_aus', '', true);
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('bypass_authenticated_protokolliert', v_txt || '/' || (pg_temp.t20_bp('weinausbau', v_wa_m) - v_n), 'ok/1');
  PERFORM set_config('s112.protokoll_aus', v_m::text, true);
  v_txt := pg_temp.s112_fehlertext(format('DELETE FROM public.keller_umzuege WHERE id = %L', v_ku[3]));
  PERFORM set_config('s112.protokoll_aus', '', true);
  v_erg := v_erg || pg_temp.s112_erwarte('demo_reset_postgres_musterhof_ohne_protokoll',
    v_txt || '/' || (SELECT count(*) FROM public.keller_umzuege WHERE id = v_ku[3]) || '/' || pg_temp.t20_bp('keller_umzuege', v_ku[3]), 'ok/0/0');
  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);   -- KAN-145 B4: Löschsperre (Wartungs-Flag)
  PERFORM set_config('s112.protokoll_aus', v_b::text, true);
  v_txt := pg_temp.s112_fehlertext(format('DELETE FROM public.keller_umzuege WHERE id = %L', v_ku_b1));
  PERFORM set_config('s112.protokoll_aus', v_m::text, true);
  v_txt := v_txt || '/' || pg_temp.s112_fehlertext(format('DELETE FROM public.keller_umzuege WHERE id = %L', v_ku_b2));
  PERFORM set_config('s112.protokoll_aus', '', true);
  PERFORM set_config('s112.loeschen_erlaubt', '', true);
  v_erg := v_erg || pg_temp.s112_erwarte('bypass_postgres_betrieb_b_protokolliert',
    v_txt || '/' || pg_temp.t20_bp('keller_umzuege', v_ku_b1) || '/' || pg_temp.t20_bp('keller_umzuege', v_ku_b2)
      || '/' || (SELECT count(*) FROM public.bestandsprotokoll WHERE datensatz_id IN (v_ku_b1, v_ku_b2) AND tenant_id = v_b),
    'ok/ok/1/1/2');

  -- authenticated: auf bestandsprotokoll nur SELECT, und nur SA/TA (m_w sieht nichts)
  v_n := (SELECT count(*) FROM public.bestandsprotokoll WHERE tenant_id = v_m);
  v_erg := v_erg || pg_temp.s112_erwarte('bp_select_beleg_zeilen_m', v_n >= 2, true);
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('bp_insert_authenticated',
    pg_temp.s112_versuch(format('INSERT INTO public.bestandsprotokoll (tenant_id, tabelle, aktion) VALUES (%L, %L, %L)', v_m, 's112test', 'UPDATE')), 'G');
  v_erg := v_erg || pg_temp.s112_erwarte('bp_update_authenticated',
    pg_temp.s112_versuch(format('UPDATE public.bestandsprotokoll SET tabelle = tabelle WHERE tenant_id = %L', v_m)), 'G');
  v_erg := v_erg || pg_temp.s112_erwarte('bp_delete_authenticated',
    pg_temp.s112_versuch(format('DELETE FROM public.bestandsprotokoll WHERE tenant_id = %L', v_m)), 'G');
  v_txt := pg_temp.s112_zaehle(format('SELECT count(*) FROM public.bestandsprotokoll WHERE tenant_id = %L', v_m));
  v_erg := v_erg || pg_temp.s112_erwarte('bp_select_tenant_admin', v_txt ~ '^[0-9]+$' AND v_txt::bigint >= 1, true);
  PERFORM pg_temp.s112_als(v_mw);
  v_erg := v_erg || pg_temp.s112_erwarte('bp_select_winzer',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.bestandsprotokoll WHERE tenant_id = %L', v_m)), '0');
  PERFORM pg_temp.s112_als_postgres();

  -- ── 5. Mandantengleichheit: Gebinde (weinausbau_gebinde_pruefen) ─────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('gebinde_nicht_gemeinsam',
    pg_temp.t20_muster(pg_temp.t20_probe(format('UPDATE public.weinausbau SET behaelter_id = %L WHERE id = %L', v_beh_ng, v_wa_b)),
                       'P0001: %gehört einem anderen Betrieb%', 'P0001 fremd'), 'P0001 fremd');
  v_erg := v_erg || pg_temp.s112_erwarte('gebinde_gemeinsam_ohne_freigabe',
    pg_temp.t20_muster(pg_temp.t20_probe(format('UPDATE public.weinausbau SET behaelter_id = %L WHERE id = %L', v_beh_gl, v_wa_b)),
                       'P0001: %gehört einem anderen Betrieb%', 'P0001 fremd'), 'P0001 fremd');
  -- inaktive Freigabe M → B gilt nicht (UNIQUE eigentuemer/nutzer: dieselbe Zeile wird danach aktiv gesetzt)
  PERFORM pg_temp.s112_als_postgres();
  INSERT INTO public.keller_freigaben (eigentuemer_tenant_id, nutzer_tenant_id, aktiv, notizen)
  VALUES (v_m, v_b, false, 'S112TEST Freigabe M an B') RETURNING id INTO v_freigabe;
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('gebinde_gemeinsam_freigabe_inaktiv',
    pg_temp.t20_muster(pg_temp.t20_probe(format('UPDATE public.weinausbau SET behaelter_id = %L WHERE id = %L', v_beh_gl, v_wa_b)),
                       'P0001: %gehört einem anderen Betrieb%', 'P0001 fremd'), 'P0001 fremd');
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.keller_freigaben SET aktiv = true WHERE id = v_freigabe;
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('gebinde_gemeinsam_mit_freigabe',
    pg_temp.t20_probe(format('UPDATE public.weinausbau SET behaelter_id = %L WHERE id = %L', v_beh_gl, v_wa_b)), 'ok:1');
  v_erg := v_erg || pg_temp.s112_erwarte('gebinde_gemeinsam_belegt',
    pg_temp.t20_muster(pg_temp.t20_probe(format('UPDATE public.weinausbau SET behaelter_id = %L WHERE id = %L', v_beh_bel, v_wa_b)),
                       'P0001: %belegt%', 'P0001 belegt'), 'P0001 belegt');
  v_erg := v_erg || pg_temp.s112_erwarte('gebinde_nicht_gemeinsam_trotz_freigabe',
    pg_temp.t20_muster(pg_temp.t20_probe(format('UPDATE public.weinausbau SET behaelter_id = %L WHERE id = %L', v_beh_ng, v_wa_b)),
                       'P0001: %gehört einem anderen Betrieb%', 'P0001 fremd'), 'P0001 fremd');

  -- Anlagen/Buchungen (trg_ea_*_tenant)
  v_erg := v_erg || pg_temp.s112_erwarte('anlage_fremd',
    pg_temp.t20_muster(pg_temp.t20_probe(format('UPDATE public.ea_transaktionen SET anlage_id = %L WHERE id = %L', v_anl_m, v_tx_b)),
                       'P0001: Die Anlage gehört nicht zu diesem Betrieb%', 'P0001 fremd'), 'P0001 fremd');
  v_erg := v_erg || pg_temp.s112_erwarte('anlage_eigen',
    pg_temp.t20_probe(format('UPDATE public.ea_transaktionen SET anlage_id = %L WHERE id = %L', v_anl_b, v_tx_b)), 'ok:1');
  v_erg := v_erg || pg_temp.s112_erwarte('anlage_buchung_fremd',
    pg_temp.t20_muster(pg_temp.t20_probe(format('UPDATE public.ea_anlagen SET transaktion_id = %L WHERE id = %L', v_tx_m, v_anl_b)),
                       'P0001: Die Buchung gehört nicht zu diesem Betrieb%', 'P0001 fremd'), 'P0001 fremd');
  v_erg := v_erg || pg_temp.s112_erwarte('anlage_buchung_eigen',
    pg_temp.t20_probe(format('UPDATE public.ea_anlagen SET transaktion_id = %L WHERE id = %L', v_tx_b, v_anl_b)), 'ok:1');

  -- ── 6. keller_freigaben: sichtbar, aber nicht schreibbar ─────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('freigabe_sichtbar_nutzer',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.keller_freigaben WHERE id = %L', v_freigabe)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('freigabe_insert',
    pg_temp.s112_versuch(format('INSERT INTO public.keller_freigaben (eigentuemer_tenant_id, nutzer_tenant_id, aktiv) VALUES (%L, %L, true)', v_b, v_m)), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('freigabe_insert_fremd',
    pg_temp.s112_versuch(format('INSERT INTO public.keller_freigaben (eigentuemer_tenant_id, nutzer_tenant_id, aktiv) VALUES (%L, %L, true)', v_m, v_b)), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('freigabe_update',
    pg_temp.s112_versuch(format('UPDATE public.keller_freigaben SET aktiv = false WHERE id = %L', v_freigabe)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('freigabe_delete',
    pg_temp.s112_versuch(format('DELETE FROM public.keller_freigaben WHERE id = %L', v_freigabe)), 'k0');
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('freigabe_sichtbar_eigentuemer',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.keller_freigaben WHERE id = %L', v_freigabe)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('freigabe_update_eigentuemer',
    pg_temp.s112_versuch(format('UPDATE public.keller_freigaben SET aktiv = false WHERE id = %L', v_freigabe)), 'k0');
  PERFORM pg_temp.s112_als_postgres();

  -- ── 7. TRUNCATE-Verbot (als postgres; zum Schluss) ───────────────────────────────────────────────────
  PERFORM set_config('lock_timeout', '5s', true);
  SELECT coalesce(array_agg(c.relname::text ORDER BY c.relname), '{}') INTO v_arr
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relnamespace = 'public'::regnamespace AND t.tgname = 'z_protokoll_truncate' AND NOT t.tgisinternal;
  -- KAN-145 B4: Löschsperre (a_loeschsperre → s112_loeschsperre) und keine_direktloeschung genau auf der Soll-Liste
  SELECT coalesce(array_agg(c.relname::text ORDER BY c.relname), '{}') INTO v_arr
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal AND t.tgfoid = 'public.s112_loeschsperre()'::regprocedure;
  v_erg := v_erg || pg_temp.s112_erwarte('loeschsperre_katalog', array_to_string(v_arr, ','),
    (SELECT array_to_string(array_agg(x ORDER BY x), ',') FROM unnest(pg_temp.s112_soll_liste('loeschsperre_tabellen')) x));
  SELECT coalesce(array_agg(p.tablename::text ORDER BY p.tablename), '{}') INTO v_arr
    FROM pg_policies p WHERE p.schemaname = 'public' AND p.policyname = 'keine_direktloeschung' AND p.permissive = 'RESTRICTIVE' AND p.cmd = 'DELETE';
  v_erg := v_erg || pg_temp.s112_erwarte('keine_direktloeschung_katalog', array_to_string(v_arr, ','),
    (SELECT array_to_string(array_agg(x ORDER BY x), ',') FROM unnest(pg_temp.s112_soll_liste('loeschsperre_tabellen')) x));
  SELECT coalesce(array_agg(c.relname::text ORDER BY c.relname), '{}') INTO v_arr
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE c.relnamespace = 'public'::regnamespace AND t.tgname = 'z_protokoll_truncate' AND NOT t.tgisinternal;
  v_erg := v_erg || pg_temp.s112_erwarte('truncate_trigger_katalog', array_to_string(v_arr, ','),
    (SELECT array_to_string(array_agg(x ORDER BY x), ',') FROM unnest(pg_temp.s112_soll_liste('protokoll_tabellen')) x));
  FOR r IN SELECT DISTINCT x AS tab FROM unnest(v_arr || pg_temp.s112_soll_liste('protokoll_tabellen')) x ORDER BY 1 LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', r.tab) INTO v_n;
    v_txt := pg_temp.s112_fehlertext(format('TRUNCATE public.%I', r.tab));
    IF v_txt LIKE '0A000:%' THEN   -- FK-Verweis: mit CASCADE, damit der Trigger der Tabelle antwortet
      v_txt := pg_temp.s112_fehlertext(format('TRUNCATE public.%I CASCADE', r.tab));
    END IF;
    v_erg := v_erg || pg_temp.s112_erwarte('truncate:' || r.tab,
      pg_temp.t20_muster(v_txt, '42501: TRUNCATE auf „' || r.tab || '“ ist gesperrt%', '42501 gesperrt'), '42501 gesperrt');
    EXECUTE format('SELECT count(*) FROM public.%I', r.tab) INTO v_n2;
    v_erg := v_erg || pg_temp.s112_erwarte('truncate_zeilen:' || r.tab, v_n2, v_n);
  END LOOP;

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 94);
END
$test$;
