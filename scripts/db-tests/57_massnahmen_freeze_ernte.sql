-- @bereich: Maßnahmen im Weingarten – Sperre nach der Lese der Ried (KAN-169)
-- @ziel: Eine Maßnahme, deren Ried (direkt oder über ein Grundstück) nach dem Maßnahmendatum gelesen wurde, ist fest:
-- @ziel: kein Bearbeiten, kein Stornieren, kein Entfernen ihrer Grundstücke (42501, HINT freeze); Notizen bleiben frei.
-- @ziel: Maßnahmen nach der Lese und an anderen Rieden sind frei; nach dem Storno der Lese ist die Maßnahme wieder frei.
-- @ziel: Die Betriebsleitung korrigiert über s112_freeze_korrektur, der Winzer nicht.
-- @mutation freeze_massnahme_aus: kein Freeze-Trigger auf behandlungen | rot: gesperrt_massnahme_.*
-- @mutation freeze_grundstueck_aus: kein Freeze-Trigger a_freeze_ernte auf behandlung_grundstuecke | rot: gesperrt_grundstueck
-- @mutation ernte_ohne_datum: Lesedatum wird nicht verglichen (jede Lese sperrt) | rot: frei_nach_lese
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 57 (Stand 07.10.2026, KAN-169). Alles zurückgerollt.

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;   -- wie die RPCs (Wiener Zeit, nicht UTC)
  c_datei constant text := '57_massnahmen_freeze_ernte';
  c_korr  constant text := 'SELECT public.s112_freeze_korrektur(%L::uuid, %L, %L::uuid, %L::jsonb, %L)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_bta   uuid;
  v_p     jsonb;
  v_wg    uuid;
  v_wg2   uuid;
  v_gst   uuid;
  v_m1    uuid;
  v_m2    uuid;
  v_m3    uuid;
  v_m4    uuid;
  v_ep    uuid;
  v_txt   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ───────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_p := pg_temp.s112_beispiel('pressungen', v_b, v_bw);   -- liefert Jahrgang und Lese für die Lesezeile
  v_wg := (pg_temp.s112_zeile('weingarten', v_b) ->> 'id')::uuid;
  v_wg2 := (pg_temp.s112_zeile('weingarten', v_b) ->> 'id')::uuid;
  v_gst := (pg_temp.s112_zeile('grundstuecke', v_b, jsonb_build_object('weingarten_id', v_wg)) ->> 'id')::uuid;
  -- m1: Ried wg vor der Lese · m2: Ried wg nach der Lese · m3: Ried wg2, aber Grundstück der Ried wg · m4: nur Ried wg2
  v_m1 := (pg_temp.s112_beispiel('behandlungen', v_b, NULL, jsonb_build_object('weingarten_id', v_wg, 'datum', v_heute - 10, 'notizen', 'S112TEST')) ->> 'id')::uuid;
  v_m2 := (pg_temp.s112_beispiel('behandlungen', v_b, NULL, jsonb_build_object('weingarten_id', v_wg, 'datum', v_heute - 1, 'notizen', 'S112TEST')) ->> 'id')::uuid;
  v_m3 := (pg_temp.s112_beispiel('behandlungen', v_b, NULL, jsonb_build_object('weingarten_id', v_wg2, 'datum', v_heute - 10, 'notizen', 'S112TEST')) ->> 'id')::uuid;
  v_m4 := (pg_temp.s112_beispiel('behandlungen', v_b, NULL, jsonb_build_object('weingarten_id', v_wg2, 'datum', v_heute - 10, 'notizen', 'S112TEST')) ->> 'id')::uuid;
  INSERT INTO public.behandlung_grundstuecke (behandlung_id, grundstueck_id, flaeche_ha) VALUES (v_m3, v_gst, 0.5);
  INSERT INTO public.ernte_parzellen (jahrgang_id, lese_id, weingarten_id, ernte_datum, menge_kg, klosterneuburger, qualitaetsstufe)
  VALUES ((v_p ->> 'jahrgang_id')::uuid, (v_p ->> 'lese_id')::uuid, v_wg, v_heute - 3, 120, 18, 'qualitaetswein')
  RETURNING id INTO v_ep;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('freeze_massnahme_aus', $m$DROP TRIGGER a_freeze_ernte ON public.behandlungen$m$);
  PERFORM pg_temp.s112_mutiere('freeze_grundstueck_aus', $m$DROP TRIGGER a_freeze_ernte ON public.behandlung_grundstuecke$m$);
  PERFORM pg_temp.s112_mutiere('ernte_ohne_datum', $m$
    CREATE OR REPLACE FUNCTION public.s112_massnahme_geerntet(p_behandlung_id uuid, p_weingarten_id uuid, p_datum date)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
      SELECT EXISTS (SELECT 1 FROM public.ernte_parzellen ep WHERE ep.storniert_am IS NULL AND ep.weingarten_id = p_weingarten_id
                     UNION ALL SELECT 1 FROM public.ernte_parzellen ep JOIN public.grundstuecke g ON g.weingarten_id = ep.weingarten_id
                       JOIN public.behandlung_grundstuecke bg ON bg.grundstueck_id = g.id
                      WHERE ep.storniert_am IS NULL AND bg.behandlung_id = p_behandlung_id)
    $f$$m$);

  -- ── 1. Rechte der Hilfsfunktion ───────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('funktion_nicht_fuer_authenticated',
    has_function_privilege('authenticated', 'public.s112_massnahme_geerntet(uuid, uuid, date)', 'EXECUTE'), false);

  -- ── 2. Maßnahme vor der Lese: fest (Bearbeiten, Stornieren), Notizen frei ─────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_txt := pg_temp.s112_fehlertext(format('UPDATE public.behandlungen SET datum = datum - 1 WHERE id = %L', v_m1));
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_massnahme_datum',
    v_txt LIKE '42501: Gesperrt: Ried nach der Maßnahme geerntet – änderbar sind nur notizen, updated_at (nicht: datum).%HINT: freeze', true);
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_massnahme_storno',
    pg_temp.s112_versuch(format('UPDATE public.behandlungen SET storniert_am = now(), storno_grund = %L WHERE id = %L', 'S112TEST Storno-Grund', v_m1)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_massnahme_ueber_grundstueck',
    pg_temp.s112_versuch(format('UPDATE public.behandlungen SET aufwandmenge = 2 WHERE id = %L', v_m3)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_grundstueck',
    pg_temp.s112_versuch(format('DELETE FROM public.behandlung_grundstuecke WHERE behandlung_id = %L', v_m3)), 'T');   -- UPDATE gibt es per API ohnehin nicht (RLS)
  v_erg := v_erg || pg_temp.s112_erwarte('erlaubt_notizen',
    pg_temp.s112_versuch(format('UPDATE public.behandlungen SET notizen = %L WHERE id = %L', 'S112TEST neu', v_m1)), 'k1');

  -- ── 3. Maßnahme nach der Lese bzw. an einer ungelesenen Ried: frei ────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('frei_nach_lese',
    pg_temp.s112_versuch(format('UPDATE public.behandlungen SET aufwandmenge = 3 WHERE id = %L', v_m2)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('frei_andere_ried',
    pg_temp.s112_versuch(format('UPDATE public.behandlungen SET aufwandmenge = 3 WHERE id = %L', v_m4)), 'k1');

  -- ── 4. Korrektur: Winzer nein, Betriebsleitung ja ─────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('korrektur_winzer',
    split_part(pg_temp.s112_fehlertext(format(c_korr, v_b, 'behandlungen', v_m1, jsonb_build_object('aufwandmenge', 5), 'S112TEST Korrektur Tippfehler')), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('korrektur_betriebsleitung',
    pg_temp.s112_fehlertext(format(c_korr, v_b, 'behandlungen', v_m1, jsonb_build_object('aufwandmenge', 5), 'S112TEST Korrektur Tippfehler')), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('korrektur_wert', (SELECT aufwandmenge = 5 FROM public.behandlungen WHERE id = v_m1), true);

  -- ── 5. Lese storniert: Maßnahme wieder frei ───────────────────────────────────────────────────────────
  UPDATE public.ernte_parzellen SET storniert_am = now(), storno_grund = 'S112TEST Storno-Grund' WHERE id = v_ep;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('frei_nach_lesestorno',
    pg_temp.s112_versuch(format('UPDATE public.behandlungen SET datum = datum - 1 WHERE id = %L', v_m1)), 'k1');

  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('kennzeichen_leer', coalesce(current_setting('s112.freeze_frei', true), ''), '');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 13);
END $test$;
