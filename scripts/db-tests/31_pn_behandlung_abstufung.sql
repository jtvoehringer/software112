-- @bereich: Prüfnummer – Kellerbehandlungen und Abstufung beenden die Gültigkeit (KAN-100)
-- @ziel: Eine Kellerbehandlung vom Typ „Veränderung“ (pn_wirkung) beendet die Gültigkeit der Prüfnummer für den
-- @ziel: Tankbestand der Charge, Pflege und nicht eingestufte Typen nicht; Storno bzw. Ändern auf einen Pflege-Typ
-- @ziel: nimmt das Ende zurück. Eine geänderte Bezeichnung der Charge (Qualität, Zusatz, Erzeugnis, Herkunft) beendet
-- @ziel: sie ebenfalls (Entscheidung Jörgen 04.10.2026: nach Abstufung erlischt die Nummer). Die Einstufung eines
-- @ziel: Typs ist gesperrt, sobald er in einer Charge mit Prüfnummer verwendet wurde.
-- @mutation keine_behandlung: Kellerbehandlung beendet die Gültigkeit nicht | rot: veraenderung_ende|aendern_.*
-- @mutation keine_abstufung: Abstufung beendet die Gültigkeit nicht | rot: abstufung_.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 31 (Stand 04.10.2026, KAN-100). Alles zurückgerollt.

CREATE FUNCTION pg_temp.t31_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't31_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

CREATE FUNCTION pg_temp.t31_zeile(p_antrag uuid, p_charge uuid) RETURNS text LANGUAGE sql AS $f$
  SELECT coalesce((SELECT CASE WHEN pc.gueltig_bis IS NULL THEN 'offen' ELSE 'ende:' || pc.ende_grund END
                     FROM public.pruefnummer_chargen pc WHERE pc.dac_antrag_id = p_antrag AND pc.weinausbau_id = p_charge), 'keine')
$f$;

