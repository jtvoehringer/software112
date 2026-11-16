-- @bereich: Kellerbuch – Tank mit Kammern (KAN-466)
-- @ziel: Ein Tank (gebinde_tanks) entsteht samt seinen Kammern (Gebinde mit tank_id/kammer_nr) nur über
-- @ziel: s112_tank_anlegen. Die Zuordnung Kammer ↔ Tank ist danach fest; Typ, Material und Standort einer Kammer
-- @ziel: kommen immer vom Tank – auch nach einer Änderung am Tank oder einem Versuch an der Kammer. Ein Tank eines
-- @ziel: anderen Betriebs ist nicht zuordenbar. Lesen im Betrieb, Schreiben mit dem Modul Kellerbuch, Löschen nur die
-- @ziel: Betriebsleitung und erst ohne Kammern; anon hat keine Rechte.
-- @mutation kammer_frei: Trigger a_kammer_vom_tank fehlt (Kammern direkt anlegbar, Zuordnung änderbar, Typ frei) | rot: direkt_.*|kammer_typ_.*
-- @mutation ohne_weitergabe: Trigger z_tank_an_kammern fehlt (Tank-Änderung erreicht die Kammern nicht) | rot: tank_update_.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 99 (Stand 16.11.2026, KAN-466). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '99_tank_kammern';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     constant uuid := '33333333-3333-4333-8333-333333333333';
  v_bta   uuid;
  v_bw    uuid;
  v_tank  uuid;
  v_k2    uuid;
  c_kammern constant text := '[{"name":"S112TEST T1/1","volumen_liter":3000},{"name":"S112TEST T1/2","volumen_liter":2000,"gemeinsam":false},{"name":"S112TEST T1/3","volumen_liter":2000.5}]';
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;

  PERFORM pg_temp.s112_mutiere('kammer_frei', $m$DROP TRIGGER a_kammer_vom_tank ON public.behaelter$m$);
  PERFORM pg_temp.s112_mutiere('ohne_weitergabe', $m$DROP TRIGGER z_tank_an_kammern ON public.gebinde_tanks$m$);

  -- ── 1. Anlegen als Mitarbeiter mit Modul Kellerbuch ─────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_tank := public.s112_tank_anlegen(v_b, 'S112TEST T1', 'stahltank', 'Edelstahl', 'S112TEST Halle', NULL, c_kammern::jsonb);
  PERFORM pg_temp.s112_als_postgres();
  SELECT id INTO v_k2 FROM public.behaelter WHERE tank_id = v_tank AND kammer_nr = 2;
  v_erg := v_erg || pg_temp.s112_erwarte('anlegen_kammern',
    (SELECT string_agg(concat_ws(':', kammer_nr, name, typ, material, standort, volumen_liter, gemeinsam, aktiv), ' | ' ORDER BY kammer_nr) FROM public.behaelter WHERE tank_id = v_tank),
    '1:S112TEST T1/1:stahltank:Edelstahl:S112TEST Halle:3000.00:t:t | 2:S112TEST T1/2:stahltank:Edelstahl:S112TEST Halle:2000.00:f:t | 3:S112TEST T1/3:stahltank:Edelstahl:S112TEST Halle:2000.50:t:t');
  v_erg := v_erg || pg_temp.s112_erwarte('anlegen_tank_im_betrieb', (SELECT count(*) FROM public.gebinde_tanks WHERE id = v_tank AND tenant_id = v_b), 1::bigint);

  -- ── 2. Eingaben, die die Funktion ablehnt ───────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('anlegen_name_doppelt',
    pg_temp.s112_versuch(format('SELECT public.s112_tank_anlegen(%L, %L, %L, NULL, NULL, NULL, %L::jsonb)', v_b, 's112test t1', 'stahltank', '[{"name":"S112TEST X/1","volumen_liter":1},{"name":"S112TEST X/2","volumen_liter":1}]')), 'E23505');
  v_erg := v_erg || pg_temp.s112_erwarte('anlegen_name_wie_gebinde',
    pg_temp.s112_versuch(format('SELECT public.s112_tank_anlegen(%L, %L, %L, NULL, NULL, NULL, %L::jsonb)', v_b, 'S112TEST T1/2', 'stahltank', '[{"name":"S112TEST X/1","volumen_liter":1},{"name":"S112TEST X/2","volumen_liter":1}]')), 'E23505');
  v_erg := v_erg || pg_temp.s112_erwarte('anlegen_kammer_wie_gebinde',
    pg_temp.s112_versuch(format('SELECT public.s112_tank_anlegen(%L, %L, %L, NULL, NULL, NULL, %L::jsonb)', v_b, 'S112TEST T2', 'stahltank', '[{"name":"S112TEST T1/3","volumen_liter":1},{"name":"S112TEST X/2","volumen_liter":1}]')), 'E23505');
  v_erg := v_erg || pg_temp.s112_erwarte('anlegen_eine_kammer',
    pg_temp.s112_versuch(format('SELECT public.s112_tank_anlegen(%L, %L, %L, NULL, NULL, NULL, %L::jsonb)', v_b, 'S112TEST T2', 'stahltank', '[{"name":"S112TEST X/1","volumen_liter":1}]')), 'E22023');
  v_erg := v_erg || pg_temp.s112_erwarte('anlegen_kammern_gleich',
    pg_temp.s112_versuch(format('SELECT public.s112_tank_anlegen(%L, %L, %L, NULL, NULL, NULL, %L::jsonb)', v_b, 'S112TEST T2', 'stahltank', '[{"name":"S112TEST X/1","volumen_liter":1},{"name":"s112test x/1","volumen_liter":1}]')), 'E22023');
  v_erg := v_erg || pg_temp.s112_erwarte('anlegen_ohne_volumen',
    pg_temp.s112_versuch(format('SELECT public.s112_tank_anlegen(%L, %L, %L, NULL, NULL, NULL, %L::jsonb)', v_b, 'S112TEST T2', 'stahltank', '[{"name":"S112TEST X/1","volumen_liter":0},{"name":"S112TEST X/2","volumen_liter":1}]')), 'E22023');
  v_erg := v_erg || pg_temp.s112_erwarte('anlegen_typ_unbekannt',
    pg_temp.s112_versuch(format('SELECT public.s112_tank_anlegen(%L, %L, %L, NULL, NULL, NULL, %L::jsonb)', v_b, 'S112TEST T2', 'barrique', '[{"name":"S112TEST X/1","volumen_liter":1},{"name":"S112TEST X/2","volumen_liter":1}]')), 'E23514');

  -- ── 3. Kammern nur über die Funktion; Zuordnung fest; Typ/Standort vom Tank ─────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_insert_kammer',
    pg_temp.s112_versuch(format('INSERT INTO public.behaelter (tenant_id, name, tank_id, kammer_nr) VALUES (%L, %L, %L, 4)', v_b, 'S112TEST T1/4', v_tank)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_tank_loesen',
    pg_temp.s112_versuch(format('UPDATE public.behaelter SET tank_id = NULL, kammer_nr = NULL WHERE id = %L', v_k2)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_kammer_nr',
    pg_temp.s112_versuch(format('UPDATE public.behaelter SET kammer_nr = 9 WHERE id = %L', v_k2)), 'T');
  UPDATE public.behaelter SET typ = 'holzfass', standort = 'S112TEST woanders', material = 'Holz', volumen_liter = 1900, name = 'S112TEST T1/Mitte' WHERE id = v_k2;
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('kammer_typ_bleibt_tank',
    (SELECT concat_ws(':', name, typ, material, standort, volumen_liter) FROM public.behaelter WHERE id = v_k2), 'S112TEST T1/Mitte:stahltank:Edelstahl:S112TEST Halle:1900.00');

  -- ── 4. Änderung am Tank geht an alle Kammern ────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  UPDATE public.gebinde_tanks SET typ = 'lagertank', standort = 'S112TEST Halle 2', material = NULL WHERE id = v_tank;
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('tank_update_an_kammern',
    (SELECT string_agg(DISTINCT concat_ws(':', typ, coalesce(material, '-'), standort), ' | ') FROM public.behaelter WHERE tank_id = v_tank), 'lagertank:-:S112TEST Halle 2');
  v_erg := v_erg || pg_temp.s112_erwarte('tank_betrieb_fest',
    pg_temp.s112_versuch(format('UPDATE public.gebinde_tanks SET tenant_id = %L WHERE id = %L', v_m, v_tank)), 'T');

  -- ── 5. Tank eines anderen Betriebs ist nicht zuordenbar (auch nicht für die Wartung) ────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_tank',
    pg_temp.s112_versuch(format('INSERT INTO public.behaelter (tenant_id, name, tank_id, kammer_nr) VALUES (%L, %L, %L, 4)', v_m, 'S112TEST fremd', v_tank)), 'E23503');
  v_erg := v_erg || pg_temp.s112_erwarte('kammer_ohne_nummer',
    pg_temp.s112_versuch(format('INSERT INTO public.behaelter (tenant_id, name, tank_id) VALUES (%L, %L, %L)', v_b, 'S112TEST ohne Nr', v_tank)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('kammer_nr_doppelt',
    pg_temp.s112_versuch(format('INSERT INTO public.behaelter (tenant_id, name, tank_id, kammer_nr) VALUES (%L, %L, %L, 2)', v_b, 'S112TEST doppelt', v_tank)), 'E23505');

  -- ── 6. Ladefunktion liefert Tank und Kammer ─────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('lade_behaelter_tank',
    (SELECT string_agg(concat_ws(':', kammer_nr, tank_name, tank_kammern), ' | ' ORDER BY kammer_nr) FROM public.lade_behaelter(v_b) WHERE tank_id = v_tank),
    '1:S112TEST T1:3 | 2:S112TEST T1:3 | 3:S112TEST T1:3');

  -- ── 7. Rechte ───────────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als((v_a ->> 'b_l')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_liest', pg_temp.s112_zaehle(format('SELECT count(*) FROM public.gebinde_tanks WHERE id = %L', v_tank)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('leser_update', pg_temp.s112_versuch(format('UPDATE public.gebinde_tanks SET standort = %L WHERE id = %L', 'x', v_tank)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('leser_anlegen',
    pg_temp.s112_versuch(format('SELECT public.s112_tank_anlegen(%L, %L, %L, NULL, NULL, NULL, %L::jsonb)', v_b, 'S112TEST T3', 'stahltank', '[{"name":"S112TEST Y/1","volumen_liter":1},{"name":"S112TEST Y/2","volumen_liter":1}]')), 'T');
  PERFORM pg_temp.s112_als((v_a ->> 'm_ta')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb_liest_nichts', pg_temp.s112_zaehle(format('SELECT count(*) FROM public.gebinde_tanks WHERE id = %L', v_tank)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb_anlegen',
    pg_temp.s112_versuch(format('SELECT public.s112_tank_anlegen(%L, %L, %L, NULL, NULL, NULL, %L::jsonb)', v_b, 'S112TEST T3', 'stahltank', '[{"name":"S112TEST Y/1","volumen_liter":1},{"name":"S112TEST Y/2","volumen_liter":1}]')), 'T');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('mitarbeiter_loescht_tank_nicht', pg_temp.s112_versuch(format('DELETE FROM public.gebinde_tanks WHERE id = %L', v_tank)), 'k0');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('tank_mit_kammern_bleibt', pg_temp.s112_versuch(format('DELETE FROM public.gebinde_tanks WHERE id = %L', v_tank)), 'E23503');
  DELETE FROM public.behaelter WHERE tank_id = v_tank;
  v_erg := v_erg || pg_temp.s112_erwarte('leerer_tank_loeschbar', pg_temp.s112_versuch(format('DELETE FROM public.gebinde_tanks WHERE id = %L', v_tank)), 'k1');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('anon_ohne_rechte',
    has_table_privilege('anon', 'public.gebinde_tanks', 'SELECT') OR has_table_privilege('anon', 'public.gebinde_tanks', 'INSERT')
      OR has_function_privilege('anon', 'public.s112_tank_anlegen(uuid, text, text, text, text, text, jsonb)', 'EXECUTE'), false);
  v_erg := v_erg || pg_temp.s112_erwarte('trigger_nicht_aufrufbar',
    has_function_privilege('authenticated', 'public.s112_kammer_vom_tank()', 'EXECUTE') OR has_function_privilege('authenticated', 'public.s112_tank_an_kammern()', 'EXECUTE'), false);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 25);
END $test$;
