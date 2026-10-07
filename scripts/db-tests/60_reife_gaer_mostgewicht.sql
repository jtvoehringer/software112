-- @bereich: Reife- und Gärmessungen mit Mostgewicht-Einheit (KAN-203)
-- @ziel: Reife-Messungen je Ried und das Mostgewicht an der Laboranalyse speichern beide Werte (°KMW und °Oe) mit der
-- @ziel: gemessenen Einheit – der Abgleich-Trigger rechnet die andere Spalte; eine Reife-Messung ohne Mostgewicht und
-- @ziel: Werte außerhalb des Bereichs lehnt die Datenbank ab; Leser dürfen keine Reife-Messung anlegen.
-- @mutation ohne_abgleich_reife: Trigger b_mostgewicht an reifemessungen entfernt | rot: reife_oe_gerechnet
-- @mutation ohne_abgleich_analyse: Trigger b_mostgewicht an weinanalysen entfernt | rot: analyse_kmw_gerechnet
-- @mutation ohne_pflicht: CHECK reifemessungen_mostgewicht_pflicht entfernt | rot: reife_ohne_mostgewicht
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 60 (Stand 07.10.2026, KAN-203). Alles zurückgerollt.

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  c_datei constant text := '60_reife_gaer_mostgewicht';
  c_reife constant text := 'INSERT INTO public.reifemessungen (tenant_id, weingarten_id, datum, kmw, oechsle, mostgewicht_einheit) VALUES (%L, %L, %L, %s, %s, %L)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_wg    uuid;
  v_ch    uuid;
  v_id    uuid;
  r       record;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_wg := (pg_temp.s112_zeile('weingarten', v_b) ->> 'id')::uuid;
  v_ch := (pg_temp.s112_beispiel('weinausbau', v_b) ->> 'id')::uuid;

  PERFORM pg_temp.s112_mutiere('ohne_abgleich_reife', $m$DROP TRIGGER b_mostgewicht ON public.reifemessungen$m$);
  PERFORM pg_temp.s112_mutiere('ohne_abgleich_analyse', $m$DROP TRIGGER b_mostgewicht ON public.weinanalysen$m$);
  PERFORM pg_temp.s112_mutiere('ohne_pflicht', $m$ALTER TABLE public.reifemessungen DROP CONSTRAINT reifemessungen_mostgewicht_pflicht$m$);

  -- ── 1. Reife-Messung als Winzer: gemessen in °Oe, °KMW gerechnet ──────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('reife_oe_ok',
    pg_temp.s112_fehlertext(format(c_reife, v_b, v_wg, v_heute, 'NULL', '84', 'oechsle')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('reife_kmw_ok',
    pg_temp.s112_fehlertext(format(c_reife, v_b, v_wg, v_heute - 7, '16.5', 'NULL', 'kmw')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('reife_ohne_mostgewicht',
    split_part(pg_temp.s112_fehlertext(format(c_reife, v_b, v_wg, v_heute, 'NULL', 'NULL', 'kmw')), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('reife_ausser_bereich',
    split_part(pg_temp.s112_fehlertext(format(c_reife, v_b, v_wg, v_heute, '61', 'NULL', 'kmw')), ':', 1), '23514');

  PERFORM pg_temp.s112_als_postgres();
  SELECT * INTO r FROM public.reifemessungen WHERE weingarten_id = v_wg AND datum = v_heute;
  v_erg := v_erg || pg_temp.s112_erwarte('reife_oe_gerechnet',
    (r.mostgewicht_einheit = 'oechsle' AND r.oechsle = 84 AND r.kmw = public.s112_kmw_aus_oechsle(84))::text, 'true');
  SELECT * INTO r FROM public.reifemessungen WHERE weingarten_id = v_wg AND datum = v_heute - 7;
  v_erg := v_erg || pg_temp.s112_erwarte('reife_kmw_gerechnet',
    (r.mostgewicht_einheit = 'kmw' AND r.kmw = 16.5 AND r.oechsle = public.s112_oechsle_aus_kmw(16.5))::text, 'true');
  v_id := r.id;

  -- ── 2. Ändern und Löschen mit Schreibrecht Rieden; Leser nicht ────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_kein_insert',
    split_part(pg_temp.s112_fehlertext(format(c_reife, v_b, v_wg, v_heute, '17', 'NULL', 'kmw')), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('winzer_update',
    pg_temp.s112_versuch(format('UPDATE public.reifemessungen SET kmw = 17.2 WHERE id = %L', v_id)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('winzer_delete',
    pg_temp.s112_versuch(format('DELETE FROM public.reifemessungen WHERE id = %L', v_id)), 'k1');

  -- ── 3. Gärkontrolle: Mostgewicht an der Laboranalyse (optional) ───────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('analyse_ohne_mostgewicht',
    pg_temp.s112_fehlertext(format('INSERT INTO public.weinanalysen (tenant_id, weinausbau_id, analyse_datum, alkohol_vol) VALUES (%L, %L, %L, 4)', v_b, v_ch, v_heute - 1)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('analyse_oe_ok',
    pg_temp.s112_fehlertext(format('INSERT INTO public.weinanalysen (tenant_id, weinausbau_id, analyse_datum, oechsle, mostgewicht_einheit) VALUES (%L, %L, %L, 40, %L)', v_b, v_ch, v_heute, 'oechsle')), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  SELECT * INTO r FROM public.weinanalysen WHERE weinausbau_id = v_ch AND analyse_datum = v_heute;
  v_erg := v_erg || pg_temp.s112_erwarte('analyse_kmw_gerechnet',
    (r.mostgewicht_einheit = 'oechsle' AND r.oechsle = 40 AND r.kmw = public.s112_kmw_aus_oechsle(40))::text, 'true');
  SELECT * INTO r FROM public.weinanalysen WHERE weinausbau_id = v_ch AND analyse_datum = v_heute - 1;
  v_erg := v_erg || pg_temp.s112_erwarte('analyse_leer_bleibt_leer',
    (r.kmw IS NULL AND r.oechsle IS NULL AND r.mostgewicht_einheit = 'kmw')::text, 'true');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 13);
END $test$;
