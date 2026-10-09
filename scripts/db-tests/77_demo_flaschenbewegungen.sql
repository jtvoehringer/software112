-- @bereich: Demo-Musterhof – Flaschenverkäufe des Resets schreiben eine Bestandsbewegung (Datenabgleich 09.10.2026)
-- @ziel: demo_musterhof_verkauf legt zu jeder Flaschenposition eine Bewegung „verkauf“ mit Verkaufsposten und Bestand
-- @ziel: vorher/nachher an; ein stornierter Verkauf bekommt Verkauf + Verkaufsstorno, der Bestand bleibt dann gleich.
-- @mutation ohne_bewegung: Verkaufsbewegungen werden nicht geschrieben (Stand vor dem Fix) | rot: verkauf_bewegung|storno_paar
-- @mutation falsche_kette: Bestand vorher/nachher um eine Flasche verschoben | rot: bestand_kette
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 77 (Stand 09.10.2026). Alles zurückgerollt.

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
  v_heute date;
  v_txt   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();
  v_heute := (now() AT TIME ZONE 'Europe/Vienna')::date;

  PERFORM pg_temp.s112_mutiere('ohne_bewegung', $m$
    CREATE FUNCTION pg_temp.t77_ohne() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
      RETURN CASE WHEN NEW.art IN ('verkauf', 'verkauf_storno') THEN NULL ELSE NEW END; END $f$;
    CREATE TRIGGER t77_mut BEFORE INSERT ON public.fuellung_bewegungen FOR EACH ROW EXECUTE FUNCTION pg_temp.t77_ohne()$m$);
  PERFORM pg_temp.s112_mutiere('falsche_kette', $m$
    CREATE FUNCTION pg_temp.t77_kette() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
      NEW.bestand_vorher := NEW.bestand_vorher + 1; NEW.bestand_nachher := NEW.bestand_nachher + 1; RETURN NEW; END $f$;
    CREATE TRIGGER t77_mut BEFORE INSERT ON public.fuellung_bewegungen FOR EACH ROW EXECUTE FUNCTION pg_temp.t77_kette()$m$);

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

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 4);
END $test$;
