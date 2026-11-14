-- @bereich: Demo-Musterhof – Flaschenverkäufe des Resets schreiben eine Bestandsbewegung (Datenabgleich 09.10.2026)
-- @ziel: demo_musterhof_verkauf legt zu jeder Flaschenposition eine Bewegung „verkauf“ mit Verkaufsposten und Bestand
-- @ziel: vorher/nachher an; ein stornierter Verkauf bekommt Verkauf + Verkaufsstorno, der Bestand bleibt dann gleich.
-- @ziel: „Heute“ ist der Wiener Tag (Befund 14.11.2026, 00:05 Wien: Verkauf mit dem Wiener Datum still übersprungen, weil
-- @ziel: die Funktion mit dem UTC-Tag der Sitzung verglich). Der Test verschiebt die Sitzungs-Zeitzone wie Datei 56, damit
-- @ziel: Sitzungstag ≠ Wiener Tag zu jeder Uhrzeit gilt: vormittags (Sitzung = gestern) muss der Verkauf von heute
-- @ziel: entstehen, nachmittags (Sitzung = morgen) darf der Verkauf von morgen nicht entstehen.
-- @mutation ohne_bewegung: Verkaufsbewegungen werden nicht geschrieben (Stand vor dem Fix) | rot: verkauf_bewegung|storno_paar
-- @mutation falsche_kette: Bestand vorher/nachher um eine Flasche verschoben | rot: bestand_kette
-- @mutation verkauf_utc: demo_musterhof_verkauf rechnet wieder mit dem Sitzungstag | rot: verkauf_bewegung|zukunft_uebersprungen
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 77 (Stand 14.11.2026). Alles zurückgerollt.

CREATE FUNCTION pg_temp.t77_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz, 'g');
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't77_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

