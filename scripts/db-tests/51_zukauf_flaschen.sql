-- @bereich: Zukauf Flaschen als Handelsware (KAN-41 Paket 2b) – RPC s112_zukauf_buchen mit p_fuellung, Journal, Freeze, Storno
-- @ziel: Ein Flaschenzukauf legt in EINER Transaktion Zukauf und Weinlager-Artikel (Füllung ohne Charge, zukauf_posten_id)
-- @ziel: an; Merkmale, Anzahl, Prüfnummer und Einstandspreis je Flasche kommen aus dem Zukauf. Das Journal bucht ZK_FLA mit
-- @ziel: Bezug auf den Zukauf. Abgelehnt: Prüfnummer fehlt ab Qualitätswein (E2), Weinlager-Artikel bei anderer Art,
-- @ziel: Merkmal-Änderung am Zukauf (Freeze), Storno der Füllung allein, Storno des Zukaufs nach einer Bewegung (E3).
-- @ziel: Storno ohne Bewegung storniert die Füllung mit (Journal-Gegenbuchung).
-- @mutation storno_ohne_pruefung: Zukauf-Storno prüft keine Bewegung | rot: storno_mit_bewegung
-- @mutation journal_ohne_bezug: ZK_FLA ohne zukauf_posten_id | rot: journal_zk_fla
-- @mutation fuellung_frei: Füllung lässt sich allein stornieren | rot: fuellung_storno_allein
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 51 (Stand 06.10.2026, KAN-41). Alles zurückgerollt.

