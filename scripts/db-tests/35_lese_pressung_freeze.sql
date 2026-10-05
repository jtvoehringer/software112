-- @bereich: Lese und Pressung – Sperre nach Verpressung bzw. Folgebuchung (KAN-205)
-- @ziel: Ein verpresster Lese-Eintrag (dieselbe Lese und Ried) behält Ort, Lesedatum und Qualität (42501, HINT freeze);
-- @ziel: Menge und Notizen bleiben änderbar, ein nicht verpresster Eintrag ist frei. Hängt an einer Charge der Pressung
-- @ziel: eine Folgebuchung (s112_charge_hat_folgebuchung), sind Kopf und Traubenzeilen fest (nur Notizen); nach dem Storno
-- @ziel: der Folgebuchung ist die Pressung wieder frei.
-- @mutation freeze_lese_aus: kein Freeze-Trigger auf ernte_parzellen | rot: gesperrt_lese_.*
-- @mutation freeze_pressung_aus: keine Freeze-Trigger auf pressungen und pressung_weingaerten | rot: gesperrt_pressung_.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 35 (Stand 05.10.2026, KAN-205). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '35_lese_pressung_freeze';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_p     jsonb;
  v_pw    jsonb;
  v_wa    uuid;
  v_wa2   uuid;
  v_beh   uuid;
  v_wg2   uuid;
  v_ep    uuid;
  v_ep2   uuid;
  v_kb    uuid;
  v_txt   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ───────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_p := pg_temp.s112_beispiel('pressungen', v_b, v_bw);
  v_pw := pg_temp.s112_beispiel('pressung_weingaerten', v_b, NULL, jsonb_build_object('pressung_id', v_p ->> 'id', 'trauben_kg', 100,
            'rebsorte', 'S112TEST Veltliner', 'ernte_datum', current_date - 3, 'kmw', 18));
  v_wa := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "70", "qualitaetsstufe": "qualitaetswein"}') ->> 'id')::uuid;
  v_wa2 := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "10"}') ->> 'id')::uuid;
  v_beh := (pg_temp.s112_beispiel('behaelter', v_b) ->> 'id')::uuid;
  INSERT INTO public.pressung_behaelter (pressung_id, behaelter_id, weinausbau_id, menge_liter)
  VALUES ((v_p ->> 'id')::uuid, v_beh, v_wa, 70);
  -- verpresste Lese (gleiche Lese und Ried wie die Traubenzeile) und eine nicht verpresste (andere Ried)
  INSERT INTO public.ernte_parzellen (jahrgang_id, lese_id, weingarten_id, ernte_datum, menge_kg, klosterneuburger, qualitaetsstufe)
  VALUES ((v_p ->> 'jahrgang_id')::uuid, (v_p ->> 'lese_id')::uuid, (v_pw ->> 'weingarten_id')::uuid, current_date - 3, 120, 18, 'qualitaetswein')
  RETURNING id INTO v_ep;
  v_wg2 := (pg_temp.s112_zeile('weingarten', v_b) ->> 'id')::uuid;
  INSERT INTO public.ernte_parzellen (jahrgang_id, lese_id, weingarten_id, ernte_datum, menge_kg, klosterneuburger, qualitaetsstufe)
  VALUES ((v_p ->> 'jahrgang_id')::uuid, (v_p ->> 'lese_id')::uuid, v_wg2, current_date - 3, 80, 17, 'qualitaetswein')
  RETURNING id INTO v_ep2;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('freeze_lese_aus', $m$DROP TRIGGER a_freeze ON public.ernte_parzellen$m$);
  PERFORM pg_temp.s112_mutiere('freeze_pressung_aus',
    $m$DROP TRIGGER a_freeze ON public.pressungen; DROP TRIGGER a_freeze ON public.pressung_weingaerten$m$);

  -- ── 1. Rechte der Hilfsfunktion ───────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('funktion_nicht_fuer_authenticated',
    has_function_privilege('authenticated', 'public.s112_charge_hat_folgebuchung(uuid)', 'EXECUTE'), false);
  v_erg := v_erg || pg_temp.s112_erwarte('funktion_ohne_folgebuchung', public.s112_charge_hat_folgebuchung(v_wa), false);

  -- ── 2. Lese verpresst: Ort, Datum, Qualität fest; Menge und Notizen frei ─────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_txt := pg_temp.s112_fehlertext(format('UPDATE public.ernte_parzellen SET weingarten_id = %L WHERE id = %L', v_wg2, v_ep));
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_lese_ort',
    v_txt LIKE '42501: Gesperrt: Lese verpresst bzw. als Trauben verkauft am % (nicht: weingarten_id).%HINT: freeze', true);
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_lese_datum',
    pg_temp.s112_versuch(format('UPDATE public.ernte_parzellen SET ernte_datum = ernte_datum - 1 WHERE id = %L', v_ep)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_lese_qualitaet',
    pg_temp.s112_versuch(format('UPDATE public.ernte_parzellen SET qualitaetsstufe = %L WHERE id = %L', 'landwein', v_ep)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('erlaubt_lese_menge',
    pg_temp.s112_versuch(format('UPDATE public.ernte_parzellen SET menge_kg = 150, notizen = %L WHERE id = %L', 'S112TEST', v_ep)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('frei_lese_unverpresst',
    pg_temp.s112_versuch(format('UPDATE public.ernte_parzellen SET ernte_datum = ernte_datum - 1 WHERE id = %L', v_ep2)), 'k1');

  -- ── 3. Pressung ohne Folgebuchung: frei ───────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('frei_pressung_ohne_folge',
    pg_temp.s112_versuch(format('UPDATE public.pressungen SET weinbezeichnung = %L WHERE id = %L', 'S112TEST frei', v_p ->> 'id')), 'k1');

  -- ── 4. Folgebuchung an der Charge: Kopf und Traubenzeilen fest ───────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  v_kb := (pg_temp.s112_beispiel('keller_behandlungen', v_b, NULL, jsonb_build_object('weinausbau_id', v_wa, 'datum', current_date - 1)) ->> 'id')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('funktion_mit_folgebuchung',
    public.s112_charge_hat_folgebuchung(v_wa)::text || '/' || public.s112_charge_hat_folgebuchung(v_wa2)::text, 'true/false');
  PERFORM pg_temp.s112_als(v_bw);
  v_txt := pg_temp.s112_fehlertext(format('UPDATE public.pressungen SET weinbezeichnung = %L WHERE id = %L', 'S112TEST neu', v_p ->> 'id'));
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_pressung_kopf',
    v_txt LIKE '42501: Gesperrt: Folgebuchung an einer Charge der Pressung am % (nicht: weinbezeichnung).%HINT: freeze', true);
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_pressung_traube',
    pg_temp.s112_versuch(format('UPDATE public.pressung_weingaerten SET trauben_kg = 90 WHERE id = %L', v_pw ->> 'id')), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('erlaubt_pressung_notizen',
    pg_temp.s112_versuch(format('UPDATE public.pressungen SET notizen = %L WHERE id = %L', 'S112TEST Notiz', v_p ->> 'id')), 'k1');

  -- ── 5. Folgebuchung storniert: wieder frei ────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.keller_behandlungen SET storniert_am = now(), storno_grund = 'S112TEST Storno-Grund' WHERE id = v_kb;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('frei_nach_storno',
    pg_temp.s112_versuch(format('UPDATE public.pressung_weingaerten SET trauben_kg = 95 WHERE id = %L', v_pw ->> 'id')), 'k1');

  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('kennzeichen_leer', coalesce(current_setting('s112.freeze_frei', true), ''), '');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 14);
END $test$;
