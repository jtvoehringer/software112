-- @bereich: Fassungsvermögen der Gebinde (KAN-381) – Constraint-Trigger z_fassungsvermoegen und a_fassung_vorher an weinausbau
-- @ziel: Kein Zugang (Umzug, Verschnitt, Pressung, Zukauf, Produktion, Zugangskorrektur, direkte Änderung) füllt ein Gebinde
-- @ziel: mit hinterlegtem Fassungsvermögen über Volumen + 0,5 l; Gebinde ohne Volumen sind frei. Geprüft wird am Ende der
-- @ziel: Transaktion: Ziel zuerst erhöhen und Quelle danach mindern geht. Eine bestehende Überfüllung bleibt bearbeitbar
-- @ziel: (mindern, umbenennen, stornieren, umverteilen), nur weitere Zugänge sind gesperrt. Kellergemeinschaft: der Nutzer-
-- @ziel: Betrieb kann das Gebinde des Eigentümers nicht überfüllen. Wartung (s112.loeschen_erlaubt) ist frei.
-- @mutation ohne_pruefung: DROP TRIGGER z_fassungsvermoegen an weinausbau | rot: .*_zu_.*|ueberfuellt_erhoehen|.*_meldung|toleranz_.*
-- @mutation ohne_vorher: DROP TRIGGER a_fassung_vorher an weinausbau | rot: ueberfuellt_umverteilen
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 84 (Stand 23.10.2026, KAN-381). Alles zurückgerollt.
-- Betrieb B (frisch), Betrieb C als Nutzer eines gemeinsamen Gebindes von B. Die Prüfung ist aufgeschoben (DEFERRABLE
-- INITIALLY DEFERRED); jeder Versuch löst sie mit SET CONSTRAINTS … IMMEDIATE aus und wird danach zurückgerollt.

-- Versuch: Anweisungen ausführen, aufgeschobene Prüfungen auslösen, immer zurückrollen → 'ok' bzw. '<SQLSTATE>: <Meldung> | HINT: …'
CREATE FUNCTION pg_temp.t84_versuch(p_sql text[]) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v_s     text;
  v_state text;
  v_msg   text;
  v_hint  text;
BEGIN
  BEGIN
    FOREACH v_s IN ARRAY p_sql LOOP
      EXECUTE v_s;
    END LOOP;
    SET CONSTRAINTS public.z_fassungsvermoegen IMMEDIATE;
    RAISE EXCEPTION USING ERRCODE = 'S1T00', MESSAGE = 'ok';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_hint = PG_EXCEPTION_HINT;
  END;
  IF v_state = 'S1T00' THEN
    RETURN 'ok';
  END IF;
  RETURN v_state || ': ' || v_msg || CASE WHEN coalesce(v_hint, '') <> '' THEN ' | HINT: ' || v_hint ELSE '' END;
END $f$;

CREATE FUNCTION pg_temp.t84_charge(p_tenant uuid, p_name text, p_beh uuid, p_liter numeric) RETURNS uuid LANGUAGE sql AS $f$
  INSERT INTO public.weinausbau (tenant_id, name, jahrgang, rebsorte, weinart, qualitaetsstufe, status, aktiv, behaelter_id, menge_liter)
  VALUES (p_tenant, p_name, 2025, 'Grüner Veltliner', 'weiss', 'qualitaetswein', 'ausbau', true, p_beh, p_liter)
  RETURNING id
$f$;

