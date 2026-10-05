-- @bereich: Umzug und Verschnitt nach dem Speichern fest (KAN-207)
-- @ziel: Ein gebuchter Umzug bzw. Verschnitt ist nur noch in Notizen und Storno änderbar (42501, HINT freeze); die
-- @ziel: Quellen eines Verschnitts sind fest, solange er nicht storniert ist (nur anteil_pct). Nach dem Storno gelten
-- @ziel: die Regeln des Storno-Schutzes.
-- @mutation umzug_frei: kein Freeze-Trigger auf keller_umzuege | rot: gesperrt_umzug_.*
-- @mutation verschnitt_frei: keine Freeze-Trigger auf verschneidungen und verschneidung_quellen | rot: gesperrt_verschnitt_.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 38 (Stand 05.10.2026, KAN-207). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '38_umzug_verschnitt_freeze';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_wa    uuid;
  v_wb    uuid;
  v_u     uuid;
  v_v     uuid;
  v_q     uuid;
  v_txt   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ───────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_wa := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "800"}') ->> 'id')::uuid;
  v_wb := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "200"}') ->> 'id')::uuid;
  v_u := (pg_temp.s112_beispiel('keller_umzuege', v_b, NULL, jsonb_build_object('von_weinausbau_id', v_wa, 'menge_liter', 100, 'datum', current_date - 2)) ->> 'id')::uuid;
  v_v := (pg_temp.s112_beispiel('verschneidungen', v_b, NULL, jsonb_build_object('ziel_weinausbau_id', v_wa, 'datum', current_date - 2)) ->> 'id')::uuid;
  v_q := (pg_temp.s112_beispiel('verschneidung_quellen', v_b, NULL, jsonb_build_object('verschneidung_id', v_v, 'quell_weinausbau_id', v_wb, 'menge_liter', 50)) ->> 'id')::uuid;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('umzug_frei', $m$DROP TRIGGER a_freeze ON public.keller_umzuege$m$);
  PERFORM pg_temp.s112_mutiere('verschnitt_frei',
    $m$DROP TRIGGER a_freeze ON public.verschneidungen; DROP TRIGGER a_freeze ON public.verschneidung_quellen$m$);

  PERFORM pg_temp.s112_als(v_bw);
  -- ── 1. Umzug ──────────────────────────────────────────────────────────────────────────────────────────
  v_txt := pg_temp.s112_fehlertext(format('UPDATE public.keller_umzuege SET datum = datum - 1 WHERE id = %L', v_u));
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_umzug_datum',
    v_txt LIKE '42501: Gesperrt: Umzug gebucht am % (nicht: datum).%HINT: freeze', true);
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_umzug_menge',
    pg_temp.s112_versuch(format('UPDATE public.keller_umzuege SET menge_liter = 90 WHERE id = %L', v_u)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('erlaubt_umzug_notizen',
    pg_temp.s112_versuch(format('UPDATE public.keller_umzuege SET notizen = %L WHERE id = %L', 'S112TEST', v_u)), 'k1');

  -- ── 2. Verschnitt und Quellen ─────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_verschnitt_datum',
    pg_temp.s112_versuch(format('UPDATE public.verschneidungen SET datum = datum - 1 WHERE id = %L', v_v)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('erlaubt_verschnitt_notizen',
    pg_temp.s112_versuch(format('UPDATE public.verschneidungen SET notizen = %L WHERE id = %L', 'S112TEST', v_v)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_verschnitt_quelle_menge',
    pg_temp.s112_versuch(format('UPDATE public.verschneidung_quellen SET menge_liter = 40 WHERE id = %L', v_q)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('erlaubt_quelle_anteil',
    pg_temp.s112_versuch(format('UPDATE public.verschneidung_quellen SET anteil_pct = 12.5 WHERE id = %L', v_q)), 'k1');

  -- ── 3. Storno bleibt möglich ──────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('storno_umzug',
    pg_temp.s112_versuch(format('UPDATE public.keller_umzuege SET storniert_am = now(), storno_grund = %L WHERE id = %L', 'S112TEST Storno-Grund', v_u)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_verschnitt',
    pg_temp.s112_versuch(format('UPDATE public.verschneidungen SET storniert_am = now(), storno_grund = %L WHERE id = %L', 'S112TEST Storno-Grund', v_v)), 'k1');

  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('kennzeichen_leer', coalesce(current_setting('s112.freeze_frei', true), ''), '');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 10);
END $test$;
