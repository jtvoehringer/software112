-- @bereich: Transportscheinnummer (TBS-Nr.) bei Verkauf und Zukauf (KAN-90)
-- @ziel: Die TBS-Nr. der eigenen Transportbescheinigung (tbs_nummer, tbs_jahr) leitet die Datenbank aus dem Formular ab –
-- @ziel: Spalte und Formular stimmen immer überein, direkt schreiben geht nicht; ein Duplikat im selben Jahr lehnt sie ab
-- @ziel: (stornierte zählen nicht). Die TBS-Nr. des Lieferanten am Zukauf ist geprüft, protokolliert, auch nach einer
-- @ziel: Folgebuchung änderbar (Positivliste a_freeze) und wird von s112_zukauf_buchen angenommen.
-- @mutation tbs_index_weg: kein UNIQUE-Index auf die TBS-Nr. | rot: duplikat_abgelehnt
-- @mutation tbs_trigger_weg: kein Ableitungs-Trigger b_tbs_spalten | rot: spalte_aus_formular
-- @mutation zukauf_protokoll_alt: Protokolltrigger des Zukaufs ohne TBS-Spalten | rot: protokoll_zukauf_tbs
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 42 (Stand 06.10.2026, KAN-90). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '42_tbs_nummer';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_tb1   uuid;
  v_tb2   uuid;
  v_zk    uuid;
  v_rpc   jsonb;
  v_txt   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ───────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_zk := (pg_temp.s112_beispiel('zukauf_posten', v_b) ->> 'id')::uuid;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('tbs_index_weg', $m$DROP INDEX public.transportbescheinigungen_tbs_nummer_uq$m$);
  PERFORM pg_temp.s112_mutiere('tbs_trigger_weg', $m$DROP TRIGGER b_tbs_spalten ON public.transportbescheinigungen$m$);
  PERFORM pg_temp.s112_mutiere('zukauf_protokoll_alt', $m$DROP TRIGGER z_protokoll_aendern ON public.zukauf_posten;
    CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF menge ON public.zukauf_posten
      FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('menge')$m$);

  PERFORM pg_temp.s112_als(v_bw);
  -- ── 1. Eigene TBS: Spalten aus dem Formular ───────────────────────────────────────────────────────────
  INSERT INTO public.transportbescheinigungen (tenant_id, formular_daten)
  VALUES (v_b, jsonb_build_object('laufende_nr', ' 7 ', 'jahr', '2026')) RETURNING id INTO v_tb1;
  v_erg := v_erg || pg_temp.s112_erwarte('spalte_aus_formular',
    (SELECT tbs_nummer = '7' AND tbs_jahr = 2026 FROM public.transportbescheinigungen WHERE id = v_tb1), true);
  PERFORM pg_temp.s112_fehlertext(format('UPDATE public.transportbescheinigungen SET tbs_nummer = %L, tbs_jahr = 2020 WHERE id = %L', '99', v_tb1));
  v_erg := v_erg || pg_temp.s112_erwarte('spalte_nicht_direkt',
    (SELECT tbs_nummer || '/' || tbs_jahr FROM public.transportbescheinigungen WHERE id = v_tb1), '7/2026');
  INSERT INTO public.transportbescheinigungen (tenant_id, formular_daten)
  VALUES (v_b, jsonb_build_object('laufende_nr', '', 'jahr', '26')) RETURNING id INTO v_tb2;
  v_erg := v_erg || pg_temp.s112_erwarte('jahr_ungueltig_leer',
    (SELECT tbs_jahr IS NULL AND tbs_nummer IS NULL FROM public.transportbescheinigungen WHERE id = v_tb2), true);

  -- ── 2. Duplikat im selben Jahr abgelehnt, anderes Jahr und nach Storno frei ────────────────────────────
  v_txt := pg_temp.s112_fehlertext(format('INSERT INTO public.transportbescheinigungen (tenant_id, formular_daten) VALUES (%L, %L)',
    v_b, '{"laufende_nr": "7", "jahr": "2026"}'));
  v_erg := v_erg || pg_temp.s112_erwarte('duplikat_abgelehnt', left(v_txt, 5), '23505');
  v_erg := v_erg || pg_temp.s112_erwarte('anderes_jahr_frei',
    pg_temp.s112_fehlertext(format('INSERT INTO public.transportbescheinigungen (tenant_id, formular_daten) VALUES (%L, %L)',
      v_b, '{"laufende_nr": "7", "jahr": "2025"}')), 'ok');
  INSERT INTO public.transportbescheinigungen (tenant_id, formular_daten)
  VALUES (v_b, jsonb_build_object('laufende_nr', '8', 'jahr', '2026')) RETURNING id INTO v_tb2;
  v_erg := v_erg || pg_temp.s112_erwarte('duplikat_bei_aenderung',
    left(pg_temp.s112_fehlertext(format('UPDATE public.transportbescheinigungen SET formular_daten = formular_daten || %L WHERE id = %L',
      '{"laufende_nr": "7"}', v_tb2)), 5), '23505');
  v_erg := v_erg || pg_temp.s112_erwarte('aenderung_abgeleitet',
    pg_temp.s112_fehlertext(format('UPDATE public.transportbescheinigungen SET formular_daten = formular_daten || %L WHERE id = %L',
      '{"laufende_nr": "9"}', v_tb2)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('aenderung_spalte',
    (SELECT tbs_nummer FROM public.transportbescheinigungen WHERE id = v_tb2), '9');
  PERFORM pg_temp.s112_fehlertext(format('UPDATE public.transportbescheinigungen SET storniert_am = now(), storno_grund = %L WHERE id = %L',
    'S112TEST falsche Nummer', v_tb1));
  v_erg := v_erg || pg_temp.s112_erwarte('nach_storno_frei',
    pg_temp.s112_fehlertext(format('INSERT INTO public.transportbescheinigungen (tenant_id, formular_daten) VALUES (%L, %L)',
      v_b, '{"laufende_nr": "7", "jahr": "2026"}')), 'ok');

  -- ── 3. Zukauf: TBS-Nr. des Lieferanten ────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('zukauf_tbs_schreiben',
    pg_temp.s112_fehlertext(format('UPDATE public.zukauf_posten SET tbs_nummer_lieferant = %L, tbs_jahr_lieferant = 2026 WHERE id = %L', '1234', v_zk)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('zukauf_jahr_geprueft',
    left(pg_temp.s112_fehlertext(format('UPDATE public.zukauf_posten SET tbs_jahr_lieferant = 1999 WHERE id = %L', v_zk)), 5), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('zukauf_nummer_geprueft',
    left(pg_temp.s112_fehlertext(format('UPDATE public.zukauf_posten SET tbs_nummer_lieferant = %L WHERE id = %L', '  ', v_zk)), 5), '23514');
  v_rpc := public.s112_zukauf_buchen(v_b, jsonb_build_object('datum', current_date, 'art', 'trauben', 'menge', 100, 'einheit', 'kg',
    'tbs_nummer_lieferant', '55', 'tbs_jahr_lieferant', 2026));
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_nimmt_tbs',
    (SELECT tbs_nummer_lieferant || '/' || tbs_jahr_lieferant FROM public.zukauf_posten WHERE id = (v_rpc ->> 'zukauf_id')::uuid), '55/2026');
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_zukauf_tbs',
    EXISTS (SELECT 1 FROM public.bestandsprotokoll p WHERE p.tabelle = 'zukauf_posten' AND p.datensatz_id = v_zk
             AND 'tbs_nummer_lieferant' = ANY (p.geaenderte_spalten)), true);
  v_erg := v_erg || pg_temp.s112_erwarte('freeze_positivliste',
    (SELECT pg_get_triggerdef(t.oid) LIKE '%eingangsrechnungsnummer,tbs_nummer_lieferant,tbs_jahr_lieferant,%'
       FROM pg_trigger t WHERE t.tgrelid = 'public.zukauf_posten'::regclass AND t.tgname = 'a_freeze'), true);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 15);
END $test$;
