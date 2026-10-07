-- @bereich: Prüfnummer je Charge – Gültigkeit und Weitergabe über Umzug (KAN-99)
-- @ziel: Einreichen legt die Gültigkeit für die Charge an; ein Umzug in ein leeres Gebinde gibt sie an die neue Charge weiter
-- @ziel: (Teilumzug: beide gelten); Verschnitt, Zukauf, Pressung bzw. Zusammenführung in die Charge beenden sie mit
-- @ziel: Datum und Vorgang, ein Storno des Vorgangs öffnet sie wieder; Endstatus des Antrags beendet alle Zeilen.
-- @ziel: Ein nachträglich angelegter Antrag endet sofort, wenn nach dem Beginn schon zugebucht wurde. Nur Lesen per API.
-- @mutation keine_weitergabe: Umzug gibt die Gültigkeit nicht weiter | rot: weitergabe_.*
-- @mutation kein_ende: Verschnitt beendet die Gültigkeit nicht | rot: verschnitt_ende|storno_oeffnet
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 30 (Stand 04.10.2026, KAN-99). Alles zurückgerollt.

CREATE FUNCTION pg_temp.t30_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't30_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

CREATE FUNCTION pg_temp.t30_zeile(p_antrag uuid, p_charge uuid) RETURNS text LANGUAGE sql AS $f$
  SELECT coalesce((SELECT CASE WHEN pc.gueltig_bis IS NULL THEN 'offen' ELSE 'ende:' || pc.ende_grund END
                            || CASE WHEN pc.quelle_vorgang IS NOT NULL THEN ':geerbt' ELSE '' END
                     FROM public.pruefnummer_chargen pc WHERE pc.dac_antrag_id = p_antrag AND pc.weinausbau_id = p_charge), 'keine')
