-- @bereich: Füllung – Freeze der Merkmale und einmaliger Nachtrag von Charge und Prüfnummer (KAN-101)
-- @ziel: Nach dem Speichern sind nur Produktname, Preise, MwSt, KN-Code, Notizen, aktiv und Storno änderbar – Merkmale,
-- @ziel: Datum, Menge, Los, Charge, DAC-Antrag und Prüfnummer per API enden mit 42501 (HINT freeze). Bestandsbuchungen
-- @ziel: (fuellung_bestand_buchen, s112_fuellung_verkauf_buchen) und Storno funktionieren weiter. s112_fuellung_nachtragen
-- @ziel: trägt Charge und DAC-Antrag/Prüfnummer je einmal nach (nur Antrag derselben Charge, Prüfnummer nur zugeteilt),
-- @ziel: ein zweiter Versuch endet mit 42501; der Nachtrag steht mit Grund im Bestandsprotokoll.
-- @mutation freeze_aus: kein Freeze-Trigger auf fuellungen | rot: gesperrt_.*
-- @mutation nachtrag_offen: Nachtrag prüft vorhandene Prüfnummer nicht | rot: nachtrag_zweimal
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 29 (Stand 04.10.2026, KAN-101). Alles zurückgerollt.

CREATE FUNCTION pg_temp.t29_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't29_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