DO $test$
DECLARE
  v_heute  date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  c_datei  constant text := '84_fassungsvermoegen';
  c_ins    constant text := 'INSERT INTO public.weinausbau (tenant_id, name, jahrgang, rebsorte, weinart, qualitaetsstufe, status, aktiv, behaelter_id, menge_liter) VALUES (%L, %L, 2025, %L, %L, %L, %L, true, %L, %s)';
  v_t0     timestamptz;
  v_erg    text[] := '{}';
  v_a      jsonb;
  v_b      uuid;
  v_c      uuid;
  v_bw     uuid;
  v_bta    uuid;
  v_cta    uuid;
  v_gross  uuid;   -- 1.000 l, Charge X 200 l
  v_klein  uuid;   -- 100 l, leer
  v_leer   uuid;   -- 100 l, leer (Verschnitt, Produktion, Zukauf, Pressung)
  v_ohne   uuid;   -- ohne Volumen
  v_voll   uuid;   -- 100 l, überfüllt mit 150 l (V1 100 l, V2 50 l)
  v_eng    uuid;   -- 300 l, P 200 l + Q 80 l
  v_gem    uuid;   -- 100 l, gemeinsam (Eigentümer B), Charge von C 80 l
  v_x      uuid;
  v_v1     uuid;
  v_v2     uuid;
  v_p      uuid;
  v_q      uuid;
  v_c1     uuid;
  v_pr     uuid;
  v_kb     uuid;
  v_txt    text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ──────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau(true);
  v_b := (v_a ->> 'b')::uuid;
  v_c := (v_a ->> 'c')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_cta := (v_a ->> 'c_ta')::uuid;
  INSERT INTO public.behaelter (tenant_id, name, volumen_liter, aktiv) VALUES (v_b, 'S112TEST Groß', 1000, true) RETURNING id INTO v_gross;
  INSERT INTO public.behaelter (tenant_id, name, volumen_liter, aktiv) VALUES (v_b, 'S112TEST Klein', 100, true) RETURNING id INTO v_klein;
  INSERT INTO public.behaelter (tenant_id, name, volumen_liter, aktiv) VALUES (v_b, 'S112TEST Leer', 100, true) RETURNING id INTO v_leer;
  INSERT INTO public.behaelter (tenant_id, name, volumen_liter, aktiv) VALUES (v_b, 'S112TEST ohne Volumen', NULL, true) RETURNING id INTO v_ohne;
  INSERT INTO public.behaelter (tenant_id, name, volumen_liter, aktiv) VALUES (v_b, 'S112TEST Voll', 100, true) RETURNING id INTO v_voll;
  INSERT INTO public.behaelter (tenant_id, name, volumen_liter, aktiv) VALUES (v_b, 'S112TEST Eng', 300, true) RETURNING id INTO v_eng;
  INSERT INTO public.behaelter (tenant_id, name, volumen_liter, aktiv, gemeinsam) VALUES (v_b, 'S112TEST Gemeinsam', 100, true, true) RETURNING id INTO v_gem;
  INSERT INTO public.keller_freigaben (eigentuemer_tenant_id, nutzer_tenant_id, aktiv, notizen) VALUES (v_b, v_c, true, 'S112TEST KAN-381');
  -- Bestand anlegen; die bestehende Überfüllung in „Voll“ entsteht als Wartung (wie die Altfälle im Musterhof)
  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);
  v_x  := pg_temp.t84_charge(v_b, 'S112TEST X', v_gross, 200);
  v_v1 := pg_temp.t84_charge(v_b, 'S112TEST V1', v_voll, 100);
  v_v2 := pg_temp.t84_charge(v_b, 'S112TEST V2', v_voll, 50);
  v_p  := pg_temp.t84_charge(v_b, 'S112TEST P', v_eng, 200);
  v_q  := pg_temp.t84_charge(v_b, 'S112TEST Q', v_eng, 80);
  v_pr := (pg_temp.s112_beispiel('pressungen', v_b, v_bw) ->> 'id')::uuid;
  v_kb := (pg_temp.s112_beispiel('kontakte', v_b, v_bw) ->> 'id')::uuid;
  SET CONSTRAINTS public.z_fassungsvermoegen IMMEDIATE;   -- aufgeschobene Prüfungen des Aufbaus jetzt (Wartung frei) auslösen
  SET CONSTRAINTS public.z_fassungsvermoegen DEFERRED;
  PERFORM set_config('s112.loeschen_erlaubt', '', true);
  v_c1 := pg_temp.t84_charge(v_c, 'S112TEST C1', v_gem, 80);
  SET CONSTRAINTS public.z_fassungsvermoegen IMMEDIATE;
  SET CONSTRAINTS public.z_fassungsvermoegen DEFERRED;
  PERFORM set_config('s112.fassung_vorher', '', true);
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_ueberfuellt',
    (SELECT sum(menge_liter)::numeric(12, 2)::text FROM public.weinausbau WHERE behaelter_id = v_voll AND aktiv), '150.00');

  PERFORM pg_temp.s112_mutiere('ohne_pruefung', $m$DROP TRIGGER z_fassungsvermoegen ON public.weinausbau$m$);
  PERFORM pg_temp.s112_mutiere('ohne_vorher', $m$DROP TRIGGER a_fassung_vorher ON public.weinausbau$m$);

  PERFORM pg_temp.s112_als(v_bw);

  -- ── 1. Umzug (Gebinde der Charge ändern) ─────────────────────────────────────────────────────────────────
  v_txt := pg_temp.t84_versuch(ARRAY[format('UPDATE public.weinausbau SET behaelter_id = %L WHERE id = %L', v_klein, v_x)]);
  v_erg := v_erg || pg_temp.s112_erwarte('umzug_zu_klein', v_txt,
    '23514: Die Charge (200 l) passt nicht in „S112TEST Klein“ (Fassungsvermögen 100 l, frei 100 l). | HINT: fassungsvermoegen');
  v_erg := v_erg || pg_temp.s112_erwarte('umzug_passt',
    pg_temp.t84_versuch(ARRAY[format('UPDATE public.weinausbau SET behaelter_id = %L WHERE id = %L', v_gross, v_q)]), 'ok');
  -- Teilumzug A → B in einer Transaktion: Quelle mindern, Ziel neu anlegen
  v_erg := v_erg || pg_temp.s112_erwarte('teilumzug_transaktion', pg_temp.t84_versuch(ARRAY[
    format('UPDATE public.weinausbau SET menge_liter = 120 WHERE id = %L', v_x),
    format(c_ins, v_b, 'S112TEST Teilmenge', 'Grüner Veltliner', 'weiss', 'qualitaetswein', 'ausbau', v_klein, 80)]), 'ok');
  -- Ziel zuerst erhöhen, Quelle im selben Gebinde danach mindern (Verschnitt im Gebinde): erst am Ende geprüft
  v_erg := v_erg || pg_temp.s112_erwarte('ziel_vor_quelle', pg_temp.t84_versuch(ARRAY[
    format('UPDATE public.weinausbau SET menge_liter = 280 WHERE id = %L', v_p),
    format('UPDATE public.weinausbau SET menge_liter = 0, aktiv = false, status = %L WHERE id = %L', 'abgeschlossen', v_q)]), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('ziel_ohne_quelle_zu_viel',
    split_part(pg_temp.t84_versuch(ARRAY[format('UPDATE public.weinausbau SET menge_liter = 280 WHERE id = %L', v_p)]), ':', 1), '23514');

  -- ── 2. Toleranz 0,5 l, Meldung mit Dezimalstellen, Gebinde ohne Volumen ─────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('toleranz_100_5',
    pg_temp.t84_versuch(ARRAY[format(c_ins, v_b, 'S112TEST T1', 'Grüner Veltliner', 'weiss', 'qualitaetswein', 'ausbau', v_klein, 100.5)]), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('toleranz_100_6_meldung',
    pg_temp.t84_versuch(ARRAY[format(c_ins, v_b, 'S112TEST T2', 'Grüner Veltliner', 'weiss', 'qualitaetswein', 'ausbau', v_klein, 100.6)]),
    '23514: Die Charge (100,6 l) passt nicht in „S112TEST Klein“ (Fassungsvermögen 100 l, frei 100 l). | HINT: fassungsvermoegen');
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_volumen_frei',
    pg_temp.t84_versuch(ARRAY[format(c_ins, v_b, 'S112TEST groß', 'Grüner Veltliner', 'weiss', 'qualitaetswein', 'ausbau', v_ohne, 5000)]), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('tausender_meldung',
    pg_temp.t84_versuch(ARRAY[format(c_ins, v_b, 'S112TEST T3', 'Grüner Veltliner', 'weiss', 'qualitaetswein', 'ausbau', v_gross, 1250.25)]),
    '23514: Die Charge (1.250,25 l) passt nicht in „S112TEST Groß“ (Fassungsvermögen 1.000 l, frei 800 l). | HINT: fassungsvermoegen');

  -- ── 3. Bestehende Überfüllung („Voll“ 150 / 100 l) ──────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('ueberfuellt_mindern',
    pg_temp.t84_versuch(ARRAY[format('UPDATE public.weinausbau SET menge_liter = 90 WHERE id = %L', v_v1)]), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('ueberfuellt_umbenennen',
    pg_temp.t84_versuch(ARRAY[format('UPDATE public.weinausbau SET name = %L, notizen = %L WHERE id = %L', 'S112TEST V1 neu', 'S112TEST', v_v1)]), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('ueberfuellt_stornieren',
    pg_temp.t84_versuch(ARRAY[format('UPDATE public.weinausbau SET storniert_am = now(), storno_grund = %L WHERE id = %L', 'S112TEST falsch erfasst', v_v2)]), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('ueberfuellt_umverteilen', pg_temp.t84_versuch(ARRAY[
    format('UPDATE public.weinausbau SET menge_liter = 90 WHERE id = %L', v_v1),
    format('UPDATE public.weinausbau SET menge_liter = 60 WHERE id = %L', v_v2)]), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('ueberfuellt_erhoehen',
    pg_temp.t84_versuch(ARRAY[format('UPDATE public.weinausbau SET menge_liter = 60 WHERE id = %L', v_v2)]),
    '23514: Die Charge (10 l) passt nicht in „S112TEST Voll“ (Fassungsvermögen 100 l, frei 0 l). | HINT: fassungsvermoegen');

  -- ── 4. Buchungs-RPCs (Verschnitt, Produktion, Zukauf, Pressung) ─────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('verschnitt_zu_gross',
    split_part(pg_temp.t84_versuch(ARRAY[format('SELECT public.s112_verschnitt_buchen(%L, %L::jsonb, %L::jsonb)', v_b,
      jsonb_build_object('datum', v_heute, 'neue_ziel_charge', jsonb_build_object('name', 'S112TEST Verschnitt', 'behaelter_id', v_leer)),
      jsonb_build_array(jsonb_build_object('weinausbau_id', v_x, 'menge_liter', 150)))]), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('verschnitt_passt',
    pg_temp.t84_versuch(ARRAY[format('SELECT public.s112_verschnitt_buchen(%L, %L::jsonb, %L::jsonb)', v_b,
      jsonb_build_object('datum', v_heute, 'neue_ziel_charge', jsonb_build_object('name', 'S112TEST Verschnitt', 'behaelter_id', v_leer)),
      jsonb_build_array(jsonb_build_object('weinausbau_id', v_x, 'menge_liter', 80)))]), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('produktion_zu_gross',
    split_part(pg_temp.t84_versuch(ARRAY[format('SELECT public.s112_produktion_buchen(%L, %L::jsonb, %L::jsonb)', v_b,
      jsonb_build_object('art', 'perlwein', 'name', 'S112TEST Perlwein', 'behaelter_id', v_leer, 'datum', v_heute),
      jsonb_build_array(jsonb_build_object('art', 'wein', 'weinausbau_id', v_x, 'menge', 150)))]), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('zukauf_zu_gross',
    split_part(pg_temp.t84_versuch(ARRAY[format('SELECT public.s112_zukauf_buchen(%L, %L::jsonb, %L::jsonb)', v_b,
      jsonb_build_object('datum', v_heute, 'art', 'wein', 'lieferant_kontakt_id', v_kb, 'weinart', 'weiss', 'rebsorte', 'Grüner Veltliner',
        'jahrgang', 2025, 'qualitaetsstufe', 'qualitaetswein', 'menge', 150, 'einheit', 'L', 'notizen', 'S112TEST Zukauf'),
      jsonb_build_object('name', 'Grüner Veltliner', 'rebsorte', 'Grüner Veltliner', 'behaelter_id', v_leer, 'jahrgang', 2025,
        'menge_liter', 150, 'weinart', 'weiss', 'qualitaetsstufe', 'qualitaetswein'))]), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('pressung_zu_gross',
    split_part(pg_temp.t84_versuch(ARRAY[format('SELECT public.s112_mostzeile_anlegen(%L, %L, %L, 150, NULL, %L::jsonb)', v_b, v_pr, v_leer,
      '{"name": "S112TEST Most"}')]), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('pressung_passt',
    pg_temp.t84_versuch(ARRAY[format('SELECT public.s112_mostzeile_anlegen(%L, %L, %L, 90, NULL, %L::jsonb)', v_b, v_pr, v_leer,
      '{"name": "S112TEST Most"}')]), 'ok');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('zugangskorrektur_zu_gross',
    split_part(pg_temp.t84_versuch(ARRAY[format('SELECT public.s112_zugangskorrektur_buchen(%L, %L, pg_temp.s112_heute(), 900, %L, %L)', v_b, v_x,
      'inventur', 'S112TEST Inventur-Plus')]), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('zugangskorrektur_passt',
    pg_temp.t84_versuch(ARRAY[format('SELECT public.s112_zugangskorrektur_buchen(%L, %L, pg_temp.s112_heute(), 50, %L, %L)', v_b, v_x,
      'inventur', 'S112TEST Inventur-Plus')]), 'ok');

  -- ── 5. Kellergemeinschaft: C nutzt das gemeinsame Gebinde von B (C sieht dessen Volumen nicht) ─────────────
  PERFORM pg_temp.s112_als(v_cta);
  v_erg := v_erg || pg_temp.s112_erwarte('gemeinschaft_zu_viel',
    pg_temp.t84_versuch(ARRAY[format('UPDATE public.weinausbau SET menge_liter = 120 WHERE id = %L', v_c1)]),
    '23514: Die Charge (40 l) passt nicht in „S112TEST Gemeinsam“ (Fassungsvermögen 100 l, frei 20 l). | HINT: fassungsvermoegen');
  v_erg := v_erg || pg_temp.s112_erwarte('gemeinschaft_passt',
    pg_temp.t84_versuch(ARRAY[format('UPDATE public.weinausbau SET menge_liter = 100 WHERE id = %L', v_c1)]), 'ok');
  PERFORM pg_temp.s112_als_postgres();

  -- ── 6. Wartung frei (Service-Role/SQL-Editor mit s112.loeschen_erlaubt) ───────────────────────────────────
  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);
  v_erg := v_erg || pg_temp.s112_erwarte('wartung_frei',
    pg_temp.t84_versuch(ARRAY[format(c_ins, v_b, 'S112TEST Wartung', 'Grüner Veltliner', 'weiss', 'qualitaetswein', 'ausbau', v_klein, 500)]), 'ok');
  PERFORM set_config('s112.loeschen_erlaubt', '', true);
  -- ohne Wartung auch für postgres/Service-Role gesperrt
  v_erg := v_erg || pg_temp.s112_erwarte('postgres_zu_gross',
    split_part(pg_temp.t84_versuch(ARRAY[format(c_ins, v_b, 'S112TEST pg', 'Grüner Veltliner', 'weiss', 'qualitaetswein', 'ausbau', v_klein, 500)]), ':', 1), '23514');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 25);
END
$test$;