$f$;

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;   -- wie die RPCs (Wiener Zeit, nicht UTC)
  c_datei constant text := '30_pn_chargen';
  c_rpc   constant text := 'SELECT public.s112_pruefnummernantrag_status_setzen(%L::uuid, %L::uuid, %L, %L::date, %L, %L)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_wa    uuid;
  v_wb    uuid;
  v_wc    uuid;
  v_wd    uuid;
  v_d     uuid;
  v_d2    uuid;
  v_batch uuid;
  v_vs    uuid;
  v_n     bigint;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ───────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_wa := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "1000"}') ->> 'id')::uuid;   -- Charge mit Antrag
  v_wb := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "400"}') ->> 'id')::uuid;    -- neue Charge (Teilumzug)
  v_wc := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "200"}') ->> 'id')::uuid;    -- fremder Wein
  v_wd := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "100"}') ->> 'id')::uuid;    -- für den Nachtrag
  v_d := (pg_temp.s112_beispiel('dac_antrag', v_b, NULL, jsonb_build_object('weinausbau_id', v_wa, 'menge_liter', 1000)) ->> 'id')::uuid;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('keine_weitergabe',
    $m$SELECT pg_temp.t30_ersetze('public.s112_pn_chargen_pflegen()'::regprocedure, $r$IF v_neu THEN$r$, $r$IF false THEN$r$)$m$);
  PERFORM pg_temp.s112_mutiere('kein_ende',
    $m$SELECT pg_temp.t30_ersetze('public.s112_pn_chargen_pflegen()'::regprocedure, $r$v_grund := 'verschnitt';$r$, $r$RETURN NULL;$r$)$m$);

  -- ── 1. Einreichen → Gültigkeit für die Charge ─────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('einreichen',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_d, 'eingereicht', v_heute - 20, NULL, NULL)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('zeile_nach_einreichen', pg_temp.t30_zeile(v_d, v_wa), 'offen');
  v_erg := v_erg || pg_temp.s112_erwarte('api_lesen',
    pg_temp.s112_versuch(format('SELECT 1 FROM public.pruefnummer_chargen WHERE dac_antrag_id = %L', v_d)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('api_schreiben',
    pg_temp.s112_versuch(format('INSERT INTO public.pruefnummer_chargen (tenant_id, dac_antrag_id, weinausbau_id, gueltig_ab) VALUES (%L, %L, %L, pg_temp.s112_heute())', v_b, v_d, v_wc)), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('api_aendern',
    pg_temp.s112_versuch(format('UPDATE public.pruefnummer_chargen SET gueltig_bis = pg_temp.s112_heute(), ende_grund = %L WHERE dac_antrag_id = %L', 'zugang', v_d)), 'k0');

  -- ── 2. Teilumzug A → neue Charge B: beide gelten ──────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  v_batch := gen_random_uuid();
  PERFORM pg_temp.s112_beispiel('keller_umzuege', v_b, NULL, jsonb_build_object('datum', v_heute - 10, 'zeilen_typ', 'quelle',
    'umzug_batch_id', v_batch, 'von_weinausbau_id', v_wa, 'nach_weinausbau_id', NULL, 'menge_liter', 400, 'brutto_liter', 400));
  PERFORM pg_temp.s112_beispiel('keller_umzuege', v_b, NULL, jsonb_build_object('datum', v_heute - 10, 'zeilen_typ', 'ziel',
    'umzug_batch_id', v_batch, 'von_weinausbau_id', NULL, 'nach_weinausbau_id', v_wb, 'menge_liter', 400));
  v_erg := v_erg || pg_temp.s112_erwarte('weitergabe_neue_charge', pg_temp.t30_zeile(v_d, v_wb), 'offen:geerbt');
  v_erg := v_erg || pg_temp.s112_erwarte('weitergabe_quelle_bleibt', pg_temp.t30_zeile(v_d, v_wa), 'offen');
  SELECT count(*) INTO v_n FROM public.pruefnummer_ereignisse e WHERE e.dac_antrag_id = v_d AND e.weinausbau_id = v_wb AND e.ereignis = 'charge_weitergabe';
  v_erg := v_erg || pg_temp.s112_erwarte('weitergabe_ereignis', v_n, 1::bigint);

  -- ── 3. Verschnitt in B: Ende nur für B; Storno öffnet wieder ──────────────────────────────────────────
  v_vs := (pg_temp.s112_beispiel('verschneidungen', v_b, NULL, jsonb_build_object('datum', v_heute - 5, 'ziel_weinausbau_id', v_wb)) ->> 'id')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('verschnitt_ende', pg_temp.t30_zeile(v_d, v_wb), 'ende:verschnitt:geerbt');
  v_erg := v_erg || pg_temp.s112_erwarte('verschnitt_andere_charge', pg_temp.t30_zeile(v_d, v_wa), 'offen');
  UPDATE public.verschneidungen SET storniert_am = now(), storno_grund = 'S112TEST Storno-Grund' WHERE id = v_vs;
  v_erg := v_erg || pg_temp.s112_erwarte('storno_oeffnet', pg_temp.t30_zeile(v_d, v_wb), 'offen:geerbt');

  -- ── 4. Zusammenführung von fremdem Wein in A: Ende ────────────────────────────────────────────────────
  v_batch := gen_random_uuid();
  PERFORM pg_temp.s112_beispiel('keller_umzuege', v_b, NULL, jsonb_build_object('datum', v_heute - 3, 'zeilen_typ', 'quelle',
    'umzug_batch_id', v_batch, 'von_weinausbau_id', v_wc, 'nach_weinausbau_id', NULL, 'menge_liter', 50, 'brutto_liter', 50));
  PERFORM pg_temp.s112_beispiel('keller_umzuege', v_b, NULL, jsonb_build_object('datum', v_heute - 3, 'zeilen_typ', 'ziel',
    'umzug_batch_id', v_batch, 'von_weinausbau_id', NULL, 'nach_weinausbau_id', v_wa, 'menge_liter', 50));
  v_erg := v_erg || pg_temp.s112_erwarte('zusammenfuehrung_ende', pg_temp.t30_zeile(v_d, v_wa), 'ende:zugang');
  v_erg := v_erg || pg_temp.s112_erwarte('zusammenfuehrung_teil_bleibt', pg_temp.t30_zeile(v_d, v_wb), 'offen:geerbt');

  -- ── 5. Zuteilen, dann Entzug: alle offenen Zeilen enden ───────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('zuteilen',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_d, 'genehmigt', v_heute - 2, 'N 4711/26', NULL)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('entziehen',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_d, 'entzogen', v_heute, NULL, 'Bescheid über Entzug BAWB')), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('entzug_beendet_teil', pg_temp.t30_zeile(v_d, v_wb), 'ende:entzogen:geerbt');
  v_erg := v_erg || pg_temp.s112_erwarte('entzug_laesst_fruehere_ende', pg_temp.t30_zeile(v_d, v_wa), 'ende:zugang');

  -- ── 6. Nachträglich angelegter Antrag: vorhandener Zugang nach dem Beginn beendet sofort ──────────────
  PERFORM pg_temp.s112_beispiel('zukauf_posten', v_b, NULL, jsonb_build_object('datum', v_heute - 1, 'ziel_weinausbau_id', v_wd));
  v_d2 := (pg_temp.s112_beispiel('dac_antrag', v_b, NULL, jsonb_build_object('weinausbau_id', v_wd, 'status', 'genehmigt',
    'eingereicht_am', v_heute - 30, 'bescheid_am', v_heute - 20, 'pruefnummer', 'N 1/26')) ->> 'id')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('nachtrag_sofort_ende', pg_temp.t30_zeile(v_d2, v_wd), 'ende:zukauf');
  v_erg := v_erg || pg_temp.s112_erwarte('nachtrag_ende_datum',
    (SELECT pc.gueltig_bis = v_heute - 1 FROM public.pruefnummer_chargen pc WHERE pc.dac_antrag_id = v_d2), true);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 19);
END $test$;
