-- @bereich: Kellerbuch – Tank mit Kammern im Kellerplan (KAN-467)
-- @ziel: Eine Position im Kellerplan steht für ein Gebinde ODER für einen Tank – genau eines von beiden, je Tank
-- @ziel: höchstens eine Position. Die Kammer eines eigenen Tanks lässt sich nicht einzeln platzieren. Ein Tank eines
-- @ziel: anderen Betriebs ist nicht platzierbar. Mit dem Tank verschwindet seine Position. Schreiben mit dem Modul
-- @ziel: Kellerbuch, Leser nur lesend.
-- @mutation kammer_einzeln: Trigger a_kammer_schutz fehlt (Kammern eines eigenen Tanks einzeln platzierbar) | rot: kammer_einzeln_.*
-- @mutation ohne_ziel: CHECK kellerplan_positionen_ziel_chk fehlt (Position ohne Gebinde und ohne Tank bzw. mit beidem) | rot: ziel_.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 99 (Stand 16.11.2026, KAN-467). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '99_kellerplan_tank';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     constant uuid := '33333333-3333-4333-8333-333333333333';
  v_bta   uuid;
  v_bw    uuid;
  v_tank  uuid;
  v_k1    uuid;
  v_plan  uuid;
  v_plan_m uuid;
  v_geb   uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;

  PERFORM pg_temp.s112_mutiere('kammer_einzeln', $m$DROP TRIGGER a_kammer_schutz ON public.kellerplan_positionen$m$);
  PERFORM pg_temp.s112_mutiere('ohne_ziel', $m$ALTER TABLE public.kellerplan_positionen DROP CONSTRAINT kellerplan_positionen_ziel_chk$m$);

  -- Plan, eigenständiges Gebinde und Tank mit zwei Kammern in B; ein Plan in M
  INSERT INTO public.kellerplaene (tenant_id, name) VALUES (v_b, 'S112TEST Plan') RETURNING id INTO v_plan;
  INSERT INTO public.kellerplaene (tenant_id, name) VALUES (v_m, 'S112TEST Plan M') RETURNING id INTO v_plan_m;
  INSERT INTO public.behaelter (tenant_id, name) VALUES (v_b, 'S112TEST Gebinde') RETURNING id INTO v_geb;
  PERFORM pg_temp.s112_als(v_bw);
  v_tank := public.s112_tank_anlegen(v_b, 'S112TEST KP', 'stahltank', NULL, NULL, NULL,
    '[{"name":"S112TEST KP/1","volumen_liter":3000},{"name":"S112TEST KP/2","volumen_liter":2000}]'::jsonb);
  PERFORM pg_temp.s112_als_postgres();
  SELECT id INTO v_k1 FROM public.behaelter WHERE tank_id = v_tank AND kammer_nr = 1;

  -- ── 1. Tank und Gebinde platzieren (Mitarbeiter mit Modul Kellerbuch) ───────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  INSERT INTO public.kellerplan_positionen (tenant_id, kellerplan_id, behaelter_id) VALUES (v_b, v_plan, v_geb);
  v_erg := v_erg || pg_temp.s112_erwarte('gebinde_platzieren',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.kellerplan_positionen WHERE behaelter_id = %L AND tank_id IS NULL', v_geb)), '1');
  INSERT INTO public.kellerplan_positionen (tenant_id, kellerplan_id, tank_id, pos_x_pct, pos_y_pct, breite_pct, hoehe_pct) VALUES (v_b, v_plan, v_tank, 10, 10, 12, 18);
  v_erg := v_erg || pg_temp.s112_erwarte('tank_platziert',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.kellerplan_positionen WHERE tank_id = %L AND behaelter_id IS NULL', v_tank)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('tank_verschieben',
    pg_temp.s112_versuch(format('UPDATE public.kellerplan_positionen SET pos_x_pct = 40, breite_pct = 15 WHERE tank_id = %L', v_tank)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('tank_nur_einmal',
    pg_temp.s112_versuch(format('INSERT INTO public.kellerplan_positionen (tenant_id, kellerplan_id, tank_id) VALUES (%L, %L, %L)', v_b, v_plan, v_tank)), 'E23505');

  -- ── 2. Kammer eines eigenen Tanks nicht einzeln ─────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('kammer_einzeln_insert',
    pg_temp.s112_versuch(format('INSERT INTO public.kellerplan_positionen (tenant_id, kellerplan_id, behaelter_id) VALUES (%L, %L, %L)', v_b, v_plan, v_k1)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('kammer_einzeln_update',
    pg_temp.s112_versuch(format('UPDATE public.kellerplan_positionen SET behaelter_id = %L WHERE behaelter_id = %L', v_k1, v_geb)), 'E23514');

  -- ── 3. Genau eines von Gebinde und Tank ─────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('ziel_keines',
    pg_temp.s112_versuch(format('INSERT INTO public.kellerplan_positionen (tenant_id, kellerplan_id) VALUES (%L, %L)', v_b, v_plan)), 'E23514');
  PERFORM pg_temp.s112_als_postgres();
  DELETE FROM public.kellerplan_positionen WHERE behaelter_id = v_geb;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('ziel_beides',
    pg_temp.s112_versuch(format('UPDATE public.kellerplan_positionen SET behaelter_id = %L WHERE tank_id = %L', v_geb, v_tank)), 'E23514');

  -- ── 4. Rechte und fremder Betrieb ───────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als((v_a ->> 'b_l')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_liest', pg_temp.s112_zaehle(format('SELECT count(*) FROM public.kellerplan_positionen WHERE tank_id = %L', v_tank)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('leser_verschiebt_nicht', pg_temp.s112_versuch(format('UPDATE public.kellerplan_positionen SET pos_x_pct = 1 WHERE tank_id = %L', v_tank)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('leser_entfernt_nicht', pg_temp.s112_versuch(format('DELETE FROM public.kellerplan_positionen WHERE tank_id = %L', v_tank)), 'k0');
  PERFORM pg_temp.s112_als((v_a ->> 'm_ta')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb_sieht_nichts', pg_temp.s112_zaehle(format('SELECT count(*) FROM public.kellerplan_positionen WHERE tank_id = %L', v_tank)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_tank_nicht_platzierbar',
    pg_temp.s112_versuch(format('INSERT INTO public.kellerplan_positionen (tenant_id, kellerplan_id, tank_id) VALUES (%L, %L, %L)', v_m, v_plan_m, v_tank)) LIKE 'k%', false);
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_tank_auch_nicht_fuer_wartung',
    pg_temp.s112_versuch(format('INSERT INTO public.kellerplan_positionen (tenant_id, kellerplan_id, tank_id) VALUES (%L, %L, %L)', v_m, v_plan_m, v_tank)) LIKE 'k%', false);

  -- ── 5. Entfernen; mit dem Tank verschwindet die Position ────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('tank_entfernen', pg_temp.s112_versuch(format('DELETE FROM public.kellerplan_positionen WHERE tank_id = %L', v_tank)), 'k1');
  PERFORM pg_temp.s112_als(v_bta);
  DELETE FROM public.behaelter WHERE tank_id = v_tank;
  DELETE FROM public.gebinde_tanks WHERE id = v_tank;
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('tank_weg_position_weg', (SELECT count(*) FROM public.kellerplan_positionen WHERE tank_id = v_tank), 0::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('trigger_nicht_aufrufbar', has_function_privilege('authenticated', 'public.s112_kellerplan_kammer_schutz()', 'EXECUTE'), false);
  v_erg := v_erg || pg_temp.s112_erwarte('keine_kammer_einzeln_im_bestand',
    (SELECT count(*) FROM public.kellerplan_positionen p JOIN public.behaelter b ON b.id = p.behaelter_id WHERE b.tank_id IS NOT NULL AND b.tenant_id = p.tenant_id), 0::bigint);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 17);
END $test$;