DO $test$
DECLARE
  c_datei  constant text := '29_fuellung_freeze';
  c_nach   constant text := 'SELECT public.s112_fuellung_nachtragen(%L::uuid, %L::uuid, %L::uuid, %L::uuid)';
  c_upd    constant text := 'UPDATE public.fuellungen SET %s WHERE id = %L';
  v_t0     timestamptz;
  v_erg    text[] := '{}';
  v_a      jsonb;
  v_m      uuid;
  v_b      uuid;
  v_bw     uuid;
  v_bl     uuid;
  v_f      uuid;
  v_fm     uuid;
  v_wa     uuid;
  v_wa2    uuid;
  v_wam    uuid;
  v_d      uuid;
  v_d2     uuid;
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
  v_wa := (pg_temp.s112_beispiel('weinausbau', v_b) ->> 'id')::uuid;
  v_wa2 := (pg_temp.s112_beispiel('weinausbau', v_b) ->> 'id')::uuid;
  v_wam := (pg_temp.s112_beispiel('weinausbau', v_m) ->> 'id')::uuid;
  -- Füllung ohne Charge, mit 100 Flaschen Bestand (Altbestand/Import)
  v_f := (pg_temp.s112_beispiel('fuellungen', v_b, v_bw, '{"bestand_flaschen": "100", "anzahl_flaschen": "100"}') ->> 'id')::uuid;
  v_fm := (pg_temp.s112_beispiel('fuellungen', v_m) ->> 'id')::uuid;
  -- DAC-Anträge der Charge: einer zugeteilt (über die RPC, damit Status/Datum stimmen), einer einer anderen Charge
  v_d := (pg_temp.s112_beispiel('dac_antrag', v_b, NULL, jsonb_build_object('weinausbau_id', v_wa)) ->> 'id')::uuid;
  v_d2 := (pg_temp.s112_beispiel('dac_antrag', v_b, NULL, jsonb_build_object('weinausbau_id', v_wa2)) ->> 'id')::uuid;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('freeze_aus', $m$DROP TRIGGER a_freeze ON public.fuellungen$m$);
  PERFORM pg_temp.s112_mutiere('nachtrag_offen',
    $m$SELECT pg_temp.t29_ersetze('public.s112_fuellung_nachtragen(uuid, uuid, uuid, uuid)'::regprocedure,
         $r$IF v_f\.pruefnummer IS NOT NULL THEN$r$, $r$IF false THEN$r$)$m$);

  -- ── 1. Rechte ─────────────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('nachtragen_nicht_fuer_anon',
    has_function_privilege('anon', 'public.s112_fuellung_nachtragen(uuid, uuid, uuid, uuid)', 'EXECUTE'), false);
  v_erg := v_erg || pg_temp.s112_erwarte('nachtragen_fuer_authenticated',
    has_function_privilege('authenticated', 'public.s112_fuellung_nachtragen(uuid, uuid, uuid, uuid)', 'EXECUTE'), true);

  -- ── 2. Erlaubte Spalten ───────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  -- KAN-378: diese Felder ändert die App nur mit Grund (s112_fuellung_aendern setzt s112.aenderung_grund; Datei 82)
  PERFORM set_config('s112.aenderung_grund', 'S112TEST Grund der Änderung', true);
  v_erg := v_erg || pg_temp.s112_erwarte('erlaubt_preis_name',
    pg_temp.s112_versuch(format(c_upd, format('name = %L, vk_preis_brutto = 12.9, einstandspreis = 4.2, notizen = %L, zolltarifnummer = %L', 'S112TEST neu', 'S112TEST', '22042109'), v_f)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('erlaubt_aktiv',
    pg_temp.s112_versuch(format(c_upd, 'aktiv = false', v_f)), 'k1');
  PERFORM set_config('s112.aenderung_grund', '', true);

  -- ── 3. Gesperrte Spalten (Akzeptanz: jahrgang, rebsorte, qualitaet, datum, chargennummer) ──────────────
  v_txt := pg_temp.s112_fehlertext(format(c_upd, 'jahrgang = 1999', v_f));
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_jahrgang',
    v_txt LIKE '42501: Gesperrt: Füllung gespeichert am % (nicht: jahrgang).%HINT: freeze', true);
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_rebsorte',
    pg_temp.s112_versuch(format(c_upd, format('rebsorte = %L', 'S112TEST Sorte'), v_f)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_qualitaet',
    pg_temp.s112_versuch(format(c_upd, format('qualitaet = %L', 'landwein'), v_f)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_datum',
    pg_temp.s112_versuch(format(c_upd, 'datum = datum - 1', v_f)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_chargennummer',
    pg_temp.s112_versuch(format(c_upd, format('chargennummer = %L', 'S112TEST-LOS'), v_f)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_bestand_direkt',
    pg_temp.s112_versuch(format(c_upd, 'bestand_flaschen = 1', v_f)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_anzahl',
    pg_temp.s112_versuch(format(c_upd, 'anzahl_flaschen = 99', v_f)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_charge_direkt',
    pg_temp.s112_versuch(format(c_upd, format('weinausbau_id = %L', v_wa), v_f)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_pruefnummer_direkt',
    pg_temp.s112_versuch(format(c_upd, format('pruefnummer = %L', 'N 1/26'), v_f)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_gemischt',
    pg_temp.s112_versuch(format(c_upd, format('name = %L, jahrgang = 1999', 'S112TEST x'), v_f)), 'T');

  -- ── 4. Bestandsbuchungen und Verkauf laufen weiter ────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('bestand_buchen',
    pg_temp.s112_versuch(format('SELECT public.fuellung_bestand_buchen(%L, %L, %L, pg_temp.s112_heute(), -2, NULL, %L)', v_b, v_f, 'bruch', 'S112TEST Bruch')), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('verkauf_buchen',
    pg_temp.s112_versuch(format('SELECT public.s112_fuellung_verkauf_buchen(%L, %L, gen_random_uuid(), -3, pg_temp.s112_heute(), NULL)', v_b, v_f)), 'k1');

  -- ── 5. Nachtrag: Charge einmal, DAC-Antrag nur derselben Charge, Prüfnummer nur zugeteilt ─────────────
  v_erg := v_erg || pg_temp.s112_erwarte('nachtrag_fremde_charge',
    split_part(pg_temp.s112_fehlertext(format(c_nach, v_b, v_f, v_wam, NULL)), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('nachtrag_fremder_betrieb',
    split_part(pg_temp.s112_fehlertext(format(c_nach, v_m, v_fm, v_wam, NULL)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('nachtrag_fremde_fuellung',
    split_part(pg_temp.s112_fehlertext(format(c_nach, v_b, v_fm, v_wa, NULL)), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('nachtrag_antrag_ohne_charge',
    split_part(pg_temp.s112_fehlertext(format(c_nach, v_b, v_f, NULL, v_d)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('nachtrag_charge',
    pg_temp.s112_fehlertext(format(c_nach, v_b, v_f, v_wa, NULL)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('nachtrag_charge_zweimal',
    split_part(pg_temp.s112_fehlertext(format(c_nach, v_b, v_f, v_wa2, NULL)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('nachtrag_antrag_andere_charge',
    split_part(pg_temp.s112_fehlertext(format(c_nach, v_b, v_f, NULL, v_d2)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('nachtrag_antrag_entwurf',
    split_part(pg_temp.s112_fehlertext(format(c_nach, v_b, v_f, NULL, v_d)), ':', 1), '42501');
  -- Antrag einreichen: Verknüpfung ohne Nummer; danach zuteilen: Nummer einmal nachtragen
  v_erg := v_erg || pg_temp.s112_erwarte('antrag_einreichen',
    pg_temp.s112_fehlertext(format('SELECT public.s112_pruefnummernantrag_status_setzen(%L, %L, %L, pg_temp.s112_heute(), NULL, NULL)', v_b, v_d, 'eingereicht')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('nachtrag_antrag_eingereicht',
    pg_temp.s112_fehlertext(format(c_nach, v_b, v_f, NULL, v_d)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('nachtrag_pn_vor_bescheid',
    split_part(pg_temp.s112_fehlertext(format(c_nach, v_b, v_f, NULL, v_d)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('antrag_zuteilen',
    pg_temp.s112_fehlertext(format('SELECT public.s112_pruefnummernantrag_status_setzen(%L, %L, %L, pg_temp.s112_heute(), %L, NULL)', v_b, v_d, 'genehmigt', 'N 4711/26')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('nachtrag_pruefnummer',
    pg_temp.s112_fehlertext(format(c_nach, v_b, v_f, NULL, v_d)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('nachtrag_zweimal',
    split_part(pg_temp.s112_fehlertext(format(c_nach, v_b, v_f, NULL, v_d)), ':', 1), '42501');
  -- Leser darf nicht nachtragen
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('nachtrag_leser',
    split_part(pg_temp.s112_fehlertext(format(c_nach, v_b, v_f, NULL, v_d)), ':', 1), '42501');

  -- ── 6. Ergebnis und Protokoll ─────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('nachtrag_werte',
    (SELECT (f.weinausbau_id = v_wa) AND (f.dac_antrag_id = v_d) AND f.pruefnummer = 'N 4711/26' FROM public.fuellungen f WHERE f.id = v_f), true);
  SELECT count(*) INTO v_n FROM public.bestandsprotokoll p
   WHERE p.tabelle = 'fuellungen' AND p.datensatz_id = v_f AND p.aktion = 'UPDATE' AND p.benutzer_id = v_bw
     AND p.grund = 'Nachtrag Prüfnummer N 4711/26' AND p.geaenderte_spalten @> ARRAY['pruefnummer'];
  v_erg := v_erg || pg_temp.s112_erwarte('nachtrag_protokoll', v_n, 1::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('kennzeichen_leer',
    coalesce(current_setting('s112.freeze_frei', true), '') || coalesce(current_setting('s112.aenderung_grund', true), ''), '');

  -- ── 7. Storno und Wartung ─────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('storno_erlaubt',
    pg_temp.s112_versuch(format(c_upd, format('aktiv = false, storniert_am = now(), storno_grund = %L', 'S112TEST Storno-Grund'), v_f)), 'k1');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_postgres_ohne_kennzeichen',
    pg_temp.s112_versuch(format(c_upd, 'jahrgang = 1999', v_f)), 'T');
  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);
  v_erg := v_erg || pg_temp.s112_erwarte('wartung_mit_kennzeichen',
    pg_temp.s112_versuch(format(c_upd, 'jahrgang = 1999', v_f)), 'k1');
  PERFORM set_config('s112.loeschen_erlaubt', '', true);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 35);
END $test$;
