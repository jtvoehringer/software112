-- @bereich: Kellerbuch – Kellerbehandlung an der Charge (KAN-475)
-- @ziel: Eine Kellerbehandlung braucht eine Charge; das Gebinde ist nur die Angabe „lag damals in …“ und wird beim
-- @ziel: Anlegen von der Charge übernommen. Ohne Charge ist am Gebinde nur ein Typ der Gebindepflege erlaubt
-- @ziel: (Reinigen, Konservieren, Umbenennung, Notiz); weder Charge noch Gebinde geht nie. Die Charge lässt sich einer
-- @ziel: gewöhnlichen Behandlung nicht nachträglich nehmen. Wartung (s112.loeschen_erlaubt) passiert die Regel.
-- @ziel: Die Regel läuft NACH der Rechteprüfung (AFTER-Trigger z_charge_pflicht): Ein fremder Betrieb bekommt die
-- @ziel: Rechte-Ablehnung, nicht die fachliche Meldung (DB-Test 11).
-- @mutation ohne_trigger: Trigger z_charge_pflicht fehlt (Behandlung ohne Charge wieder möglich) | rot: ohne_charge_.*|weder_.*|charge_entfernen_.*
-- @mutation alle_pflege: jeder Typ gilt als Gebindepflege | rot: ohne_charge_gewoehnlich
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 99 (Stand 16.11.2026, KAN-475). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '99_behandlung_an_charge';
  c_m     constant uuid := '33333333-3333-4333-8333-333333333333';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_mw    uuid;
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  v_charge uuid;
  v_beh   uuid;
  v_typ   uuid;
  v_pflege uuid;
  v_id    uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_mw := (v_a ->> 'm_w')::uuid;

  -- Aufbau im Musterhof: eine Charge im Gebinde, ein gewöhnlicher Typ, ein Typ der Gebindepflege
  SELECT id, behaelter_id INTO v_charge, v_beh FROM public.weinausbau WHERE tenant_id = c_m AND aktiv AND behaelter_id IS NOT NULL ORDER BY id LIMIT 1;
  IF v_charge IS NULL THEN
    RAISE EXCEPTION 'Staging-Demo unvollständig – keine Charge im Gebinde im Musterhof (demo_musterhof_zuruecksetzen() + demo_musterhof_y2_kette())';
  END IF;
  INSERT INTO public.keller_behandlungstypen (tenant_id, name, einheit_standard, pn_wirkung, gebindepflege) VALUES (c_m, 'S112TEST Schönung', 'g', 'pflege', false) RETURNING id INTO v_typ;
  INSERT INTO public.keller_behandlungstypen (tenant_id, name, einheit_standard, pn_wirkung, gebindepflege) VALUES (c_m, 'S112TEST Reinigung', '-', 'pflege', true) RETURNING id INTO v_pflege;

  PERFORM pg_temp.s112_mutiere('ohne_trigger', $m$DROP TRIGGER z_charge_pflicht ON public.keller_behandlungen$m$);
  PERFORM pg_temp.s112_mutiere('alle_pflege', $m$UPDATE public.keller_behandlungstypen SET gebindepflege = true$m$);

  -- ── 1. Ohne Charge: nur Gebindepflege ───────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_mw);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_charge_gewoehnlich',
    pg_temp.s112_versuch(format('INSERT INTO public.keller_behandlungen (tenant_id, behaelter_id, datum, typ_id, typ_name_snapshot, menge, einheit) VALUES (%L, %L, %L, %L, %L, 5, %L)', c_m, v_beh, v_heute, v_typ, 'S112TEST Schönung', 'g')), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_charge_gebindepflege',
    pg_temp.s112_versuch(format('INSERT INTO public.keller_behandlungen (tenant_id, behaelter_id, datum, typ_id, typ_name_snapshot, einheit) VALUES (%L, %L, %L, %L, %L, %L)', c_m, v_beh, v_heute, v_pflege, 'S112TEST Reinigung', '-')), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('weder_charge_noch_gebinde',
    pg_temp.s112_versuch(format('INSERT INTO public.keller_behandlungen (tenant_id, datum, typ_id, typ_name_snapshot, einheit) VALUES (%L, %L, %L, %L, %L)', c_m, v_heute, v_pflege, 'S112TEST Reinigung', '-')), 'E23514');

  -- ── 2. Mit Charge: Gebinde wird übernommen, auch als Benutzer ───────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('mit_charge_ohne_gebinde_als_benutzer',
    pg_temp.s112_versuch(format('INSERT INTO public.keller_behandlungen (tenant_id, weinausbau_id, datum, typ_id, typ_name_snapshot, menge, einheit) VALUES (%L, %L, %L, %L, %L, 5, %L)', c_m, v_charge, v_heute, v_typ, 'S112TEST Schönung', 'g')), 'k1');
  PERFORM pg_temp.s112_als_postgres();
  INSERT INTO public.keller_behandlungen (tenant_id, weinausbau_id, datum, typ_id, typ_name_snapshot, menge, einheit)
  VALUES (c_m, v_charge, v_heute, v_typ, 'S112TEST Schönung', 5, 'g') RETURNING id INTO v_id;
  v_erg := v_erg || pg_temp.s112_erwarte('gebinde_von_der_charge',
    (SELECT behaelter_id FROM public.keller_behandlungen WHERE id = v_id), v_beh);
  v_erg := v_erg || pg_temp.s112_erwarte('angegebenes_gebinde_bleibt',
    pg_temp.s112_versuch(format('INSERT INTO public.keller_behandlungen (tenant_id, weinausbau_id, behaelter_id, datum, typ_id, typ_name_snapshot, menge, einheit) VALUES (%L, %L, %L, %L, %L, %L, 5, %L)', c_m, v_charge, v_beh, v_heute, v_typ, 'S112TEST Schönung', 'g')), 'k1');

  -- ── 3. Charge nachträglich nehmen bzw. Typ wechseln ─────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('charge_entfernen_gewoehnlich',
    pg_temp.s112_versuch(format('UPDATE public.keller_behandlungen SET weinausbau_id = NULL WHERE id = %L', v_id)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('charge_entfernen_und_gebinde',
    pg_temp.s112_versuch(format('UPDATE public.keller_behandlungen SET weinausbau_id = NULL, behaelter_id = NULL WHERE id = %L', v_id)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('notiz_aendern_bleibt_moeglich',
    pg_temp.s112_versuch(format('UPDATE public.keller_behandlungen SET notizen = %L WHERE id = %L', 'S112TEST', v_id)), 'k1');
  -- Gebindepflege ohne Charge darf nicht nachträglich ein gewöhnlicher Typ werden
  INSERT INTO public.keller_behandlungen (tenant_id, behaelter_id, datum, typ_id, typ_name_snapshot, einheit)
  VALUES (c_m, v_beh, v_heute, v_pflege, 'S112TEST Reinigung', '-') RETURNING id INTO v_id;
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_charge_typwechsel',
    pg_temp.s112_versuch(format('UPDATE public.keller_behandlungen SET typ_id = %L WHERE id = %L', v_typ, v_id)), 'E23514');

  -- ── 4. Wartung und Rechte ───────────────────────────────────────────────────────────────────────────────────
  PERFORM set_config('s112.loeschen_erlaubt', c_m::text, true);
  v_erg := v_erg || pg_temp.s112_erwarte('wartung_passiert',
    pg_temp.s112_versuch(format('UPDATE public.keller_behandlungen SET typ_id = %L WHERE id = %L', v_typ, v_id)), 'k1');
  PERFORM set_config('s112.loeschen_erlaubt', '', true);
  v_erg := v_erg || pg_temp.s112_erwarte('trigger_nicht_aufrufbar',
    has_function_privilege('authenticated', 'public.s112_behandlung_an_charge()', 'EXECUTE') OR has_function_privilege('anon', 'public.s112_behandlung_an_charge()', 'EXECUTE'), false);
  -- die Regel ist ein AFTER-Trigger (nach RLS), das Übernehmen des Gebindes ein BEFORE-Trigger, der nie wirft
  v_erg := v_erg || pg_temp.s112_erwarte('regel_nach_der_rechtepruefung',
    (SELECT string_agg(tgname || ':' || CASE WHEN (tgtype & 2) = 2 THEN 'before' ELSE 'after' END, ',' ORDER BY tgname)
       FROM pg_trigger WHERE tgrelid = 'public.keller_behandlungen'::regclass AND tgname IN ('a_charge_pflicht', 'a_gebinde_von_charge', 'z_charge_pflicht')),
    'a_gebinde_von_charge:before,z_charge_pflicht:after');
  PERFORM pg_temp.s112_als((v_a ->> 'b_ta')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb_rechte_ablehnung',
    pg_temp.s112_versuch(format('INSERT INTO public.keller_behandlungen (tenant_id) VALUES (%L)', c_m)) IN ('R', 'G', 'T'), true);
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('gebinde_nicht_mehr_pflicht',
    (SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'keller_behandlungen' AND column_name = 'behaelter_id'), 'YES');
  v_erg := v_erg || pg_temp.s112_erwarte('app_typen_sind_gebindepflege',
    (SELECT count(*) FROM public.keller_behandlungstypen WHERE lower(btrim(name)) IN ('umbenennung', 'notiz') AND NOT gebindepflege), 0::bigint);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 15);
END $test$;