DO $test$
DECLARE
  c_datei constant text := '77_demo_flaschenbewegungen';
  c_t     constant uuid := '33333333-3333-4333-8333-333333333333';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_f     uuid;
  v_alt   integer;
  v_vp    uuid := gen_random_uuid();
  v_vs    uuid := gen_random_uuid();
  v_vz    uuid := gen_random_uuid();
  v_tz    text;
  v_heute date;
  v_txt   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();
  v_heute := (now() AT TIME ZONE 'Europe/Vienna')::date;

  -- Sitzungstag ≠ Wiener Tag erzwingen (wie zwischen 00:00 und 02:00 Wiener Zeit mit UTC; siehe Datei 56):
  -- vormittags (Wien) liegt UTC−12 am Vortag, nachmittags UTC+14 am Folgetag.
  v_tz := CASE WHEN extract(hour FROM now() AT TIME ZONE 'Europe/Vienna') < 12 THEN 'Etc/GMT+12' ELSE 'Etc/GMT-14' END;
  PERFORM set_config('TimeZone', v_tz, true);
  v_erg := v_erg || pg_temp.s112_erwarte('vorbedingung_tag_verschieden', now()::date <> v_heute, true);

  PERFORM pg_temp.s112_mutiere('ohne_bewegung', $m$
    CREATE FUNCTION pg_temp.t77_ohne() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
      RETURN CASE WHEN NEW.art IN ('verkauf', 'verkauf_storno') THEN NULL ELSE NEW END; END $f$;
    CREATE TRIGGER t77_mut BEFORE INSERT ON public.fuellung_bewegungen FOR EACH ROW EXECUTE FUNCTION pg_temp.t77_ohne()$m$);
  PERFORM pg_temp.s112_mutiere('falsche_kette', $m$
    CREATE FUNCTION pg_temp.t77_kette() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
      NEW.bestand_vorher := NEW.bestand_vorher + 1; NEW.bestand_nachher := NEW.bestand_nachher + 1; RETURN NEW; END $f$;
    CREATE TRIGGER t77_mut BEFORE INSERT ON public.fuellung_bewegungen FOR EACH ROW EXECUTE FUNCTION pg_temp.t77_kette()$m$);

  PERFORM pg_temp.s112_mutiere('verkauf_utc',
    $m$SELECT pg_temp.t77_ersetze('public.demo_musterhof_verkauf(uuid, integer, date, uuid, uuid, jsonb, jsonb, boolean, text)'::regprocedure,
         $r$\(now\(\) AT TIME ZONE 'Europe/Vienna'\)::date$r$, $r$(now())::date$r$)$m$);

  v_f := public.demo_musterhof_id(19, 12);
  SELECT bestand_flaschen INTO v_alt FROM public.fuellungen WHERE id = v_f AND tenant_id = c_t;
  IF coalesce(v_alt, 0) < 12 THEN
    RAISE EXCEPTION 'Staging-Demo unvollständig – demo_musterhof_zuruecksetzen() + demo_musterhof_y2_kette()';
  END IF;

  -- Kontext wie in demo_musterhof_zuruecksetzen: Wartung des Demo-Betriebs passiert die Füllungssperre (KAN-97/101)
  PERFORM set_config('s112.protokoll_aus', c_t::text, true);

  -- ── 1. Verkauf: eine Bewegung, Kette passt zum Bestand ────────────────────────────────────────────────
  PERFORM public.demo_musterhof_verkauf(v_vp, 9901, v_heute, NULL, NULL, '[{"t":"f","f":12,"m":6}]'::jsonb, NULL, false, 'S112TEST Verkauf');
  SELECT string_agg(art || ' ' || menge_stk, ', ') INTO v_txt
    FROM public.fuellung_bewegungen WHERE verkaufsposten_id = v_vp AND fuellung_id = v_f;
  v_erg := v_erg || pg_temp.s112_erwarte('verkauf_bewegung', coalesce(v_txt, '–'), 'verkauf -6');
  SELECT bestand_vorher || '→' || bestand_nachher || '|' || (SELECT bestand_flaschen FROM public.fuellungen WHERE id = v_f) INTO v_txt
    FROM public.fuellung_bewegungen WHERE verkaufsposten_id = v_vp AND fuellung_id = v_f;
  v_erg := v_erg || pg_temp.s112_erwarte('bestand_kette', coalesce(v_txt, '–'), v_alt || '→' || (v_alt - 6) || '|' || (v_alt - 6));

  -- ── 2. Stornierter Verkauf: Verkauf + Verkaufsstorno, Bestand unverändert ─────────────────────────────
  PERFORM public.demo_musterhof_verkauf(v_vs, 9902, v_heute, NULL, NULL, '[{"t":"f","f":12,"m":4}]'::jsonb, NULL, true, 'S112TEST Storno');
  SELECT string_agg(art || ' ' || menge_stk, ', ' ORDER BY menge_stk) INTO v_txt
    FROM public.fuellung_bewegungen WHERE verkaufsposten_id = v_vs AND fuellung_id = v_f;
  v_erg := v_erg || pg_temp.s112_erwarte('storno_paar', coalesce(v_txt, '–'), 'verkauf -4, verkauf_storno 4');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_bestand',
    (SELECT bestand_flaschen FROM public.fuellungen WHERE id = v_f)::text, (v_alt - 6)::text);

  -- ── 3. Verkauf von morgen (Wiener Zeit): wird übersprungen, auch wenn der Sitzungstag schon morgen ist ─
  PERFORM public.demo_musterhof_verkauf(v_vz, 9903, v_heute + 1, NULL, NULL, '[{"t":"f","f":12,"m":2}]'::jsonb, NULL, false, 'S112TEST Zukunft');
  v_erg := v_erg || pg_temp.s112_erwarte('zukunft_uebersprungen',
    (SELECT count(*) FROM public.verkaufsposten WHERE id = v_vz)::text || '|' ||
    (SELECT bestand_flaschen FROM public.fuellungen WHERE id = v_f)::text, '0|' || (v_alt - 6));

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 6);
END $test$;
