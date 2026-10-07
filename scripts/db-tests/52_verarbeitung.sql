-- @bereich: Verarbeitung einer Charge (KAN-41 Paket 3a) – RPCs s112_verarbeitung_buchen/_stornieren, Journal AB_VERAR
-- @ziel: Eine Menge verlässt die Charge durch Verarbeitung (Traubensaft, Essig, Brennerei, Sonstiges): die Charge wird
-- @ziel: gemindert, das Journal bucht AB_VERAR am Datum der Verarbeitung, die Verarbeitung ist eine Folgebuchung. Abgelehnt:
-- @ziel: Datum in der Zukunft bzw. vor der letzten Bewegung, mehr als der Bestand, unbekannter Zweck, Leser, fremder
-- @ziel: Betrieb und direktes Schreiben per API. Storno (Grund ≥ 10 Zeichen) bucht die Menge zurück und gegen;
-- @ziel: die ganze Menge schließt die Charge ab.
-- @mutation ohne_bestandspruefung: Menge über dem Bestand wird angenommen | rot: mehr_als_bestand
-- @mutation journal_leer: Zeilenfunktion bucht nichts | rot: journal_ab_verar
-- @mutation storno_ohne_rueckbuchung: Storno bucht die Menge nicht zurück | rot: storno_bestand
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 52 (Stand 06.10.2026, KAN-41). Alles zurückgerollt.

