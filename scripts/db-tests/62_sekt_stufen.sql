-- @bereich: Sekt-Stufen und Hefelagerung (KAN-190)
-- @ziel: Tirage-Angaben nur bei Sekt g.U.; die Sekt-Stufe setzt nur s112_sekt_stufe_setzen – Hefelagerung ≥ 9/18/36 Monate
-- @ziel: ab der Tirage (bis zum Degorgieren bzw. heute), Reserve/Große Reserve nur Flaschengärung, Große Reserve nur
-- @ziel: lagenrein, nur abstufen, Degorgieren einmal; direktes Ändern der Stufe sperrt der Freeze-Trigger; fremde Füllung → P0002.
-- @mutation ohne_hefelagerung: Prüfung der Hefelagerung ausgeschaltet | rot: klassik_zu_frueh
-- @mutation aufwertung_erlaubt: Prüfung „nur abstufen“ ausgeschaltet | rot: keine_aufwertung
-- @mutation ohne_check_nur_sekt: CHECK fuellungen_tirage_nur_sekt entfernt | rot: tirage_nur_sekt
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 62 (Stand 07.10.2026, KAN-190). Alles zurückgerollt.

CREATE FUNCTION pg_temp.t62_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't62_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  c_datei constant text := '62_sekt_stufen';
  c_rpc   constant text := 'SELECT public.s112_sekt_stufe_setzen(%L::uuid, %L::uuid, %L, %L::date, %s)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bw    uuid;
  v_alt   uuid;   -- Tirage vor 40 Monaten, Flaschengärung
  v_jung  uuid;   -- Tirage vor 5 Monaten
  v_tank  uuid;   -- Tankgärung, vor 20 Monaten
  v_fm    uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_alt := (pg_temp.s112_beispiel('fuellungen', v_b, NULL, jsonb_build_object('erzeugnis', 'SEKTGU', 'qualitaet', 'qualitaetswein', 'datum', v_heute - 1,
    'tirage_datum', (v_heute - interval '40 months')::date, 'gaermethode', 'flaschengaerung', 'storniert_am', NULL)) ->> 'id')::uuid;
  v_jung := (pg_temp.s112_beispiel('fuellungen', v_b, NULL, jsonb_build_object('erzeugnis', 'SEKTGU', 'qualitaet', 'qualitaetswein', 'datum', v_heute - 1,
    'tirage_datum', (v_heute - interval '5 months')::date, 'gaermethode', 'flaschengaerung', 'storniert_am', NULL)) ->> 'id')::uuid;
  v_tank := (pg_temp.s112_beispiel('fuellungen', v_b, NULL, jsonb_build_object('erzeugnis', 'SEKTGU', 'qualitaet', 'qualitaetswein', 'datum', v_heute - 1,
    'tirage_datum', (v_heute - interval '20 months')::date, 'gaermethode', 'tankgaerung', 'storniert_am', NULL)) ->> 'id')::uuid;
  v_fm := (pg_temp.s112_beispiel('fuellungen', v_m, NULL, jsonb_build_object('erzeugnis', 'SEKTGU', 'qualitaet', 'qualitaetswein', 'datum', v_heute - 1,
    'tirage_datum', (v_heute - interval '40 months')::date, 'gaermethode', 'flaschengaerung', 'storniert_am', NULL)) ->> 'id')::uuid;

  PERFORM pg_temp.s112_mutiere('ohne_hefelagerung', $m$SELECT pg_temp.t62_ersetze('public.s112_sekt_stufe_setzen(uuid, uuid, text, date, boolean)'::regprocedure,
    $r$IF v_monate < v_min THEN$r$, $r$IF false THEN$r$)$m$);
  PERFORM pg_temp.s112_mutiere('aufwertung_erlaubt', $m$SELECT pg_temp.t62_ersetze('public.s112_sekt_stufe_setzen(uuid, uuid, text, date, boolean)'::regprocedure,
    $r$IF v_f\.sekt_stufe IS NOT NULL AND \(v_rang$r$, $r$IF false AND (v_rang$r$)$m$);
  PERFORM pg_temp.s112_mutiere('ohne_check_nur_sekt', $m$ALTER TABLE public.fuellungen DROP CONSTRAINT fuellungen_tirage_nur_sekt$m$);

  -- ── 1. CHECK: Tirage nur bei Sekt g.U. ────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('tirage_nur_sekt',
    split_part(pg_temp.s112_fehlertext(format('SELECT pg_temp.s112_beispiel(%L, %L::uuid, NULL, %L::jsonb)', 'fuellungen', v_b,
      jsonb_build_object('erzeugnis', 'WEINGU', 'qualitaet', 'qualitaetswein', 'datum', v_heute - 1, 'tirage_datum', v_heute - 30, 'gaermethode', 'flaschengaerung'))), ':', 1), '23514');

  -- ── 2. Regeln der Stufe ───────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('klassik_zu_frueh',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_jung, 'klassik', NULL, 'false')), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('reserve_tankgaerung',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_tank, 'reserve', NULL, 'false')), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('klassik_tank_ok',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_tank, 'klassik', NULL, 'false')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('gr_nicht_lagenrein',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_alt, 'grosse_reserve', NULL, 'false')), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('gr_ok',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_alt, 'grosse_reserve', NULL, 'true')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('abstufen_ok',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_alt, 'reserve', NULL, 'false')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('keine_aufwertung',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_alt, 'grosse_reserve', NULL, 'true')), ':', 1), '22023');

  -- ── 3. Degorgieren einmal; Stufe nicht per Update; fremde Füllung ─────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('degorgieren_ok',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_alt, NULL, v_heute - 10, 'false')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('degorgieren_einmal',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_alt, NULL, v_heute - 5, 'false')), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('stufe_nicht_per_update',
    pg_temp.s112_fehlertext(format('UPDATE public.fuellungen SET sekt_stufe = %L WHERE id = %L', 'grosse_reserve', v_alt)) <> 'ok', true);
  v_erg := v_erg || pg_temp.s112_erwarte('idor_fremde_fuellung',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_fm, 'klassik', NULL, 'false')), ':', 1), 'P0002');

  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('gespeichert',
    (SELECT sekt_stufe || '|' || degorgiert_am::text FROM public.fuellungen WHERE id = v_alt), 'reserve|' || (v_heute - 10)::text);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 13);
END $test$;
