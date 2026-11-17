-- @bereich: Keller – Maßnahmen an der Maische (KAN-481)
-- @ziel: Eine Maßnahme an der Maische ist eine Kellerbehandlung mit pressung_id = Maische statt einer Charge. Das
-- @ziel: Gebinde kommt von der Maische, was immer der Aufrufer schickt. Erlaubt ist sie nur an einer Maische (nicht an
-- @ziel: einer Direktpressung), nie zugleich mit einer Charge, nur innerhalb der Maischezeit (Beginn bis Pressdatum)
-- @ziel: und nicht an einer stornierten Maische. Ohne Charge und ohne Maische bleibt es bei der Regel aus KAN-475
-- @ziel: (nur Gebindepflege). Die Triggerfunktionen sind für Benutzer nicht aufrufbar.
-- @mutation ohne_pflicht: Trigger z_charge_pflicht fehlt | rot: (ohne_charge_.*|direktpressung_.*|datum_.*|stornierte_maische_.*)
-- @mutation ohne_check: CHECK charge_oder_maische fehlt | rot: charge_und_maische_abgelehnt
-- @mutation ohne_gebinde: Trigger a_gebinde_von_charge fehlt (Gebinde vom Aufrufer) | rot: gebinde_von_der_maische
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 99 (Stand 17.11.2026, KAN-481). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '99_massnahmen_maische';
  c_m     constant uuid := '33333333-3333-4333-8333-333333333333';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_jg    uuid;
  v_lese  uuid;
  v_frei  uuid;   -- leeres Gebinde (Maische)
  v_voll  uuid;   -- Gebinde mit Wein
  v_wa    uuid;   -- Charge darin
  v_typ   uuid;   -- Behandlungstyp (keine Gebindepflege)
  v_m     uuid;   -- Maische
  v_dir   uuid;   -- Direktpressung
  v_b     uuid;
  v_tag   date := (now() AT TIME ZONE 'Europe/Vienna')::date;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();
  v_a := pg_temp.s112_aufbau();
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_mutiere('ohne_pflicht', $m$DROP TRIGGER z_charge_pflicht ON public.keller_behandlungen$m$);
  PERFORM pg_temp.s112_mutiere('ohne_check', $m$ALTER TABLE public.keller_behandlungen DROP CONSTRAINT keller_behandlungen_charge_oder_maische_chk$m$);
  PERFORM pg_temp.s112_mutiere('ohne_gebinde', $m$DROP TRIGGER a_gebinde_von_charge ON public.keller_behandlungen$m$);

  SELECT l.jahrgang_id, l.id INTO v_jg, v_lese
    FROM public.lesen l JOIN public.weinjahrgaenge j ON j.id = l.jahrgang_id
   WHERE l.tenant_id = c_m AND NOT j.abgeschlossen ORDER BY j.jahrgang DESC, l.lfd_nr LIMIT 1;
  SELECT b.id INTO v_frei FROM public.behaelter b
   WHERE b.tenant_id = c_m AND b.aktiv
     AND NOT EXISTS (SELECT 1 FROM public.weinausbau w WHERE w.behaelter_id = b.id AND w.aktiv AND coalesce(w.menge_liter, 0) > 0)
     AND NOT EXISTS (SELECT 1 FROM public.pressungen p WHERE p.maische_behaelter_id = b.id AND p.maische_offen AND p.storniert_am IS NULL)
   ORDER BY b.id LIMIT 1;
  SELECT w.id, w.behaelter_id INTO v_wa, v_voll FROM public.weinausbau w
   WHERE w.tenant_id = c_m AND w.aktiv AND w.storniert_am IS NULL AND coalesce(w.menge_liter, 0) > 0 AND w.behaelter_id IS NOT NULL ORDER BY w.id LIMIT 1;
  SELECT t.id INTO v_typ FROM public.keller_behandlungstypen t WHERE t.tenant_id = c_m AND NOT t.gebindepflege ORDER BY t.name LIMIT 1;
  IF v_jg IS NULL OR v_frei IS NULL OR v_wa IS NULL OR v_typ IS NULL THEN
    RAISE EXCEPTION 'Staging-Demo unvollständig – Jahrgang mit Lese, leeres und belegtes Gebinde und ein Behandlungstyp nötig (demo_musterhof_zuruecksetzen() + demo_musterhof_y2_kette())';
  END IF;

  -- Maische, vor drei Tagen angesetzt, noch offen; dazu eine Direktpressung
  INSERT INTO public.pressungen (tenant_id, jahrgang_id, lese_id, datum, maische_beginn, maische_behaelter_id, maische_offen)
  VALUES (c_m, v_jg, v_lese, v_tag - 3, v_tag - 3, v_frei, true) RETURNING id INTO v_m;
  INSERT INTO public.pressungen (tenant_id, jahrgang_id, lese_id, datum) VALUES (c_m, v_jg, v_lese, v_tag) RETURNING id INTO v_dir;

  -- ── 1. Maßnahme an der offenen Maische: möglich, Gebinde kommt von der Maische ───────────────────────────
  INSERT INTO public.keller_behandlungen (tenant_id, typ_id, typ_name_snapshot, datum, menge, einheit, pressung_id, behaelter_id, notizen)
  VALUES (c_m, v_typ, 'S112TEST Maßnahme', v_tag - 2, 50, 'g', v_m, v_voll, 'S112TEST') RETURNING id INTO v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('gebinde_von_der_maische', (SELECT behaelter_id FROM public.keller_behandlungen WHERE id = v_b), v_frei);
  v_erg := v_erg || pg_temp.s112_erwarte('massnahme_ohne_charge_gespeichert',
    (SELECT concat_ws('|', weinausbau_id IS NULL, pressung_id = v_m) FROM public.keller_behandlungen WHERE id = v_b), 't|t');

  -- ── 2. Regeln ───────────────────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_charge_und_ohne_maische_abgelehnt',
    pg_temp.s112_versuch(format('INSERT INTO public.keller_behandlungen (tenant_id, typ_id, typ_name_snapshot, datum, behaelter_id) VALUES (%L, %L, %L, %L, %L)',
      c_m, v_typ, 'S112TEST', v_tag, v_frei)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('direktpressung_abgelehnt',
    pg_temp.s112_versuch(format('INSERT INTO public.keller_behandlungen (tenant_id, typ_id, typ_name_snapshot, datum, pressung_id) VALUES (%L, %L, %L, %L, %L)',
      c_m, v_typ, 'S112TEST', v_tag, v_dir)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('charge_und_maische_abgelehnt',
    pg_temp.s112_versuch(format('INSERT INTO public.keller_behandlungen (tenant_id, typ_id, typ_name_snapshot, datum, pressung_id, weinausbau_id) VALUES (%L, %L, %L, %L, %L, %L)',
      c_m, v_typ, 'S112TEST', v_tag - 2, v_m, v_wa)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('datum_vor_beginn_abgelehnt',
    pg_temp.s112_versuch(format('INSERT INTO public.keller_behandlungen (tenant_id, typ_id, typ_name_snapshot, datum, pressung_id) VALUES (%L, %L, %L, %L, %L)',
      c_m, v_typ, 'S112TEST', v_tag - 4, v_m)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('datum_verschieben_vor_beginn_abgelehnt',
    pg_temp.s112_versuch(format('UPDATE public.keller_behandlungen SET datum = %L WHERE id = %L', v_tag - 5, v_b)), 'E23514');

  -- ── 3. Nach dem Abpressen (Pressdatum gestern): nur noch innerhalb der Maischezeit ──────────────────────────
  UPDATE public.pressungen SET maische_offen = false, datum = v_tag - 1, most_liter_gesamt = 100 WHERE id = v_m;
  v_erg := v_erg || pg_temp.s112_erwarte('datum_nach_pressung_abgelehnt',
    pg_temp.s112_versuch(format('INSERT INTO public.keller_behandlungen (tenant_id, typ_id, typ_name_snapshot, datum, pressung_id) VALUES (%L, %L, %L, %L, %L)',
      c_m, v_typ, 'S112TEST', v_tag, v_m)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('nachtrag_innerhalb_der_maischezeit_moeglich',
    pg_temp.s112_versuch(format('INSERT INTO public.keller_behandlungen (tenant_id, typ_id, typ_name_snapshot, datum, pressung_id) VALUES (%L, %L, %L, %L, %L)',
      c_m, v_typ, 'S112TEST', v_tag - 1, v_m)), 'k1');
  -- die Regel aus KAN-475 gilt weiter: an einer Charge jede Behandlung
  v_erg := v_erg || pg_temp.s112_erwarte('an_der_charge_unveraendert',
    pg_temp.s112_versuch(format('INSERT INTO public.keller_behandlungen (tenant_id, typ_id, typ_name_snapshot, datum, weinausbau_id) VALUES (%L, %L, %L, %L, %L)',
      c_m, v_typ, 'S112TEST', v_tag, v_wa)), 'k1');

  -- ── 4. Stornierte Maische: keine neue Maßnahme; die erfasste bleibt ─────────────────────────────────────────
  UPDATE public.pressungen SET storniert_am = now(), storno_grund = 'S112TEST Fehlerfassung' WHERE id = v_m;
  v_erg := v_erg || pg_temp.s112_erwarte('stornierte_maische_abgelehnt',
    pg_temp.s112_versuch(format('INSERT INTO public.keller_behandlungen (tenant_id, typ_id, typ_name_snapshot, datum, pressung_id) VALUES (%L, %L, %L, %L, %L)',
      c_m, v_typ, 'S112TEST', v_tag - 2, v_m)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('massnahme_bleibt_nach_storno_der_maische',
    (SELECT count(*) FROM public.keller_behandlungen WHERE id = v_b AND pressung_id = v_m AND storniert_am IS NULL), 1::bigint);

  -- ── 5. Rechte und Schema ────────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('trigger_nicht_aufrufbar',
    has_function_privilege('authenticated', 'public.s112_behandlung_an_charge()', 'EXECUTE')
      OR has_function_privilege('authenticated', 'public.s112_behandlung_gebinde_von_charge()', 'EXECUTE')
      OR has_function_privilege('anon', 'public.s112_behandlung_an_charge()', 'EXECUTE'), false);
  v_erg := v_erg || pg_temp.s112_erwarte('index_und_fremdverweis',
    (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'keller_behandlungen_pressung_id')
      + (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.keller_behandlungen'::regclass AND tgname = 'z_fremdverweis_pressung_id'), 2::bigint);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 14);
END $test$;
