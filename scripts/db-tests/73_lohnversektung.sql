-- @bereich: Lohnversektung (KAN-232) – lohnversektungen, s112_lohnversektung_versenden/_stornieren, Rückkehr als Füllung,
-- @bereich: Journal LNSKT/LNSKT_ZU, Genealogie
-- @ziel: Der Versand bucht nichts: Die Charge behält ihre Menge (eigener Bestand bei Dritten), gibt ihr Gebinde frei und lässt
-- @ziel: sich nicht ein zweites Mal versenden. Die Rückkehr ist eine Füllung mit lohnversektung_id: Journal LNSKT (Grundwein ab)
-- @ziel: und LNSKT_ZU (Sekt zu) statt FUELLUNG, kein Füllverlust; die Genealogie führt von der Charge zur Sekt-Füllung. Mit der
-- @ziel: letzten Teillieferung ist der Versand abgeschlossen, ein Storno der Rückkehr öffnet ihn wieder. Rückkehr nur aus der
-- @ziel: versandten Charge eines offenen Versands. Storno des Versands nur ohne Rückkehr, die Charge kommt ins Gebinde zurück.
-- @ziel: Leser, fremde Charge/Firma/Lohnversektung und direktes Schreiben werden abgelehnt.
-- @mutation journal_fuellung: Rückkehr bucht wie eine normale Füllung | rot: journal_lnskt
-- @mutation ohne_abschluss: Abschluss nach der letzten Lieferung fehlt | rot: abgeschlossen
-- @mutation storno_mit_rueckkehr: Storno des Versands trotz Rückkehr | rot: storno_mit_rueckkehr
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 73 (Stand 08.10.2026, KAN-232). Alles zurückgerollt.

