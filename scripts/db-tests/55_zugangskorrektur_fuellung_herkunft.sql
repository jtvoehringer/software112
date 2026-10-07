-- @bereich: Zugangskorrektur einer Charge (KAN-53) und Chargenpflicht der Füllung (KAN-198)
-- @ziel: KAN-53 – Die Betriebsleitung bucht eine Mehrmenge bzw. ein Inventur-Plus als datierte Korrektur: die Charge wird
-- @ziel: erhöht, das Journal bucht INV_PLUS am Datum, die Korrektur ist eine Folgebuchung und beendet eine geltende
-- @ziel: Prüfnummer für den Tankbestand (ende_grund korrektur). Abgelehnt: Winzer, Leser, Datum in der Zukunft bzw. vor
-- @ziel: der letzten Bewegung, Grund unter 10 Zeichen, fremder Betrieb, direktes Schreiben per API. Storno (Grund ≥ 10)
-- @ziel: nimmt Menge, Journal und Ende der Prüfnummer zurück.
-- @ziel: KAN-198 – Eine Füllung ohne Charge, Import-Kennzeichen und Flaschenzukauf lehnt die Datenbank für App/API ab
-- @ziel: (23514, HINT fuellung_charge); mit Kennzeichen „eroeffnungsbestand“ bzw. Charge geht es.
-- @mutation journal_leer: Zeilenfunktion bucht nichts | rot: journal_inv_plus
-- @mutation storno_ohne_rueckbuchung: Storno bucht die Menge nicht zurück | rot: storno_bestand
-- @mutation pn_ohne_korrektur: Zugangskorrektur beendet die Prüfnummer nicht | rot: pn_erloschen
-- @mutation herkunft_frei: Füllung ohne Charge wird angenommen | rot: fuellung_ohne_charge
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 55 (Stand 07.10.2026, KAN-53/KAN-198). Alles zurückgerollt.

CREATE FUNCTION pg_temp.t55_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't55_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

