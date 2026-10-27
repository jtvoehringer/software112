-- @bereich: Stornobeleg (KAN-379) – Storno einer Rechnung als Gegenbuchung im offenen Zeitraum
-- @ziel: Jeder Rechnungsstorno (s112_rechnung_stornieren, Verkauf samt Rechnung, Verkauf sofort über den Spiegel) legt einen
-- @ziel: Stornobeleg an: art 'storno', Nummer ST-JJJJ-0001 fortlaufend, Verweis auf das Original, Datum wählbar im offenen
-- @ziel: Zeitraum (nicht vor dem Rechnungsdatum, nicht in der Zukunft). Das Original bleibt in seinem (auch abgeschlossenen)
-- @ziel: Zeitraum unverändert wirksam; die Doppik-UVA zählt es dort aus der Momentaufnahme und den Stornobeleg negativ im
-- @ziel: Zeitraum seines Datums. Auch an BMD übergebene Rechnungen sind stornierbar; ein Stornobeleg selbst nicht; direkt
-- @ziel: (ohne Stornobeleg) lehnt die Datenbank den Storno ab. Leser und fremde Betriebe dürfen nicht.
-- @mutation ohne_momentaufnahme: UVA zählt das stornierte Original nicht mehr | rot: uva_alt.*
-- @mutation ohne_gegenbuchung: UVA zählt den Stornobeleg nicht | rot: uva_neu.*|uva_bmd.*
-- @mutation ohne_datumspruefung: Stornobeleg ohne eigene Prüfung des Zeitraums | rot: datum_gesperrt
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 86 (Stand 27.10.2026, KAN-379). Alles zurückgerollt.
-- Betrieb B (frisch, Doppik): Monat „vor zwei Monaten“ abgeschlossen, laufender Monat offen.

CREATE FUNCTION pg_temp.t86_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't86_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

CREATE FUNCTION pg_temp.t86_uva(p_tenant uuid, p_tag date) RETURNS text LANGUAGE sql AS $f$
  SELECT concat_ws('|', u.bmgl_20::numeric(12, 2), u.ust_20::numeric(12, 2), u.bmgl_13::numeric(12, 2))
  FROM public.berechne_ea_uva(p_tenant, extract(year FROM p_tag)::smallint, to_char(p_tag, 'MM')) u