CREATE FUNCTION pg_temp.t73_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't73_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  c_datei constant text := '73_lohnversektung';
  c_vers  constant text := 'SELECT public.s112_lohnversektung_versenden(%L::uuid, %L::uuid, %L::date, %L::uuid, NULL)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_beh   uuid;
  v_gw    uuid;   -- Grundwein 300 L
  v_gw2   uuid;   -- zweite Charge (Storno-Fall)
  v_beh2  uuid;
  v_fa    uuid;   -- Sektkellerei
  v_fm    uuid;   -- fremde Firma
  v_wm    uuid;   -- fremde Charge
  v_lv    uuid;
  v_lv2   uuid;
  v_r1    uuid;   -- Rückkehr 1
  v_r2    uuid;   -- Rückkehr 2 (letzte)
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ─────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  UPDATE public.tenant_einstellungen SET journal_ab = v_heute - 30 WHERE tenant_id = v_b;
  v_beh := (pg_temp.s112_beispiel('behaelter', v_b, NULL, '{"aktiv": true, "gemeinsam": false}') ->> 'id')::uuid;
  v_beh2 := (pg_temp.s112_beispiel('behaelter', v_b, NULL, '{"aktiv": true, "gemeinsam": false}') ->> 'id')::uuid;
  v_gw := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, jsonb_build_object('menge_liter', 300, 'status', 'ausbau', 'aktiv', true,
    'storniert_am', NULL, 'weinart', 'weiss', 'erzeugnis', 'WEINGU', 'behaelter_id', v_beh)) ->> 'id')::uuid;
  v_gw2 := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, jsonb_build_object('menge_liter', 100, 'status', 'ausbau', 'aktiv', true,
    'storniert_am', NULL, 'weinart', 'weiss', 'erzeugnis', 'WEINGU', 'behaelter_id', v_beh2)) ->> 'id')::uuid;
  PERFORM pg_temp.s112_beispiel('kellerbuch_buchungen', v_b, NULL, jsonb_build_object('weinausbau_id', x.id, 'menge_liter', x.l, 'datum', v_heute - 10))
     FROM (VALUES (v_gw, 300), (v_gw2, 100)) x (id, l);
  v_fa := (pg_temp.s112_beispiel('firmen', v_b, NULL, '{"name": "S112TEST Sektkellerei"}') ->> 'id')::uuid;
  v_fm := (pg_temp.s112_beispiel('firmen', v_m, NULL, '{"name": "S112TEST fremde Kellerei"}') ->> 'id')::uuid;
  v_wm := (pg_temp.s112_beispiel('weinausbau', v_m, NULL, '{"menge_liter": "100", "status": "ausbau", "aktiv": true, "storniert_am": null}') ->> 'id')::uuid;

  PERFORM pg_temp.s112_mutiere('journal_fuellung',
    $m$SELECT pg_temp.t73_ersetze('public.s112_journal_zeilen_fuellung(jsonb)'::regprocedure,
      $r$IF v_wa IS NOT NULL AND NULLIF\(f ->> 'lohnversektung_id', ''\) IS NOT NULL THEN$r$, $r$IF false THEN$r$)$m$);
  PERFORM pg_temp.s112_mutiere('ohne_abschluss',
    $m$SELECT pg_temp.t73_ersetze('public.s112_lohnversektung_stand()'::regprocedure,
      $r$SET abgeschlossen_am = CASE WHEN v_summe >= v_lv\.liter_versandt - 0\.005$r$, $r$SET abgeschlossen_am = CASE WHEN false$r$)$m$);
  PERFORM pg_temp.s112_mutiere('storno_mit_rueckkehr',
    $m$SELECT pg_temp.t73_ersetze('public.s112_lohnversektung_stornieren(uuid, uuid, text)'::regprocedure,
      $r$IF EXISTS \(SELECT 1 FROM public\.fuellungen f WHERE f\.lohnversektung_id = p_id AND f\.storniert_am IS NULL\) THEN$r$, $r$IF false THEN$r$)$m$);

  -- ── 1. Versand: Menge bleibt, Gebinde frei, nicht doppelt ─────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_lv := public.s112_lohnversektung_versenden(v_b, v_gw, v_heute - 5, v_fa, 'S112TEST Versand');
  v_erg := v_erg || pg_temp.s112_erwarte('versand',
    (SELECT concat_ws('|', w.menge_liter::numeric(10,2), w.behaelter_id IS NULL, l.liter_versandt, l.behaelter_id_vorher = v_beh, l.abgeschlossen_am IS NULL)
       FROM public.weinausbau w JOIN public.lohnversektungen l ON l.weinausbau_id = w.id WHERE l.id = v_lv), '300.00|t|300.00|t|t');
  v_erg := v_erg || pg_temp.s112_erwarte('versand_bucht_nichts',
    (SELECT count(*) FROM public.kellerbuch_buchungen k WHERE k.tenant_id = v_b AND k.buchungsart_code IN ('LNSKT', 'LNSKT_ZU')), 0::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('nicht_doppelt',
    split_part(pg_temp.s112_fehlertext(format(c_vers, v_b, v_gw, v_heute, v_fa)), ':', 1), '22023');

  -- ── 2. Rückkehr 1 (Teillieferung): 140 L Grundwein → 200 × 0,75 L Sekt ────────────────────
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.weinausbau SET menge_liter = 160 WHERE id = v_gw;   -- wie createFuellung: Charge mindern
  v_r1 := (pg_temp.s112_beispiel('fuellungen', v_b, v_bw, jsonb_build_object('weinausbau_id', v_gw, 'lohnversektung_id', v_lv,
    'datum', v_heute - 2, 'anzahl_flaschen', 200, 'bestand_flaschen', 200, 'anzahl_unetikettiert', 0, 'flaschengroesse_ml', 750,
    'menge_liter_gefuellt', 140, 'erzeugnis', 'SEKTGU', 'storniert_am', NULL)) ->> 'id')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('journal_lnskt',
    (SELECT string_agg(k.buchungsart_code || ':' || k.bestand || ':' || k.menge_liter::numeric(10,2) || ':' || coalesce(k.menge_stk::text, '-'), ',' ORDER BY k.buchungsart_code)
       FROM public.kellerbuch_buchungen k WHERE k.fuellung_id = v_r1 AND k.storno_von_id IS NULL),
    'LNSKT:offen:-140.00:0,LNSKT_ZU:flasche:150.00:200');
  v_erg := v_erg || pg_temp.s112_erwarte('genealogie',
    (SELECT count(*) FROM public.charge_herkunft h WHERE h.nach_fuellung_id = v_r1 AND h.von_weinausbau_id = v_gw AND NOT h.gegenbuchung), 1::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('teil_offen',
    (SELECT abgeschlossen_am IS NULL FROM public.lohnversektungen WHERE id = v_lv), true);

  -- ── 3. Letzte Lieferung: Rest 160 L → abgeschlossen; Storno der Rückkehr öffnet wieder ─────
  UPDATE public.weinausbau SET menge_liter = 0, aktiv = false, status = 'abgeschlossen' WHERE id = v_gw;
  v_r2 := (pg_temp.s112_beispiel('fuellungen', v_b, v_bw, jsonb_build_object('weinausbau_id', v_gw, 'lohnversektung_id', v_lv,
    'datum', v_heute - 1, 'anzahl_flaschen', 220, 'bestand_flaschen', 220, 'anzahl_unetikettiert', 0, 'flaschengroesse_ml', 750,
    'menge_liter_gefuellt', 160, 'erzeugnis', 'SEKTGU', 'storniert_am', NULL)) ->> 'id')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('abgeschlossen',
    (SELECT abgeschlossen_am = v_heute - 1 FROM public.lohnversektungen WHERE id = v_lv), true);
  v_erg := v_erg || pg_temp.s112_erwarte('nach_abschluss_keine_rueckkehr',
    split_part(pg_temp.s112_fehlertext(format('INSERT INTO public.fuellungen (tenant_id, weinausbau_id, lohnversektung_id, name, datum, anzahl_flaschen, bestand_flaschen, flaschengroesse_ml) VALUES (%L, %L, %L, %L, %L, 1, 1, 750)',
      v_b, v_gw, v_lv, 'S112TEST zu spät', v_heute)), ':', 1), '22023');
  PERFORM set_config('s112.freeze_frei', 'fuellungen', true);
  UPDATE public.fuellungen SET storniert_am = now(), storno_grund = 'S112TEST Rückkehr falsch erfasst' WHERE id = v_r2;
  PERFORM set_config('s112.freeze_frei', '', true);
  v_erg := v_erg || pg_temp.s112_erwarte('storno_oeffnet',
    (SELECT abgeschlossen_am IS NULL FROM public.lohnversektungen WHERE id = v_lv), true);

  -- ── 4. Rückkehr nur aus der versandten Charge ─────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('rueckkehr_falsche_charge',
    split_part(pg_temp.s112_fehlertext(format('INSERT INTO public.fuellungen (tenant_id, weinausbau_id, lohnversektung_id, name, datum, anzahl_flaschen, bestand_flaschen, flaschengroesse_ml) VALUES (%L, %L, %L, %L, %L, 1, 1, 750)',
      v_b, v_gw2, v_lv, 'S112TEST falsche Charge', v_heute)), ':', 1), '22023');

  -- ── 5. Storno des Versands: mit Rückkehr nein; ohne Rückkehr zurück ins Gebinde ───────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('storno_mit_rueckkehr',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_lohnversektung_stornieren(%L, %L, %L)', v_b, v_lv, 'S112TEST Versand storniert')), ':', 1), '22023');
  v_lv2 := public.s112_lohnversektung_versenden(v_b, v_gw2, v_heute, v_fa, NULL);
  PERFORM public.s112_lohnversektung_stornieren(v_b, v_lv2, 'S112TEST Versand irrtümlich');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_zurueck',
    (SELECT concat_ws('|', w.behaelter_id = v_beh2, l.storniert_am IS NOT NULL) FROM public.weinausbau w JOIN public.lohnversektungen l ON l.weinausbau_id = w.id
      WHERE l.id = v_lv2), 't|t');

  -- ── 6. Rechte und fremde Objekte ──────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('idor_fremde_charge',
    split_part(pg_temp.s112_fehlertext(format(c_vers, v_b, v_wm, v_heute, v_fa)), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('idor_fremde_firma',
    split_part(pg_temp.s112_fehlertext(format(c_vers, v_b, v_gw2, v_heute, v_fm)), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_schreiben',
    pg_temp.s112_versuch(format('INSERT INTO public.lohnversektungen (tenant_id, weinausbau_id, firma_id, datum, liter_versandt) VALUES (%L, %L, %L, %L, 1)',
      v_b, v_gw2, v_fa, v_heute)), 'G');   -- kein INSERT-Recht (nur über die RPC)
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_nicht',
    split_part(pg_temp.s112_fehlertext(format(c_vers, v_b, v_gw2, v_heute, v_fa)), ':', 1), '42501');
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 16);
END $test$;
