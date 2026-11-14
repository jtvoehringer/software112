-- @bereich: Gutschrift mit Rücknahme in den Bestand (KAN-452 G2)
-- @ziel: s112_gutschrift_anlegen nimmt je Position „ruecknahme“ an: Flaschen einer Füllung und Produkte mit Lagerbestand
-- @ziel: kommen in derselben Transaktion am Datum der Gutschrift zurück in den Bestand (Bewegungsart ruecknahme mit Verweis
-- @ziel: auf die Gutschrift, Flaschen samt Journalzeile in der Buchungsart des Verkaufs). Ohne Kennzeichen bleibt der
-- @ziel: Bestand unberührt. Tankwein, freie Positionen und Produkte ohne Lagerbestand sind abgelehnt, ebenso eine
-- @ziel: stornierte Füllung, ein deaktiviertes Produkt und ein Datum im abgeschlossenen Kellerbuch-Zeitraum – dann
-- @ziel: entsteht auch keine Gutschrift. Direkt lässt sich keine Rücknahme buchen.
-- @mutation ohne_rueckbuchung: die Gutschrift merkt die Rücknahme, bucht aber nichts | rot: flasche_bestand|flasche_bewegung|artikel_bestand|artikel_bewegung|journal_zeile|nach_abschluss_bestand
-- @mutation storniert_egal: Rücknahme in eine stornierte Füllung | rot: fuellung_storniert
-- @mutation ohne_kellerbuch_sperre: Rücknahme ohne eigene Prüfung des Kellerbuch-Abschlusses | rot: kellerbuch_gesperrt
-- @mutation journal_ohne_ruecknahme: das Journal bucht die Rücknahme nicht | rot: journal_zeile|journal_saldo
-- @mutation ohne_gutschrift_verweis: Rücknahme ohne Verweis auf die Gutschrift erlaubt | rot: verweis_pflicht
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 04 (Stand 14.11.2026, KAN-452). Alles zurückgerollt.
-- Betrieb B: Füllung mit 100 Flaschen, Produkt mit Lagerstand 20; Rechnung vor drei Tagen über 6 Flaschen, 4 Saft,
-- 2 Stück eines Produkts ohne Lagerbestand, 10 l Tankwein und eine freie Position.

