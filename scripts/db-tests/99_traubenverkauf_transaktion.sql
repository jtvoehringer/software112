-- @bereich: Warenwirtschaft – Traubenverkauf in einer Transaktion, Musterhof-Reset räumt Rechnungen ab (KAN-476)
-- @ziel: Der Musterhof-Reset lässt keine Rechnung ohne Verkauf stehen (Sammelrechnung, Stornobeleg) und setzt den
-- @ziel: Rechnungszähler hinter die höchste vorhandene Nummer – ein neuer Verkauf bekommt eine freie Rechnungsnummer.
-- @ziel: s112_traubenverkauf_anlegen legt Liefernummer, Verkauf, Position und Traubenverkauf gemeinsam an; scheitert
-- @ziel: ein Schritt (Rechnungsnummer vergeben, fremde Ried), bleibt nichts zurück – auch keine verbrauchte
-- @ziel: Liefernummer. Es gelten die Rechte der Tabellen: Leser, Mitarbeiter ohne Warenwirtschaft und fremde Betriebe
-- @ziel: legen nichts an; anon darf die Funktion nicht ausführen. s112_traubenverkauf_anlegen_zeilen (ganze Ried): je
-- @ziel: Grundstück ein Traubenverkauf mit eigener Liefernummer, ein Verkauf mit einer Rechnung; scheitert eine Zeile,
-- @ziel: entsteht nichts.
-- @mutation reset_alt: Reset räumt die Rechnungen nicht mehr ab (Stand vor KAN-476) | rot: reset_.*
-- @mutation anon_darf: anon darf s112_traubenverkauf_anlegen ausführen | rot: anon_ohne_rechte
-- @mutation anon_darf_zeilen: anon darf s112_traubenverkauf_anlegen_zeilen ausführen | rot: zeilen_anon_ohne_rechte
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 99 (Stand 16.11.2026, KAN-476). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '99_traubenverkauf_transaktion';
  c_m     constant uuid := '33333333-3333-4333-8333-333333333333';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_mta   uuid;
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  v_vorl  record;
  v_daten jsonb;
  v_r     jsonb;
  v_tv    uuid;
  v_vp    uuid;
  v_ln0   int;
  v_tv0   bigint;
  v_vp0   bigint;
  v_frei  text;
  v_ried  record;
  v_kopf  jsonb;
  v_zeilen jsonb;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_mta := (v_a ->> 'm_ta')::uuid;

  PERFORM pg_temp.s112_mutiere('reset_alt', $m$DO $x$ BEGIN
    EXECUTE replace(pg_get_functiondef('public.demo_musterhof_zuruecksetzen()'::regprocedure),
      'delete from rechnungen where tenant_id = c_t;', ''); END $x$$m$);

  PERFORM pg_temp.s112_mutiere('anon_darf', $m$GRANT EXECUTE ON FUNCTION public.s112_traubenverkauf_anlegen(uuid, jsonb, text) TO anon$m$);
  PERFORM pg_temp.s112_mutiere('anon_darf_zeilen', $m$GRANT EXECUTE ON FUNCTION public.s112_traubenverkauf_anlegen_zeilen(uuid, jsonb, jsonb, text) TO anon$m$);

  -- ── 1. Reset: eine Rechnung ohne Verkauf mit hoher Nummer nachstellen (Befund Produktion: RE-0029 blieb stehen) ──
  PERFORM pg_temp.s112_als_postgres();
  PERFORM public.demo_musterhof_zuruecksetzen();
  UPDATE public.rechnungen SET rechnungsnummer = 'RE-9000'
   WHERE id = (SELECT rechnung_id FROM public.verkaufsposten WHERE tenant_id = c_m AND rechnung_id IS NOT NULL ORDER BY rechnungsnummer DESC LIMIT 1);
  UPDATE public.verkaufsposten SET rechnung_id = NULL WHERE tenant_id = c_m AND rechnung_id = (SELECT id FROM public.rechnungen WHERE tenant_id = c_m AND rechnungsnummer = 'RE-9000');
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_rechnung_ohne_verkauf',
    (SELECT count(*) FROM public.rechnungen r WHERE tenant_id = c_m AND rechnungsnummer = 'RE-9000' AND NOT EXISTS (SELECT 1 FROM public.verkaufsposten v WHERE v.rechnung_id = r.id)), 1::bigint);
  PERFORM public.demo_musterhof_zuruecksetzen();
  v_erg := v_erg || pg_temp.s112_erwarte('reset_keine_rechnung_ohne_verkauf',
    (SELECT count(*) FROM public.rechnungen r WHERE tenant_id = c_m AND NOT EXISTS (SELECT 1 FROM public.verkaufsposten v WHERE v.rechnung_id = r.id)), 0::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('reset_rechnungen_bleiben_je_verkauf',
    (SELECT count(*) FROM public.rechnungen WHERE tenant_id = c_m) > 0, true);
  v_erg := v_erg || pg_temp.s112_erwarte('reset_zaehler_hinter_hoechster_nummer',
    (SELECT rechnung_zaehler FROM public.tenant_einstellungen WHERE tenant_id = c_m),
    (SELECT max(substring(rechnungsnummer from 4)::int) + 1 FROM public.rechnungen WHERE tenant_id = c_m AND rechnungsnummer ~ '^RE-[0-9]+$'));
  v_erg := v_erg || pg_temp.s112_erwarte('reset_storno_und_gutschrift_zaehler',
    (SELECT concat_ws('/', storno_zaehler, gutschrift_zaehler) FROM public.tenant_einstellungen WHERE tenant_id = c_m), '1/1');

  -- Vorlage: eine Lesedaten-Zeile des frisch aufgebauten Musterhofs (Ried, Grundstück, Lese) und ein Abnehmer
  SELECT e.jahrgang_id, e.lese_id, e.weingarten_id, e.grundstueck_id, e.qualitaetsstufe, e.herkunft_code,
         NULL::uuid AS kontakt_id, (SELECT id FROM public.firmen WHERE tenant_id = c_m ORDER BY id LIMIT 1) AS firma_id
    INTO v_vorl
    FROM public.ernte_parzellen e JOIN public.weinjahrgaenge j ON j.id = e.jahrgang_id
   WHERE j.tenant_id = c_m AND e.storniert_am IS NULL AND e.weingarten_id IS NOT NULL AND e.lese_id IS NOT NULL
   ORDER BY e.ernte_datum DESC, e.id LIMIT 1;
  IF v_vorl.lese_id IS NULL OR v_vorl.firma_id IS NULL THEN
    RAISE EXCEPTION 'Staging-Demo unvollständig – keine Lesedaten bzw. Firma im Musterhof nach demo_musterhof_zuruecksetzen()';
  END IF;
  v_daten := jsonb_build_object('jahrgang_id', v_vorl.jahrgang_id, 'lese_id', v_vorl.lese_id, 'weingarten_id', v_vorl.weingarten_id,
    'grundstueck_id', v_vorl.grundstueck_id, 'kontakt_id', v_vorl.kontakt_id, 'firma_id', v_vorl.firma_id,
    'datum', v_heute, 'menge_kg', 250, 'preis_per_kg', 1, 'kmw_grad', 15.0, 'mostgewicht_einheit', 'kmw',
    'qualitaetsstufe', v_vorl.qualitaetsstufe, 'gesundheit', 'G', 'herkunft_code', v_vorl.herkunft_code, 'notizen', 'S112TEST KAN-476');
  SELECT liefernummer_zaehler INTO v_ln0 FROM public.tenant_einstellungen WHERE tenant_id = c_m;
  SELECT count(*) INTO v_tv0 FROM public.traubenverkauf WHERE tenant_id = c_m;
  SELECT count(*) INTO v_vp0 FROM public.verkaufsposten WHERE tenant_id = c_m;

  -- ── 2. Der Fall aus dem Ticket: nach dem Reset einen Traubenverkauf anlegen ─────────────────────────────────
  PERFORM pg_temp.s112_als(v_mta);
  v_r := public.s112_traubenverkauf_anlegen(c_m, v_daten, 'S112TEST Ried');
  PERFORM pg_temp.s112_als_postgres();
  v_tv := (v_r ->> 'id')::uuid;
  v_vp := (v_r ->> 'verkaufsposten_id')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('anlegen_traubenverkauf_mit_verkauf',
    (SELECT concat_ws('|', menge_kg, preis_per_kg, datum, verkaufsposten_id = v_vp, liefernummer = v_r ->> 'liefernummer', lese_id = v_vorl.lese_id, notizen)
       FROM public.traubenverkauf WHERE id = v_tv AND tenant_id = c_m),
    concat_ws('|', '250.00', '1.0000', v_heute, 't', 't', 't', 'S112TEST KAN-476'));
  v_erg := v_erg || pg_temp.s112_erwarte('anlegen_verkauf_mit_rechnung',
    (SELECT concat_ws('|', v.notizen, v.rechnungsnummer ~ '^RE-', r.rechnungsnummer = v.rechnungsnummer)
       FROM public.verkaufsposten v LEFT JOIN public.rechnungen r ON r.id = v.rechnung_id WHERE v.id = v_vp),
    'Traubenverkauf – S112TEST Ried|t|t');
  v_erg := v_erg || pg_temp.s112_erwarte('anlegen_position',
    (SELECT string_agg(concat_ws('|', typ, name, menge, einheit, preis_brutto, ust_satz), ' ; ') FROM public.verkauf_positionen WHERE verkaufsposten_id = v_vp),
    'sonstiges|Weintrauben – S112TEST Ried|250.00|kg|1.0000|13.00');
  v_erg := v_erg || pg_temp.s112_erwarte('anlegen_liefernummer_gezogen',
    (SELECT liefernummer_zaehler FROM public.tenant_einstellungen WHERE tenant_id = c_m), v_ln0 + 1);

  -- ── 3. Alles oder nichts ────────────────────────────────────────────────────────────────────────────────────
  -- 3a. die nächste Rechnungsnummer gibt es schon (Zähler zurückgestellt wie nach dem alten Reset)
  UPDATE public.tenant_einstellungen SET rechnung_zaehler = rechnung_zaehler - 1 WHERE tenant_id = c_m;
  PERFORM pg_temp.s112_als(v_mta);
  BEGIN
    PERFORM public.s112_traubenverkauf_anlegen(c_m, v_daten, 'S112TEST Ried');
    v_frei := 'k1';
  EXCEPTION WHEN OTHERS THEN v_frei := 'E' || SQLSTATE;
  END;
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('nummer_vergeben_abgelehnt', v_frei, 'E23505');
  v_erg := v_erg || pg_temp.s112_erwarte('nummer_vergeben_nichts_gespeichert',
    (SELECT concat_ws('/', (SELECT count(*) FROM public.traubenverkauf WHERE tenant_id = c_m) - v_tv0,
                           (SELECT count(*) FROM public.verkaufsposten WHERE tenant_id = c_m) - v_vp0,
                           liefernummer_zaehler - v_ln0) FROM public.tenant_einstellungen WHERE tenant_id = c_m), '1/1/1');
  UPDATE public.tenant_einstellungen SET rechnung_zaehler = rechnung_zaehler + 1 WHERE tenant_id = c_m;

  -- 3b. der letzte Schritt scheitert (Ried eines anderen Betriebs): auch der Verkauf entsteht nicht
  PERFORM pg_temp.s112_als(v_mta);
  BEGIN
    PERFORM public.s112_traubenverkauf_anlegen(c_m, v_daten || jsonb_build_object('weingarten_id', gen_random_uuid()), 'S112TEST Ried');
    v_frei := 'k1';
  EXCEPTION WHEN OTHERS THEN v_frei := 'abgelehnt';
  END;
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('fremde_ried_abgelehnt', v_frei, 'abgelehnt');
  v_erg := v_erg || pg_temp.s112_erwarte('fremde_ried_nichts_gespeichert',
    (SELECT concat_ws('/', (SELECT count(*) FROM public.traubenverkauf WHERE tenant_id = c_m) - v_tv0,
                           (SELECT count(*) FROM public.verkaufsposten WHERE tenant_id = c_m) - v_vp0,
                           liefernummer_zaehler - v_ln0) FROM public.tenant_einstellungen WHERE tenant_id = c_m), '1/1/1');

  -- 3c. Eingaben
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('menge_null_abgelehnt',
    pg_temp.s112_versuch(format('SELECT public.s112_traubenverkauf_anlegen(%L, %L::jsonb, %L)', c_m, v_daten || '{"menge_kg": 0}'::jsonb, 'x')), 'E22023');
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_datum_abgelehnt',
    pg_temp.s112_versuch(format('SELECT public.s112_traubenverkauf_anlegen(%L, %L::jsonb, %L)', c_m, v_daten - 'datum', 'x')), 'E22023');

  -- ── 4. Rechte: es gelten die Policies der Tabellen ──────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('betriebsleitung_darf',
    pg_temp.s112_versuch(format('SELECT public.s112_traubenverkauf_anlegen(%L, %L::jsonb, %L)', c_m, v_daten, 'x')), 'k1');
  PERFORM pg_temp.s112_als((v_a ->> 'm_w')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('mitarbeiter_mit_modulen_darf',
    pg_temp.s112_versuch(format('SELECT public.s112_traubenverkauf_anlegen(%L, %L::jsonb, %L)', c_m, v_daten, 'x')), 'k1');
  PERFORM pg_temp.s112_als((v_a ->> 'm_wc')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('mitarbeiter_nur_crm_darf_nicht',
    pg_temp.s112_versuch(format('SELECT public.s112_traubenverkauf_anlegen(%L, %L::jsonb, %L)', c_m, v_daten, 'x')) IN ('R', 'T'), true);
  PERFORM pg_temp.s112_als((v_a ->> 'm_l')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_darf_nicht',
    pg_temp.s112_versuch(format('SELECT public.s112_traubenverkauf_anlegen(%L, %L::jsonb, %L)', c_m, v_daten, 'x')) IN ('R', 'T'), true);
  PERFORM pg_temp.s112_als((v_a ->> 'b_ta')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb_darf_nicht',
    pg_temp.s112_versuch(format('SELECT public.s112_traubenverkauf_anlegen(%L, %L::jsonb, %L)', c_m, v_daten, 'x')) IN ('R', 'T'), true);
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('anon_ohne_rechte',
    has_function_privilege('anon', 'public.s112_traubenverkauf_anlegen(uuid, jsonb, text)', 'EXECUTE'), false);
  v_erg := v_erg || pg_temp.s112_erwarte('funktion_ist_invoker',
    (SELECT prosecdef FROM pg_proc WHERE oid = 'public.s112_traubenverkauf_anlegen(uuid, jsonb, text)'::regprocedure), false);

  -- ── 5. Ganze Ried: mehrere Grundstücke in einem Verkauf (Nebenbefund 19.11.2026) ────────────────────────────
  SELECT g.weingarten_id, (array_agg(g.id ORDER BY g.gst_nr, g.id))[1] AS g1, (array_agg(g.id ORDER BY g.gst_nr, g.id))[2] AS g2
    INTO v_ried
    FROM public.grundstuecke g
   WHERE g.tenant_id = c_m AND g.weingarten_id IS NOT NULL
   GROUP BY g.weingarten_id HAVING count(*) >= 2 ORDER BY g.weingarten_id LIMIT 1;
  IF v_ried.g2 IS NULL THEN
    RAISE EXCEPTION 'Staging-Demo unvollständig – keine Ried mit zwei Grundstücken im Musterhof';
  END IF;
  v_kopf := (v_daten - 'grundstueck_id' - 'menge_kg') || jsonb_build_object('weingarten_id', v_ried.weingarten_id);
  v_zeilen := jsonb_build_array(
    jsonb_build_object('grundstueck_id', v_ried.g1, 'menge_kg', 300, 'bezeichnung', 'S112TEST Ried, GST 1'),
    jsonb_build_object('grundstueck_id', v_ried.g2, 'menge_kg', 200.5, 'bezeichnung', 'S112TEST Ried, GST 2'));
  SELECT liefernummer_zaehler INTO v_ln0 FROM public.tenant_einstellungen WHERE tenant_id = c_m;
  SELECT count(*) INTO v_tv0 FROM public.traubenverkauf WHERE tenant_id = c_m;
  SELECT count(*) INTO v_vp0 FROM public.verkaufsposten WHERE tenant_id = c_m;

  PERFORM pg_temp.s112_als(v_mta);
  v_r := public.s112_traubenverkauf_anlegen_zeilen(c_m, v_kopf, v_zeilen, 'S112TEST Ried');
  PERFORM pg_temp.s112_als_postgres();
  v_vp := (v_r ->> 'verkaufsposten_id')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('zeilen_je_gst_ein_traubenverkauf',
    (SELECT string_agg(concat_ws('|', menge_kg, preis_per_kg, grundstueck_id = CASE menge_kg WHEN 300 THEN v_ried.g1 ELSE v_ried.g2 END,
                                 weingarten_id = v_ried.weingarten_id, lese_id = v_vorl.lese_id), ' ; ' ORDER BY menge_kg DESC)
       FROM public.traubenverkauf WHERE tenant_id = c_m AND verkaufsposten_id = v_vp),
    '300.00|1.0000|t|t|t ; 200.50|1.0000|t|t|t');
  v_erg := v_erg || pg_temp.s112_erwarte('zeilen_eigene_liefernummern',
    (SELECT concat_ws('/', count(DISTINCT liefernummer), (SELECT liefernummer_zaehler FROM public.tenant_einstellungen WHERE tenant_id = c_m) - v_ln0,
                           jsonb_array_length(v_r -> 'zeilen'))
       FROM public.traubenverkauf WHERE tenant_id = c_m AND verkaufsposten_id = v_vp), '2/2/2');
  v_erg := v_erg || pg_temp.s112_erwarte('zeilen_ein_verkauf_eine_rechnung',
    (SELECT concat_ws('|', (SELECT count(*) FROM public.verkaufsposten WHERE tenant_id = c_m) - v_vp0, v.notizen, r.rechnungsnummer = v.rechnungsnummer)
       FROM public.verkaufsposten v LEFT JOIN public.rechnungen r ON r.id = v.rechnung_id WHERE v.id = v_vp),
    '1|Traubenverkauf – S112TEST Ried|t');
  v_erg := v_erg || pg_temp.s112_erwarte('zeilen_positionen_mit_verweis',
    (SELECT string_agg(concat_ws('|', p.typ, p.name, p.menge, p.einheit, p.preis_brutto, p.ust_satz, t.grundstueck_id IS NOT NULL AND t.menge_kg = p.menge), ' ; ' ORDER BY p.menge DESC)
       FROM public.verkauf_positionen p LEFT JOIN public.traubenverkauf t ON t.id = p.traubenverkauf_id AND t.verkaufsposten_id = p.verkaufsposten_id
      WHERE p.verkaufsposten_id = v_vp),
    'trauben|Weintrauben – S112TEST Ried, GST 1|300.00|kg|1.0000|13.00|t ; trauben|Weintrauben – S112TEST Ried, GST 2|200.50|kg|1.0000|13.00|t');

  -- 5a. Alles oder nichts: die zweite Zeile scheitert (Menge 0 bzw. Grundstück eines anderen Betriebs)
  PERFORM pg_temp.s112_als(v_mta);
  BEGIN
    PERFORM public.s112_traubenverkauf_anlegen_zeilen(c_m, v_kopf, jsonb_set(v_zeilen, '{1,menge_kg}', '0'), 'S112TEST Ried');
    v_frei := 'k1';
  EXCEPTION WHEN OTHERS THEN v_frei := 'E' || SQLSTATE;
  END;
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('zeilen_menge_null_in_zeile_2_abgelehnt', v_frei, 'E22023');
  PERFORM pg_temp.s112_als(v_mta);
  BEGIN
    PERFORM public.s112_traubenverkauf_anlegen_zeilen(c_m, v_kopf, jsonb_set(v_zeilen, '{1,grundstueck_id}', to_jsonb(gen_random_uuid())), 'S112TEST Ried');
    v_frei := 'k1';
  EXCEPTION WHEN OTHERS THEN v_frei := 'abgelehnt';
  END;
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('zeilen_fremdes_gst_in_zeile_2_abgelehnt', v_frei, 'abgelehnt');
  v_erg := v_erg || pg_temp.s112_erwarte('zeilen_fehler_nichts_gespeichert',
    (SELECT concat_ws('/', (SELECT count(*) FROM public.traubenverkauf WHERE tenant_id = c_m) - v_tv0,
                           (SELECT count(*) FROM public.verkaufsposten WHERE tenant_id = c_m) - v_vp0,
                           liefernummer_zaehler - v_ln0) FROM public.tenant_einstellungen WHERE tenant_id = c_m), '2/1/2');

  -- 5b. Eingaben
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('zeilen_gst_doppelt_abgelehnt',
    pg_temp.s112_versuch(format('SELECT public.s112_traubenverkauf_anlegen_zeilen(%L, %L::jsonb, %L::jsonb, %L)', c_m, v_kopf,
      jsonb_build_array(v_zeilen -> 0, v_zeilen -> 0), 'x')), 'E22023');
  v_erg := v_erg || pg_temp.s112_erwarte('zeilen_leer_abgelehnt',
    pg_temp.s112_versuch(format('SELECT public.s112_traubenverkauf_anlegen_zeilen(%L, %L::jsonb, %L::jsonb, %L)', c_m, v_kopf, '[]', 'x')), 'E22023');
  v_erg := v_erg || pg_temp.s112_erwarte('zeilen_ohne_gst_abgelehnt',
    pg_temp.s112_versuch(format('SELECT public.s112_traubenverkauf_anlegen_zeilen(%L, %L::jsonb, %L::jsonb, %L)', c_m, v_kopf,
      jsonb_build_array((v_zeilen -> 0) - 'grundstueck_id'), 'x')), 'E22023');
  v_erg := v_erg || pg_temp.s112_erwarte('zeilen_mehr_als_20_abgelehnt',
    pg_temp.s112_versuch(format('SELECT public.s112_traubenverkauf_anlegen_zeilen(%L, %L::jsonb, %L::jsonb, %L)', c_m, v_kopf,
      (SELECT jsonb_agg(jsonb_build_object('grundstueck_id', gen_random_uuid(), 'menge_kg', 1)) FROM generate_series(1, 21)), 'x')), 'E22023');
  v_erg := v_erg || pg_temp.s112_erwarte('zeilen_ohne_datum_abgelehnt',
    pg_temp.s112_versuch(format('SELECT public.s112_traubenverkauf_anlegen_zeilen(%L, %L::jsonb, %L::jsonb, %L)', c_m, v_kopf - 'datum', v_zeilen, 'x')), 'E22023');

  -- 5c. Rechte wie bei der einzelnen Zeile
  PERFORM pg_temp.s112_als((v_a ->> 'm_l')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('zeilen_leser_darf_nicht',
    pg_temp.s112_versuch(format('SELECT public.s112_traubenverkauf_anlegen_zeilen(%L, %L::jsonb, %L::jsonb, %L)', c_m, v_kopf, v_zeilen, 'x')) IN ('R', 'T'), true);
  PERFORM pg_temp.s112_als((v_a ->> 'm_wc')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('zeilen_mitarbeiter_nur_crm_darf_nicht',
    pg_temp.s112_versuch(format('SELECT public.s112_traubenverkauf_anlegen_zeilen(%L, %L::jsonb, %L::jsonb, %L)', c_m, v_kopf, v_zeilen, 'x')) IN ('R', 'T'), true);
  PERFORM pg_temp.s112_als((v_a ->> 'b_ta')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('zeilen_fremder_betrieb_darf_nicht',
    pg_temp.s112_versuch(format('SELECT public.s112_traubenverkauf_anlegen_zeilen(%L, %L::jsonb, %L::jsonb, %L)', c_m, v_kopf, v_zeilen, 'x')) IN ('R', 'T'), true);
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('zeilen_anon_ohne_rechte',
    has_function_privilege('anon', 'public.s112_traubenverkauf_anlegen_zeilen(uuid, jsonb, jsonb, text)', 'EXECUTE'), false);
  v_erg := v_erg || pg_temp.s112_erwarte('zeilen_funktion_ist_invoker',
    (SELECT prosecdef FROM pg_proc WHERE oid = 'public.s112_traubenverkauf_anlegen_zeilen(uuid, jsonb, jsonb, text)'::regprocedure), false);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 36);
END $test$;
