-- @bereich: Gutschrift zur Rechnung (KAN-419 G1) – Teilberichtigung als eigener Beleg
-- @ziel: s112_gutschrift_anlegen legt zu einer Rechnung eine Gutschrift an (art 'gutschrift', Nummer GS-JJJJ-0001, Verweis
-- @ziel: auf die Rechnung, eigene Positionen als Momentaufnahme): einzelne Positionen bis zur Restmenge und/oder ein freier
-- @ziel: Betrag, anteilig auf die Steuersätze der Rechnung verteilt; alle Gutschriften zusammen höchstens der Rechnungsbetrag.
-- @ziel: Datum wie beim Storno (nicht vor der Rechnung, nicht in der Zukunft, nicht im abgeschlossenen Monat). Zahlungen und
-- @ziel: Gutschriften zusammen gleichen die Rechnung aus. Eine Rechnung mit Gutschrift und eine Gutschrift selbst lassen
-- @ziel: sich nicht stornieren. Leser, fremde Betriebe und direkte Änderungen sind abgelehnt.
-- @mutation ohne_obergrenze: Gutschriften dürfen den Rechnungsbetrag übersteigen | rot: betrag_zu_hoch
-- @mutation ohne_restmenge: je Position mehr als die Restmenge | rot: menge_zu_gross|menge_rest
-- @mutation ohne_datumspruefung: Gutschrift ohne eigene Prüfung des Zeitraums | rot: datum_gesperrt
-- @mutation ohne_gutschrift_im_abgleich: der Zahlungsabgleich kennt die Gutschriften nicht | rot: bezahlt_mit_gutschrift
-- @mutation storno_trotz_gutschrift: Rechnung mit Gutschrift lässt sich stornieren | rot: storno_gesperrt
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 04 (Stand 13.11.2026, KAN-419). Alles zurückgerollt.
-- Betrieb B: Monat „vor zwei Monaten“ abgeschlossen, laufender Monat offen.

