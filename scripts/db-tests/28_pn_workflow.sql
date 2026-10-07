-- @bereich: Prüfnummernantrag als Workflow (KAN-97)
-- @ziel: Status nur über s112_pruefnummernantrag_status_setzen (Übergangsmatrix, Kellerbuch-Schreibrecht, eigener Betrieb);
-- @ziel: ein neuer Antrag ist ein Entwurf; ab „Eingereicht“ sind Antrags-/Weinangaben, Menge und Charge gesperrt (42501),
-- @ziel: die Prüfnummer bis „Zugeteilt“ änderbar, danach nur Notizen/aktiv, im Endstatus nur aktiv und Storno.
-- @ziel: Antragsformular (pruefnummernantraege) höchstens einmal je Antrag, ab „Eingereicht“ unveränderlich.
-- @ziel: Jeder Statuswechsel steht mit Benutzer, Datum und Grund in pruefnummer_ereignisse und im Bestandsprotokoll.
-- @ziel: Wartung (s112.loeschen_erlaubt für den Betrieb) darf eingereichte Anträge löschen (Mandanten-Löschung, Resets).
-- @mutation matrix_offen: RPC prüft die Übergangsmatrix nicht | rot: uebergang_.*
-- @mutation status_direkt: Statusschutz lässt direkte Statusänderungen zu | rot: status_direkt|insert_nicht_entwurf
-- @mutation freeze_eingereicht_aus: kein Freeze ab Eingereicht | rot: eingereicht_menge|eingereicht_charge
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 28 (Stand 04.10.2026, KAN-97). Alles zurückgerollt.

