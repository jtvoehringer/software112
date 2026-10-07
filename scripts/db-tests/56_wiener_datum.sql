-- @bereich: „Heute“ = Wiener Datum in Funktionen und Spalten-Defaults (Befund test:db 07.10.2026, 00:15 Wien)
-- @ziel: Keine Funktion in public (außer Demo-Daten und Smoke-Test) und kein Spalten-Default rechnet mit dem UTC-Tag der
-- @ziel: Sitzung; der Prüfnummernantrag nimmt das Wiener „heute“ an, lehnt „morgen“ ab und belegt ein fehlendes Datum
-- @ziel: wienerisch; ein Verkauf ohne Datum bekommt das Wiener Datum. Der Test verschiebt dazu die Sitzungs-Zeitzone so,
-- @ziel: dass der Sitzungstag zu jeder Uhrzeit vom Wiener Tag abweicht (vormittags Etc/GMT+12, nachmittags Etc/GMT-14).
-- @mutation pn_utc: Prüfnummernantrag rechnet wieder mit dem Sitzungstag | rot: pn_.*
-- @mutation default_utc: Default von verkaufsposten.datum wieder der Sitzungstag | rot: default_verkauf|keine_utc_defaults
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 56 (Stand 07.10.2026). Alles zurückgerollt.

CREATE FUNCTION pg_temp.t56_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz, 'g');
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't56_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;   -- wie die RPCs (Wiener Zeit, nicht UTC)
  c_datei constant text := '56_wiener_datum';
  c_rpc   constant text := 'SELECT public.s112_pruefnummernantrag_status_setzen(%L::uuid, %L::uuid, %L, %L::date, NULL, NULL)';
  c_utc   constant text := '\mcurrent' || '_date\M';   -- das Wort selbst lehnt run.mjs in Testdateien ab
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_d     uuid;
  v_d2    uuid;
  v_tz    text;
  v_datum date;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Sitzungstag ≠ Wiener Tag erzwingen (wie zwischen 00:00 und 02:00 Wiener Zeit mit UTC) ──────────────────
  -- Vormittags (Wien) liegt UTC−12 am Vortag, nachmittags UTC+14 am Folgetag – Abstand jeweils über 12 Stunden.
  v_tz := CASE WHEN extract(hour FROM now() AT TIME ZONE 'Europe/Vienna') < 12 THEN 'Etc/GMT+12' ELSE 'Etc/GMT-14' END;
  PERFORM set_config('TimeZone', v_tz, true);
  v_erg := v_erg || pg_temp.s112_erwarte('vorbedingung_tag_verschieden', now()::date <> v_heute, true);

  -- ── Aufbau (als postgres) ────────────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_d := (pg_temp.s112_beispiel('dac_antrag', v_b) ->> 'id')::uuid;
  v_d2 := (pg_temp.s112_beispiel('dac_antrag', v_b) ->> 'id')::uuid;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('pn_utc',
    $m$SELECT pg_temp.t56_ersetze('public.s112_pruefnummernantrag_status_setzen(uuid, uuid, text, date, text, text)'::regprocedure,
         $r$\(now\(\) AT TIME ZONE 'Europe/Vienna'\)::date$r$, $r$(now())::date$r$)$m$);
  PERFORM pg_temp.s112_mutiere('default_utc',
    $m$ALTER TABLE public.verkaufsposten ALTER COLUMN datum SET DEFAULT ('now'::text)::date$m$);

  -- ── 1. Katalog: kein UTC-Tag in Funktionen und Defaults ──────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('keine_utc_funktion',
    (SELECT coalesce(string_agg(p.proname, ',' ORDER BY p.proname), '-') FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
        AND p.proname NOT LIKE 'demo\_%' AND p.proname <> 's112_smoke_test'
        AND pg_get_functiondef(p.oid) ~* c_utc), '-');
  v_erg := v_erg || pg_temp.s112_erwarte('keine_utc_defaults',
    (SELECT coalesce(string_agg(c.relname || '.' || a.attname, ',' ORDER BY c.relname, a.attname), '-')
       FROM pg_attrdef d JOIN pg_class c ON c.oid = d.adrelid
       JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
      WHERE c.relnamespace = 'public'::regnamespace
        AND (pg_get_expr(d.adbin, d.adrelid) ~* c_utc
             OR (format_type(a.atttypid, a.atttypmod) = 'date' AND pg_get_expr(d.adbin, d.adrelid) ~* '\mnow\(\)|''now'''
                 AND pg_get_expr(d.adbin, d.adrelid) !~* 'Europe/Vienna'))), '-');

  -- ── 2. Prüfnummernantrag: „morgen“ abgelehnt, „heute“ angenommen, ohne Datum = Wiener Tag ────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('pn_morgen_abgelehnt',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_d, 'eingereicht', v_heute + 1)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('pn_heute_eingereicht',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_d, 'eingereicht', v_heute)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('pn_ohne_datum',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_d2, 'eingereicht', NULL)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('pn_ohne_datum_wien',
    (SELECT d.eingereicht_am = v_heute FROM public.dac_antrag d WHERE d.id = v_d2), true);

  -- ── 3. Spalten-Default: Verkauf ohne Datum ───────────────────────────────────────────────────────────
  INSERT INTO public.verkaufsposten (tenant_id, notizen) VALUES (v_b, 'S112TEST 56') RETURNING datum INTO v_datum;
  v_erg := v_erg || pg_temp.s112_erwarte('default_verkauf', v_datum = v_heute, true);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 8);
END $test$;
