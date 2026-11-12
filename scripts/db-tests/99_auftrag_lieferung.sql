-- @bereich: Warenwirtschaft – Lieferung aus dem Auftrag (KAN-418 Teil 2)
-- @ziel: Eine Lieferung vermerkt die gelieferten Flaschen am Auftrag, bevor der Verkauf den Bestand bucht: die
-- @ziel: Reservierung sinkt um genau diese Menge, mehr als offen geht nicht. Der Storno des Verkaufs stellt Auftrag
-- @ziel: und Reservierung wieder her; „Abschließen“ gibt den Rest frei. Leser, Mitarbeiter ohne Warenwirtschaft und
-- @ziel: fremde Betriebe kommen nicht durch; Lieferungen entstehen nur über die RPC.
-- @mutation ohne_obergrenze: s112_auftrag_liefern prüft die offene Menge nicht | rot: (mehr_als_offen|nach_rest_nichts_offen)
-- @mutation ohne_storno_trigger: Trigger z_auftrag_lieferung_storno entfernt | rot: (storno_oeffnet_auftrag|storno_reserviert_wieder)
-- @mutation ohne_modul: s112_pruefe_schreibmodul prüft nichts mehr | rot: ohne_warenwirtschaft
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 99 (Stand 12.11.2026, KAN-418). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '99_auftrag_lieferung';
  c_lief  constant text := 'SELECT public.s112_auftrag_liefern(%L::uuid, %L::uuid, %L::uuid, %L::jsonb)';
  c_verk  constant text := 'SELECT public.s112_fuellung_verkauf_buchen(%L::uuid, %L::uuid, %L::uuid, %s, pg_temp.s112_heute(), %L)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_bx    uuid;
  v_k     uuid;
  v_f     uuid;   -- Füllung in B mit 100 Flaschen
  v_f2    uuid;   -- zweite Füllung in B
  v_auf   uuid;
  v_pos   uuid;
  v_auf_m uuid;   -- Auftrag im fremden Betrieb
  v_pos_m uuid;
  v_vp1   uuid := gen_random_uuid();
  v_vp2   uuid := gen_random_uuid();
  v_vp3   uuid := gen_random_uuid();
  v_def   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_bx := pg_temp.s112_benutzer('winzer', v_b, ARRAY['crm']);   -- Mitarbeiter ohne Warenwirtschaft
  v_k := (pg_temp.s112_zeile('kontakte', v_b, jsonb_build_object('nachname', 'S112TEST Kunde')) ->> 'id')::uuid;
  v_f := (pg_temp.s112_zeile('fuellungen', v_b, jsonb_build_object('name', 'S112TEST GV', 'anzahl_flaschen', 100, 'bestand_flaschen', 100, 'aktiv', true)) ->> 'id')::uuid;
  v_f2 := (pg_temp.s112_zeile('fuellungen', v_b, jsonb_build_object('name', 'S112TEST ZW', 'anzahl_flaschen', 100, 'bestand_flaschen', 100, 'aktiv', true)) ->> 'id')::uuid;
  v_auf_m := (pg_temp.s112_beispiel('auftraege', v_m, (v_a ->> 'm_ta')::uuid) ->> 'id')::uuid;
  v_pos_m := (pg_temp.s112_beispiel('auftrag_positionen', v_m, (v_a ->> 'm_ta')::uuid, jsonb_build_object('auftrag_id', v_auf_m, 'menge', 5)) ->> 'id')::uuid;

  SELECT pg_get_functiondef('public.s112_auftrag_liefern(uuid, uuid, uuid, jsonb)'::regprocedure) INTO v_def;
  PERFORM pg_temp.s112_mutiere('ohne_obergrenze', replace(v_def, 'IF v_z.menge > v_p.menge - v_p.geliefert THEN', 'IF false THEN'));
  PERFORM pg_temp.s112_mutiere('ohne_storno_trigger',
    $m$DROP TRIGGER z_auftrag_lieferung_storno ON public.verkaufsposten$m$);
  PERFORM pg_temp.s112_mutiere('ohne_modul',
    $m$CREATE OR REPLACE FUNCTION public.s112_pruefe_schreibmodul(p_tenant_id uuid, VARIADIC p_module text[]) RETURNS void
       LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$ BEGIN RETURN; END $f$$m$);

  -- Auftrag über 12 Flaschen als Mitarbeiter mit Warenwirtschaft
  PERFORM pg_temp.s112_als(v_bw);
  v_auf := (public.s112_auftrag_anlegen(v_b, jsonb_build_object('kontakt_id', v_k), jsonb_build_array(jsonb_build_object('fuellung_id', v_f, 'menge', 12))) ->> 'id')::uuid;
  PERFORM pg_temp.s112_als_postgres();
  SELECT id INTO v_pos FROM public.auftrag_positionen WHERE auftrag_id = v_auf;

  -- ── 1. Wer nicht darf ───────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser',
    split_part(pg_temp.s112_fehlertext(format(c_lief, v_b, v_auf, v_vp1, jsonb_build_array(jsonb_build_object('position_id', v_pos, 'menge', 1)))), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bx);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_warenwirtschaft',
    split_part(pg_temp.s112_fehlertext(format(c_lief, v_b, v_auf, v_vp1, jsonb_build_array(jsonb_build_object('position_id', v_pos, 'menge', 1)))), ':', 1), '42501');
  PERFORM pg_temp.s112_als((v_a ->> 'm_ta')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb',
    split_part(pg_temp.s112_fehlertext(format(c_lief, v_b, v_auf, v_vp1, jsonb_build_array(jsonb_build_object('position_id', v_pos, 'menge', 1)))), ':', 1), '42501');
  -- eigener Betrieb, aber Auftrag bzw. Position des fremden Betriebs
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_auftrag',
    split_part(pg_temp.s112_fehlertext(format(c_lief, v_b, v_auf_m, v_vp1, jsonb_build_array(jsonb_build_object('position_id', v_pos_m, 'menge', 1)))), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('fremde_position',
    split_part(pg_temp.s112_fehlertext(format(c_lief, v_b, v_auf, v_vp1, jsonb_build_array(jsonb_build_object('position_id', v_pos_m, 'menge', 1)))), ':', 1), '23503');

  -- ── 2. Teillieferung ────────────────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('falsche_fuellung',
    split_part(pg_temp.s112_fehlertext(format(c_lief, v_b, v_auf, v_vp1, jsonb_build_array(jsonb_build_object('position_id', v_pos, 'fuellung_id', v_f2, 'menge', 1)))), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('menge_null',
    split_part(pg_temp.s112_fehlertext(format(c_lief, v_b, v_auf, v_vp1, jsonb_build_array(jsonb_build_object('position_id', v_pos, 'menge', 0)))), ':', 1), '23514');
  -- vor der Lieferung sperrt die Reservierung den Verkauf der letzten 12 Flaschen
  v_erg := v_erg || pg_temp.s112_erwarte('vorher_gesperrt',
    pg_temp.s112_fehlertext(format(c_verk, v_b, v_f, v_vp1, -89, 'S112TEST Verkauf')) LIKE '22023:%reserviert%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('teillieferung',
    pg_temp.s112_fehlertext(format(c_lief, v_b, v_auf, v_vp1, jsonb_build_array(jsonb_build_object('position_id', v_pos, 'fuellung_id', v_f, 'menge', 5)))), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('doppelt_abgelehnt',
    split_part(pg_temp.s112_fehlertext(format(c_lief, v_b, v_auf, v_vp1, jsonb_build_array(jsonb_build_object('position_id', v_pos, 'menge', 1)))), ':', 1), '23505');
  -- die eigene Lieferung darf ihre 5 Flaschen abbuchen: 100 − 93 = 7 = Rest-Reservierung
  v_erg := v_erg || pg_temp.s112_erwarte('lieferung_bucht_ab',
    pg_temp.s112_fehlertext(format(c_verk, v_b, v_f, v_vp1, -93, 'S112TEST Lieferung')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('rest_bleibt_gesperrt',
    pg_temp.s112_fehlertext(format(c_verk, v_b, v_f, v_vp3, -1, 'S112TEST Verkauf')) LIKE '22023:%reserviert%', true);
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('status_teilgeliefert',
    (SELECT status || '/' || public.s112_fuellung_reserviert(v_f) FROM public.auftraege WHERE id = v_auf), 'teilgeliefert/7');

  -- ── 3. Obergrenze, Storno des Auftrags, direkte Schreibwege ─────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('mehr_als_offen',
    pg_temp.s112_fehlertext(format(c_lief, v_b, v_auf, v_vp2, jsonb_build_array(jsonb_build_object('position_id', v_pos, 'menge', 8)))) LIKE '22023:%nur noch 7 Flaschen offen%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('storno_mit_lieferung',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_auftrag_stornieren(%L::uuid, %L::uuid, %L)', v_b, v_auf, 'S112TEST Kunde hat abgesagt')), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_lieferung',
    pg_temp.s112_versuch(format('INSERT INTO public.auftrag_lieferungen (tenant_id, auftrag_id, auftrag_position_id, verkaufsposten_id, menge) VALUES (%L, %L, %L, %L, 1)', v_b, v_auf, v_pos, v_vp3)), 'R');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_geliefert',
    pg_temp.s112_versuch(format('UPDATE public.auftrag_positionen SET geliefert = 0 WHERE id = %L', v_pos)), 'k0');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_loeschen',
    pg_temp.s112_versuch(format('DELETE FROM public.auftrag_lieferungen WHERE auftrag_id = %L', v_auf)), 'k0');
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_sieht',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.auftrag_lieferungen WHERE auftrag_id = %L', v_auf)), '1');
  PERFORM pg_temp.s112_als((v_a ->> 'm_ta')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('fremd_unsichtbar',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.auftrag_lieferungen WHERE auftrag_id = %L', v_auf)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('fremd_nimmt_nicht_zurueck',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_auftrag_lieferung_zuruecknehmen(%L::uuid, %L::uuid)', v_m, v_vp1)), ':', 1), 'P0002');

  -- ── 4. Rest liefern, Abbruchweg ─────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('rest_liefern',
    pg_temp.s112_fehlertext(format(c_lief, v_b, v_auf, v_vp2, jsonb_build_array(jsonb_build_object('position_id', v_pos, 'menge', 7)))), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('nach_rest_nichts_offen',
    split_part(pg_temp.s112_fehlertext(format(c_lief, v_b, v_auf, v_vp3, jsonb_build_array(jsonb_build_object('position_id', v_pos, 'menge', 1)))), ':', 1), '23514');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('status_geliefert',
    (SELECT status || '/' || public.s112_fuellung_reserviert(v_f) FROM public.auftraege WHERE id = v_auf), 'geliefert/0');
  -- der Verkauf zur zweiten Lieferung kam nicht zustande: zurücknehmen
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('abbruch_nimmt_zurueck',
    pg_temp.s112_zaehle(format('SELECT public.s112_auftrag_lieferung_zuruecknehmen(%L::uuid, %L::uuid)', v_b, v_vp2)), '1');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('nach_abbruch',
    (SELECT status || '/' || public.s112_fuellung_reserviert(v_f) FROM public.auftraege WHERE id = v_auf), 'teilgeliefert/7');

  -- ── 5. Storno des Verkaufs nimmt die Lieferung zurück ───────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_zeile('verkaufsposten', v_b, jsonb_build_object('id', v_vp1, 'kontakt_id', v_k, 'rechnung_spaeter', true));
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('mit_verkauf_nicht_zuruecknehmbar',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_auftrag_lieferung_zuruecknehmen(%L::uuid, %L::uuid)', v_b, v_vp1)), ':', 1), '23514');
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.verkaufsposten SET storniert = true, storniert_am = now(), storno_grund = 'S112TEST Storno der Lieferung' WHERE id = v_vp1;
  v_erg := v_erg || pg_temp.s112_erwarte('storno_oeffnet_auftrag',
    (SELECT a.status || '/' || p.geliefert FROM public.auftraege a JOIN public.auftrag_positionen p ON p.auftrag_id = a.id WHERE a.id = v_auf), 'offen/0');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_reserviert_wieder', public.s112_fuellung_reserviert(v_f), 12);
  v_erg := v_erg || pg_temp.s112_erwarte('lieferung_bleibt_sichtbar',
    (SELECT count(*) FILTER (WHERE zurueckgenommen_am IS NOT NULL) || '/' || count(*) FROM public.auftrag_lieferungen WHERE auftrag_id = v_auf), '2/2');

  -- ── 6. Abschließen ──────────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('abschliessen_ohne_lieferung',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_auftrag_abschliessen(%L::uuid, %L::uuid)', v_b, v_auf)), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('dritte_lieferung',
    pg_temp.s112_fehlertext(format(c_lief, v_b, v_auf, v_vp3, jsonb_build_array(jsonb_build_object('position_id', v_pos, 'menge', 2)))), 'ok');
  PERFORM pg_temp.s112_als(v_bx);
  v_erg := v_erg || pg_temp.s112_erwarte('abschliessen_ohne_modul',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_auftrag_abschliessen(%L::uuid, %L::uuid)', v_b, v_auf)), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('abschliessen_fremder_auftrag',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_auftrag_abschliessen(%L::uuid, %L::uuid)', v_b, v_auf_m)), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('abschliessen',
    pg_temp.s112_fehlertext(format('SELECT public.s112_auftrag_abschliessen(%L::uuid, %L::uuid)', v_b, v_auf)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('abgeschlossen_nicht_lieferbar',
    split_part(pg_temp.s112_fehlertext(format(c_lief, v_b, v_auf, gen_random_uuid(), jsonb_build_array(jsonb_build_object('position_id', v_pos, 'menge', 1)))), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('abgeschlossen_nicht_stornierbar',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_auftrag_stornieren(%L::uuid, %L::uuid, %L)', v_b, v_auf, 'S112TEST Kunde hat abgesagt')), ':', 1), '23514');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('abgeschlossen_gibt_frei',
    (SELECT status || '/' || public.s112_fuellung_reserviert(v_f) || '/' || (abgeschlossen_von = v_bw)::text FROM public.auftraege WHERE id = v_auf), 'abgeschlossen/0/true');
  v_erg := v_erg || pg_temp.s112_erwarte('rechte',
    has_function_privilege('anon', 'public.s112_auftrag_liefern(uuid, uuid, uuid, jsonb)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.s112_auftrag_lieferung_zurueck_intern(uuid, text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.s112_auftrag_status_setzen(uuid)', 'EXECUTE'), false);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 39);
END $test$;