CREATE FUNCTION pg_temp.t04r_ersetze(p_fn regprocedure, p_alt text, p_neu text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text := replace(v_alt, p_alt, p_neu);
BEGIN
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't04r_ersetze: Muster % greift nicht in %', p_alt, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

-- Differenz Ist − Journal der Füllung (0, wenn das Journal den Bestand trägt)
CREATE FUNCTION pg_temp.t04r_differenz(p_tenant uuid, p_fuellung uuid) RETURNS numeric LANGUAGE sql AS $f$
  SELECT coalesce((SELECT a.differenz FROM public.s112_journal_abweichungen(p_tenant) a WHERE a.art = 'fuellung' AND a.id = p_fuellung), 0)
$f$;

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  c_datei constant text := '04_gutschrift_ruecknahme';
  c_gs    constant text := 'SELECT public.s112_gutschrift_anlegen(%L::uuid, %L::uuid, %L::date, %L, %L::jsonb, NULL, NULL)';
  c_fn    constant text := 'public.s112_gutschrift_anlegen(uuid, uuid, date, text, jsonb, numeric, text)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_bta   uuid;
  v_m     uuid;
  v_f     uuid;    -- Füllung, 100 Flaschen
  v_art   uuid;    -- Produkt mit Lagerbestand (20)
  v_art0  uuid;    -- Produkt ohne Lagerbestand
  v_wa    uuid;
  v_ls    uuid;
  v_r     uuid;
  v_pf    uuid;    -- 6 Flaschen
  v_ps    uuid;    -- 4 Saft
  v_p0    uuid;    -- 2 × Produkt ohne Lagerbestand
  v_pt    uuid;    -- 10 l Tankwein
  v_px    uuid;    -- freie Position
  v_g1    uuid;
  v_g2    uuid;
  v_gm    uuid;    -- Rechnung im Betrieb M (Fremdverweis)
  v_diff  numeric;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ───────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);
  UPDATE public.tenant_einstellungen SET journal_ab = v_heute - 30 WHERE tenant_id = v_b;
  v_f := (pg_temp.s112_beispiel('fuellungen', v_b, v_bw, jsonb_build_object('bestand_flaschen', 100, 'anzahl_flaschen', 100,
    'flaschengroesse_ml', 750, 'aktiv', true, 'storniert_am', NULL, 'datum', v_heute - 20)) ->> 'id')::uuid;
  v_wa := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "300", "status": "ausbau", "aktiv": true, "storniert_am": null}') ->> 'id')::uuid;
  INSERT INTO public.sonstige_artikel (tenant_id, name, einheit, default_preis, bestand_fuehren) VALUES (v_b, 'S112TEST Saft', 'Stk', 5, true) RETURNING id INTO v_art;
  INSERT INTO public.sonstige_artikel (tenant_id, name, einheit, default_preis, bestand_fuehren) VALUES (v_b, 'S112TEST Karton', 'Stk', 2, false) RETURNING id INTO v_art0;
  INSERT INTO public.sonstige_artikel_bewegungen (tenant_id, artikel_id, datum, art, menge) VALUES (v_b, v_art, v_heute - 10, 'zugang', 20);

  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen, rechnung_spaeter) VALUES (v_b, v_heute - 3, 'S112TEST KAN-452', true) RETURNING id INTO v_ls;
  INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz, fuellung_id)
  VALUES (v_b, v_ls, 'flasche', 'S112TEST Wein', 6, 'Stk', 10, 20, v_f) RETURNING id INTO v_pf;
  INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz, sonstige_artikel_id)
  VALUES (v_b, v_ls, 'sonstiges', 'S112TEST Saft', 4, 'Stk', 5, 20, v_art) RETURNING id INTO v_ps;
  INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz, sonstige_artikel_id)
  VALUES (v_b, v_ls, 'sonstiges', 'S112TEST Karton', 2, 'Stk', 2, 20, v_art0) RETURNING id INTO v_p0;
  INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz, weinausbau_id)
  VALUES (v_b, v_ls, 'tank', 'S112TEST Tankwein', 10, 'L', 2, 20, v_wa) RETURNING id INTO v_pt;
  INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz)
  VALUES (v_b, v_ls, 'sonstiges', 'S112TEST Versand', 1, 'Stk', 3, 20) RETURNING id INTO v_px;
  PERFORM public.s112_fuellung_verkauf_buchen(v_b, v_f, v_ls, -6, v_heute - 3, NULL);
  PERFORM public.s112_artikel_verkauf_buchen(v_b, v_ls);
  v_r := public.s112_rechnung_erstellen(v_b, ARRAY[v_ls], v_heute - 3, '[]'::jsonb, NULL);
  v_gm := (pg_temp.s112_beispiel('rechnungen', v_m) ->> 'id')::uuid;
  PERFORM set_config('s112.loeschen_erlaubt', '', true);
  v_diff := pg_temp.t04r_differenz(v_b, v_f);

  PERFORM pg_temp.s112_mutiere('ohne_rueckbuchung',
    format($m$SELECT pg_temp.t04r_ersetze(%L::regprocedure, $r$ORDER BY p.fuellung_id NULLS LAST, p.sonstige_artikel_id, p.id$r$,
      $r$AND false ORDER BY p.fuellung_id NULLS LAST, p.sonstige_artikel_id, p.id$r$)$m$, c_fn));
  PERFORM pg_temp.s112_mutiere('storniert_egal',
    format($m$SELECT pg_temp.t04r_ersetze(%L::regprocedure, $r$AND coalesce(f.aktiv, true) AND f.storniert_am IS NULL;$r$, $r$;$r$)$m$, c_fn));
  PERFORM pg_temp.s112_mutiere('ohne_kellerbuch_sperre',
    format($m$SELECT pg_temp.t04r_ersetze(%L::regprocedure, $r$IF v_kb IS NOT NULL AND p_datum <= v_kb THEN$r$, $r$IF false THEN$r$)$m$, c_fn));
  PERFORM pg_temp.s112_mutiere('journal_ohne_ruecknahme',
    $m$SELECT pg_temp.t04r_ersetze('public.s112_journal_zeilen_flaschenbuchung(jsonb, integer)'::regprocedure,
      $r$IF v_stk = 0 OR v_art IN ('verkauf', 'verkauf_storno') THEN$r$, $r$IF v_stk = 0 OR v_art IN ('verkauf', 'verkauf_storno', 'ruecknahme') THEN$r$)$m$);
  PERFORM pg_temp.s112_mutiere('ohne_gutschrift_verweis',
    $m$ALTER TABLE public.fuellung_bewegungen DROP CONSTRAINT fuellung_bewegungen_gutschrift_check$m$);

  -- ── 1. Ausgangslage und Ablehnungen: nichts wird angelegt ───────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('ausgangslage',
    concat_ws('|', (SELECT bestand_flaschen FROM public.fuellungen WHERE id = v_f), (SELECT sum(x.menge)::numeric(12, 0) FROM public.sonstige_artikel_bewegungen x WHERE x.artikel_id = v_art)), '94|16');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('kennzeichen_ungueltig',
    split_part(pg_temp.s112_fehlertext(format(c_gs, v_b, v_r, v_heute, 'S112TEST Kennzeichen als Text',
      jsonb_build_array(jsonb_build_object('position_id', v_pf, 'menge', 1, 'ruecknahme', 'ja'))::text)), ': ', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('frei_abgelehnt',
    pg_temp.s112_fehlertext(format(c_gs, v_b, v_r, v_heute, 'S112TEST freie Position zurück',
      jsonb_build_array(jsonb_build_object('position_id', v_px, 'menge', 1, 'ruecknahme', true))::text))
      ~ '^22023: .*nur für Flaschen und für Produkte mit Lagerbestand.*HINT: ruecknahme$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('tank_abgelehnt',
    pg_temp.s112_fehlertext(format(c_gs, v_b, v_r, v_heute, 'S112TEST Tankwein zurück',
      jsonb_build_array(jsonb_build_object('position_id', v_pt, 'menge', 5, 'ruecknahme', true))::text))
      ~ '^22023: .*nicht für Tankwein.*HINT: ruecknahme$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_lagerbestand_abgelehnt',
    pg_temp.s112_fehlertext(format(c_gs, v_b, v_r, v_heute, 'S112TEST Karton zurück',
      jsonb_build_array(jsonb_build_object('position_id', v_p0, 'menge', 1, 'ruecknahme', true))::text))
      ~ '^22023: .*kein Lagerbestand geführt.*HINT: ruecknahme$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('flasche_nur_ganz',
    pg_temp.s112_fehlertext(format(c_gs, v_b, v_r, v_heute, 'S112TEST halbe Flasche zurück',
      jsonb_build_array(jsonb_build_object('position_id', v_pf, 'menge', 1.5, 'ruecknahme', true))::text))
      ~ '^23514: .*nur in ganzen Stück.*HINT: ruecknahme$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('abgelehnt_nichts_angelegt',
    concat_ws('|', (SELECT count(*) FROM public.rechnungen g WHERE g.tenant_id = v_b AND g.art = 'gutschrift'),
      (SELECT bestand_flaschen FROM public.fuellungen WHERE id = v_f),
      (SELECT count(*) FROM public.fuellung_bewegungen WHERE tenant_id = v_b AND art = 'ruecknahme')), '0|94|0');

  -- ── 2. Gutschrift gestern: 2 Flaschen und 1 Saft kommen zurück, der Tankwein wird nur gutgeschrieben ───────────
  v_erg := v_erg || pg_temp.s112_erwarte('ruecknahme_ok',
    pg_temp.s112_fehlertext(format(c_gs, v_b, v_r, v_heute - 1, 'S112TEST falsche Lieferung zurück',
      jsonb_build_array(jsonb_build_object('position_id', v_pf, 'menge', 2, 'ruecknahme', true),
                        jsonb_build_object('position_id', v_ps, 'menge', 1, 'ruecknahme', true),
                        jsonb_build_object('position_id', v_pt, 'menge', 1, 'ruecknahme', false))::text)), 'ok');
  SELECT id INTO v_g1 FROM public.rechnungen WHERE tenant_id = v_b AND art = 'gutschrift' AND gutschrift_zu_id = v_r;
  v_erg := v_erg || pg_temp.s112_erwarte('momentaufnahme',
    (SELECT string_agg(concat_ws(':', x.pos ->> 'name', x.pos ->> 'menge', x.pos ->> 'ruecknahme'), ',' ORDER BY x.pos ->> 'name')
       FROM public.rechnungen g CROSS JOIN LATERAL jsonb_array_elements(g.gutschrift_positionen) AS x(pos) WHERE g.id = v_g1),
    'S112TEST Saft:1:true,S112TEST Tankwein:1:false,S112TEST Wein:2:true');
  v_erg := v_erg || pg_temp.s112_erwarte('flasche_bestand', (SELECT bestand_flaschen FROM public.fuellungen WHERE id = v_f), 96);
  v_erg := v_erg || pg_temp.s112_erwarte('flasche_bewegung',
    (SELECT string_agg(concat_ws('|', b.art, b.menge_stk, b.bestand_vorher, b.bestand_nachher, b.datum = v_heute - 1, b.verkaufsposten_id = v_ls,
                      b.gutschrift_id = v_g1, b.grund = 'Rücknahme zu Gutschrift ' || (SELECT rechnungsnummer FROM public.rechnungen WHERE id = v_g1)), ';')
       FROM public.fuellung_bewegungen b WHERE b.tenant_id = v_b AND b.art = 'ruecknahme'),
    'ruecknahme|2|94|96|t|t|t|t');
  v_erg := v_erg || pg_temp.s112_erwarte('artikel_bestand', (SELECT sum(x.menge)::numeric(12, 0) FROM public.sonstige_artikel_bewegungen x WHERE x.artikel_id = v_art), 17);
  v_erg := v_erg || pg_temp.s112_erwarte('artikel_bewegung',
    (SELECT string_agg(concat_ws('|', b.art, b.menge::numeric(12, 0), b.datum = v_heute - 1, b.verkauf_position_id = v_ps, b.verkaufsposten_id = v_ls,
                      b.gutschrift_id = v_g1, b.notizen LIKE 'Rücknahme zu Gutschrift GS-%'), ';')
       FROM public.sonstige_artikel_bewegungen b WHERE b.tenant_id = v_b AND b.art = 'ruecknahme'),
    'ruecknahme|1|t|t|t|t|t');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('journal_zeile',
    (SELECT string_agg(concat_ws('|', k.buchungsart_code, k.bestand, k.menge_stk, k.menge_liter, k.datum = v_heute - 1, k.storno_von_id IS NULL,
                      k.hinweis LIKE 'Rücknahme zu Gutschrift GS-%'), ';')
       FROM public.kellerbuch_buchungen k JOIN public.fuellung_bewegungen b ON b.id = k.quelle_id
      WHERE k.tenant_id = v_b AND k.quelle_tabelle = 'fuellung_bewegungen' AND b.art = 'ruecknahme'),
    'VK_FL_AT|flasche|2|1.500|t|t|t');
  v_erg := v_erg || pg_temp.s112_erwarte('journal_saldo', pg_temp.t04r_differenz(v_b, v_f), v_diff);
  PERFORM pg_temp.s112_als(v_bw);

  -- ── 3. Ohne Kennzeichen bleibt der Bestand stehen ──────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_ruecknahme_ok',
    pg_temp.s112_fehlertext(format(c_gs, v_b, v_r, v_heute, 'S112TEST Bruch beim Kunden',
      jsonb_build_array(jsonb_build_object('position_id', v_pf, 'menge', 1), jsonb_build_object('position_id', v_ps, 'menge', 1))::text)), 'ok');
  SELECT id INTO v_g2 FROM public.rechnungen WHERE tenant_id = v_b AND art = 'gutschrift' AND gutschrift_zu_id = v_r AND id <> v_g1;
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_ruecknahme_bestand',
    concat_ws('|', (SELECT bestand_flaschen FROM public.fuellungen WHERE id = v_f), (SELECT sum(x.menge)::numeric(12, 0) FROM public.sonstige_artikel_bewegungen x WHERE x.artikel_id = v_art),
      (SELECT count(*) FROM public.fuellung_bewegungen WHERE tenant_id = v_b AND art = 'ruecknahme'),
      (SELECT bool_or((x.pos ->> 'ruecknahme')::boolean) FROM public.rechnungen g CROSS JOIN LATERAL jsonb_array_elements(g.gutschrift_positionen) AS x(pos) WHERE g.id = v_g2)),
    '96|17|1|f');

  -- ── 4. Füllung storniert bzw. Produkt deaktiviert: keine Rücknahme, keine Gutschrift ────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);
  UPDATE public.fuellungen SET aktiv = false WHERE id = v_f;
  UPDATE public.sonstige_artikel SET aktiv = false WHERE id = v_art;
  PERFORM set_config('s112.loeschen_erlaubt', '', true);
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('fuellung_storniert',
    pg_temp.s112_fehlertext(format(c_gs, v_b, v_r, v_heute, 'S112TEST in stornierte Füllung',
      jsonb_build_array(jsonb_build_object('position_id', v_pf, 'menge', 1, 'ruecknahme', true))::text))
      ~ '^22023: .*storniert bzw. nicht mehr aktiv.*ohne Rücknahme ausstellen.*HINT: ruecknahme$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('produkt_deaktiviert',
    pg_temp.s112_fehlertext(format(c_gs, v_b, v_r, v_heute, 'S112TEST in deaktiviertes Produkt',
      jsonb_build_array(jsonb_build_object('position_id', v_ps, 'menge', 1, 'ruecknahme', true))::text))
      ~ '^22023: .*Produkt ist deaktiviert.*HINT: ruecknahme$', true);
  PERFORM pg_temp.s112_als_postgres();
  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);
  UPDATE public.fuellungen SET aktiv = true WHERE id = v_f;
  UPDATE public.sonstige_artikel SET aktiv = true WHERE id = v_art;
  PERFORM set_config('s112.loeschen_erlaubt', '', true);

  -- ── 5. Direkt lässt sich keine Rücknahme buchen; Art und Verweis gehören zusammen; kein fremder Beleg ───────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_flasche',
    pg_temp.s112_fehlertext(format('INSERT INTO public.fuellung_bewegungen (tenant_id, fuellung_id, datum, art, menge_stk, verkaufsposten_id, gutschrift_id) VALUES (%L, %L, %L, %L, 1, %L, %L)',
      v_b, v_f, v_heute, 'ruecknahme', v_ls, v_g1)) <> 'ok', true);
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_artikel',
    pg_temp.s112_fehlertext(format('INSERT INTO public.sonstige_artikel_bewegungen (tenant_id, artikel_id, datum, art, menge, gutschrift_id) VALUES (%L, %L, %L, %L, 1, %L)',
      v_b, v_art, v_heute, 'ruecknahme', v_g1)) <> 'ok', true);
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('verweis_pflicht',
    split_part(pg_temp.s112_fehlertext(format('INSERT INTO public.fuellung_bewegungen (tenant_id, fuellung_id, datum, art, menge_stk, verkaufsposten_id) VALUES (%L, %L, %L, %L, 1, %L)',
      v_b, v_f, v_heute, 'ruecknahme', v_ls)), ': ', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('verweis_nur_ruecknahme',
    split_part(pg_temp.s112_fehlertext(format('INSERT INTO public.sonstige_artikel_bewegungen (tenant_id, artikel_id, datum, art, menge, gutschrift_id) VALUES (%L, %L, %L, %L, 1, %L)',
      v_b, v_art, v_heute, 'zugang', v_g1)), ': ', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('ruecknahme_nur_zugang',
    split_part(pg_temp.s112_fehlertext(format('INSERT INTO public.sonstige_artikel_bewegungen (tenant_id, artikel_id, datum, art, menge, gutschrift_id) VALUES (%L, %L, %L, %L, -1, %L)',
      v_b, v_art, v_heute, 'ruecknahme', v_g1)), ': ', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_beleg',
    pg_temp.s112_fehlertext(format('INSERT INTO public.sonstige_artikel_bewegungen (tenant_id, artikel_id, datum, art, menge, gutschrift_id) VALUES (%L, %L, %L, %L, 1, %L)',
      v_b, v_art, v_heute, 'ruecknahme', v_gm)) <> 'ok', true);

  -- ── 6. Kellerbuch bis gestern abgeschlossen: Rücknahme gestern abgelehnt, ohne Rücknahme bzw. heute möglich ──────
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('abschluss',
    pg_temp.s112_fehlertext(format('SELECT public.kellerbuch_abschliessen(%L, %L)', v_b, v_heute - 1)), 'ok');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('kellerbuch_gesperrt',
    pg_temp.s112_fehlertext(format(c_gs, v_b, v_r, v_heute - 1, 'S112TEST Rücknahme im Abschluss',
      jsonb_build_array(jsonb_build_object('position_id', v_pf, 'menge', 1, 'ruecknahme', true))::text))
      ~ '^42501: Rücknahme mit Datum .* nicht möglich: Das Kellerbuch ist bis .* abgeschlossen\..*ohne Rücknahme ausstellen\..*HINT: periodensperre$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('nach_abschluss_ohne_ruecknahme',
    pg_temp.s112_fehlertext(format(c_gs, v_b, v_r, v_heute - 1, 'S112TEST gestern ohne Rücknahme',
      jsonb_build_array(jsonb_build_object('position_id', v_pf, 'menge', 1))::text)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('nach_abschluss_heute',
    pg_temp.s112_fehlertext(format(c_gs, v_b, v_r, v_heute, 'S112TEST heute mit Rücknahme',
      jsonb_build_array(jsonb_build_object('position_id', v_pf, 'menge', 1, 'ruecknahme', true))::text)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('nach_abschluss_bestand', (SELECT bestand_flaschen FROM public.fuellungen WHERE id = v_f), 97);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 30);
END
$test$;
