-- @bereich: Produktion (KAN-118) – RPCs s112_produktion_buchen/_stornieren, Journal AB_VERAR/ZU_PROD, Stoffkonto, Genealogie
-- @ziel: Aus Quell-Chargen und Zutaten entsteht eine neue Charge mit eigenem Erzeugnis: 600 L Wein + 400 L Wasser + CO2 ergeben
-- @ziel: 1.000 L weinhaltiges Getränk; die Quelle bucht AB_VERAR, das Ziel ZU_PROD (je Quelle mit Gegencharge, Wasser ohne),
-- @ziel: CO2 wird im Stoffkonto verwendet, die Genealogie kennt die Quelle. Abgelehnt: unter 50 % Wein, gemischte Weinarten,
-- @ziel: Wasser bei Perlwein, CO2 bei PetNat, Leser, fremde Charge, direktes Schreiben. Storno nur bei unveränderter Zielcharge;
-- @ziel: es bucht Menge, Journal und Stoffkonto zurück. Perlwein behält die Menge. KAN-119: Der Demo-Sekt des Musterhofs entsteht
-- @ziel: über eine Produktion (Grundwein → Tirage-Charge SEKTGU → Füllung).
-- @mutation ohne_weinanteil: 50-%-Prüfung ausgeschaltet | rot: weinanteil_unter_50
-- @mutation journal_leer: Zeilenfunktion bucht nichts | rot: journal_zeilen
-- @mutation storno_ohne_rueckbuchung: Storno bucht die Menge der Quelle nicht zurück | rot: storno_quelle
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 66 (Stand 08.10.2026, KAN-118). Alles zurückgerollt.