DO $test$
DECLARE
  c_datei constant text := '31_pn_behandlung_abstufung';
  c_rpc   constant text := 'SELECT public.s112_pruefnummernantrag_status_setzen(%L::uuid, %L::uuid, %L, %L::date, %L, %L)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_wa    uuid;
  v_wb    uuid;
  v_d     uuid;
  v_d2    uuid;
  v_t_ver uuid;
  v_t_pfl uuid;
  v_t_neu uuid;
  v_kb    uuid;
  v_n     bigint;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ───────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_wa := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "1000", "qualitaetsstufe": "qualitaetswein"}') ->> 'id')::uuid;
  v_wb := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "500", "qualitaetsstufe": "qualitaetswein"}') ->> 'id')::uuid;
  v_d := (pg_temp.s112_beispiel('dac_antrag', v_b, NULL, jsonb_build_object('weinausbau_id', v_wa, 'menge_liter', 1000)) ->> 'id')::uuid;
  v_d2 := (pg_temp.s112_beispiel('dac_antrag', v_b, NULL, jsonb_build_object('weinausbau_id', v_wb, 'menge_liter', 500)) ->> 'id')::uuid;
  v_t_ver := (pg_temp.s112_beispiel('keller_behandlungstypen', v_b, NULL, '{"name": "S112TEST Säurekorrektur", "pn_wirkung": "veraenderung"}') ->> 'id')::uuid;
  v_t_pfl := (pg_temp.s112_beispiel('keller_behandlungstypen', v_b, NULL, '{"name": "S112TEST Schwefelung", "pn_wirkung": "pflege"}') ->> 'id')::uuid;
  v_t_neu := (pg_temp.s112_beispiel('keller_behandlungstypen', v_b, NULL, '{"name": "S112TEST Neuer Typ"}') ->> 'id')::uuid;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('keine_behandlung',
    $m$SELECT pg_temp.t31_ersetze('public.s112_pn_chargen_pflegen()'::regprocedure, $r$t\.pn_wirkung = 'veraenderung'$r$, $r$false$r$)$m$);
  PERFORM pg_temp.s112_mutiere('keine_abstufung',
    $m$SELECT pg_temp.t31_ersetze('public.s112_pn_chargen_pflegen()'::regprocedure, $r$WHERE pc\.weinausbau_id = NEW\.id AND pc\.gueltig_bis IS NULL$r$, $r$WHERE false$r$)$m$);

  -- ── 1. Einstufung: neuer Typ startet als „unklar“ ─────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('neuer_typ_unklar',
    (SELECT t.pn_wirkung FROM public.keller_behandlungstypen t WHERE t.id = v_t_neu), 'unklar');
  v_erg := v_erg || pg_temp.s112_erwarte('wirkung_check',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.keller_behandlungstypen SET pn_wirkung = %L WHERE id = %L', 'egal', v_t_neu)), ':', 1), '23514');

  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('einreichen',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_d, 'eingereicht', current_date - 20, NULL, NULL)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('einreichen_2',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_d2, 'eingereicht', current_date - 20, NULL, NULL)), 'ok');
  -- Mitarbeiter mit Kellerbuch darf einen Typ einstufen
  v_erg := v_erg || pg_temp.s112_erwarte('einstufen_api',
    pg_temp.s112_versuch(format('UPDATE public.keller_behandlungstypen SET pn_wirkung = %L WHERE id = %L', 'unklar', v_t_neu)), 'k1');
  PERFORM pg_temp.s112_als_postgres();

  -- ── 2. Pflege und nicht eingestuft: Gültigkeit bleibt ─────────────────────────────────────────────────
  PERFORM pg_temp.s112_beispiel('keller_behandlungen', v_b, NULL, jsonb_build_object('weinausbau_id', v_wa, 'typ_id', v_t_pfl, 'datum', current_date - 10));
  PERFORM pg_temp.s112_beispiel('keller_behandlungen', v_b, NULL, jsonb_build_object('weinausbau_id', v_wa, 'typ_id', v_t_neu, 'datum', current_date - 9));
  v_erg := v_erg || pg_temp.s112_erwarte('pflege_bleibt', pg_temp.t31_zeile(v_d, v_wa), 'offen');

  -- ── 3. Veränderung: Ende mit Datum; Ändern auf Pflege nimmt es zurück, zurück auf Veränderung beendet erneut ─
  v_kb := (pg_temp.s112_beispiel('keller_behandlungen', v_b, NULL, jsonb_build_object('weinausbau_id', v_wa, 'typ_id', v_t_ver, 'datum', current_date - 8)) ->> 'id')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('veraenderung_ende', pg_temp.t31_zeile(v_d, v_wa), 'ende:behandlung');
  v_erg := v_erg || pg_temp.s112_erwarte('veraenderung_datum',
    (SELECT pc.gueltig_bis = current_date - 8 FROM public.pruefnummer_chargen pc WHERE pc.dac_antrag_id = v_d), true);
  v_erg := v_erg || pg_temp.s112_erwarte('veraenderung_andere_charge', pg_temp.t31_zeile(v_d2, v_wb), 'offen');
  -- KAN-206: die Behandlung ist gesperrt (Charge mit Prüfnummer) – Typ ändern nur als Korrektur (s112_freeze_korrektur
  -- setzt s112.freeze_frei); geprüft wird hier die Reaktion der Prüfnummer auf die Änderung
  PERFORM set_config('s112.freeze_frei', 'keller_behandlungen', true);
  UPDATE public.keller_behandlungen SET typ_id = v_t_pfl WHERE id = v_kb;
  v_erg := v_erg || pg_temp.s112_erwarte('aendern_auf_pflege_oeffnet', pg_temp.t31_zeile(v_d, v_wa), 'offen');
  UPDATE public.keller_behandlungen SET typ_id = v_t_ver WHERE id = v_kb;
  v_erg := v_erg || pg_temp.s112_erwarte('aendern_auf_veraenderung_beendet', pg_temp.t31_zeile(v_d, v_wa), 'ende:behandlung');
  PERFORM set_config('s112.freeze_frei', '', true);
  UPDATE public.keller_behandlungen SET storniert_am = now(), storno_grund = 'S112TEST Storno-Grund' WHERE id = v_kb;
  v_erg := v_erg || pg_temp.s112_erwarte('storno_oeffnet', pg_temp.t31_zeile(v_d, v_wa), 'offen');
  SELECT count(*) INTO v_n FROM public.pruefnummer_ereignisse e WHERE e.dac_antrag_id = v_d AND e.ereignis = 'charge_ende';
  v_erg := v_erg || pg_temp.s112_erwarte('ende_ereignisse', v_n, 2::bigint);

  -- ── 4. Abstufung: Ende; unveränderte Werte lösen nichts aus ───────────────────────────────────────────
  -- KAN-204: die Anträge sind eingereicht – die Charge ist gesperrt; geändert wird hier über den Korrekturweg
  -- (s112.freeze_frei wie s112_freeze_korrektur), geprüft wird die Reaktion der Prüfnummer
  PERFORM set_config('s112.freeze_frei', 'weinausbau', true);
  UPDATE public.weinausbau SET qualitaetsstufe = 'qualitaetswein' WHERE id = v_wb;
  v_erg := v_erg || pg_temp.s112_erwarte('abstufung_gleich_bleibt', pg_temp.t31_zeile(v_d2, v_wb), 'offen');
  UPDATE public.weinausbau SET qualitaetsstufe = 'wein' WHERE id = v_wb;
  v_erg := v_erg || pg_temp.s112_erwarte('abstufung_ende', pg_temp.t31_zeile(v_d2, v_wb), 'ende:abstufung');
  v_erg := v_erg || pg_temp.s112_erwarte('abstufung_vorgang',
    (SELECT pc.ende_vorgang FROM public.pruefnummer_chargen pc WHERE pc.dac_antrag_id = v_d2), 'weinausbau:' || v_wb);
  UPDATE public.weinausbau SET zusatzbezeichnung = 'reserve' WHERE id = v_wa;
  v_erg := v_erg || pg_temp.s112_erwarte('abstufung_zusatz', pg_temp.t31_zeile(v_d, v_wa), 'ende:abstufung');
  PERFORM set_config('s112.freeze_frei', '', true);

  -- ── 4b. Einstufung ändern: gesperrt, sobald der Typ in einer Charge mit Prüfnummer verwendet wurde ─────
  v_erg := v_erg || pg_temp.s112_erwarte('einstufung_gesperrt',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.keller_behandlungstypen SET pn_wirkung = %L WHERE id = %L', 'veraenderung', v_t_pfl)), ':', 1), '42501');
  v_t_neu := (pg_temp.s112_beispiel('keller_behandlungstypen', v_b, NULL, '{"name": "S112TEST Unbenutzt"}') ->> 'id')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('einstufung_frei',
    pg_temp.s112_fehlertext(format('UPDATE public.keller_behandlungstypen SET pn_wirkung = %L WHERE id = %L', 'veraenderung', v_t_neu)), 'ok');

  -- ── 5. Nachträglich angelegter Antrag: vorhandene Veränderung nach dem Beginn beendet sofort ──────────
  v_wb := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "300"}') ->> 'id')::uuid;
  PERFORM pg_temp.s112_beispiel('keller_behandlungen', v_b, NULL, jsonb_build_object('weinausbau_id', v_wb, 'typ_id', v_t_ver, 'datum', current_date - 1));
  v_d2 := (pg_temp.s112_beispiel('dac_antrag', v_b, NULL, jsonb_build_object('weinausbau_id', v_wb, 'status', 'genehmigt',
    'eingereicht_am', current_date - 30, 'bescheid_am', current_date - 20, 'pruefnummer', 'N 2/26')) ->> 'id')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('nachtrag_behandlung_ende', pg_temp.t31_zeile(v_d2, v_wb), 'ende:behandlung');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 20);
END $test$;