CREATE FUNCTION pg_temp.t28_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't28_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;   -- wie die RPCs (Wiener Zeit, nicht UTC)
  c_datei  constant text := '28_pn_workflow';
  c_rpc    constant text := 'SELECT public.s112_pruefnummernantrag_status_setzen(%L::uuid, %L::uuid, %L, %L::date, %L, %L)';
  c_ins    constant text := 'INSERT INTO public.dac_antrag (tenant_id, bezeichnung, dac_region, status) VALUES (%L, %L, %L, %L)';
  v_t0     timestamptz;
  v_erg    text[] := '{}';
  v_a      jsonb;
  v_m      uuid;
  v_b      uuid;
  v_bw     uuid;
  v_bl     uuid;
  v_bcrm   uuid;
  v_d      uuid;
  v_d2     uuid;
  v_dm     uuid;
  v_wa     uuid;
  v_txt    text;
  v_n      bigint;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ───────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_m := (v_a ->> 'm')::uuid;
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_bcrm := pg_temp.s112_benutzer('winzer', v_b, ARRAY['crm']);
  v_wa := (pg_temp.s112_beispiel('weinausbau', v_b) ->> 'id')::uuid;
  v_d := (pg_temp.s112_beispiel('dac_antrag', v_b, NULL, jsonb_build_object('weinausbau_id', v_wa)) ->> 'id')::uuid;
  v_d2 := (pg_temp.s112_beispiel('dac_antrag', v_b) ->> 'id')::uuid;
  v_dm := (pg_temp.s112_beispiel('dac_antrag', v_m) ->> 'id')::uuid;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('matrix_offen',
    $m$SELECT pg_temp.t28_ersetze('public.s112_pruefnummernantrag_status_setzen(uuid, uuid, text, date, text, text)'::regprocedure,
         $r$IF NOT coalesce\(\(c_uebergaenge -> v_a.status\) \? p_status, false\) THEN$r$, $r$IF false THEN$r$)$m$);
  PERFORM pg_temp.s112_mutiere('status_direkt',
    $m$CREATE OR REPLACE FUNCTION public.s112_pn_workflow_schutz() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
       AS $x$ BEGIN RETURN NEW; END $x$$m$);
  PERFORM pg_temp.s112_mutiere('freeze_eingereicht_aus', $m$DROP TRIGGER a_freeze_eingereicht ON public.dac_antrag$m$);

  -- ── 1. Rechte ─────────────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_nicht_fuer_anon',
    has_function_privilege('anon', 'public.s112_pruefnummernantrag_status_setzen(uuid, uuid, text, date, text, text)', 'EXECUTE'), false);
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_fuer_authenticated',
    has_function_privilege('authenticated', 'public.s112_pruefnummernantrag_status_setzen(uuid, uuid, text, date, text, text)', 'EXECUTE'), true);
  v_erg := v_erg || pg_temp.s112_erwarte('schutz_nicht_ausfuehrbar',
    has_function_privilege('authenticated', 'public.s112_pn_workflow_schutz()', 'EXECUTE'), false);

  -- ── 2. Entwurf: Anlegen nur als Entwurf, Status nie direkt ────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('insert_entwurf',
    pg_temp.s112_versuch(format(c_ins, v_b, 'S112TEST', 'sonstiges', 'entwurf')), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('insert_nicht_entwurf',
    pg_temp.s112_versuch(format(c_ins, v_b, 'S112TEST', 'sonstiges', 'genehmigt')), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('status_direkt',
    pg_temp.s112_versuch(format('UPDATE public.dac_antrag SET status = %L WHERE id = %L', 'genehmigt', v_d)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('eingereicht_am_direkt',
    pg_temp.s112_versuch(format('UPDATE public.dac_antrag SET eingereicht_am = pg_temp.s112_heute() WHERE id = %L', v_d)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('entwurf_frei',
    pg_temp.s112_versuch(format('UPDATE public.dac_antrag SET menge_liter = 500, bezeichnung = %L WHERE id = %L', 'S112TEST GV', v_d)), 'k1');
  -- Antragsformular: einmal je Antrag
  v_erg := v_erg || pg_temp.s112_erwarte('pna_anlegen',
    pg_temp.s112_fehlertext(format('INSERT INTO public.pruefnummernantraege (tenant_id, dac_antrag_id, formular_daten) VALUES (%L, %L, %L)', v_b, v_d, '{"x": 1}')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('pna_doppelt',
    pg_temp.s112_versuch(format('INSERT INTO public.pruefnummernantraege (tenant_id, dac_antrag_id, formular_daten) VALUES (%L, %L, %L)', v_b, v_d, '{"x": 2}')), 'E23505');

  -- ── 3. Übergänge ──────────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('uebergang_entwurf_zugeteilt',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_d, 'genehmigt', v_heute, 'N 1/26', NULL)), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('uebergang_unbekannt',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_d, 'freigegeben', v_heute, NULL, NULL)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('datum_zukunft',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_d, 'eingereicht', v_heute + 1, NULL, NULL)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('einreichen',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_d, 'eingereicht', v_heute - 5, NULL, 'Probe gezogen')), 'ok');

  -- ── 4. Eingereicht: Freeze ────────────────────────────────────────────────────────────────────────────
  v_txt := pg_temp.s112_fehlertext(format('UPDATE public.dac_antrag SET menge_liter = 600 WHERE id = %L', v_d));
  v_erg := v_erg || pg_temp.s112_erwarte('eingereicht_menge',
    v_txt LIKE '42501: Gesperrt: Prüfnummernantrag eingereicht am % (nicht: menge_liter).%HINT: freeze', true);
  v_erg := v_erg || pg_temp.s112_erwarte('eingereicht_charge',
    pg_temp.s112_versuch(format('UPDATE public.dac_antrag SET weinausbau_id = NULL WHERE id = %L', v_d)), 'T');
  -- Löschen per API: keine Zeile (Policy keine_direktloeschung); ohne Wartungs-Kennzeichen sperrt der Freeze (Abschnitt 8)
  v_erg := v_erg || pg_temp.s112_erwarte('eingereicht_loeschen',
    pg_temp.s112_versuch(format('DELETE FROM public.dac_antrag WHERE id = %L', v_d)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('eingereicht_notizen',
    pg_temp.s112_versuch(format('UPDATE public.dac_antrag SET notizen = %L, antragsnummer = %L WHERE id = %L', 'S112TEST', 'A-1', v_d)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('pna_gesperrt',
    pg_temp.s112_versuch(format('UPDATE public.pruefnummernantraege SET formular_daten = %L WHERE dac_antrag_id = %L', '{"x": 3}', v_d)), 'T');
  -- (auch nach einem Storno des Formulars: neu anlegen nur zu einem Entwurf – der Trigger greift vor dem eindeutigen Index)
  v_erg := v_erg || pg_temp.s112_erwarte('pna_neu_nach_einreichen',
    pg_temp.s112_versuch(format('INSERT INTO public.pruefnummernantraege (tenant_id, dac_antrag_id, formular_daten) VALUES (%L, %L, %L)', v_b, v_d, '{}')), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('uebergang_zugeteilt_ohne_nummer',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_d, 'genehmigt', v_heute, NULL, NULL)), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('eingereicht_pn_aenderbar',
    pg_temp.s112_fehlertext(format('UPDATE public.dac_antrag SET pruefnummer = %L WHERE id = %L', 'N 4711/26', v_d)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('datum_vor_einreichung',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_d, 'genehmigt', v_heute - 6, NULL, NULL)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('zuteilen',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_d, 'genehmigt', v_heute - 1, NULL, 'Bescheid BAWB')), 'ok');

  -- ── 5. Zugeteilt und Endstatus ────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('zugeteilt_pn_gesperrt',
    pg_temp.s112_versuch(format('UPDATE public.dac_antrag SET pruefnummer = %L WHERE id = %L', 'N 1/26', v_d)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('zugeteilt_notizen',
    pg_temp.s112_versuch(format('UPDATE public.dac_antrag SET notizen = %L WHERE id = %L', 'S112TEST 2', v_d)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('uebergang_zugeteilt_abgelehnt',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_d, 'abgelehnt', v_heute, NULL, NULL)), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('entzug_ohne_grund',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_d, 'entzogen', v_heute, NULL, 'kurz')), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('entziehen',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_d, 'entzogen', v_heute, NULL, 'Bescheid über Entzug BAWB')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('uebergang_ende_zurueck',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_d, 'genehmigt', v_heute, NULL, NULL)), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('ende_notizen',
    pg_temp.s112_versuch(format('UPDATE public.dac_antrag SET notizen = %L WHERE id = %L', 'S112TEST 3', v_d)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('ende_aktiv',
    pg_temp.s112_versuch(format('UPDATE public.dac_antrag SET aktiv = false WHERE id = %L', v_d)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('ende_storno',
    pg_temp.s112_versuch(format('UPDATE public.dac_antrag SET storniert_am = now(), storno_grund = %L WHERE id = %L', 'S112TEST Storno-Grund', v_d)), 'k1');

  -- ── 6. Ereignisse und Protokoll ───────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  SELECT count(*) INTO v_n FROM public.pruefnummer_ereignisse e
   WHERE e.dac_antrag_id = v_d AND e.tenant_id = v_b AND e.benutzer_id = v_bw;
  v_erg := v_erg || pg_temp.s112_erwarte('ereignisse', v_n, 3::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('ereignis_zuteilung',
    (SELECT e.status_alt || '>' || e.status_neu || '|' || e.pruefnummer || '|' || e.grund || '|' || (e.datum = v_heute - 1)
       FROM public.pruefnummer_ereignisse e WHERE e.dac_antrag_id = v_d AND e.status_neu = 'genehmigt' ORDER BY e.erstellt_am DESC LIMIT 1),
    'eingereicht>genehmigt|N 4711/26|Bescheid BAWB|true');
  SELECT count(*) INTO v_n FROM public.bestandsprotokoll p
   WHERE p.tabelle = 'dac_antrag' AND p.datensatz_id = v_d AND p.aktion = 'UPDATE' AND p.benutzer_id = v_bw
     AND p.grund = 'Statuswechsel Eingereicht → Zugeteilt: Bescheid BAWB' AND 'status' = ANY (p.geaenderte_spalten);
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_grund', v_n, 1::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('snapshot_charge',
    (SELECT (d.charge_snapshot -> 'charge' ->> 'id')::uuid FROM public.dac_antrag d WHERE d.id = v_d), v_wa);
  v_erg := v_erg || pg_temp.s112_erwarte('entzug_spalten',
    (SELECT d.entzug_am = v_heute AND d.entzug_grund = 'Bescheid über Entzug BAWB' FROM public.dac_antrag d WHERE d.id = v_d), true);
  v_erg := v_erg || pg_temp.s112_erwarte('kennzeichen_leer',
    coalesce(current_setting('s112.freeze_frei', true), '') || coalesce(current_setting('s112.aenderung_grund', true), ''), '');

  -- ── 7. Zugriff ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bcrm);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_kellerbuch',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_d2, 'eingereicht', v_heute, NULL, NULL)), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_d2, 'eingereicht', v_heute, NULL, NULL)), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_m, v_dm, 'eingereicht', v_heute, NULL, NULL)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('idor_fremder_antrag',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_dm, 'eingereicht', v_heute, NULL, NULL)), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('ereignis_direkt',
    pg_temp.s112_versuch(format('INSERT INTO public.pruefnummer_ereignisse (tenant_id, dac_antrag_id, ereignis, datum) VALUES (%L, %L, %L, pg_temp.s112_heute())', v_b, v_d2, 'status')), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('ereignisse_lesen_eigene',
    pg_temp.s112_versuch(format('SELECT 1 FROM public.pruefnummer_ereignisse WHERE dac_antrag_id = %L', v_d)), 'k3');

  -- ── 8. Wartung: eingereichten Antrag löschen nur mit Kennzeichen des Betriebs ──────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('einreichen_2',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_d2, 'eingereicht', v_heute, NULL, NULL)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('wartung_ohne_kennzeichen',
    pg_temp.s112_versuch(format('DELETE FROM public.dac_antrag WHERE id = %L', v_d2)), 'T');
  PERFORM set_config('s112.loeschen_erlaubt', v_m::text, true);
  v_erg := v_erg || pg_temp.s112_erwarte('wartung_anderer_betrieb',
    pg_temp.s112_versuch(format('DELETE FROM public.dac_antrag WHERE id = %L', v_d2)), 'T');
  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);
  v_erg := v_erg || pg_temp.s112_erwarte('wartung_loeschen',
    pg_temp.s112_versuch(format('DELETE FROM public.dac_antrag WHERE id = %L', v_d2)), 'k1');
  PERFORM set_config('s112.loeschen_erlaubt', '', true);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 40);
END $test$;