CREATE FUNCTION pg_temp.t66_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't66_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  c_datei constant text := '66_produktion';
  c_rpc   constant text := 'SELECT public.s112_produktion_buchen(%L::uuid, %L::jsonb, %L::jsonb)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_gv    uuid;   -- Weiß 600 L
  v_wr    uuid;   -- Weiß 400 L
  v_rot   uuid;   -- Rot 300 L
  v_wm    uuid;   -- fremde Charge
  v_beh1  uuid;
  v_beh2  uuid;
  v_co2   uuid;
  v_kopf  jsonb;
  v_p     uuid;
  v_ziel  uuid;
  v_pm    uuid;   -- Produktion im fremden Betrieb
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ──────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  UPDATE public.tenant_einstellungen SET journal_ab = v_heute - 30 WHERE tenant_id = v_b;
  v_gv := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "600", "status": "ausbau", "aktiv": true, "storniert_am": null, "weinart": "weiss", "erzeugnis": "WEINGU"}') ->> 'id')::uuid;
  v_wr := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "400", "status": "ausbau", "aktiv": true, "storniert_am": null, "weinart": "weiss", "erzeugnis": "WEIN"}') ->> 'id')::uuid;
  v_rot := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "300", "status": "ausbau", "aktiv": true, "storniert_am": null, "weinart": "rot", "erzeugnis": "WEIN"}') ->> 'id')::uuid;
  v_wm := (pg_temp.s112_beispiel('weinausbau', v_m, NULL, '{"menge_liter": "100", "status": "ausbau", "aktiv": true, "storniert_am": null}') ->> 'id')::uuid;
  PERFORM pg_temp.s112_beispiel('kellerbuch_buchungen', v_b, NULL, jsonb_build_object('weinausbau_id', x.id, 'menge_liter', x.l, 'datum', v_heute - 5))
     FROM (VALUES (v_gv, 600), (v_wr, 400), (v_rot, 300)) x (id, l);
  v_beh1 := (pg_temp.s112_beispiel('behaelter', v_b, NULL, '{"aktiv": true, "gemeinsam": false}') ->> 'id')::uuid;
  v_beh2 := (pg_temp.s112_beispiel('behaelter', v_b, NULL, '{"aktiv": true, "gemeinsam": false}') ->> 'id')::uuid;
  v_co2 := (pg_temp.s112_beispiel('kellermittel', v_b, NULL, '{"name": "S112TEST CO2", "einheit": "kg", "aktiv": true}') ->> 'id')::uuid;
  INSERT INTO public.produktionen (tenant_id, datum, art, erzeugnis, ziel_weinausbau_id, wein_liter, ziel_menge)
  VALUES (v_m, v_heute - 1, 'perlwein', 'PERLWEIN', v_wm, 1, 1) RETURNING id INTO v_pm;
  v_kopf := jsonb_build_object('datum', v_heute - 2, 'art', 'spritzer', 'name', 'S112TEST Spritzer', 'behaelter_id', v_beh1);

  PERFORM pg_temp.s112_mutiere('ohne_weinanteil',
    $m$SELECT pg_temp.t66_ersetze('public.s112_produktion_buchen(uuid, jsonb, jsonb)'::regprocedure,
      $r$IF v_art IN \('spritzer', 'mischgetraenk'\) AND v_wein \* 2 < v_wein \+ v_zusatz - 0\.005 THEN$r$, $r$IF false THEN$r$)$m$);
  PERFORM pg_temp.s112_mutiere('journal_leer',
    $m$SELECT pg_temp.t66_ersetze('public.s112_journal_zeilen_produktion(jsonb)'::regprocedure,
      $r$SELECT CASE WHEN NOT coalesce\(\(p ->> 'gebucht'\)::boolean, false\)$r$, $r$SELECT CASE WHEN true$r$)$m$);
  PERFORM pg_temp.s112_mutiere('storno_ohne_rueckbuchung',
    $m$SELECT pg_temp.t66_ersetze('public.s112_produktion_stornieren(uuid, uuid, text)'::regprocedure,
      $r$SET menge_liter = round\(coalesce\(menge_liter, 0\) \+ r\.menge, 2\),$r$, $r$SET menge_liter = menge_liter,$r$)$m$);

  -- ── 1. Ablehnungen ────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('weinanteil_unter_50',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_kopf, jsonb_build_array(
      jsonb_build_object('art', 'wein', 'weinausbau_id', v_wr, 'menge', 300), jsonb_build_object('art', 'wasser', 'menge', 400, 'einheit', 'l')))), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('weinart_gemischt',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_kopf, jsonb_build_array(
      jsonb_build_object('art', 'wein', 'weinausbau_id', v_wr, 'menge', 100), jsonb_build_object('art', 'wein', 'weinausbau_id', v_rot, 'menge', 100)))), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('wasser_bei_perlwein',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_kopf || '{"art": "perlwein"}', jsonb_build_array(
      jsonb_build_object('art', 'wein', 'weinausbau_id', v_wr, 'menge', 100), jsonb_build_object('art', 'wasser', 'menge', 10, 'einheit', 'l')))), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('co2_bei_petnat',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_kopf || '{"art": "petnat"}', jsonb_build_array(
      jsonb_build_object('art', 'wein', 'weinausbau_id', v_wr, 'menge', 100), jsonb_build_object('art', 'co2', 'menge', 1, 'einheit', 'kg')))), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('erzeugnis_passt_nicht',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_kopf || '{"erzeugnis": "SEKTGU"}', jsonb_build_array(
      jsonb_build_object('art', 'wein', 'weinausbau_id', v_wr, 'menge', 100)))), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('mehr_als_bestand',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_kopf, jsonb_build_array(
      jsonb_build_object('art', 'wein', 'weinausbau_id', v_wr, 'menge', 500)))), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('fremde_charge',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_kopf, jsonb_build_array(
      jsonb_build_object('art', 'wein', 'weinausbau_id', v_wm, 'menge', 10)))), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_per_api',
    split_part(pg_temp.s112_fehlertext(format('INSERT INTO public.produktionen (tenant_id, datum, art, erzeugnis, ziel_weinausbau_id, wein_liter, ziel_menge) VALUES (%L, pg_temp.s112_heute(), %L, %L, %L, 1, 1)',
      v_b, 'perlwein', 'PERLWEIN', v_wr)), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_nicht',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_kopf, jsonb_build_array(
      jsonb_build_object('art', 'wein', 'weinausbau_id', v_gv, 'menge', 600)))), ':', 1), '42501');

  -- ── 2. Perlweinspritzer: 600 L Wein + 400 L Wasser + 2 kg CO2 (Stoffkonto) ─────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('buchung_ok',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_kopf, jsonb_build_array(
      jsonb_build_object('art', 'wein', 'weinausbau_id', v_gv, 'menge', 600),
      jsonb_build_object('art', 'wasser', 'menge', 400, 'einheit', 'l'),
      jsonb_build_object('art', 'co2', 'menge', 2, 'einheit', 'kg', 'kellermittel_id', v_co2)))), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  SELECT p.id, p.ziel_weinausbau_id INTO v_p, v_ziel FROM public.produktionen p WHERE p.tenant_id = v_b AND p.art = 'spritzer';
  v_erg := v_erg || pg_temp.s112_erwarte('ziel_charge',
    (SELECT concat_ws('|', w.menge_liter::numeric(10, 0), w.erzeugnis, w.weinart, w.aktiv) FROM public.weinausbau w WHERE w.id = v_ziel), '1000|WEINHALT|weiss|t');
  v_erg := v_erg || pg_temp.s112_erwarte('quelle_abgeschlossen',
    (SELECT concat_ws('|', w.menge_liter::numeric(10, 0), w.aktiv, w.status) FROM public.weinausbau w WHERE w.id = v_gv), '0|f|abgeschlossen');
  v_erg := v_erg || pg_temp.s112_erwarte('journal_zeilen',
    (SELECT string_agg(k.buchungsart_code || '=' || k.menge_liter::numeric(10, 0)::text || CASE WHEN k.gegen_weinausbau_id IS NULL THEN '' ELSE '+g' END,
                       ',' ORDER BY k.buchungsart_code, k.menge_liter)
       FROM public.kellerbuch_buchungen k WHERE k.quelle_tabelle = 'produktionen' AND k.quelle_id = v_p),
    'AB_VERAR=-600+g,ZU_PROD=400,ZU_PROD=600+g');
  v_erg := v_erg || pg_temp.s112_erwarte('journal_ziel_erzeugnis',
    (SELECT string_agg(DISTINCT k.erzeugnis, ',') FROM public.kellerbuch_buchungen k WHERE k.quelle_id = v_p AND k.buchungsart_code = 'ZU_PROD'), 'WEINHALT');
  v_erg := v_erg || pg_temp.s112_erwarte('stoffkonto_verwendung',
    (SELECT sum(b.menge)::numeric(10, 1)::text FROM public.kellermittel_buchungen b WHERE b.produktion_id = v_p), '-2.0');
  v_erg := v_erg || pg_temp.s112_erwarte('genealogie',
    (SELECT count(*) FILTER (WHERE h.von_weinausbau_id = v_gv) || '|' || count(*) FILTER (WHERE h.von_weinausbau_id IS NULL)
       FROM public.charge_herkunft h WHERE h.nach_weinausbau_id = v_ziel AND NOT h.gegenbuchung), '1|1');
  v_erg := v_erg || pg_temp.s112_erwarte('folgebuchung_quelle', public.s112_charge_hat_folgebuchung(v_gv)::text, 'true');

  -- ── 3. Storno nur bei unveränderter Zielcharge ────────────────────────────────────────────────────────
  UPDATE public.weinausbau SET menge_liter = 990 WHERE id = v_ziel;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('storno_ziel_veraendert',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_produktion_stornieren(%L, %L, %L)', v_b, v_p, 'S112TEST falsche Menge')), ':', 1), '22023');
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.weinausbau SET menge_liter = 1000 WHERE id = v_ziel;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('storno_fremd',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_produktion_stornieren(%L, %L, %L)', v_b, v_pm, 'S112TEST fremde Produktion')), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_grund_pflicht',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_produktion_stornieren(%L, %L, %L)', v_b, v_p, 'kurz')), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_ok',
    pg_temp.s112_fehlertext(format('SELECT public.s112_produktion_stornieren(%L, %L, %L)', v_b, v_p, 'S112TEST falsche Menge')), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('storno_quelle',
    (SELECT concat_ws('|', w.menge_liter::numeric(10, 0), w.aktiv) FROM public.weinausbau w WHERE w.id = v_gv), '600|t');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_ziel',
    (SELECT concat_ws('|', w.menge_liter::numeric(10, 0), w.aktiv) FROM public.weinausbau w WHERE w.id = v_ziel), '0|f');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_journal_saldo',
    (SELECT sum(k.menge_liter)::numeric(10, 0)::text FROM public.kellerbuch_buchungen k WHERE k.quelle_tabelle = 'produktionen' AND k.quelle_id = v_p), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_stoffkonto',
    (SELECT sum(b.menge)::numeric(10, 1)::text FROM public.kellermittel_buchungen b WHERE b.produktion_id = v_p), '0.0');

  -- ── 4. Perlwein: Menge bleibt, Erzeugnis PERLWEIN ─────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('perlwein_ok',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_kopf || jsonb_build_object('art', 'perlwein', 'name', 'S112TEST Perlwein', 'behaelter_id', v_beh2),
      jsonb_build_array(jsonb_build_object('art', 'wein', 'weinausbau_id', v_wr, 'menge', 400), jsonb_build_object('art', 'co2', 'menge', 1.5, 'einheit', 'kg')))), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('perlwein_ziel',
    (SELECT concat_ws('|', w.menge_liter::numeric(10, 0), w.erzeugnis) FROM public.produktionen p JOIN public.weinausbau w ON w.id = p.ziel_weinausbau_id
      WHERE p.tenant_id = v_b AND p.art = 'perlwein'), '400|PERLWEIN');

  -- ── 5. KAN-119: Demo-Sekt im Musterhof entsteht über die Produktion (Grundwein → Tirage-Charge SEKTGU → Füllung) ──
  v_erg := v_erg || pg_temp.s112_erwarte('demo_sekt_produktion',
    (SELECT concat_ws('|', p.art, p.erzeugnis, w.erzeugnis, (SELECT count(*) FROM public.produktion_eingaenge e WHERE e.produktion_id = p.id AND e.art = 'wein'))
       FROM public.fuellungen f JOIN public.weinausbau w ON w.id = f.weinausbau_id
       JOIN public.produktionen p ON p.ziel_weinausbau_id = w.id AND p.storniert_am IS NULL
      WHERE f.id = public.demo_musterhof_id(19, 1)), 'schaumwein|SEKTGU|SEKTGU|1');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 25);
END $test$;
