-- @bereich: Füllung – Änderungen nur mit Grund (KAN-378)
-- @ziel: An einer gespeicherten, nicht stornierten Füllung ändern API-Benutzer Produktname, Preise, MwSt., KN-Code,
-- @ziel: Notizen und aktiv nur über s112_fuellung_aendern mit Grund (≥ 10 Zeichen) – direkt endet das mit 42501 (HINT
-- @ziel: grund_fehlt). Der Grund steht im Bestandsprotokoll. Storno, Bestands- und Verkaufsbuchungen, Service-Role und
-- @ziel: Wartung laufen weiter; fremde Betriebe, Leser und gesperrte Abos werden abgelehnt.
-- @mutation grund_trigger_aus: kein Trigger a_grund_pflicht auf fuellungen | rot: ohne_grund_.*
-- @mutation rpc_ohne_grundpruefung: RPC prüft die Länge des Grundes nicht | rot: rpc_grund_kurz
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 82 (Stand 23.10.2026, KAN-378). Alles zurückgerollt.

CREATE FUNCTION pg_temp.t82_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't82_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

DO $test$
DECLARE
  c_datei  constant text := '82_fuellung_grund';
  c_rpc    constant text := 'SELECT public.s112_fuellung_aendern(%L::uuid, %L::uuid, %L::jsonb, %L)';
  c_upd    constant text := 'UPDATE public.fuellungen SET %s WHERE id = %L';
  c_grund  constant text := 'S112TEST Preis laut neuer Preisliste';
  v_t0     timestamptz;
  v_erg    text[] := '{}';
  v_a      jsonb;
  v_m      uuid;
  v_b      uuid;
  v_bw     uuid;
  v_bl     uuid;
  v_f      uuid;
  v_fm     uuid;
  v_txt    text;
  v_n      bigint;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ───────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_m := (v_a ->> 'm')::uuid;
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_f := (pg_temp.s112_beispiel('fuellungen', v_b, v_bw, '{"bestand_flaschen": "100", "anzahl_flaschen": "100"}') ->> 'id')::uuid;
  v_fm := (pg_temp.s112_beispiel('fuellungen', v_m) ->> 'id')::uuid;
  UPDATE public.fuellungen SET vk_preis_brutto = 10, aktiv = true WHERE id = v_f;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('grund_trigger_aus', $m$DROP TRIGGER a_grund_pflicht ON public.fuellungen$m$);
  PERFORM pg_temp.s112_mutiere('rpc_ohne_grundpruefung',
    $m$SELECT pg_temp.t82_ersetze('public.s112_fuellung_aendern(uuid, uuid, jsonb, text)'::regprocedure,
         $r$IF char_length\(v_grund\) < 10 THEN$r$, $r$IF false THEN$r$)$m$);

  -- ── 1. Rechte ─────────────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_nicht_fuer_anon',
    has_function_privilege('anon', 'public.s112_fuellung_aendern(uuid, uuid, jsonb, text)', 'EXECUTE'), false);
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_fuer_authenticated',
    has_function_privilege('authenticated', 'public.s112_fuellung_aendern(uuid, uuid, jsonb, text)', 'EXECUTE'), true);
  v_erg := v_erg || pg_temp.s112_erwarte('trigger_fn_nicht_aufrufbar',
    has_function_privilege('authenticated', 'public.s112_fuellung_grund_pflicht()', 'EXECUTE'), false);

  -- ── 2. Direkt ohne Grund: abgelehnt ───────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_grund_name',
    pg_temp.s112_versuch(format(c_upd, format('name = %L', 'S112TEST neu'), v_f)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_grund_preis',
    pg_temp.s112_versuch(format(c_upd, 'vk_preis_brutto = 12.9', v_f)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_grund_einstand_kn_notizen',
    pg_temp.s112_versuch(format(c_upd, format('einstandspreis = 4.2, zolltarifnummer = %L, notizen = %L', '22042109', 'S112TEST'), v_f)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_grund_aktiv',
    pg_temp.s112_versuch(format(c_upd, 'aktiv = false', v_f)), 'T');
  v_txt := pg_temp.s112_fehlertext(format(c_upd, 'mwst_pct = 20', v_f));
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_grund_meldung',
    v_txt LIKE '42501: Änderungen an einer gespeicherten Füllung brauchen einen Grund%(betrifft: mwst_pct).%HINT: grund_fehlt', true);
  -- unverändert gesetzt (No-op) ist keine Änderung
  v_erg := v_erg || pg_temp.s112_erwarte('noop_ohne_grund',
    pg_temp.s112_versuch(format(c_upd, 'name = name, aktiv = aktiv', v_f)), 'k1');
  -- gesperrte Merkmale bleiben beim Freeze (KAN-101)
  v_erg := v_erg || pg_temp.s112_erwarte('freeze_bleibt',
    pg_temp.s112_versuch(format(c_upd, 'jahrgang = 1999', v_f)), 'T');

  -- ── 3. RPC: Grund, Positivliste, Mandant ──────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_grund_kurz',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_f, '{"vk_preis_brutto": 13}', 'zu kurz')), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_grund_leer',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_f, '{"vk_preis_brutto": 13}', NULL)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_fremde_spalte',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_f, '{"jahrgang": 1999}', c_grund)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_name_leer',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_f, '{"name": "  "}', c_grund)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_fremder_betrieb',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_m, v_fm, '{"vk_preis_brutto": 13}', c_grund)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_fremde_fuellung',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_fm, '{"vk_preis_brutto": 13}', c_grund)), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_mit_grund',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_f, '{"name": "S112TEST Riesling neu", "vk_preis_brutto": 13.5, "notizen": "S112TEST"}', c_grund)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_nichts_geaendert',
    pg_temp.s112_zaehle(format('SELECT (' || c_rpc || ')::int', v_b, v_f, '{"name": "S112TEST Riesling neu", "vk_preis_brutto": 13.5}', c_grund)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('kennzeichen_leer_nach_rpc',
    coalesce(current_setting('s112.aenderung_grund', true), ''), '');

  -- ── 4. Buchungs-RPCs laufen weiter ────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('bestand_buchen',
    pg_temp.s112_versuch(format('SELECT public.fuellung_bestand_buchen(%L, %L, %L, pg_temp.s112_heute(), -2, NULL, %L)', v_b, v_f, 'bruch', 'S112TEST Bruch')), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('verkauf_buchen',
    pg_temp.s112_versuch(format('SELECT public.s112_fuellung_verkauf_buchen(%L, %L, gen_random_uuid(), -3, pg_temp.s112_heute(), NULL)', v_b, v_f)), 'k1');

  -- ── 5. Leser ──────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_leser',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_f, '{"vk_preis_brutto": 14}', c_grund)), ':', 1), '42501');

  -- ── 6. Ergebnis und Protokoll ─────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_werte',
    (SELECT f.name = 'S112TEST Riesling neu' AND f.vk_preis_brutto = 13.5 AND f.notizen = 'S112TEST' FROM public.fuellungen f WHERE f.id = v_f), true);
  SELECT count(*) INTO v_n FROM public.bestandsprotokoll p
   WHERE p.tabelle = 'fuellungen' AND p.datensatz_id = v_f AND p.aktion = 'UPDATE' AND p.benutzer_id = v_bw
     AND p.grund = c_grund AND p.geaenderte_spalten @> ARRAY['name', 'notizen', 'vk_preis_brutto'];
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_protokoll_mit_grund', v_n, 1::bigint);

  -- ── 7. Service-Role und Wartung ───────────────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  EXECUTE 'SET LOCAL ROLE service_role';
  v_erg := v_erg || pg_temp.s112_erwarte('service_role_ohne_grund',
    pg_temp.s112_versuch(format(c_upd, format('notizen = %L', 'S112TEST Service'), v_f)), 'k1');
  PERFORM pg_temp.s112_als_postgres();
  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);
  v_erg := v_erg || pg_temp.s112_erwarte('wartung_ohne_grund',
    pg_temp.s112_versuch(format(c_upd, 'vk_preis_brutto = 1', v_f)), 'k1');
  PERFORM set_config('s112.loeschen_erlaubt', '', true);

  -- ── 8. Abo-Schreibsperre ──────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  SELECT t.stripe_status INTO v_txt FROM public.tenants t WHERE t.id = v_b;
  UPDATE public.tenants SET stripe_status = 'canceled' WHERE id = v_b;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_abo_gesperrt',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_f, '{"vk_preis_brutto": 15}', c_grund)) <> 'ok', true);
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.tenants SET stripe_status = v_txt WHERE id = v_b;


  -- ── 9. Storno ohne Änderungsgrund (Grund im Storno) ───────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('storno_erlaubt',
    pg_temp.s112_versuch(format(c_upd, format('aktiv = false, storniert_am = now(), storno_grund = %L', 'S112TEST Storno-Grund'), v_f)), 'k1');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 28);
END $test$;
