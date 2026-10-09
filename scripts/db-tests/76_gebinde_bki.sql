-- @bereich: Gebinde für das BKI-Gebindeverzeichnis (KAN-48 AP11) – eindeutige Bezeichnung, Material in lade_behaelter
-- @ziel: Die Bezeichnung eines Gebindes ist je Betrieb eindeutig (ohne Groß-/Kleinschreibung und Leerzeichen am Rand),
-- @ziel: in einem anderen Betrieb darf sie gleich sein; lade_behaelter liefert Material und Langbezeichnung mit.
-- @mutation ohne_index: Index behaelter_name_je_betrieb fehlt | rot: name_doppelt
-- @mutation ohne_normalisierung: Index nur auf name (Groß-/Kleinschreibung und Leerzeichen zählen) | rot: name_doppelt
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 76 (Stand 09.10.2026, KAN-48). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '76_gebinde_bki';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bw    uuid;
  v_mat   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;

  PERFORM pg_temp.s112_mutiere('ohne_index', $m$DROP INDEX public.behaelter_name_je_betrieb$m$);
  PERFORM pg_temp.s112_mutiere('ohne_normalisierung', $m$DROP INDEX public.behaelter_name_je_betrieb; CREATE UNIQUE INDEX behaelter_name_je_betrieb ON public.behaelter (tenant_id, name)$m$);

  INSERT INTO public.behaelter (tenant_id, name, typ, volumen_liter, material, bezeichnung_lang)
  VALUES (v_b, 'S112TEST T1', 'stahltank', 5000, 'Edelstahl', 'Edelstahltank mit Kühlmantel');

  PERFORM pg_temp.s112_als(v_bw);
  -- gleiche Bezeichnung, andere Schreibweise und Leerzeichen → abgelehnt
  v_erg := v_erg || pg_temp.s112_erwarte('name_doppelt',
    pg_temp.s112_versuch(format('INSERT INTO public.behaelter (tenant_id, name) VALUES (%L, %L)', v_b, '  s112test t1 ')), 'E23505');
  v_erg := v_erg || pg_temp.s112_erwarte('name_neu',
    pg_temp.s112_versuch(format('INSERT INTO public.behaelter (tenant_id, name) VALUES (%L, %L)', v_b, 'S112TEST T2')), 'k1');
  -- RPC liefert Material und Langbezeichnung
  SELECT material || ' / ' || bezeichnung_lang INTO v_mat FROM public.lade_behaelter(v_b) WHERE name = 'S112TEST T1';
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_material', v_mat, 'Edelstahl / Edelstahltank mit Kühlmantel');

  -- anderer Betrieb: gleiche Bezeichnung erlaubt
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('anderer_betrieb',
    pg_temp.s112_versuch(format('INSERT INTO public.behaelter (tenant_id, name) VALUES (%L, %L)', v_m, 'S112TEST T1')), 'k1');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 4);
END $test$;
