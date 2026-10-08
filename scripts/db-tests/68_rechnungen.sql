-- @bereich: Rechnungen (KAN-102) – Tabelle rechnungen, Lieferscheinnummer, Übergang 1:1 (Rechnung im Insert, Spiegel, Wartung)
-- @ziel: Ein Verkauf (Lieferschein) bekommt im Insert eine Lieferscheinnummer und eine Rechnung mit derselben Nummer wie
-- @ziel: verkaufsposten.rechnungsnummer. Storno und bezahlt spiegeln sich auf die Rechnung. Rechnungen sind für Mitglieder
-- @ziel: lesbar, aber nicht direkt schreibbar; Lieferscheinnummer und rechnung_id setzt nur das System. Fremde Betriebe sehen
-- @ziel: nichts. Wird ein Lieferschein in der Wartung gelöscht, geht die Rechnung mit.
-- @mutation spiegel_aus: Spiegel-Trigger fehlt | rot: storno_gespiegelt
-- @mutation aufraeumen_aus: Rechnung bleibt beim Löschen des Lieferscheins | rot: wartung_mitgeloescht
-- @mutation direkt_schreibbar: INSERT auf rechnungen für authenticated | rot: direkt_insert
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 68 (Stand 08.10.2026, KAN-102). Alles zurückgerollt.

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  c_datei constant text := '68_rechnungen';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_mw    uuid;
  v_vp    uuid;
  v_vp2   uuid;
  v_re    uuid;
  v_nr    text;
  v_ls    text;
  v_z0    integer;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ──────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_mw := (v_a ->> 'm_w')::uuid;
  SELECT lieferschein_zaehler INTO v_z0 FROM public.tenant_einstellungen WHERE tenant_id = v_b;

  PERFORM pg_temp.s112_mutiere('spiegel_aus', $m$DROP TRIGGER z_rechnung_spiegeln ON public.verkaufsposten$m$);
  PERFORM pg_temp.s112_mutiere('aufraeumen_aus', $m$DROP TRIGGER z_rechnung_aufraeumen ON public.verkaufsposten$m$);
  PERFORM pg_temp.s112_mutiere('direkt_schreibbar', $m$GRANT INSERT ON public.rechnungen TO authenticated;
    CREATE POLICY t67_insert ON public.rechnungen FOR INSERT TO authenticated WITH CHECK (true)$m$);

  -- ── 1. Verkauf als Mitarbeiter: Lieferscheinnummer und Rechnung im Insert ─────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen) VALUES (v_b, v_heute, 'S112TEST KAN-102 a')
    RETURNING id, rechnungsnummer, lieferscheinnummer, rechnung_id INTO v_vp, v_nr, v_ls, v_re;
  INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz)
  VALUES (v_b, v_vp, 'sonstiges', 'S112TEST Gutschein', 1, 'Stk', 10, 20);
  v_erg := v_erg || pg_temp.s112_erwarte('lieferscheinnummer_vergeben',
    v_ls = 'LS-' || to_char(v_heute, 'YYYY') || '-' || lpad(v_z0::text, 4, '0'), true);
  v_erg := v_erg || pg_temp.s112_erwarte('rechnung_angelegt',
    (SELECT concat_ws('|', r.rechnungsnummer = v_nr, r.datum = v_heute, r.storniert, r.bezahlt) FROM public.rechnungen r WHERE r.id = v_re), 't|t|f|f');
  v_erg := v_erg || pg_temp.s112_erwarte('mitarbeiter_liest',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.rechnungen WHERE id = %L', v_re)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('api_lieferscheinnummer_abgelehnt',
    pg_temp.s112_versuch(format('INSERT INTO public.verkaufsposten (tenant_id, datum, lieferscheinnummer) VALUES (%L, pg_temp.s112_heute(), %L)', v_b, 'S112TEST-LS')), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('api_lieferscheinnummer_aendern',
    pg_temp.s112_versuch(format('UPDATE public.verkaufsposten SET lieferscheinnummer = %L WHERE id = %L', 'S112TEST-LS', v_vp)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('api_rechnung_id_aendern',
    pg_temp.s112_versuch(format('UPDATE public.verkaufsposten SET rechnung_id = NULL WHERE id = %L', v_vp)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_insert',
    pg_temp.s112_versuch(format('INSERT INTO public.rechnungen (tenant_id, rechnungsnummer) VALUES (%L, %L)', v_b, 'S112TEST-RE')), 'G');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_update',
    pg_temp.s112_versuch(format('UPDATE public.rechnungen SET bezahlt = true WHERE id = %L', v_re)), 'G');

  -- ── 2. Zahlung → bezahlt, Storno → storniert (Spiegel) ────────────────────────────────────────────────
  INSERT INTO public.zahlungen (tenant_id, verkaufsposten_id, betrag, art, datum) VALUES (v_b, v_vp, 10, 'bar', v_heute);
  v_erg := v_erg || pg_temp.s112_erwarte('bezahlt_gespiegelt',
    (SELECT concat_ws('|', r.bezahlt, r.bezahlt_am IS NOT NULL) FROM public.rechnungen r WHERE r.id = v_re), 't|t');
  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen) VALUES (v_b, v_heute, 'S112TEST KAN-102 b')
    RETURNING id INTO v_vp2;
  UPDATE public.verkaufsposten SET storniert = true, storno_grund = 'S112TEST falsch erfasst' WHERE id = v_vp2;
  v_erg := v_erg || pg_temp.s112_erwarte('storno_gespiegelt',
    (SELECT concat_ws('|', r.storniert, r.storno_grund, r.storniert_von IS NOT NULL) FROM public.rechnungen r
      JOIN public.verkaufsposten v ON v.rechnung_id = r.id WHERE v.id = v_vp2), 't|S112TEST falsch erfasst|t');
  v_erg := v_erg || pg_temp.s112_erwarte('lieferschein_fortlaufend',
    (SELECT v.lieferscheinnummer FROM public.verkaufsposten v WHERE v.id = v_vp2) = 'LS-' || to_char(v_heute, 'YYYY') || '-' || lpad((v_z0 + 1)::text, 4, '0'), true);

  -- ── 3. Leser und fremder Betrieb ──────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_liest',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.rechnungen WHERE tenant_id = %L', v_b)), '2');
  PERFORM pg_temp.s112_als(v_mw);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb_sieht_nichts',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.rechnungen WHERE tenant_id = %L', v_b)), '0');
  PERFORM pg_temp.s112_als_postgres();

  -- ── 4. Nummer eindeutig je Betrieb; Wartung löscht die Rechnung mit ──────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('nummer_eindeutig',
    pg_temp.s112_versuch(format('INSERT INTO public.rechnungen (tenant_id, rechnungsnummer) VALUES (%L, %L)', v_b, v_nr)), 'E23505');
  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);
  DELETE FROM public.zahlungen WHERE verkaufsposten_id = v_vp;   -- storno-ausnahme: DB-Test, Wartung mit s112.loeschen_erlaubt
  DELETE FROM public.verkauf_positionen WHERE verkaufsposten_id = v_vp;   -- storno-ausnahme: DB-Test, Wartung mit s112.loeschen_erlaubt
  DELETE FROM public.verkaufsposten WHERE id = v_vp;   -- storno-ausnahme: DB-Test, Wartung mit s112.loeschen_erlaubt
  PERFORM set_config('s112.loeschen_erlaubt', '', true);
  v_erg := v_erg || pg_temp.s112_erwarte('wartung_mitgeloescht',
    (SELECT count(*) FROM public.rechnungen WHERE id = v_re)::text, '0');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 15);
END $test$;
