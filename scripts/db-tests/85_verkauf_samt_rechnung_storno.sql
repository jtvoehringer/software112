-- @bereich: Verkauf samt Rechnung stornieren (KAN-356) – s112_verkauf_samt_rechnung_stornieren
-- @ziel: Eine eigene Rechnung mit genau einem Lieferschein wird zusammen mit dem Verkauf in einer Transaktion storniert:
-- @ziel: Rechnung storniert (Nummer bleibt), Lieferschein storniert, Flaschen und offener Wein zurückgebucht (abgeschlossene
-- @ziel: Charge wieder aktiv). Abgelehnt werden Sammelrechnungen, Spiegelrechnungen (Verkauf sofort), Lieferscheine mit
-- @ziel: ausgestellter Transportbescheinigung, Leser und ein zu kurzer Grund; scheitert ein späterer Schritt, bleibt alles
-- @ziel: unverändert (auch die Rechnung).
-- @mutation ohne_tb_pruefung: Funktion ohne Prüfung der Transportbescheinigung | rot: tb_.*
-- @mutation ohne_sammel_pruefung: Funktion ohne Prüfung „genau ein Lieferschein“ | rot: sammel_.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 85 (Stand 27.10.2026, KAN-356). Alles zurückgerollt.

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  c_datei constant text := '85_verkauf_samt_rechnung_storno';
  c_rpc   constant text := 'SELECT public.s112_verkauf_samt_rechnung_stornieren(%L::uuid, %L::uuid, %L)';
  c_pos   constant text := 'INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz, fuellung_id, weinausbau_id) VALUES (%L, %L, %L, %L, %s, %L, 10, 13, %L, %L)';
  c_fn    constant text := 'public.s112_verkauf_samt_rechnung_stornieren(uuid,uuid,text,date)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_f     uuid;    -- Füllung, 100 Flaschen
  v_w     uuid;    -- Charge, leer und abgeschlossen
  v_wx    uuid;    -- Charge, storniert (Schreibfehler nach dem Rechnungsstorno)
  v_ls1   uuid;    -- eigene Rechnung, ein Lieferschein: Flaschen + Tank
  v_r1    uuid;
  v_ls2   uuid;    -- Sammelrechnung
  v_ls3   uuid;
  v_r2    uuid;
  v_ls4   uuid;    -- ausgestellte Transportbescheinigung
  v_ls5   uuid;    -- Verkauf sofort (Spiegel)
  v_ls6   uuid;    -- Rechnung, Tank auf stornierter Charge → Abbruch nach dem Rechnungsstorno
  v_r6    uuid;
  v_mvp   uuid;    -- Verkauf des Musterhofs (fremd für B)
  v_txt   text;
  v_json  jsonb;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ──────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);
  v_f := (pg_temp.s112_beispiel('fuellungen', v_b, v_bw, '{"bestand_flaschen": "100", "anzahl_flaschen": "100"}') ->> 'id')::uuid;
  v_w := (pg_temp.s112_beispiel('weinausbau', v_b, NULL,
    '{"menge_liter": "0", "status": "abgeschlossen", "aktiv": false, "storniert_am": null, "weinart": "weiss"}') ->> 'id')::uuid;
  v_wx := (pg_temp.s112_beispiel('weinausbau', v_b, NULL,
    '{"menge_liter": "50", "status": "ausbau", "aktiv": true, "storniert_am": null, "weinart": "weiss"}') ->> 'id')::uuid;

  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen, rechnung_spaeter) VALUES (v_b, v_heute, 'S112TEST KAN-356 eins', true) RETURNING id INTO v_ls1;
  EXECUTE format(c_pos, v_b, v_ls1, 'flasche', 'S112TEST Flasche', 6, 'Stk', v_f, NULL);
  EXECUTE format(c_pos, v_b, v_ls1, 'tank', 'S112TEST Tank', 100, 'L', NULL, v_w);
  v_r1 := public.s112_rechnung_erstellen(v_b, ARRAY[v_ls1], v_heute, '[]'::jsonb, NULL);

  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen, rechnung_spaeter) VALUES (v_b, v_heute, 'S112TEST KAN-356 sammel a', true) RETURNING id INTO v_ls2;
  EXECUTE format(c_pos, v_b, v_ls2, 'sonstiges', 'S112TEST A', 1, 'Stk', NULL, NULL);
  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen, rechnung_spaeter) VALUES (v_b, v_heute, 'S112TEST KAN-356 sammel b', true) RETURNING id INTO v_ls3;
  EXECUTE format(c_pos, v_b, v_ls3, 'sonstiges', 'S112TEST B', 1, 'Stk', NULL, NULL);
  v_r2 := public.s112_rechnung_erstellen(v_b, ARRAY[v_ls2, v_ls3], v_heute, '[]'::jsonb, NULL);

  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen, rechnung_spaeter) VALUES (v_b, v_heute, 'S112TEST KAN-356 TB', true) RETURNING id INTO v_ls4;
  EXECUTE format(c_pos, v_b, v_ls4, 'sonstiges', 'S112TEST TB', 1, 'Stk', NULL, NULL);
  PERFORM public.s112_rechnung_erstellen(v_b, ARRAY[v_ls4], v_heute, '[]'::jsonb, NULL);
  PERFORM pg_temp.s112_zeile('transportbescheinigungen', v_b,
    jsonb_build_object('verkaufsposten_id', v_ls4, 'status', 'ausgestellt', 'storniert_am', NULL, 'storno_grund', NULL));

  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen) VALUES (v_b, v_heute, 'S112TEST KAN-356 sofort') RETURNING id INTO v_ls5;

  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen, rechnung_spaeter) VALUES (v_b, v_heute, 'S112TEST KAN-356 abbruch', true) RETURNING id INTO v_ls6;
  EXECUTE format(c_pos, v_b, v_ls6, 'flasche', 'S112TEST Flasche', 4, 'Stk', v_f, NULL);
  EXECUTE format(c_pos, v_b, v_ls6, 'tank', 'S112TEST Tank', 10, 'L', NULL, v_wx);
  v_r6 := public.s112_rechnung_erstellen(v_b, ARRAY[v_ls6], v_heute, '[]'::jsonb, NULL);
  UPDATE public.weinausbau SET storniert_am = now(), storno_grund = 'S112TEST Charge storniert' WHERE id = v_wx;
  PERFORM set_config('s112.loeschen_erlaubt', '', true);
  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen, rechnung_spaeter) VALUES ((v_a ->> 'm')::uuid, v_heute, 'S112TEST KAN-356 fremd', true) RETURNING id INTO v_mvp;

  PERFORM pg_temp.s112_mutiere('ohne_tb_pruefung',
    replace(pg_get_functiondef(c_fn::regprocedure), $r$AND t.status = 'ausgestellt'$r$, 'AND false'));
  PERFORM pg_temp.s112_mutiere('ohne_sammel_pruefung',
    replace(pg_get_functiondef(c_fn::regprocedure), 'IF v_anzahl <> 1 THEN', 'IF false THEN'));

  -- ── 1. Ablehnungen ────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_abgelehnt',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_ls1, 'S112TEST Leser darf nicht')), ': ', 1), '42501');
  PERFORM pg_temp.s112_als(v_bw);
  -- IDOR: fremder Verkauf unter dem eigenen Betrieb → nicht gefunden; fremder Betrieb → kein Zugriff
  v_erg := v_erg || pg_temp.s112_erwarte('idor_fremder_verkauf',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_mvp, 'S112TEST fremder Verkauf')), ': ', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('idor_fremder_betrieb',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_a ->> 'm', v_mvp, 'S112TEST fremder Betrieb')), ': ', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('grund_zu_kurz',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_ls1, 'kurz')), ': ', 1), '23514');
  v_txt := pg_temp.s112_fehlertext(format(c_rpc, v_b, v_ls2, 'S112TEST Sammelrechnung'));
  v_erg := v_erg || pg_temp.s112_erwarte('sammel_abgelehnt', v_txt ~ '^22023: Die Rechnung .* umfasst 2 Lieferscheine.*HINT: sammelrechnung$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('sammel_unveraendert',
    (SELECT concat_ws('|', r.storniert, (SELECT count(*) FROM public.verkaufsposten v WHERE v.rechnung_id = r.id AND NOT v.storniert))
       FROM public.rechnungen r WHERE r.id = v_r2), 'f|2');
  v_txt := pg_temp.s112_fehlertext(format(c_rpc, v_b, v_ls4, 'S112TEST mit Transportbescheinigung'));
  v_erg := v_erg || pg_temp.s112_erwarte('tb_abgelehnt', v_txt ~ 'ausgestellte Transportbescheinigung.*HINT: transportbescheinigung$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('tb_unveraendert',
    (SELECT concat_ws('|', v.storniert, v.rechnung_id IS NOT NULL) FROM public.verkaufsposten v WHERE v.id = v_ls4), 'f|t');
  v_txt := pg_temp.s112_fehlertext(format(c_rpc, v_b, v_ls5, 'S112TEST Verkauf sofort'));
  v_erg := v_erg || pg_temp.s112_erwarte('spiegel_abgelehnt', v_txt ~ 'HINT: spiegel$', true);

  -- ── 2. Abbruch nach dem Rechnungsstorno: alles bleibt (Rechnung, Flaschen) ─────────────────────────────
  v_txt := pg_temp.s112_fehlertext(format(c_rpc, v_b, v_ls6, 'S112TEST Charge storniert'));
  v_erg := v_erg || pg_temp.s112_erwarte('abbruch_fehler', v_txt <> 'ok', true);
  v_erg := v_erg || pg_temp.s112_erwarte('abbruch_nichts_geaendert',
    (SELECT concat_ws('|', r.storniert, v.storniert, v.rechnung_id = r.id, f.bestand_flaschen)
       FROM public.rechnungen r, public.verkaufsposten v, public.fuellungen f
      WHERE r.id = v_r6 AND v.id = v_ls6 AND f.id = v_f), 'f|f|t|100');

  -- ── 3. Erfolg: Rechnung und Verkauf storniert, Bestand zurück, Charge wieder aktiv ─────────────────────
  v_txt := pg_temp.s112_fehlertext(format(c_rpc, v_b, v_ls1, 'S112TEST Kunde hat storniert'));
  v_erg := v_erg || pg_temp.s112_erwarte('storno_ok', v_txt, 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_rechnung',
    (SELECT concat_ws('|', r.storniert, r.storno_grund, jsonb_array_length(r.storno_positionen)) FROM public.rechnungen r WHERE r.id = v_r1),
    't|S112TEST Kunde hat storniert|2');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_lieferschein',
    (SELECT concat_ws('|', v.storniert, v.storniert_von = v_bw, v.rechnung_id IS NULL) FROM public.verkaufsposten v WHERE v.id = v_ls1), 't|t|t');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_flaschen',
    (SELECT concat_ws('|', f.bestand_flaschen,
       (SELECT count(*) FROM public.fuellung_bewegungen b WHERE b.fuellung_id = v_f AND b.verkaufsposten_id = v_ls1 AND b.art = 'verkauf_storno' AND b.menge_stk = 6))
       FROM public.fuellungen f WHERE f.id = v_f), '106|1');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_charge',
    (SELECT concat_ws('|', w.menge_liter, w.aktiv, w.status) FROM public.weinausbau w WHERE w.id = v_w), '100.00|t|ausbau');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_zweimal',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_ls1, 'S112TEST noch einmal')), ': ', 1), '22023');
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 16);
END
$test$;
