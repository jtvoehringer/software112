-- @bereich: Persönliches Dashboard (KAN-388) – Tabelle benutzer_dashboard
-- @ziel: Jeder angemeldete Benutzer (auch Leser, auch ohne Betrieb) liest, legt an, ändert und löscht nur seine eigene Zeile;
-- @ziel: fremde Zeilen sieht er nicht und kann sie weder anlegen noch ändern oder löschen. anon liest nichts. Das Layout ist
-- @ziel: ein Array mit höchstens 50 Einträgen; Zwei-Faktor-Sitzungen mit nur aal1 kommen nicht an die Zeile.
-- @mutation offen_lesen: PERMISSIVE-Policy USING (true) für SELECT auf benutzer_dashboard | rot: fremd_lesen
-- @mutation offen_schreiben: PERMISSIVE-Policy WITH CHECK (true) für INSERT auf benutzer_dashboard | rot: fremd_anlegen
-- @mutation ohne_check: CHECK benutzer_dashboard_layout_form entfernt | rot: check_.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 87 (Stand 31.10.2026, KAN-388). Alles zurückgerollt.
-- Personen: Leser l (Musterhof), Mitarbeiter w (Betrieb B), Benutzer o ohne Betrieb.

DO $test$
DECLARE
  c_datei constant text := '87_benutzer_dashboard';
  c_m     constant uuid := '33333333-3333-4333-8333-333333333333';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_l     uuid;
  v_w     uuid;
  v_o     uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ──────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau(true);
  v_b := (v_a ->> 'b')::uuid;
  v_l := pg_temp.s112_benutzer('leser', c_m);
  v_w := pg_temp.s112_benutzer('winzer', v_b);
  v_o := pg_temp.s112_benutzer(NULL, NULL);
  INSERT INTO public.benutzer_dashboard (user_id, layout) VALUES (v_w, '[{"id": "kellerbestand"}]');

  PERFORM pg_temp.s112_mutiere('offen_lesen',
    $m$CREATE POLICY s112test_offen ON public.benutzer_dashboard AS PERMISSIVE FOR SELECT TO authenticated USING (true)$m$);
  PERFORM pg_temp.s112_mutiere('offen_schreiben',
    $m$CREATE POLICY s112test_offen ON public.benutzer_dashboard AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (true)$m$);
  PERFORM pg_temp.s112_mutiere('ohne_check',
    $m$ALTER TABLE public.benutzer_dashboard DROP CONSTRAINT benutzer_dashboard_layout_form$m$);

  -- ── 1. Eigene Zeile: Leser im Musterhof ───────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_l);
  v_erg := v_erg || pg_temp.s112_erwarte('eigen_anlegen_leser',
    pg_temp.s112_versuch(format($s$INSERT INTO public.benutzer_dashboard (user_id, layout) VALUES (%L, '[{"id": "morgenbericht", "groesse": "breit"}]')$s$, v_l)), 'k1');
  INSERT INTO public.benutzer_dashboard (user_id, layout) VALUES (v_l, '[]');
  v_erg := v_erg || pg_temp.s112_erwarte('eigen_lesen_leser',
    pg_temp.s112_zaehle('SELECT count(*) FROM public.benutzer_dashboard'), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('eigen_aendern_leser',
    pg_temp.s112_versuch(format($s$UPDATE public.benutzer_dashboard SET layout = '[{"id": "finanzen"}]', aktualisiert_am = now() WHERE user_id = %L$s$, v_l)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('eigen_loeschen_leser',
    pg_temp.s112_versuch(format('DELETE FROM public.benutzer_dashboard WHERE user_id = %L', v_l)), 'k1');

  -- ── 2. Fremde Zeile (w aus Betrieb B) ─────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('fremd_lesen',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.benutzer_dashboard WHERE user_id = %L', v_w)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('fremd_aendern',
    pg_temp.s112_versuch(format($s$UPDATE public.benutzer_dashboard SET layout = '[]' WHERE user_id = %L$s$, v_w)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('fremd_loeschen',
    pg_temp.s112_versuch(format('DELETE FROM public.benutzer_dashboard WHERE user_id = %L', v_w)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('fremd_anlegen',
    pg_temp.s112_versuch(format($s$INSERT INTO public.benutzer_dashboard (user_id, layout) VALUES (%L, '[]')$s$, v_o)), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('fremd_umhaengen',   -- eigene Zeile, neuer Eigentümer scheitert an WITH CHECK
    pg_temp.s112_versuch(format($s$UPDATE public.benutzer_dashboard SET user_id = %L WHERE user_id = %L$s$, v_o, v_l)), 'R');

  -- ── 3. Ohne Betrieb: eigene Zeile geht (Einstellung gilt über alle Betriebe) ──────────────────────────
  PERFORM pg_temp.s112_als(v_o);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_betrieb_anlegen',
    pg_temp.s112_versuch(format($s$INSERT INTO public.benutzer_dashboard (user_id, layout) VALUES (%L, '[]')$s$, v_o)), 'k1');

  -- ── 4. Form des Layouts (CHECK) ───────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('check_kein_array',
    pg_temp.s112_versuch(format($s$INSERT INTO public.benutzer_dashboard (user_id, layout) VALUES (%L, '{"id": "x"}')$s$, v_o)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('check_zu_lang',
    pg_temp.s112_versuch(format($s$INSERT INTO public.benutzer_dashboard (user_id, layout) SELECT %L, jsonb_agg(jsonb_build_object('id', 'w' || i)) FROM generate_series(1, 51) i$s$, v_o)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('check_50_geht',
    pg_temp.s112_versuch(format($s$INSERT INTO public.benutzer_dashboard (user_id, layout) SELECT %L, jsonb_agg(jsonb_build_object('id', 'w' || i)) FROM generate_series(1, 50) i$s$, v_o)), 'k1');

  -- ── 5. anon und Zwei-Faktor ───────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(NULL, 'anon');
  v_erg := v_erg || pg_temp.s112_erwarte('anon_lesen',
    pg_temp.s112_zaehle('SELECT count(*) FROM public.benutzer_dashboard'), 'G');
  PERFORM pg_temp.s112_als_postgres();
  PERFORM pg_temp.s112_faktor(v_w);   -- bestätigter TOTP-Faktor
  PERFORM pg_temp.s112_als(v_w, 'authenticated', 'aal1');
  v_erg := v_erg || pg_temp.s112_erwarte('aal1_eigen_lesen',
    pg_temp.s112_zaehle('SELECT count(*) FROM public.benutzer_dashboard'), '0');
  PERFORM pg_temp.s112_als(v_w, 'authenticated', 'aal2');
  v_erg := v_erg || pg_temp.s112_erwarte('aal2_eigen_lesen',
    pg_temp.s112_zaehle('SELECT count(*) FROM public.benutzer_dashboard'), '1');
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 16);
END
$test$;
