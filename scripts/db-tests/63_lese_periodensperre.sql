-- @bereich: Lese in der Kellerbuch-Periodensperre (KAN-205, Entscheidung Jörgen 07.10.2026 „ganz gesperrt“)
-- @ziel: Im abgeschlossenen Kellerbuch-Zeitraum lassen sich Lese-Zeilen (ernte_parzellen samt Mostgewicht), Traubenzeilen
-- @ziel: der Pressung (pressung_weingaerten) und Traubenverkäufe weder anlegen noch mengen- bzw. merkmalsrelevant ändern
-- @ziel: (42501); Storno bleibt möglich; nach dem Abschluss geht alles wie bisher; Wartung (s112.loeschen_erlaubt) passiert.
-- @mutation lese_ohne_sperre: Trigger a_periodensperre an ernte_parzellen entfernt | rot: lese_.*
-- @mutation tv_ohne_sperre: Trigger a_periodensperre an traubenverkauf entfernt | rot: tv_.*
-- @mutation pw_ohne_sperre: Trigger a_periodensperre an pressung_weingaerten entfernt | rot: pw_.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 63 (Stand 07.10.2026, KAN-205). Alles zurückgerollt.

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  c_datei constant text := '63_lese_periodensperre';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bis   date;
  v_p     jsonb;
  v_jg    uuid;
  v_lese  uuid;
  v_wg    uuid;
  v_alt   uuid;   -- Lese-Zeile im gesperrten Zeitraum (per Wartung angelegt)
  v_tv    uuid;   -- Traubenverkauf im gesperrten Zeitraum
  v_pr    uuid;   -- Pressung im gesperrten Zeitraum
  v_pw    uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bis := public.s112_kellerbuch_gesperrt_bis(v_b);
  IF v_bis IS NULL THEN
    INSERT INTO public.kellerbuch_abschluesse (tenant_id, abgeschlossen_bis) VALUES (v_b, v_heute - 60);
    v_bis := public.s112_kellerbuch_gesperrt_bis(v_b);
  END IF;
  v_p := pg_temp.s112_beispiel('pressungen', v_b, NULL);   -- Jahrgang und Lese für die Lesezeilen
  v_jg := (v_p ->> 'jahrgang_id')::uuid;
  v_lese := (v_p ->> 'lese_id')::uuid;
  v_wg := (pg_temp.s112_zeile('weingarten', v_b) ->> 'id')::uuid;

  -- Altbestand im gesperrten Zeitraum (Wartung passiert die Sperre)
  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);
  INSERT INTO public.ernte_parzellen (jahrgang_id, lese_id, weingarten_id, ernte_datum, menge_kg, klosterneuburger, qualitaetsstufe)
  VALUES (v_jg, v_lese, v_wg, v_bis - 1, 100, 17, 'qualitaetswein') RETURNING id INTO v_alt;
  v_tv := (pg_temp.s112_beispiel('traubenverkauf', v_b, NULL, jsonb_build_object('datum', v_bis - 1, 'menge_kg', 50, 'jahrgang_id', v_jg, 'lese_id', v_lese, 'storniert_am', NULL)) ->> 'id')::uuid;
  v_pr := (pg_temp.s112_beispiel('pressungen', v_b, NULL, jsonb_build_object('datum', v_bis - 1, 'storniert_am', NULL)) ->> 'id')::uuid;
  v_pw := (pg_temp.s112_beispiel('pressung_weingaerten', v_b, NULL, jsonb_build_object('pressung_id', v_pr, 'trauben_kg', 80, 'storniert_am', NULL)) ->> 'id')::uuid;
  PERFORM set_config('s112.loeschen_erlaubt', '', true);
  v_erg := v_erg || pg_temp.s112_erwarte('wartung_passiert', v_alt IS NOT NULL AND v_tv IS NOT NULL AND v_pw IS NOT NULL, true);

  PERFORM pg_temp.s112_mutiere('lese_ohne_sperre', $m$DROP TRIGGER a_periodensperre ON public.ernte_parzellen$m$);
  PERFORM pg_temp.s112_mutiere('tv_ohne_sperre', $m$DROP TRIGGER a_periodensperre ON public.traubenverkauf$m$);
  PERFORM pg_temp.s112_mutiere('pw_ohne_sperre', $m$DROP TRIGGER a_periodensperre ON public.pressung_weingaerten$m$);

  -- ── 1. Lese-Zeilen ────────────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('lese_anlegen_gesperrt',
    split_part(pg_temp.s112_fehlertext(format('INSERT INTO public.ernte_parzellen (jahrgang_id, lese_id, weingarten_id, ernte_datum, menge_kg, qualitaetsstufe) VALUES (%L, %L, %L, %L, 10, %L)',
      v_jg, v_lese, v_wg, v_bis - 2, 'qualitaetswein')), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('lese_menge_gesperrt',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.ernte_parzellen SET menge_kg = 110 WHERE id = %L', v_alt)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('lese_mostgewicht_gesperrt',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.ernte_parzellen SET klosterneuburger = 18 WHERE id = %L', v_alt)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('lese_storno_geht',
    pg_temp.s112_fehlertext(format('UPDATE public.ernte_parzellen SET storniert_am = now(), storno_grund = %L WHERE id = %L', 'S112TEST Storno im Zeitraum', v_alt)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('lese_nach_abschluss_ok',
    pg_temp.s112_fehlertext(format('INSERT INTO public.ernte_parzellen (jahrgang_id, lese_id, weingarten_id, ernte_datum, menge_kg, qualitaetsstufe) VALUES (%L, %L, %L, %L, 10, %L)',
      v_jg, v_lese, v_wg, v_heute - 1, 'qualitaetswein')), 'ok');

  -- ── 2. Traubenverkauf ─────────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('tv_menge_gesperrt',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.traubenverkauf SET menge_kg = 60 WHERE id = %L', v_tv)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('tv_storno_geht',
    pg_temp.s112_fehlertext(format('UPDATE public.traubenverkauf SET storniert_am = now(), storno_grund = %L WHERE id = %L', 'S112TEST Storno im Zeitraum', v_tv)), 'ok');

  -- ── 3. Traubenzeilen der Pressung ─────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('pw_menge_gesperrt',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.pressung_weingaerten SET trauben_kg = 90 WHERE id = %L', v_pw)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('pw_storno_geht',
    pg_temp.s112_fehlertext(format('UPDATE public.pressung_weingaerten SET storniert_am = now(), storno_grund = %L WHERE id = %L', 'S112TEST Storno im Zeitraum', v_pw)), 'ok');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 10);
END $test$;