DO $test$
DECLARE
  c_datei constant text := '55_zugangskorrektur_fuellung_herkunft';
  c_rpc   constant text := 'SELECT public.s112_zugangskorrektur_buchen(%L::uuid, %L::uuid, %L::date, %s, %L, %L)';
  c_fue   constant text := 'INSERT INTO public.fuellungen (tenant_id, name, datum, anzahl_flaschen, bestand_flaschen, flaschengroesse_ml, weinausbau_id, import_quelle) VALUES (%L, %L, pg_temp.s112_heute(), 10, 10, 750, %L, %L)';
  v_t0    timestamptz;
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;   -- wie die RPC (Wiener Zeit, nicht UTC)
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bta   uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_wa    uuid;
  v_wm    uuid;
  v_dac   uuid;
  v_z     uuid;
  v_zm    uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres): Journal ab vor 30 Tagen, Charge 500 L (Zugang vor 5 Tagen), PN zugeteilt ─────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  UPDATE public.tenant_einstellungen SET journal_ab = v_heute - 30 WHERE tenant_id = v_b;
  v_wa := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "500", "status": "ausbau", "aktiv": true, "storniert_am": null}') ->> 'id')::uuid;
  v_wm := (pg_temp.s112_beispiel('weinausbau', v_m, NULL, '{"menge_liter": "100", "status": "ausbau"}') ->> 'id')::uuid;
  PERFORM pg_temp.s112_beispiel('kellerbuch_buchungen', v_b, NULL, jsonb_build_object('weinausbau_id', v_wa, 'menge_liter', 500,
    'datum', v_heute - 5, 'charge_status', 'ausbau'));
  v_dac := (pg_temp.s112_beispiel('dac_antrag', v_b, NULL, jsonb_build_object('weinausbau_id', v_wa, 'status', 'genehmigt',
    'pruefnummer', 'S112TEST 55/26', 'eingereicht_am', v_heute - 20, 'bescheid_am', v_heute - 15, 'storniert_am', NULL)) ->> 'id')::uuid;
  -- Korrektur im fremden Betrieb (IDOR-Prüfung des Stornos)
  v_zm := (pg_temp.s112_beispiel('keller_zugangskorrekturen', v_m, NULL, jsonb_build_object('weinausbau_id', v_wm, 'datum', v_heute - 1,
    'menge_liter', 5, 'art', 'inventur', 'grund', 'S112TEST fremde Korrektur', 'storniert_am', NULL)) ->> 'id')::uuid;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('journal_leer',
    $m$SELECT pg_temp.t55_ersetze('public.s112_journal_zeilen_zugangskorrektur(jsonb)'::regprocedure,
      $r$SELECT CASE WHEN z ->> 'weinausbau_id' IS NOT NULL$r$, $r$SELECT CASE WHEN false$r$)$m$);
  PERFORM pg_temp.s112_mutiere('storno_ohne_rueckbuchung',
    $m$SELECT pg_temp.t55_ersetze('public.s112_zugangskorrektur_stornieren(uuid, uuid, text)'::regprocedure,
      $r$SET menge_liter = greatest\(round\(coalesce\(menge_liter, 0\) - v_z\.menge_liter, 2\), 0\)$r$, $r$SET menge_liter = menge_liter$r$)$m$);
  PERFORM pg_temp.s112_mutiere('pn_ohne_korrektur',
    $m$SELECT pg_temp.t55_ersetze('public.s112_pn_chargen_pflegen()'::regprocedure,
      $r$v_ziel := NEW\.weinausbau_id;  v_grund := 'korrektur';$r$, $r$RETURN NULL;$r$)$m$);
  PERFORM pg_temp.s112_mutiere('herkunft_frei',
    $m$SELECT pg_temp.t55_ersetze('public.s112_fuellung_herkunft_pruefen()'::regprocedure,
      $r$IF NEW\.storniert_am IS NULL AND NEW\.weinausbau_id IS NULL$r$, $r$IF false AND NEW.weinausbau_id IS NULL$r$)$m$);

  -- ── 1. Ablehnungen ────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('winzer_nicht',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wa, v_heute - 3, 20, 'inventur', 'S112TEST Inventur-Plus')), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_nicht',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wa, v_heute - 3, 20, 'inventur', 'S112TEST Inventur-Plus')), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('datum_zukunft',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wa, v_heute + 1, 20, 'inventur', 'S112TEST Inventur-Plus')), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('vor_letzter_bewegung',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wa, v_heute - 10, 20, 'inventur', 'S112TEST Inventur-Plus')), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('grund_zu_kurz',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wa, v_heute - 3, 20, 'inventur', 'kurz')), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('fremde_charge',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wm, v_heute - 3, 20, 'inventur', 'S112TEST Inventur-Plus')), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_per_api',
    split_part(pg_temp.s112_fehlertext(format('INSERT INTO public.keller_zugangskorrekturen (tenant_id, weinausbau_id, datum, menge_liter, art, grund) VALUES (%L, %L, pg_temp.s112_heute(), 1, %L, %L)',
      v_b, v_wa, 'inventur', 'S112TEST direkt per API')), ':', 1), '42501');

  -- ── 2. 20 L Inventur-Plus vor 3 Tagen ─────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('buchung_ok',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_wa, v_heute - 3, 20, 'inventur', 'S112TEST Inventur-Plus')), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  SELECT z.id INTO v_z FROM public.keller_zugangskorrekturen z WHERE z.weinausbau_id = v_wa;
  v_erg := v_erg || pg_temp.s112_erwarte('charge_erhoeht',
    (SELECT w.menge_liter::numeric(10, 0)::text FROM public.weinausbau w WHERE w.id = v_wa), '520');
  v_erg := v_erg || pg_temp.s112_erwarte('journal_inv_plus',
    (SELECT string_agg(k.buchungsart_code || '=' || k.menge_liter::numeric(10, 0)::text || '@' || (v_heute - k.datum)::text, ',')
       FROM public.kellerbuch_buchungen k WHERE k.quelle_tabelle = 'keller_zugangskorrekturen' AND k.quelle_id = v_z),
    'INV_PLUS=20@3');
  v_erg := v_erg || pg_temp.s112_erwarte('folgebuchung', public.s112_charge_hat_folgebuchung(v_wa)::text, 'true');
  v_erg := v_erg || pg_temp.s112_erwarte('pn_erloschen',
    (SELECT concat_ws('|', pc.ende_grund, v_heute - pc.gueltig_bis) FROM public.pruefnummer_chargen pc WHERE pc.dac_antrag_id = v_dac), 'korrektur|3');

  -- ── 3. Storno ─────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('storno_fremd',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_zugangskorrektur_stornieren(%L, %L, %L)', v_b, v_zm, 'S112TEST fremde Buchung')), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_ok',
    pg_temp.s112_fehlertext(format('SELECT public.s112_zugangskorrektur_stornieren(%L, %L, %L)', v_b, v_z, 'S112TEST falsch gezählt')), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('storno_bestand',
    (SELECT w.menge_liter::numeric(10, 0)::text FROM public.weinausbau w WHERE w.id = v_wa), '500');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_journal_saldo',
    (SELECT sum(k.menge_liter)::numeric(10, 0)::text FROM public.kellerbuch_buchungen k WHERE k.quelle_tabelle = 'keller_zugangskorrekturen' AND k.quelle_id = v_z), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_pn_wieder_offen',
    (SELECT (pc.gueltig_bis IS NULL)::text FROM public.pruefnummer_chargen pc WHERE pc.dac_antrag_id = v_dac), 'true');

  -- ── 4. KAN-198: Chargenpflicht der Füllung ────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('fuellung_ohne_charge',
    pg_temp.s112_fehlertext(format(c_fue, v_b, 'S112TEST ohne Charge', NULL, NULL)) LIKE '23514:%HINT: fuellung_charge%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('fuellung_eroeffnung_ok',
    pg_temp.s112_fehlertext(format(c_fue, v_b, 'S112TEST Eröffnung', NULL, 'eroeffnungsbestand')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('fuellung_mit_charge_ok',
    pg_temp.s112_fehlertext(format(c_fue, v_b, 'S112TEST mit Charge', v_wa, NULL)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('wartung_frei',
    pg_temp.s112_fehlertext(format(c_fue, v_b, 'S112TEST Wartung', NULL, NULL)), 'ok');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 20);
END $test$;