CREATE FUNCTION pg_temp.t51_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't51_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;   -- wie die RPCs (Wiener Zeit, nicht UTC)
  c_datei constant text := '51_zukauf_flaschen';
  c_rpc   constant text := 'SELECT public.s112_zukauf_buchen(%L::uuid, %L::jsonb, NULL, NULL, %L::jsonb)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_zk    jsonb;
  v_fl    jsonb := '{"name": "S112TEST Handel GV", "flaschengroesse_ml": 750, "vk_preis_brutto": 18.9}';
  v_r     jsonb;
  v_z     uuid;
  v_f     uuid;
  v_z2    uuid;
  v_f2    uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres): Journal ab vor 30 Tagen ───────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  UPDATE public.tenant_einstellungen SET journal_ab = v_heute - 30 WHERE tenant_id = v_b;
  v_zk := jsonb_build_object('datum', v_heute - 2, 'art', 'flaschen', 'weinart', 'weiss', 'rebsorte', 'Grüner Veltliner',
    'jahrgang', 2025, 'qualitaetsstufe', 'qualitaetswein', 'land_iso', 'AT', 'herkunft', 'kamptal_gebietswein', 'alkohol_pct', 12.5,
    'staatliche_pruefnummer', 'N 4711/26', 'menge', 120, 'einheit', 'Stk', 'preis_gesamt', 1200, 'notizen', 'S112TEST Flaschenzukauf');

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('storno_ohne_pruefung',
    $m$SELECT pg_temp.t51_ersetze('public.s112_flaschenzukauf_storno()'::regprocedure,
      $r$IF EXISTS \(SELECT 1 FROM public\.fuellungen f$r$, $r$IF false AND EXISTS (SELECT 1 FROM public.fuellungen f$r$)$m$);
  PERFORM pg_temp.s112_mutiere('journal_ohne_bezug',
    $m$SELECT pg_temp.t51_ersetze('public.s112_journal_zeilen_fuellung(jsonb)'::regprocedure,
      $r$'zukauf_posten_id', f ->> 'zukauf_posten_id', $r$, '')$m$);
  PERFORM pg_temp.s112_mutiere('fuellung_frei',
    $m$SELECT pg_temp.t51_ersetze('public.s112_flaschenzukauf_fuellung_schutz()'::regprocedure,
      $r$IF OLD\.zukauf_posten_id IS NOT NULL$r$, $r$IF false AND OLD.zukauf_posten_id IS NOT NULL$r$)$m$);

  -- ── 1. Ablehnungen der RPC ────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('pruefnummer_pflicht',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_zk - 'staatliche_pruefnummer', v_fl)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_artikel',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_zukauf_buchen(%L::uuid, %L::jsonb)', v_b, v_zk)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('artikel_nur_bei_flaschen',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_zk || '{"art": "wein", "einheit": "L"}', v_fl)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('ganze_stueckzahl',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_zk || '{"menge": 12.5}', v_fl)), ':', 1), '22023');

  -- ── 2. Flaschenzukauf als winzer: Zukauf + Weinlager-Artikel ──────────────────────────────────────────
  EXECUTE format(c_rpc, v_b, v_zk, v_fl) INTO v_r;
  v_z := (v_r ->> 'zukauf_id')::uuid;
  v_f := (v_r ->> 'fuellung_id')::uuid;
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('artikel_angelegt',
    (SELECT concat_ws('|', f.zukauf_posten_id = v_z, f.weinausbau_id IS NULL, f.anzahl_flaschen, f.bestand_flaschen, f.einstandspreis,
                      f.qualitaet, f.rebsorte, f.jahrgang, f.pruefnummer, f.flaschengroesse_ml, f.datum = v_heute - 2)
       FROM public.fuellungen f WHERE f.id = v_f),
    't|t|120|120|10.00|qualitaetswein|Grüner Veltliner|2025|N 4711/26|750|t');
  v_erg := v_erg || pg_temp.s112_erwarte('journal_zk_fla',
    (SELECT string_agg(k.buchungsart_code || '=' || k.menge_liter::numeric(10, 0)::text || ':' || (k.zukauf_posten_id = v_z)::text, ',')
       FROM public.kellerbuch_buchungen k WHERE k.fuellung_id = v_f),
    'ZK_FLA=90:true');

  -- ── 3. Freeze und Storno-Schutz ───────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('freeze_merkmale',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.zukauf_posten SET rebsorte = %L WHERE id = %L', 'Riesling', v_z)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_aenderbar',
    pg_temp.s112_fehlertext(format('UPDATE public.zukauf_posten SET notizen = %L WHERE id = %L', 'S112TEST geändert', v_z)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('fuellung_storno_allein',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.fuellungen SET storniert_am = now(), storno_grund = %L, aktiv = false WHERE id = %L',
      'S112TEST Storno', v_f)), ':', 1), '42501');

  -- ── 4. Storno ohne Bewegung storniert die Füllung mit ─────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('storno_ohne_bewegung',
    pg_temp.s112_fehlertext(format('UPDATE public.zukauf_posten SET aktiv = false, storniert_am = now(), storno_grund = %L WHERE id = %L',
      'S112TEST Tippfehler', v_z)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('fuellung_mitstorniert',
    (SELECT concat_ws('|', f.storniert_am IS NOT NULL, f.aktiv, f.storno_grund) FROM public.fuellungen f WHERE f.id = v_f),
    't|f|S112TEST Tippfehler');
  v_erg := v_erg || pg_temp.s112_erwarte('journal_gegenbuchung',
    (SELECT sum(k.menge_liter)::numeric(10, 0)::text FROM public.kellerbuch_buchungen k WHERE k.fuellung_id = v_f), '0');

  -- ── 5. Nach einer Bewegung kein Storno mehr (E3) ──────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  EXECUTE format(c_rpc, v_b, v_zk || '{"notizen": "S112TEST Flaschenzukauf 2"}', v_fl || '{"name": "S112TEST Handel GV 2"}') INTO v_r;
  v_z2 := (v_r ->> 'zukauf_id')::uuid;
  v_f2 := (v_r ->> 'fuellung_id')::uuid;
  PERFORM pg_temp.s112_als_postgres();
  PERFORM pg_temp.s112_beispiel('fuellung_bewegungen', v_b, NULL, jsonb_build_object('fuellung_id', v_f2, 'datum', v_heute - 1,
    'art', 'bruch', 'menge_stk', -1, 'verkaufsposten_id', NULL));
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('storno_mit_bewegung',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.zukauf_posten SET aktiv = false, storniert_am = now(), storno_grund = %L WHERE id = %L',
      'S112TEST zu spät', v_z2)), ':', 1), '42501');
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 13);
END $test$;
