-- @bereich: Lese – Maische als eigene Stufe zwischen Ernte und Charge (KAN-480)
-- @ziel: Eine Maische ist eine Pressung in zwei Schritten: angesetzt (Traubenzeilen, Beginn, Gebinde, maische_offen)
-- @ziel: und später abgepresst. Die Datenbank vergibt die Nummer je Jahrgang und hält sie fest; eine Direktpressung
-- @ziel: hat keine. Angesetzt wird nur in ein Gebinde ohne Wein und ohne andere offene Maische; in ein Gebinde mit
-- @ziel: offener Maische kommt keine Charge; aus einer offenen Maische entsteht keine Mostzeile. Beginn und Gebinde
-- @ziel: stehen fest, abgepresst bleibt abgepresst, das Pressdatum liegt nie vor dem Beginn. Nach dem Abpressen ist
-- @ziel: das Gebinde wieder frei. Die Triggerfunktionen sind für Benutzer nicht aufrufbar.
-- @mutation ohne_nummer_trigger: Trigger b_maische_nr fehlt (Nummer vom Aufrufer, änderbar) | rot: nummer_.*
-- @mutation ohne_gebinde_schutz: Trigger z_maische_gebinde an weinausbau fehlt | rot: charge_in_gebinde_mit_maische
-- @mutation ohne_pruefung: Trigger z_maische_pruefen fehlt | rot: (gebinde_.*|maische_.*fest|nicht_wieder_oeffnen)
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 99 (Stand 17.11.2026, KAN-480). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '99_maische';
  c_m     constant uuid := '33333333-3333-4333-8333-333333333333';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_jg    uuid;
  v_jahr  int;
  v_lese  uuid;
  v_frei  uuid;   -- leeres Gebinde
  v_frei2 uuid;   -- zweites leeres Gebinde
  v_voll  uuid;   -- Gebinde mit Wein
  v_max   int;
  v_m1    uuid;
  v_m2    uuid;
  v_dir   uuid;
  v_rpc   uuid;
  v_tag   date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  v_mta   uuid;   -- Betriebsleiter des Musterhofs
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();
  v_a := pg_temp.s112_aufbau();
  v_mta := (v_a ->> 'm_ta')::uuid;
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_mutiere('ohne_nummer_trigger', $m$DROP TRIGGER b_maische_nr ON public.pressungen$m$);
  PERFORM pg_temp.s112_mutiere('ohne_gebinde_schutz', $m$DROP TRIGGER z_maische_gebinde ON public.weinausbau$m$);
  PERFORM pg_temp.s112_mutiere('ohne_pruefung', $m$DROP TRIGGER z_maische_pruefen ON public.pressungen$m$);

  -- Vorlage: jüngster Jahrgang des Musterhofs mit Lese; zwei leere Gebinde und eines mit Wein
  SELECT l.jahrgang_id, l.id, j.jahrgang INTO v_jg, v_lese, v_jahr
    FROM public.lesen l JOIN public.weinjahrgaenge j ON j.id = l.jahrgang_id
   WHERE l.tenant_id = c_m AND NOT j.abgeschlossen ORDER BY j.jahrgang DESC, l.lfd_nr LIMIT 1;
  SELECT b.id INTO v_frei FROM public.behaelter b
   WHERE b.tenant_id = c_m AND b.aktiv
     AND NOT EXISTS (SELECT 1 FROM public.weinausbau w WHERE w.behaelter_id = b.id AND w.aktiv AND coalesce(w.menge_liter, 0) > 0)
     AND NOT EXISTS (SELECT 1 FROM public.pressungen p WHERE p.maische_behaelter_id = b.id AND p.maische_offen AND p.storniert_am IS NULL)
   ORDER BY b.id LIMIT 1;
  SELECT b.id INTO v_frei2 FROM public.behaelter b
   WHERE b.tenant_id = c_m AND b.aktiv AND b.id <> v_frei
     AND NOT EXISTS (SELECT 1 FROM public.weinausbau w WHERE w.behaelter_id = b.id AND w.aktiv AND coalesce(w.menge_liter, 0) > 0)
     AND NOT EXISTS (SELECT 1 FROM public.pressungen p WHERE p.maische_behaelter_id = b.id AND p.maische_offen AND p.storniert_am IS NULL)
   ORDER BY b.id LIMIT 1;
  SELECT w.behaelter_id INTO v_voll FROM public.weinausbau w
   WHERE w.tenant_id = c_m AND w.aktiv AND w.storniert_am IS NULL AND coalesce(w.menge_liter, 0) > 0 AND w.behaelter_id IS NOT NULL ORDER BY w.id LIMIT 1;
  IF v_jg IS NULL OR v_frei IS NULL OR v_frei2 IS NULL OR v_voll IS NULL THEN
    RAISE EXCEPTION 'Staging-Demo unvollständig – Jahrgang mit Lese, zwei leere Gebinde und ein belegtes nötig (demo_musterhof_zuruecksetzen() + demo_musterhof_y2_kette())';
  END IF;
  SELECT coalesce(max(maische_nr), 0) INTO v_max FROM public.pressungen WHERE jahrgang_id = v_jg;

  -- ── 1. Direktpressung: keine Nummer, nicht offen ────────────────────────────────────────────────────────────
  INSERT INTO public.pressungen (tenant_id, jahrgang_id, lese_id, datum, maische_nr) VALUES (c_m, v_jg, v_lese, v_tag, 55) RETURNING id INTO v_dir;
  v_erg := v_erg || pg_temp.s112_erwarte('nummer_direktpressung_ohne',
    (SELECT concat_ws('|', coalesce(maische_nr::text, 'leer'), maische_offen) FROM public.pressungen WHERE id = v_dir), 'leer|f');

  -- ── 2. Maische ansetzen: nächste Nummer des Jahrgangs, mitgeschickte Nummer zählt nicht ─────────────────
  INSERT INTO public.pressungen (tenant_id, jahrgang_id, lese_id, datum, maische_beginn, maische_behaelter_id, maische_offen, maische_nr)
  VALUES (c_m, v_jg, v_lese, v_tag, v_tag, v_frei, true, 77) RETURNING id INTO v_m1;
  INSERT INTO public.pressungen (tenant_id, jahrgang_id, lese_id, datum, maische_beginn, maische_behaelter_id, maische_offen, maische_nr)
  VALUES (c_m, v_jg, v_lese, v_tag, v_tag, v_frei2, true, 78) RETURNING id INTO v_m2;
  v_erg := v_erg || pg_temp.s112_erwarte('nummer_naechste_des_jahrgangs',
    (SELECT string_agg(maische_nr::text, ',' ORDER BY maische_nr) FROM public.pressungen WHERE id IN (v_m1, v_m2)), (v_max + 1)::text || ',' || (v_max + 2)::text);
  UPDATE public.pressungen SET maische_nr = 99 WHERE id = v_m2;
  v_erg := v_erg || pg_temp.s112_erwarte('nummer_unveraenderlich', (SELECT maische_nr FROM public.pressungen WHERE id = v_m2), v_max + 2);

  -- ── 3. Gebinde der Maische ──────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('gebinde_zweite_maische_abgelehnt',
    pg_temp.s112_versuch(format('INSERT INTO public.pressungen (tenant_id, jahrgang_id, lese_id, datum, maische_beginn, maische_behaelter_id, maische_offen) VALUES (%L, %L, %L, %L, %L, %L, true)',
      c_m, v_jg, v_lese, v_tag, v_tag, v_frei)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('gebinde_mit_wein_abgelehnt',
    pg_temp.s112_versuch(format('INSERT INTO public.pressungen (tenant_id, jahrgang_id, lese_id, datum, maische_beginn, maische_behaelter_id, maische_offen) VALUES (%L, %L, %L, %L, %L, %L, true)',
      c_m, v_jg, v_lese, v_tag, v_tag, v_voll)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('charge_in_gebinde_mit_maische',
    pg_temp.s112_versuch(format('INSERT INTO public.weinausbau (tenant_id, name, jahrgang, menge_liter, status, behaelter_id, weinart, aktiv) VALUES (%L, %L, %s, 100, %L, %L, %L, true)',
      c_m, 'S112TEST Maische', v_jahr, 'ausbau', v_frei, 'rot')), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('mostzeile_aus_offener_maische_abgelehnt',
    pg_temp.s112_versuch(format('INSERT INTO public.pressung_behaelter (pressung_id, behaelter_id, menge_liter) VALUES (%L, %L, 100)', v_m1, v_frei2)), 'E23514');

  -- ── 4. Beginn und Gebinde stehen fest; Pressdatum nie vor dem Beginn ────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('maische_gebinde_fest',
    pg_temp.s112_versuch(format('UPDATE public.pressungen SET maische_behaelter_id = %L WHERE id = %L', v_voll, v_m1)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('maische_beginn_fest',
    pg_temp.s112_versuch(format('UPDATE public.pressungen SET maische_beginn = maische_beginn - 1 WHERE id = %L', v_m1)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('pressdatum_vor_beginn_abgelehnt',
    pg_temp.s112_versuch(format('UPDATE public.pressungen SET datum = maische_beginn - 1 WHERE id = %L', v_m1)), 'E23514');

  -- ── 5. Abpressen: schließen, nicht wieder öffnen; das Gebinde ist danach frei ───────────────────────────
  UPDATE public.pressungen SET maische_offen = false, most_liter_gesamt = 100 WHERE id = v_m1;
  v_erg := v_erg || pg_temp.s112_erwarte('nicht_wieder_oeffnen',
    pg_temp.s112_versuch(format('UPDATE public.pressungen SET maische_offen = true WHERE id = %L', v_m1)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('nach_abpressen_mostzeile_moeglich',
    pg_temp.s112_versuch(format('INSERT INTO public.pressung_behaelter (pressung_id, behaelter_id, menge_liter) VALUES (%L, %L, 100)', v_m1, v_frei)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('nach_abpressen_gebinde_frei',
    pg_temp.s112_versuch(format('INSERT INTO public.weinausbau (tenant_id, name, jahrgang, menge_liter, status, behaelter_id, weinart, aktiv) VALUES (%L, %L, %s, 100, %L, %L, %L, true)',
      c_m, 'S112TEST Maische', v_jahr, 'ausbau', v_frei, 'rot')), 'k1');
  -- stornierte Maische belegt das Gebinde nicht mehr
  UPDATE public.pressungen SET storniert_am = now(), storno_grund = 'S112TEST Fehlerfassung' WHERE id = v_m2;
  v_erg := v_erg || pg_temp.s112_erwarte('stornierte_maische_gibt_gebinde_frei',
    pg_temp.s112_versuch(format('INSERT INTO public.weinausbau (tenant_id, name, jahrgang, menge_liter, status, behaelter_id, weinart, aktiv) VALUES (%L, %L, %s, 100, %L, %L, %L, true)',
      c_m, 'S112TEST Maische', v_jahr, 'ausbau', v_frei2, 'rot')), 'k1');

  -- ── 6. RPC s112_pressung_anlegen ────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_mta);   -- die RPC prüft Mitgliedschaft und Schreibrecht des Benutzers
  v_rpc := public.s112_pressung_anlegen(c_m, jsonb_build_object('jahrgang_id', v_jg, 'lese_id', v_lese, 'datum', v_tag,
             'maische_beginn', v_tag, 'maische_behaelter_id', v_frei2), '[]'::jsonb);
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_maische_angesetzt',
    (SELECT concat_ws('|', maische_offen, maische_behaelter_id = v_frei2, maische_nr = v_max + 3, most_liter_gesamt IS NULL) FROM public.pressungen WHERE id = v_rpc), 't|t|t|t');
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_maische_ohne_gebinde_abgelehnt',
    pg_temp.s112_versuch(format('SELECT public.s112_pressung_anlegen(%L, %L::jsonb, %L::jsonb)', c_m,
      jsonb_build_object('jahrgang_id', v_jg, 'lese_id', v_lese, 'datum', v_tag, 'maische_beginn', v_tag)::text, '[]')), 'E22023');
  v_dir := public.s112_pressung_anlegen(c_m, jsonb_build_object('jahrgang_id', v_jg, 'lese_id', v_lese, 'datum', v_tag), '[]'::jsonb);
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_direktpressung_unveraendert',
    (SELECT concat_ws('|', maische_offen, maische_nr IS NULL, maische_beginn IS NULL) FROM public.pressungen WHERE id = v_dir), 'f|t|t');

  PERFORM pg_temp.s112_als_postgres();

  -- ── 7. Rechte und Schema ────────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('trigger_nicht_aufrufbar',
    has_function_privilege('authenticated', 'public.s112_maische_nummer()', 'EXECUTE') OR has_function_privilege('authenticated', 'public.s112_maische_pruefen()', 'EXECUTE')
      OR has_function_privilege('authenticated', 'public.s112_maische_gebinde_belegt()', 'EXECUTE') OR has_function_privilege('authenticated', 'public.s112_maische_mostzeile()', 'EXECUTE')
      OR has_function_privilege('anon', 'public.s112_maische_nummer()', 'EXECUTE'), false);
  v_erg := v_erg || pg_temp.s112_erwarte('nummer_je_jahrgang_eindeutig',
    (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'pressungen_jahrgang_maische_nr' AND indexdef LIKE 'CREATE UNIQUE INDEX%(jahrgang_id, maische_nr)%'), 1::bigint);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 19);
END $test$;
