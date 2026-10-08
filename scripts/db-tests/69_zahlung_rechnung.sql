-- @bereich: Zahlung → Rechnung (KAN-105 Teil A) – zahlungen.rechnung_id, bezahlt je Rechnung
-- @ziel: Eine Zahlung zum Lieferschein hängt automatisch an dessen Rechnung; per API lässt sich keine andere Rechnung setzen.
-- @ziel: bezahlt gilt je Rechnung: bei einer Rechnung über zwei Lieferscheine ist sie erst bezahlt, wenn die Summe beider
-- @ziel: gedeckt ist, und beide Lieferscheine übernehmen den Stand. Eine stornierte Zahlung hebt bezahlt wieder auf.
-- @mutation ohne_zuordnung: Trigger a_zahlung_rechnung fehlt | rot: zahlung_an_rechnung
-- @mutation je_lieferschein: bezahlt wieder je Lieferschein | rot: sammel_erst_teilweise
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 69 (Stand 08.10.2026, KAN-105). Alles zurückgerollt.

CREATE FUNCTION pg_temp.t69_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't69_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  c_datei constant text := '69_zahlung_rechnung';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bw    uuid;
  v_vp1   uuid;
  v_vp2   uuid;
  v_vp3   uuid;
  v_re1   uuid;
  v_re2   uuid;
  v_re3   uuid;
  v_z     uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ──────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;

  PERFORM pg_temp.s112_mutiere('ohne_zuordnung', $m$DROP TRIGGER a_zahlung_rechnung ON public.zahlungen$m$);
  PERFORM pg_temp.s112_mutiere('je_lieferschein',
    $m$SELECT pg_temp.t69_ersetze('public.sync_verkaufsposten_bezahlt()'::regprocedure, $r$IF v_re IS NULL THEN$r$, $r$IF true THEN$r$)$m$);

  -- drei Lieferscheine mit Rechnung (Übergang 1:1), je 10 € bzw. 20 €
  PERFORM pg_temp.s112_als(v_bw);
  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen) VALUES (v_b, v_heute, 'S112TEST KAN-105 a') RETURNING id, rechnung_id INTO v_vp1, v_re1;
  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen) VALUES (v_b, v_heute, 'S112TEST KAN-105 b') RETURNING id, rechnung_id INTO v_vp2, v_re2;
  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen) VALUES (v_b, v_heute, 'S112TEST KAN-105 c') RETURNING id, rechnung_id INTO v_vp3, v_re3;
  INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz)
  VALUES (v_b, v_vp1, 'sonstiges', 'S112TEST A', 1, 'Stk', 10, 20), (v_b, v_vp2, 'sonstiges', 'S112TEST B', 1, 'Stk', 20, 20),
         (v_b, v_vp3, 'sonstiges', 'S112TEST C', 1, 'Stk', 10, 20);

  -- ── 1. Zahlung hängt an der Rechnung des Lieferscheins ────────────────────────────────────────────────
  INSERT INTO public.zahlungen (tenant_id, verkaufsposten_id, betrag, art, datum) VALUES (v_b, v_vp1, 10, 'bar', v_heute) RETURNING id INTO v_z;
  v_erg := v_erg || pg_temp.s112_erwarte('zahlung_an_rechnung',
    (SELECT z.rechnung_id = v_re1 FROM public.zahlungen z WHERE z.id = v_z), true);
  v_erg := v_erg || pg_temp.s112_erwarte('einzeln_bezahlt',
    (SELECT concat_ws('|', r.bezahlt, v.bezahlt) FROM public.rechnungen r JOIN public.verkaufsposten v ON v.rechnung_id = r.id WHERE v.id = v_vp1), 't|t');
  v_erg := v_erg || pg_temp.s112_erwarte('api_fremde_rechnung',
    pg_temp.s112_versuch(format('INSERT INTO public.zahlungen (tenant_id, verkaufsposten_id, rechnung_id, betrag, art, datum) VALUES (%L, %L, %L, 1, %L, pg_temp.s112_heute())',
      v_b, v_vp1, v_re2, 'bar')), 'T');

  -- ── 2. Rechnung über zwei Lieferscheine (Wartung wie die spätere Sammelrechnung): bezahlt erst bei voller Summe ──
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.verkaufsposten SET rechnung_id = v_re2 WHERE id = v_vp3;   -- Rechnung 2 umfasst jetzt B (20 €) und C (10 €)
  PERFORM pg_temp.s112_als(v_bw);
  INSERT INTO public.zahlungen (tenant_id, verkaufsposten_id, betrag, art, datum) VALUES (v_b, v_vp2, 20, 'bar', v_heute);
  v_erg := v_erg || pg_temp.s112_erwarte('sammel_erst_teilweise',
    (SELECT concat_ws('|', r.bezahlt, (SELECT bool_or(v.bezahlt) FROM public.verkaufsposten v WHERE v.rechnung_id = r.id)) FROM public.rechnungen r WHERE r.id = v_re2), 'f|f');
  INSERT INTO public.zahlungen (tenant_id, verkaufsposten_id, betrag, art, datum) VALUES (v_b, v_vp3, 10, 'bar', v_heute) RETURNING id INTO v_z;
  v_erg := v_erg || pg_temp.s112_erwarte('sammel_bezahlt_beide',
    (SELECT concat_ws('|', r.bezahlt, (SELECT bool_and(v.bezahlt) FROM public.verkaufsposten v WHERE v.rechnung_id = r.id)) FROM public.rechnungen r WHERE r.id = v_re2), 't|t');
  v_erg := v_erg || pg_temp.s112_erwarte('zahlung_c_an_sammelrechnung',
    (SELECT z.rechnung_id = v_re2 FROM public.zahlungen z WHERE z.id = v_z), true);

  -- ── 3. Storno einer Zahlung hebt bezahlt wieder auf ──────────────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  PERFORM public.s112_zahlung_stornieren(v_b, v_z, 'S112TEST Zahlung falsch', v_heute);
  v_erg := v_erg || pg_temp.s112_erwarte('storno_offen',
    (SELECT concat_ws('|', r.bezahlt, (SELECT bool_or(v.bezahlt) FROM public.verkaufsposten v WHERE v.rechnung_id = r.id)) FROM public.rechnungen r WHERE r.id = v_re2), 'f|f');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 7);
END $test$;