CREATE FUNCTION pg_temp.t52_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't52_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;   -- wie die RPCs (Wiener Zeit, nicht UTC)
  c_datei constant text := '52_verarbeitung';
  c_rpc   constant text := 'SELECT public.s112_verarbeitung_buchen(%L::uuid, %L::uuid, %L::date, %s, %L, %L)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_wa    uuid;
  v_wm    uuid;
  v_v     uuid;
  v_vm    uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres): Journal ab vor 30 Tagen, Charge 500 L (Zugang vor 5 Tagen) ─────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  UPDATE public.tenant_einstellungen SET journal_ab = v_heute - 30 WHERE tenant_id = v_b;
  v_wa := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "500", "status": "ausbau", "aktiv": true, "storniert_am": null}') ->> 'id')::uuid;
  v_wm := (pg_temp.s112_beispiel('weinausbau', v_m, NULL, '{"menge_liter": "100", "status": "ausbau"}') ->> 'id')::uuid;
  PERFORM pg_temp.s112_beispiel('kellerbuch_buchungen', v_b, NULL, jsonb_build_object('weinausbau_id', v_wa, 'menge_liter', 500,
    'datum', v_heute - 5, 'charge_status', 'ausbau'));
  -- Verarbeitung im fremden Betrieb (IDOR-Prüfung des Stornos)
  v_vm := (pg_temp.s112_beispiel('keller_verarbeitungen', v_m, NULL, jsonb_build_object('weinausbau_id', v_wm, 'datum', v_heute - 1,
    'menge_liter', 5, 'zweck', 'essig', 'storniert_am', NULL)) ->> 'id')::uuid;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('ohne_bestandspruefung',
    $m$SELECT pg_temp.t52_ersetze('public.s112_verarbeitung_buchen(uuid, uuid, date, numeric, text, text, uuid, numeric)'::regprocedure,
      $r$IF v_menge > coalesce\(v_w\.menge_liter, 0\) \+ 0\.005 THEN$r$, $r$IF false THEN$r$)$m$);
  PERFORM pg_temp.s112_mutiere('journal_leer',
    $m$SELECT pg_temp.t52_ersetze('public.s112_journal_zeilen_verarbeitung(jsonb)'::regprocedure,
      $r$SELECT CASE WHEN v ->> 'weinausbau_id' IS NOT NULL$r$, $r$SELECT CASE WHEN false$r$)$m$);
  PERFORM pg_temp.s112_mutiere('storno_ohne_rueckbuchung',
    $m$SELECT pg_temp.t52_ersetze('public.s112_verarbeitung_stornieren(uuid, uuid, text)'::regprocedure,
      $r$SET menge_liter = round\(coalesce\(menge_liter, 0\) \+ v_v\.menge_liter, 2\),$r$, $r$SET menge_liter = menge_liter,$r$)$m$);

  -- ── 1. Ablehnungen ────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('datum_zukunft',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wa, v_heute + 1, 100, 'traubensaft', NULL)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('vor_letzter_bewegung',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wa, v_heute - 10, 100, 'traubensaft', NULL)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('mehr_als_bestand',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wa, v_heute - 3, 600, 'essig', NULL)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('zweck_unbekannt',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wa, v_heute - 3, 100, 'saft', NULL)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('fremde_charge',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wm, v_heute - 3, 10, 'essig', NULL)), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_m, v_wm, v_heute - 3, 10, 'essig', NULL)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_per_api',
    split_part(pg_temp.s112_fehlertext(format('INSERT INTO public.keller_verarbeitungen (tenant_id, weinausbau_id, datum, menge_liter, zweck) VALUES (%L, %L, pg_temp.s112_heute(), 1, %L)',
      v_b, v_wa, 'essig')), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_nicht',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wa, v_heute - 3, 100, 'traubensaft', NULL)), ':', 1), '42501');

  -- ── 2. 200 L zu Traubensaft vor 3 Tagen ──────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('buchung_ok',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wa, v_heute - 3, 200, 'traubensaft', 'S112TEST Saft')), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  SELECT v.id INTO v_v FROM public.keller_verarbeitungen v WHERE v.weinausbau_id = v_wa AND v.notizen = 'S112TEST Saft';
  v_erg := v_erg || pg_temp.s112_erwarte('charge_gemindert',
    (SELECT concat_ws('|', w.menge_liter::numeric(10, 0), w.aktiv) FROM public.weinausbau w WHERE w.id = v_wa), '300|t');
  v_erg := v_erg || pg_temp.s112_erwarte('journal_ab_verar',
    (SELECT string_agg(k.buchungsart_code || '=' || k.menge_liter::numeric(10, 0)::text || '@' || (v_heute - k.datum)::text, ',')
       FROM public.kellerbuch_buchungen k WHERE k.quelle_tabelle = 'keller_verarbeitungen' AND k.quelle_id = v_v),
    'AB_VERAR=-200@3');
  v_erg := v_erg || pg_temp.s112_erwarte('folgebuchung', public.s112_charge_hat_folgebuchung(v_wa)::text, 'true');

  -- ── 3. Storno ─────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('storno_grund_pflicht',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_verarbeitung_stornieren(%L, %L, %L)', v_b, v_v, 'kurz')), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_fremd',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_verarbeitung_stornieren(%L, %L, %L)', v_b, v_vm, 'S112TEST fremde Buchung')), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_ok',
    pg_temp.s112_fehlertext(format('SELECT public.s112_verarbeitung_stornieren(%L, %L, %L)', v_b, v_v, 'S112TEST falsche Charge')), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('storno_bestand',
    (SELECT w.menge_liter::numeric(10, 0)::text FROM public.weinausbau w WHERE w.id = v_wa), '500');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_journal_saldo',
    (SELECT sum(k.menge_liter)::numeric(10, 0)::text FROM public.kellerbuch_buchungen k WHERE k.quelle_tabelle = 'keller_verarbeitungen' AND k.quelle_id = v_v), '0');

  -- ── 4. Ganze Menge schließt die Charge ab ─────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('ganze_menge_ok',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wa, v_heute, 500, 'brennerei', NULL)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('ganze_menge_abgeschlossen',
    (SELECT concat_ws('|', w.menge_liter::numeric(10, 0), w.aktiv, w.status) FROM public.weinausbau w WHERE w.id = v_wa), '0|f|abgeschlossen');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 19);
END $test$;