CREATE FUNCTION pg_temp.t04_ersetze(p_fn regprocedure, p_alt text, p_neu text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text := replace(v_alt, p_alt, p_neu);
BEGIN
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't04_ersetze: Muster % greift nicht in %', p_alt, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

-- Summe der Gutschriften einer Rechnung aus den sichtbaren Belegen (die interne Funktion ist für Benutzer gesperrt)
CREATE FUNCTION pg_temp.t04_summe(p_rechnung uuid) RETURNS numeric LANGUAGE sql AS $f$
  SELECT coalesce(sum(round((x.pos ->> 'menge')::numeric * (x.pos ->> 'preis_brutto')::numeric, 2)), 0)::numeric(12, 2)
    FROM public.rechnungen g CROSS JOIN LATERAL jsonb_array_elements(g.gutschrift_positionen) AS x(pos)
   WHERE g.gutschrift_zu_id = p_rechnung AND g.art = 'gutschrift'
$f$;

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  c_datei constant text := '04_gutschrift';
  c_gs    constant text := 'SELECT public.s112_gutschrift_anlegen(%L::uuid, %L::uuid, %L::date, %L, %L::jsonb, %s, %L)';
  c_sto   constant text := 'SELECT public.s112_rechnung_stornieren(%L::uuid, %L::uuid, %L, %L::date)';
  c_pos   constant text := 'INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz, fuellung_id) VALUES (%L, %L, %L, %L, %s, %L, %s, %s, %L)';
  c_fn    constant regprocedure := 'public.s112_gutschrift_anlegen(uuid, uuid, date, text, jsonb, numeric, text)'::regprocedure;
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_m     uuid;
  v_zu    date;    -- Tag im abgeschlossenen Monat
  v_ls0   uuid;    -- Rechnung im abgeschlossenen Monat: 1 × 24 € zu 20 %
  v_r0    uuid;
  v_ls1   uuid;    -- Rechnung vor drei Tagen: 12 × 10 € zu 20 % und 6 × 11,30 € zu 13 % = 187,80 €
  v_r1    uuid;
  v_p1    uuid;
  v_p2    uuid;
  v_ls2   uuid;    -- Rechnung heute: 1 × 5 € zu 20 % (wird ganz gutgeschrieben)
  v_r2    uuid;
  v_p3    uuid;
  v_g1    uuid;
  v_g2    uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ───────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_zu := (date_trunc('month', v_heute) - interval '2 months')::date + 9;

  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);
  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen, rechnung_spaeter) VALUES (v_b, v_zu, 'S112TEST KAN-419 alt', true) RETURNING id INTO v_ls0;
  EXECUTE format(c_pos, v_b, v_ls0, 'sonstiges', 'S112TEST Alt', 1, 'Stk', 24, 20, NULL);
  v_r0 := public.s112_rechnung_erstellen(v_b, ARRAY[v_ls0], v_zu, '[]'::jsonb, NULL);
  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen, rechnung_spaeter) VALUES (v_b, v_heute - 3, 'S112TEST KAN-419', true) RETURNING id INTO v_ls1;
  EXECUTE format(c_pos, v_b, v_ls1, 'sonstiges', 'S112TEST Kiste', 12, 'Stk', 10, 20, NULL);
  EXECUTE format(c_pos, v_b, v_ls1, 'sonstiges', 'S112TEST Saft', 6, 'Stk', 11.30, 13, NULL);
  v_r1 := public.s112_rechnung_erstellen(v_b, ARRAY[v_ls1], v_heute - 3, '[]'::jsonb, NULL);
  SELECT id INTO v_p1 FROM public.verkauf_positionen WHERE verkaufsposten_id = v_ls1 AND name = 'S112TEST Kiste';
  SELECT id INTO v_p2 FROM public.verkauf_positionen WHERE verkaufsposten_id = v_ls1 AND name = 'S112TEST Saft';
  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen, rechnung_spaeter) VALUES (v_b, v_heute, 'S112TEST KAN-419 klein', true) RETURNING id INTO v_ls2;
  EXECUTE format(c_pos, v_b, v_ls2, 'sonstiges', 'S112TEST Klein', 1, 'Stk', 5, 20, NULL);
  v_r2 := public.s112_rechnung_erstellen(v_b, ARRAY[v_ls2], v_heute, '[]'::jsonb, NULL);
  SELECT id INTO v_p3 FROM public.verkauf_positionen WHERE verkaufsposten_id = v_ls2;
  PERFORM pg_temp.s112_zeile('ea_monatsabschluss', v_b,
    jsonb_build_object('jahr', extract(year FROM v_zu)::int::text, 'monat', extract(month FROM v_zu)::int::text));
  PERFORM set_config('s112.loeschen_erlaubt', '', true);

  PERFORM pg_temp.s112_mutiere('ohne_obergrenze',
    $m$SELECT pg_temp.t04_ersetze('public.s112_gutschrift_anlegen(uuid, uuid, date, text, jsonb, numeric, text)'::regprocedure,
      $r$IF v_gut + v_neu > v_gesamt THEN$r$, $r$IF false THEN$r$)$m$);
  PERFORM pg_temp.s112_mutiere('ohne_restmenge',
    $m$SELECT pg_temp.t04_ersetze('public.s112_gutschrift_anlegen(uuid, uuid, date, text, jsonb, numeric, text)'::regprocedure,
      $r$IF v_menge > coalesce(v_p.menge, 0) - v_bisher THEN$r$, $r$IF false THEN$r$)$m$);
  PERFORM pg_temp.s112_mutiere('ohne_datumspruefung',
    $m$SELECT pg_temp.t04_ersetze('public.s112_gutschrift_anlegen(uuid, uuid, date, text, jsonb, numeric, text)'::regprocedure,
      $r$IF NOT public.s112_wartung_frei(p_tenant_id) THEN$r$, $r$IF false THEN$r$)$m$);
  PERFORM pg_temp.s112_mutiere('ohne_gutschrift_im_abgleich',
    $m$SELECT pg_temp.t04_ersetze('public.sync_verkaufsposten_bezahlt()'::regprocedure,
      $r$v_gezahlt := v_gezahlt + public.s112_gutschrift_summe(v_tenant, v_re);$r$, $r$NULL;$r$)$m$);
  PERFORM pg_temp.s112_mutiere('storno_trotz_gutschrift',
    $m$SELECT pg_temp.t04_ersetze('public.s112_stornobeleg_anlegen(uuid, uuid, text, date)'::regprocedure,
      $r$IF EXISTS (SELECT 1 FROM public.rechnungen g WHERE g.gutschrift_zu_id = v_r.id$r$, $r$IF false AND EXISTS (SELECT 1 FROM public.rechnungen g WHERE g.gutschrift_zu_id = v_r.id$r$)$m$);

  -- ── 1. Rechte: nur angemeldet, nicht anonym; Leser und fremder Betrieb abgelehnt ────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('rechte',
    concat_ws('|', has_function_privilege('authenticated', c_fn, 'EXECUTE'), has_function_privilege('anon', c_fn, 'EXECUTE'),
      has_function_privilege('authenticated', 'public.s112_gutschrift_summe(uuid, uuid)', 'EXECUTE'),
      has_function_privilege('authenticated', 'public.s112_gutschriftnummer_ziehen(uuid, date)', 'EXECUTE')), 't|f|f|f');
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_abgelehnt',
    split_part(pg_temp.s112_fehlertext(format(c_gs, v_b, v_r1, v_heute, 'S112TEST Leser darf nicht', '[]', 5, NULL)), ': ', 1), '42501');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb',
    split_part(pg_temp.s112_fehlertext(format(c_gs, v_m, v_r1, v_heute, 'S112TEST fremder Betrieb', '[]', 5, NULL)), ': ', 1), '42501');

  -- ── 2. Eingaben: Grund, Datum, Positionen ──────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('grund_zu_kurz',
    split_part(pg_temp.s112_fehlertext(format(c_gs, v_b, v_r1, v_heute, 'zu kurz', '[]', 5, NULL)), ': ', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_inhalt',
    split_part(pg_temp.s112_fehlertext(format(c_gs, v_b, v_r1, v_heute, 'S112TEST ohne Inhalt', '[]', 'NULL', NULL)), ': ', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('datum_vor_rechnung',
    pg_temp.s112_fehlertext(format(c_gs, v_b, v_r1, v_heute - 4, 'S112TEST vor der Rechnung', '[]', 5, NULL)) ~ '^23514: .*vor dem Rechnungsdatum.*HINT: storno_datum$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('datum_zukunft',
    pg_temp.s112_fehlertext(format(c_gs, v_b, v_r1, v_heute + 1, 'S112TEST in der Zukunft', '[]', 5, NULL)) ~ '^23514: .*in der Zukunft.*HINT: storno_datum$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('datum_gesperrt',
    pg_temp.s112_fehlertext(format(c_gs, v_b, v_r0, v_zu + 1, 'S112TEST im alten Monat', '[]', 5, NULL))
      ~ '^42501: Gutschrift mit Datum .* nicht möglich: Monat .* abgeschlossen\..*HINT: periodensperre$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('position_fremd',
    split_part(pg_temp.s112_fehlertext(format(c_gs, v_b, v_r1, v_heute, 'S112TEST fremde Position', jsonb_build_array(jsonb_build_object('position_id', v_p3, 'menge', 1))::text, 'NULL', NULL)), ': ', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('position_doppelt',
    split_part(pg_temp.s112_fehlertext(format(c_gs, v_b, v_r1, v_heute, 'S112TEST doppelte Position',
      jsonb_build_array(jsonb_build_object('position_id', v_p1, 'menge', 1), jsonb_build_object('position_id', v_p1, 'menge', 1))::text, 'NULL', NULL)), ': ', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('menge_zu_gross',
    pg_temp.s112_fehlertext(format(c_gs, v_b, v_r1, v_heute, 'S112TEST zu viel', jsonb_build_array(jsonb_build_object('position_id', v_p1, 'menge', 13))::text, 'NULL', NULL))
      ~ '^23514: .*höchstens 12 gutschreibbar.*HINT: gutschrift_menge$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('abgelehnt_nichts_angelegt',
    (SELECT count(*) FROM public.rechnungen g WHERE g.tenant_id = v_b AND g.art = 'gutschrift'), 0);

  -- ── 3. Gutschrift über 2 von 12 Kisten: eigener Beleg, Rechnung bleibt offen ────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('gutschrift_ok',
    pg_temp.s112_fehlertext(format(c_gs, v_b, v_r1, v_heute - 1, 'S112TEST zwei Kisten beschädigt', jsonb_build_array(jsonb_build_object('position_id', v_p1, 'menge', 2))::text, 'NULL', NULL)), 'ok');
  SELECT id INTO v_g1 FROM public.rechnungen WHERE tenant_id = v_b AND art = 'gutschrift' AND gutschrift_zu_id = v_r1;
  v_erg := v_erg || pg_temp.s112_erwarte('beleg',
    (SELECT concat_ws('|', g.art, g.rechnungsnummer = 'GS-' || to_char(v_heute - 1, 'YYYY') || '-0001', g.datum = v_heute - 1, g.storniert, g.notizen,
                      jsonb_array_length(g.gutschrift_positionen), g.gutschrift_positionen -> 0 ->> 'menge', g.gutschrift_positionen -> 0 ->> 'preis_brutto',
                      g.gutschrift_positionen -> 0 ->> 'ust_satz', g.gutschrift_positionen -> 0 ->> 'position_id' = v_p1::text,
                      pg_temp.t04_summe(v_r1), r.bezahlt, r.storniert)
       FROM public.rechnungen g JOIN public.rechnungen r ON r.id = g.gutschrift_zu_id WHERE g.id = v_g1),
    'gutschrift|t|t|f|S112TEST zwei Kisten beschädigt|1|2|10.0000|20.00|t|20.00|f|f');
  v_erg := v_erg || pg_temp.s112_erwarte('menge_rest',
    pg_temp.s112_fehlertext(format(c_gs, v_b, v_r1, v_heute, 'S112TEST über den Rest', jsonb_build_array(jsonb_build_object('position_id', v_p1, 'menge', 11))::text, 'NULL', NULL))
      ~ '^23514: .*höchstens 10 gutschreibbar.*bereits gutgeschrieben 2.*HINT: gutschrift_menge$', true);

  -- ── 4. Freier Betrag 18,78 €: anteilig 6,78 € (13 %) und 12,00 € (20 %); Nummer fortlaufend ──────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('betrag_ok',
    pg_temp.s112_fehlertext(format(c_gs, v_b, v_r1, v_heute, 'S112TEST Treuebonus zum Jahresende', '[]', 18.78, 'S112TEST Bonus')), 'ok');
  SELECT id INTO v_g2 FROM public.rechnungen WHERE tenant_id = v_b AND art = 'gutschrift' AND gutschrift_zu_id = v_r1 AND id <> v_g1;
  v_erg := v_erg || pg_temp.s112_erwarte('betrag_aufgeteilt',
    (SELECT concat_ws('|', g.rechnungsnummer = 'GS-' || to_char(v_heute, 'YYYY') || '-0002',
       (SELECT string_agg(concat_ws(':', x.pos ->> 'ust_satz', (x.pos ->> 'preis_brutto')::numeric(12, 2), x.pos ->> 'name', x.pos ->> 'frei'), ',' ORDER BY (x.pos ->> 'ust_satz')::numeric)
          FROM jsonb_array_elements(g.gutschrift_positionen) AS x(pos)),
       pg_temp.t04_summe(v_r1))
       FROM public.rechnungen g WHERE g.id = v_g2),
    't|13.00:6.78:S112TEST Bonus:true,20.00:12.00:S112TEST Bonus:true|38.78');
  v_erg := v_erg || pg_temp.s112_erwarte('betrag_zu_hoch',
    pg_temp.s112_fehlertext(format(c_gs, v_b, v_r1, v_heute, 'S112TEST über dem Rest', '[]', 149.03, NULL))
      ~ '^23514: .*übersteigt den noch gutschreibbaren Betrag.*149,02 € von 187,80 €.*HINT: gutschrift_betrag$', true);

  -- ── 5. Zahlung über den Rest: Zahlungen + Gutschriften gleichen die Rechnung aus ─────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  INSERT INTO public.zahlungen (tenant_id, verkaufsposten_id, rechnung_id, betrag, art, datum) VALUES (v_b, v_ls1, v_r1, 149.02, 'bar', v_heute);
  v_erg := v_erg || pg_temp.s112_erwarte('bezahlt_mit_gutschrift',
    (SELECT concat_ws('|', r.bezahlt, (SELECT v.bezahlt FROM public.verkaufsposten v WHERE v.id = v_ls1)) FROM public.rechnungen r WHERE r.id = v_r1), 't|t');
  PERFORM pg_temp.s112_als(v_bw);

  -- ── 6. Rechnung ganz gutgeschrieben: ausgeglichen; weder Rechnung noch Gutschrift stornierbar ─────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('voll_ok',
    pg_temp.s112_fehlertext(format(c_gs, v_b, v_r2, v_heute, 'S112TEST ganze Rechnung erlassen', jsonb_build_array(jsonb_build_object('position_id', v_p3, 'menge', 1))::text, 'NULL', NULL)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('voll_ausgeglichen',
    (SELECT concat_ws('|', r.bezahlt, r.storniert, (SELECT v.bezahlt FROM public.verkaufsposten v WHERE v.id = v_ls2)) FROM public.rechnungen r WHERE r.id = v_r2), 't|f|t');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_gesperrt',
    pg_temp.s112_fehlertext(format(c_sto, v_b, v_r2, 'S112TEST Storno trotz Gutschrift', v_heute)) ~ '^22023: .*gibt es eine Gutschrift.*HINT: gutschrift$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('gutschrift_nicht_stornierbar',
    pg_temp.s112_fehlertext(format(c_sto, v_b, v_g1, 'S112TEST Gutschrift stornieren', v_heute)) ~ '^22023: .*', true);
  v_erg := v_erg || pg_temp.s112_erwarte('gutschrift_auf_gutschrift',
    split_part(pg_temp.s112_fehlertext(format(c_gs, v_b, v_g1, v_heute, 'S112TEST Gutschrift zur Gutschrift', '[]', 1, NULL)), ': ', 1), '22023');

  -- ── 7. Direkt ändern oder löschen: nichts ──────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_aendern',
    pg_temp.s112_versuch(format('UPDATE public.rechnungen SET gutschrift_positionen = %L::jsonb WHERE id = %L', '[{"menge": 1}]', v_g1)), 'G');   -- kein Schreibrecht auf rechnungen (nur über die RPC)
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_loeschen',
    pg_temp.s112_versuch(format('DELETE FROM public.rechnungen WHERE id = %L', v_g1)), 'G');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('art_und_verweis_gekoppelt',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.rechnungen SET gutschrift_zu_id = NULL WHERE id = %L', v_g1)), ': ', 1), '23514');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 27);
END
$test$;
