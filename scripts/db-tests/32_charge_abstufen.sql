-- @bereich: Charge abstufen (KAN-82) – RPC s112_charge_abstufen und Protokoll charge_umstufungen
-- @ziel: Abstufen nur mit Grund (≥ 10 Zeichen), nicht in die Zukunft, nicht in einen abgeschlossenen Kellerbuch-Zeitraum
-- @ziel: und nur mit Schreibrecht Kellerbuch im eigenen Betrieb; die Merkmale der Charge ändern sich, die Abstufung steht
-- @ziel: mit Datum, Menge, alt → neu, Grund und Benutzer in charge_umstufungen (per API nur lesbar) und mit Grund im
-- @ziel: Änderungsprotokoll; eine geltende Prüfnummer erlischt am Datum der Abstufung (KAN-100).
-- @mutation ohne_grund: Grund wird nicht geprüft | rot: grund_.*
-- @mutation ohne_abschluss: Kellerbuch-Abschluss wird nicht geprüft | rot: abschluss_.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 32 (Stand 05.10.2026, KAN-82). Alles zurückgerollt.

CREATE FUNCTION pg_temp.t32_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't32_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;   -- wie die RPCs (Wiener Zeit, nicht UTC)
  c_datei constant text := '32_charge_abstufen';
  c_rpc   constant text := 'SELECT public.s112_charge_abstufen(%L::uuid, %L::uuid, %L::date, %L::jsonb, %L, %L::uuid)';
  c_neu   constant text := '{"qualitaetsstufe": "landwein"}';
  c_grund constant text := 'Säure zu hoch, Bescheid BKI';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_wa    uuid;
  v_wb    uuid;
  v_wm    uuid;
  v_d     uuid;
  v_n     bigint;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ───────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_wa := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "800", "qualitaetsstufe": "qualitaetswein"}') ->> 'id')::uuid;
  v_wb := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "300", "qualitaetsstufe": "kabinett"}') ->> 'id')::uuid;
  v_wm := (pg_temp.s112_beispiel('weinausbau', v_m, NULL, '{"menge_liter": "100", "qualitaetsstufe": "qualitaetswein"}') ->> 'id')::uuid;
  -- geltende Prüfnummer an v_wa (eingereicht vor 20 Tagen, zugeteilt)
  v_d := (pg_temp.s112_beispiel('dac_antrag', v_b, NULL, jsonb_build_object('weinausbau_id', v_wa, 'status', 'genehmigt',
    'eingereicht_am', v_heute - 20, 'bescheid_am', v_heute - 10, 'pruefnummer', 'N 32/26')) ->> 'id')::uuid;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('ohne_grund',
    $m$SELECT pg_temp.t32_ersetze('public.s112_charge_abstufen(uuid, uuid, date, jsonb, text, uuid)'::regprocedure,
      $r$IF length\(v_grund\) < 10 THEN$r$, $r$IF false THEN$r$)$m$);
  PERFORM pg_temp.s112_mutiere('ohne_abschluss',
    $m$SELECT pg_temp.t32_ersetze('public.s112_charge_abstufen(uuid, uuid, date, jsonb, text, uuid)'::regprocedure,
      $r$IF v_bis IS NOT NULL AND v_datum <= v_bis THEN$r$, $r$IF false THEN$r$)$m$);

  -- ── 1. Ablehnungen ────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('grund_zu_kurz',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wa, v_heute, c_neu, 'kurz', NULL)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('datum_zukunft',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wa, v_heute + 1, c_neu, c_grund, NULL)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('nichts_zu_aendern',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wa, v_heute, '{"qualitaetsstufe": "qualitaetswein"}', c_grund, NULL)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('idor_fremde_charge',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wm, v_heute, c_neu, c_grund, NULL)), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('idor_fremde_quelle',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wa, v_heute, c_neu, c_grund, v_wm)), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_m, v_wm, v_heute, c_neu, c_grund, NULL)), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wa, v_heute, c_neu, c_grund, NULL)), ':', 1), '42501');

  -- Kellerbuch bis vorgestern abgeschlossen: vorgestern abgelehnt, gestern zulässig
  PERFORM pg_temp.s112_als_postgres();
  INSERT INTO public.kellerbuch_abschluesse (tenant_id, abgeschlossen_bis, bemerkung) VALUES (v_b, v_heute - 2, 'S112TEST');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('abschluss_gesperrt',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wa, v_heute - 2, c_neu, c_grund, NULL)), ':', 1), '42501');

  -- ── 2. Abstufen (gestern) ─────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('abstufen_ok',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wa, v_heute - 1, '{"qualitaetsstufe": "landwein", "herkunft_code": "weinland"}', c_grund, NULL)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('charge_merkmale',
    (SELECT w.qualitaetsstufe || '|' || coalesce(w.herkunft_code, '–') FROM public.weinausbau w WHERE w.id = v_wa), 'landwein|weinland');
  v_erg := v_erg || pg_temp.s112_erwarte('protokollzeile',
    (SELECT u.alt_qualitaetsstufe || '>' || u.neu_qualitaetsstufe || '|' || u.menge_liter || '|' || (u.datum = v_heute - 1) || '|' || u.grund || '|' || (u.erstellt_von = v_bw)
       FROM public.charge_umstufungen u WHERE u.weinausbau_id = v_wa ORDER BY u.erstellt_am DESC, u.id LIMIT 1), 'qualitaetswein>landwein|800.000|true|' || c_grund || '|true');
  v_erg := v_erg || pg_temp.s112_erwarte('api_lesen',
    pg_temp.s112_versuch(format('SELECT 1 FROM public.charge_umstufungen WHERE weinausbau_id = %L', v_wa)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('api_schreiben',
    pg_temp.s112_versuch(format('INSERT INTO public.charge_umstufungen (tenant_id, weinausbau_id, datum, menge_liter, grund) VALUES (%L, %L, pg_temp.s112_heute(), 1, %L)', v_b, v_wb, c_grund)), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('api_aendern',
    pg_temp.s112_versuch(format('UPDATE public.charge_umstufungen SET grund = %L WHERE weinausbau_id = %L', 'S112TEST anders begründet', v_wa)), 'k0');

  PERFORM pg_temp.s112_als_postgres();
  SELECT count(*) INTO v_n FROM public.bestandsprotokoll p
   WHERE p.tabelle = 'weinausbau' AND p.datensatz_id = v_wa AND p.aktion = 'UPDATE' AND p.benutzer_id = v_bw
     AND p.grund LIKE 'Abstufung am % (800,00 L): ' || c_grund AND 'qualitaetsstufe' = ANY (p.geaenderte_spalten);
  v_erg := v_erg || pg_temp.s112_erwarte('aenderungsprotokoll_grund', v_n, 1::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('pn_erloschen_am_datum',
    (SELECT pc.ende_grund || '|' || (pc.gueltig_bis = v_heute - 1) FROM public.pruefnummer_chargen pc WHERE pc.dac_antrag_id = v_d), 'abstufung|true');
  v_erg := v_erg || pg_temp.s112_erwarte('einstellungen_zurueck',
    coalesce(current_setting('s112.umstufung_datum', true), '') || coalesce(current_setting('s112.aenderung_grund', true), ''), '');

  -- ── 3. Teilmenge: neue Charge mit Ausgangscharge ──────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('teilmenge_ok',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wb, v_heute, '{"qualitaetsstufe": "qualitaetswein"}', c_grund, v_wa)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('teilmenge_quelle',
    (SELECT u.quelle_weinausbau_id FROM public.charge_umstufungen u WHERE u.weinausbau_id = v_wb), v_wa);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 19);
END $test$;
