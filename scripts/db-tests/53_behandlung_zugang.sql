-- @bereich: Volumenzugang durch Behandlung (KAN-41 Paket 3b) – keller_behandlungen.zugang_liter, Bestand, Journal ZU_BEH
-- @ziel: Eine Kellerbehandlung mit Volumenzugang erhöht den Bestand der Charge und bucht ZU_BEH am Tag der Behandlung;
-- @ziel: eine Änderung des Zugangs bucht nur die Differenz, ein Storno nimmt Bestand und Buchung zurück (Gegenbuchung).
-- @ziel: Abgelehnt: Zugang ohne Charge bzw. ≤ 0 (CHECK) und eine Rücknahme, für die die Charge nicht mehr genug Bestand hat.
-- @mutation bestand_aus: Trigger ändert den Bestand nicht | rot: bestand_zugang
-- @mutation journal_leer: Zeilenfunktion bucht nichts | rot: journal_zu_beh
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 53 (Stand 06.10.2026, KAN-41). Alles zurückgerollt.

CREATE FUNCTION pg_temp.t53_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't53_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;   -- wie die RPCs (Wiener Zeit, nicht UTC)
  c_datei constant text := '53_behandlung_zugang';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_wa    uuid;
  v_kb    uuid;
  v_kb2   uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres): Journal ab vor 30 Tagen, Charge 500 L ──────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  UPDATE public.tenant_einstellungen SET journal_ab = v_heute - 30 WHERE tenant_id = v_b;
  v_wa := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "500", "status": "ausbau", "aktiv": true, "storniert_am": null}') ->> 'id')::uuid;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('bestand_aus',
    $m$SELECT pg_temp.t53_ersetze('public.s112_behandlung_zugang_bestand()'::regprocedure,
      $r$HAVING sum\(x\.d\) <> 0$r$, $r$HAVING false$r$)$m$);
  PERFORM pg_temp.s112_mutiere('journal_leer',
    $m$SELECT pg_temp.t53_ersetze('public.s112_journal_zeilen_behandlung(jsonb)'::regprocedure,
      $r$SELECT CASE WHEN b ->> 'weinausbau_id' IS NOT NULL$r$, $r$SELECT CASE WHEN false$r$)$m$);

  -- ── 1. CHECK: Zugang nur > 0 und mit Charge ───────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('zugang_ohne_charge',
    split_part(pg_temp.s112_fehlertext(format('SELECT pg_temp.s112_beispiel(%L, %L, %L, %L::jsonb)', 'keller_behandlungen', v_b, v_bw,
      '{"zugang_liter": 10, "weinausbau_id": null, "storniert_am": null}')), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('zugang_null_liter',
    split_part(pg_temp.s112_fehlertext(format('SELECT pg_temp.s112_beispiel(%L, %L, %L, %L::jsonb)', 'keller_behandlungen', v_b, v_bw,
      jsonb_build_object('zugang_liter', 0, 'weinausbau_id', v_wa, 'storniert_am', NULL))), ':', 1), '23514');

  -- ── 2. Süßreserve 30 L vor 2 Tagen ────────────────────────────────────────────────────────────────────
  v_kb := (pg_temp.s112_beispiel('keller_behandlungen', v_b, v_bw, jsonb_build_object('weinausbau_id', v_wa, 'datum', v_heute - 2,
    'zugang_liter', 30, 'storniert_am', NULL)) ->> 'id')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('bestand_zugang',
    (SELECT w.menge_liter::numeric(10, 0)::text FROM public.weinausbau w WHERE w.id = v_wa), '530');
  v_erg := v_erg || pg_temp.s112_erwarte('journal_zu_beh',
    (SELECT string_agg(k.buchungsart_code || '=' || k.menge_liter::numeric(10, 0)::text || '@' || (v_heute - k.datum)::text, ',')
       FROM public.kellerbuch_buchungen k WHERE k.quelle_tabelle = 'keller_behandlungen' AND k.quelle_id = v_kb),
    'ZU_BEH=30@2');

  -- ── 3. Änderung auf 40 L: nur die Differenz ───────────────────────────────────────────────────────────
  UPDATE public.keller_behandlungen SET zugang_liter = 40 WHERE id = v_kb;
  v_erg := v_erg || pg_temp.s112_erwarte('bestand_aenderung',
    (SELECT w.menge_liter::numeric(10, 0)::text FROM public.weinausbau w WHERE w.id = v_wa), '540');
  v_erg := v_erg || pg_temp.s112_erwarte('journal_aenderung',
    (SELECT sum(k.menge_liter)::numeric(10, 0)::text FROM public.kellerbuch_buchungen k WHERE k.quelle_tabelle = 'keller_behandlungen' AND k.quelle_id = v_kb), '40');

  -- ── 4. Storno: Bestand und Buchung zurück ─────────────────────────────────────────────────────────────
  UPDATE public.keller_behandlungen SET storniert_am = now(), storno_grund = 'S112TEST Storno Zugang' WHERE id = v_kb;
  v_erg := v_erg || pg_temp.s112_erwarte('bestand_storno',
    (SELECT w.menge_liter::numeric(10, 0)::text FROM public.weinausbau w WHERE w.id = v_wa), '500');
  v_erg := v_erg || pg_temp.s112_erwarte('journal_storno_saldo',
    (SELECT sum(k.menge_liter)::numeric(10, 0)::text FROM public.kellerbuch_buchungen k WHERE k.quelle_tabelle = 'keller_behandlungen' AND k.quelle_id = v_kb), '0');

  -- ── 5. Rücknahme ohne Bestand abgelehnt ───────────────────────────────────────────────────────────────
  v_kb2 := (pg_temp.s112_beispiel('keller_behandlungen', v_b, v_bw, jsonb_build_object('weinausbau_id', v_wa, 'datum', v_heute - 1,
    'zugang_liter', 20, 'storniert_am', NULL)) ->> 'id')::uuid;
  UPDATE public.weinausbau SET menge_liter = 10 WHERE id = v_wa;   -- inzwischen weitgehend abgegangen
  v_erg := v_erg || pg_temp.s112_erwarte('ruecknahme_ohne_bestand',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.keller_behandlungen SET storniert_am = now(), storno_grund = %L WHERE id = %L',
      'S112TEST zu spät', v_kb2)), ':', 1), '22023');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 9);
END $test$;
