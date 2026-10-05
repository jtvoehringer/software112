-- @bereich: Transportbescheinigung – Entwurf und Ausstellen (KAN-209)
-- @ziel: Ein Entwurf ist änderbar; beim Ausstellen setzt der Trigger Zeitpunkt und Benutzer. Eine ausgestellte
-- @ziel: Bescheinigung ist fest (42501, HINT freeze) – auch kein Zurück auf Entwurf –, Storno bleibt möglich.
-- @mutation freeze_aus: kein Freeze-Trigger auf transportbescheinigungen | rot: gesperrt_.*
-- @mutation stempel_aus: kein Stempel beim Ausstellen | rot: stempel
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 37 (Stand 05.10.2026, KAN-209). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '37_tb_ausstellen';
  c_upd   constant text := 'UPDATE public.transportbescheinigungen SET %s WHERE id = %L';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_tb    uuid;
  v_txt   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ───────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_tb := (pg_temp.s112_beispiel('transportbescheinigungen', v_b, NULL, '{"formular_daten": {"laufende_nr": "1", "jahr": "2026"}}') ->> 'id')::uuid;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('freeze_aus', $m$DROP TRIGGER a_freeze ON public.transportbescheinigungen$m$);
  PERFORM pg_temp.s112_mutiere('stempel_aus', $m$DROP TRIGGER b_tb_stempel ON public.transportbescheinigungen$m$);

  -- ── 1. Entwurf ────────────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('standard_entwurf', (SELECT t.status FROM public.transportbescheinigungen t WHERE t.id = v_tb), 'entwurf');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('frei_entwurf',
    pg_temp.s112_fehlertext(format(c_upd, format('formular_daten = %L::jsonb', '{"laufende_nr": "2", "jahr": "2026"}'), v_tb)), 'ok');

  -- ── 2. Ausstellen: Stempel ────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('ausstellen',
    pg_temp.s112_fehlertext(format(c_upd, format('status = %L', 'ausgestellt'), v_tb)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('stempel',
    (SELECT t.ausgestellt_am IS NOT NULL AND t.ausgestellt_von = v_bw FROM public.transportbescheinigungen t WHERE t.id = v_tb), true);

  -- ── 3. Ausgestellt: fest, Storno erlaubt ──────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_txt := pg_temp.s112_fehlertext(format(c_upd, format('formular_daten = %L::jsonb', '{"laufende_nr": "3"}'), v_tb));
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_formular',
    v_txt LIKE '42501: Gesperrt: Transportbescheinigung ausgestellt am %HINT: freeze', true);
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_zurueck_auf_entwurf',
    pg_temp.s112_versuch(format(c_upd, format('status = %L', 'entwurf'), v_tb)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_erlaubt',
    pg_temp.s112_versuch(format(c_upd, format('storniert_am = now(), storno_grund = %L', 'S112TEST Storno-Grund'), v_tb)), 'k1');

  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('kennzeichen_leer', coalesce(current_setting('s112.freeze_frei', true), ''), '');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 8);
END $test$;