$f$;

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  c_datei constant text := '86_stornobeleg';
  c_sto   constant text := 'SELECT public.s112_rechnung_stornieren(%L::uuid, %L::uuid, %L, %L::date)';
  c_pos   constant text := 'INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz, fuellung_id) VALUES (%L, %L, %L, %L, %s, %L, %s, %s, %L)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_m     uuid;
  v_zu    date;    -- Tag im abgeschlossenen Monat
  v_f     uuid;    -- Füllung, 100 Flaschen
  v_ls1   uuid;    -- Rechnung (eigene) im abgeschlossenen Monat: 2 × 12 € zu 20 %
  v_r1    uuid;
  v_ls2   uuid;    -- Verkauf sofort (Spiegel) im abgeschlossenen Monat: 1 × 24 € zu 20 %
  v_r2    uuid;
  v_ls3   uuid;    -- Rechnung heute, an BMD übergeben: 3 × 11,30 € zu 13 %
  v_r3    uuid;
  v_ls4   uuid;    -- Rechnung heute (direkter Storno)
  v_r4    uuid;
  v_ls5   uuid;    -- Rechnung vorgestern mit Flaschen (Verkauf samt Rechnung, Datum gestern)
  v_r5    uuid;
  v_s1    uuid;
  v_txt   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ──────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_zu := (date_trunc('month', v_heute) - interval '2 months')::date + 9;
  UPDATE public.tenant_einstellungen SET buchhaltungsart = 'doppik' WHERE tenant_id = v_b;

  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);
  v_f := (pg_temp.s112_beispiel('fuellungen', v_b, v_bw, '{"bestand_flaschen": "100", "anzahl_flaschen": "100"}') ->> 'id')::uuid;
  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen, rechnung_spaeter) VALUES (v_b, v_zu, 'S112TEST KAN-379 alt', true) RETURNING id INTO v_ls1;
  EXECUTE format(c_pos, v_b, v_ls1, 'sonstiges', 'S112TEST Kiste', 2, 'Stk', 12, 20, NULL);
  v_r1 := public.s112_rechnung_erstellen(v_b, ARRAY[v_ls1], v_zu, '[]'::jsonb, NULL);
  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen) VALUES (v_b, v_zu, 'S112TEST KAN-379 sofort alt') RETURNING id INTO v_ls2;
  EXECUTE format(c_pos, v_b, v_ls2, 'sonstiges', 'S112TEST Sofort', 1, 'Stk', 24, 20, NULL);
  SELECT rechnung_id INTO v_r2 FROM public.verkaufsposten WHERE id = v_ls2;
  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen, rechnung_spaeter) VALUES (v_b, v_heute, 'S112TEST KAN-379 BMD', true) RETURNING id INTO v_ls3;
  EXECUTE format(c_pos, v_b, v_ls3, 'sonstiges', 'S112TEST Saft', 3, 'Stk', 11.30, 13, NULL);
  v_r3 := public.s112_rechnung_erstellen(v_b, ARRAY[v_ls3], v_heute, '[]'::jsonb, NULL);
  UPDATE public.rechnungen SET bmd_export_id = (pg_temp.s112_beispiel('buchhaltung_export_protokoll', v_b, NULL, '{}') ->> 'id')::uuid
   WHERE id = v_r3;
  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen, rechnung_spaeter) VALUES (v_b, v_heute, 'S112TEST KAN-379 direkt', true) RETURNING id INTO v_ls4;
  EXECUTE format(c_pos, v_b, v_ls4, 'sonstiges', 'S112TEST Direkt', 1, 'Stk', 5, 20, NULL);
  v_r4 := public.s112_rechnung_erstellen(v_b, ARRAY[v_ls4], v_heute, '[]'::jsonb, NULL);
  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen, rechnung_spaeter) VALUES (v_b, v_heute - 2, 'S112TEST KAN-379 Flaschen', true) RETURNING id INTO v_ls5;
  EXECUTE format(c_pos, v_b, v_ls5, 'flasche', 'S112TEST Flasche', 6, 'Stk', 'NULL', 13, v_f);   -- ohne Preis: zählt in keiner UVA
  v_r5 := public.s112_rechnung_erstellen(v_b, ARRAY[v_ls5], v_heute - 2, '[]'::jsonb, NULL);
  PERFORM pg_temp.s112_zeile('ea_monatsabschluss', v_b,
    jsonb_build_object('jahr', extract(year FROM v_zu)::int::text, 'monat', extract(month FROM v_zu)::int::text));
  PERFORM set_config('s112.loeschen_erlaubt', '', true);

  v_erg := v_erg || pg_temp.s112_erwarte('uva_alt_vorher', pg_temp.t86_uva(v_b, v_zu), '40.00|8.00|0.00');

  PERFORM pg_temp.s112_mutiere('ohne_momentaufnahme',
    $m$SELECT pg_temp.t86_ersetze('public.berechne_ea_uva(uuid, smallint, text)'::regprocedure,
      $r$AND o\.storniert AND o\.storniert_durch_id IS NOT NULL$r$, $r$AND false$r$)$m$);
  PERFORM pg_temp.s112_mutiere('ohne_gegenbuchung',
    $m$SELECT pg_temp.t86_ersetze('public.berechne_ea_uva(uuid, smallint, text)'::regprocedure,
      $r$AND s\.art = 'storno' AND s\.aktiv$r$, $r$AND false$r$)$m$);
  PERFORM pg_temp.s112_mutiere('ohne_datumspruefung',
    $m$SELECT pg_temp.t86_ersetze('public.s112_stornobeleg_anlegen(uuid, uuid, text, date)'::regprocedure,
      $r$IF NOT public\.s112_wartung_frei\(p_tenant_id\) THEN$r$, $r$IF false THEN$r$)$m$);

  -- ── 1. Ablehnungen: Leser, fremder Betrieb, Datum ─────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_abgelehnt',
    split_part(pg_temp.s112_fehlertext(format(c_sto, v_b, v_r1, 'S112TEST Leser darf nicht', v_heute)), ': ', 1), '42501');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb',
    split_part(pg_temp.s112_fehlertext(format(c_sto, v_m, v_r1, 'S112TEST fremder Betrieb', v_heute)), ': ', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('datum_gesperrt',
    pg_temp.s112_fehlertext(format(c_sto, v_b, v_r1, 'S112TEST Storno im alten Monat', v_zu + 1))
      ~ '^42501: Storno mit Datum .* nicht möglich: Monat .* abgeschlossen\..*HINT: periodensperre$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('datum_vor_rechnung',
    pg_temp.s112_fehlertext(format(c_sto, v_b, v_r1, 'S112TEST vor der Rechnung', v_zu - 1)) ~ '^23514: .*vor dem Rechnungsdatum.*HINT: storno_datum$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('datum_zukunft',
    pg_temp.s112_fehlertext(format(c_sto, v_b, v_r1, 'S112TEST in der Zukunft', v_heute + 1)) ~ '^23514: .*in der Zukunft.*HINT: storno_datum$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('abgelehnt_unveraendert',
    (SELECT concat_ws('|', r.storniert, r.storniert_durch_id IS NULL, (SELECT count(*) FROM public.rechnungen s WHERE s.tenant_id = v_b AND s.art = 'storno'))
       FROM public.rechnungen r WHERE r.id = v_r1), 'f|t|0');

  -- ── 2. Storno einer Rechnung im abgeschlossenen Monat: Stornobeleg heute, Original unverändert ─────────────
  v_erg := v_erg || pg_temp.s112_erwarte('storno_ok',
    pg_temp.s112_fehlertext(format(c_sto, v_b, v_r1, 'S112TEST Kunde hat zurückgegeben', v_heute)), 'ok');
  SELECT storniert_durch_id INTO v_s1 FROM public.rechnungen WHERE id = v_r1;
  v_erg := v_erg || pg_temp.s112_erwarte('beleg',
    (SELECT concat_ws('|', s.art, s.rechnungsnummer = 'ST-' || to_char(v_heute, 'YYYY') || '-0001', s.datum = v_heute, s.storno_von_id = v_r1,
                      s.storniert, s.notizen, r.storniert, r.datum = v_zu, r.storno_grund, jsonb_array_length(r.storno_positionen))
       FROM public.rechnungen s JOIN public.rechnungen r ON r.id = s.storno_von_id WHERE s.id = v_s1),
    'storno|t|t|t|f|S112TEST Kunde hat zurückgegeben|t|t|S112TEST Kunde hat zurückgegeben|1');
  v_erg := v_erg || pg_temp.s112_erwarte('lieferschein_wieder_offen',
    (SELECT concat_ws('|', v.rechnung_id IS NULL, v.storniert) FROM public.verkaufsposten v WHERE v.id = v_ls1), 't|f');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_zweimal',
    split_part(pg_temp.s112_fehlertext(format(c_sto, v_b, v_r1, 'S112TEST noch einmal', v_heute)), ': ', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('stornobeleg_nicht_stornierbar',
    pg_temp.s112_fehlertext(format(c_sto, v_b, v_s1, 'S112TEST Stornobeleg stornieren', v_heute)) ~ '^22023: .*ist ein Stornobeleg.*HINT: stornobeleg$', true);

  -- ── 3. Verkauf sofort (Spiegel) im abgeschlossenen Monat: Storno des Verkaufs → Stornobeleg heute ───────────
  v_erg := v_erg || pg_temp.s112_erwarte('spiegel_storno',
    pg_temp.s112_fehlertext(format('UPDATE public.verkaufsposten SET storniert = true, storno_grund = %L WHERE id = %L', 'S112TEST Verkauf falsch erfasst', v_ls2)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('spiegel_beleg',
    (SELECT concat_ws('|', r.storniert, r.datum = v_zu, s.rechnungsnummer = 'ST-' || to_char(v_heute, 'YYYY') || '-0002', s.datum = v_heute,
                      jsonb_array_length(r.storno_positionen))
       FROM public.rechnungen r JOIN public.rechnungen s ON s.id = r.storniert_durch_id WHERE r.id = v_r2), 't|t|t|t|1');

  -- ── 4. UVA: abgeschlossener Monat unverändert, laufender Monat um beide Stornos vermindert ──────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('uva_alt_unveraendert', pg_temp.t86_uva(v_b, v_zu), '40.00|8.00|0.00');
  -- laufender Monat: −20 (Stornobeleg 1) −20 (Stornobeleg 2) +4,17 (offene Rechnung 5 € zu 20 %); 13 %: BMD-Rechnung 30
  v_erg := v_erg || pg_temp.s112_erwarte('uva_neu_negativ', pg_temp.t86_uva(v_b, v_heute), '-35.83|-7.17|30.00');

  -- ── 5. An BMD übergebene Rechnung: stornierbar; Stornobeleg hebt sie in der UVA auf ─────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('bmd_storno_ok',
    pg_temp.s112_fehlertext(format(c_sto, v_b, v_r3, 'S112TEST nach BMD storniert', v_heute)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('uva_bmd_aufgehoben', split_part(pg_temp.t86_uva(v_b, v_heute), '|', 3), '0.00');

  -- ── 6. Direkt (ohne Stornobeleg) lehnt die Datenbank ab – auch für die Service-Role ohne Wartung ────────────
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_abgelehnt',
    pg_temp.s112_fehlertext(format('UPDATE public.rechnungen SET storniert = true WHERE id = %L', v_r4)) ~ '^42501: .*Stornobeleg.*HINT: stornobeleg$', true);
  PERFORM pg_temp.s112_als(v_bw);

  -- ── 7. Verkauf samt Rechnung mit Datum gestern: Stornobeleg und Flaschen-Rückbuchung am Storno-Datum ───────
  v_erg := v_erg || pg_temp.s112_erwarte('samt_rechnung_ok',
    pg_temp.s112_fehlertext(format('SELECT public.s112_verkauf_samt_rechnung_stornieren(%L::uuid, %L::uuid, %L, %L::date)',
      v_b, v_ls5, 'S112TEST Kunde hat storniert', v_heute - 1)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('samt_rechnung_datum',
    (SELECT concat_ws('|', s.datum = v_heute - 1,
       (SELECT count(*) FROM public.fuellung_bewegungen b WHERE b.fuellung_id = v_f AND b.verkaufsposten_id = v_ls5 AND b.art = 'verkauf_storno' AND b.datum = v_heute - 1))
       FROM public.rechnungen r JOIN public.rechnungen s ON s.id = r.storniert_durch_id WHERE r.id = v_r5), 't|1');
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 21);
END
$test$;
