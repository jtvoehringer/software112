-- @bereich: Storno einer Gutschrift (KAN-453 G3b)
-- @ziel: s112_gutschrift_stornieren hebt eine Gutschrift über einen Stornobeleg am Storno-Datum auf (art 'storno', Verweis
-- @ziel: auf die Gutschrift): Die Gutschrift bleibt in ihrem Zeitraum wirksam, der Stornobeleg bucht in seinem dagegen
-- @ziel: (Doppik-UVA neutral). Restmengen und Restbetrag der Rechnung werden wieder frei, „bezahlt“ wird neu berechnet,
-- @ziel: die Rechnung ist wieder stornierbar. Eine Rücknahme in den Bestand (KAN-452) wird am Storno-Datum zurückgebucht;
-- @ziel: reicht der Bestand nicht oder liegt das Datum im abgeschlossenen Kellerbuch-Zeitraum, wird der Storno abgelehnt.
-- @ziel: Leser, fremde Betriebe, Rechnungen und Stornobelege sind abgelehnt; direkt lässt sich nichts stornieren.
-- @mutation ohne_rueckbuchung: der Storno lässt die zurückgenommene Ware im Bestand | rot: flasche_bestand|flasche_bewegung|journal_zeile
-- @mutation bestand_egal: Storno ohne Prüfung, ob die Ware noch da ist | rot: bestand_zu_klein
-- @mutation storniert_zaehlt_weiter: die stornierte Gutschrift mindert weiter den offenen Betrag | rot: bezahlt_nach_storno
-- @mutation restmenge_gesperrt: die stornierte Gutschrift belegt weiter die Restmenge | rot: restmenge_frei
-- @mutation rechnung_bleibt_gesperrt: Rechnung nach dem Storno ihrer Gutschrift nicht stornierbar | rot: rechnung_wieder_stornierbar
-- @mutation ohne_kellerbuch_sperre: Storno ohne eigene Prüfung des Kellerbuch-Abschlusses | rot: kellerbuch_gesperrt
-- @mutation uva_ohne_steuerfall_frei: der Stornobeleg zu einer Gutschrift fehlt in der UVA | rot: uva_neutral
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 04 (Stand 14.11.2026, KAN-453). Alles zurückgerollt.
-- Betrieb B (Doppik): Füllung mit 100 Flaschen, Produkt mit Lagerstand 20; Rechnung heute über 6 Flaschen, 4 Saft und eine
-- freie Position; zweite Rechnung über eine freie Position (wird ganz gutgeschrieben).

CREATE FUNCTION pg_temp.t04s_ersetze(p_fn regprocedure, p_alt text, p_neu text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text := replace(v_alt, p_alt, p_neu);
BEGIN
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't04s_ersetze: Muster % greift nicht in %', p_alt, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

CREATE FUNCTION pg_temp.t04s_differenz(p_tenant uuid, p_fuellung uuid) RETURNS numeric LANGUAGE sql AS $f$
  SELECT coalesce((SELECT a.differenz FROM public.s112_journal_abweichungen(p_tenant) a WHERE a.art = 'fuellung' AND a.id = p_fuellung), 0)
$f$;

-- Bemessungsgrundlage und Steuer zu 20 % im Monat des Tages (Doppik-UVA)
CREATE FUNCTION pg_temp.t04s_uva(p_tenant uuid, p_tag date) RETURNS text LANGUAGE sql AS $f$
  SELECT concat_ws('|', u.bmgl_20::numeric(12, 2), u.ust_20::numeric(12, 2))
  FROM public.berechne_ea_uva(p_tenant, extract(year FROM p_tag)::smallint, to_char(p_tag, 'MM')) u
$f$;

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  c_datei constant text := '04_gutschrift_storno';
  c_gs    constant text := 'SELECT public.s112_gutschrift_anlegen(%L::uuid, %L::uuid, %L::date, %L, %L::jsonb, NULL, NULL)';
  c_st    constant text := 'SELECT public.s112_gutschrift_stornieren(%L::uuid, %L::uuid, %L, %L::date)';
  c_fn    constant text := 'public.s112_gutschrift_stornieren(uuid, uuid, text, date)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_bta   uuid;
  v_m     uuid;
  v_f     uuid;
  v_art   uuid;
  v_ls    uuid;
  v_r     uuid;
  v_pf    uuid;
  v_ps    uuid;
  v_px    uuid;
  v_ls2   uuid;
  v_r2    uuid;
  v_p2    uuid;
  v_g1    uuid;    -- Gutschrift mit Rücknahme (2 Flaschen, 1 Saft) und freier Position
  v_s1    uuid;    -- ihr Stornobeleg
  v_g2    uuid;    -- Gutschrift über die ganze zweite Rechnung
  v_g3    uuid;    -- Gutschrift gestern mit Rücknahme (Kellerbuch-Abschluss)
  v_diff  numeric;
  v_uva   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ───────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);
  UPDATE public.tenant_einstellungen SET buchhaltungsart = 'doppik', journal_ab = v_heute - 30 WHERE tenant_id = v_b;
  v_f := (pg_temp.s112_beispiel('fuellungen', v_b, v_bw, jsonb_build_object('bestand_flaschen', 100, 'anzahl_flaschen', 100,
    'flaschengroesse_ml', 750, 'aktiv', true, 'storniert_am', NULL, 'datum', v_heute - 20)) ->> 'id')::uuid;
  INSERT INTO public.sonstige_artikel (tenant_id, name, einheit, default_preis, bestand_fuehren) VALUES (v_b, 'S112TEST Saft', 'Stk', 5, true) RETURNING id INTO v_art;
  INSERT INTO public.sonstige_artikel_bewegungen (tenant_id, artikel_id, datum, art, menge) VALUES (v_b, v_art, v_heute - 10, 'zugang', 20);

  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen, rechnung_spaeter) VALUES (v_b, v_heute - 3, 'S112TEST KAN-453', true) RETURNING id INTO v_ls;
  INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz, fuellung_id)
  VALUES (v_b, v_ls, 'flasche', 'S112TEST Wein', 6, 'Stk', 12, 20, v_f) RETURNING id INTO v_pf;
  INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz, sonstige_artikel_id)
  VALUES (v_b, v_ls, 'sonstiges', 'S112TEST Saft', 4, 'Stk', 6, 20, v_art) RETURNING id INTO v_ps;
  INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz)
  VALUES (v_b, v_ls, 'sonstiges', 'S112TEST Versand', 1, 'Stk', 6, 20) RETURNING id INTO v_px;
  PERFORM public.s112_fuellung_verkauf_buchen(v_b, v_f, v_ls, -6, v_heute - 3, NULL);
  PERFORM public.s112_artikel_verkauf_buchen(v_b, v_ls);
  v_r := public.s112_rechnung_erstellen(v_b, ARRAY[v_ls], v_heute - 3, '[]'::jsonb, NULL);
  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen, rechnung_spaeter) VALUES (v_b, v_heute, 'S112TEST KAN-453 klein', true) RETURNING id INTO v_ls2;
  INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz)
  VALUES (v_b, v_ls2, 'sonstiges', 'S112TEST Klein', 1, 'Stk', 6, 20) RETURNING id INTO v_p2;
  v_r2 := public.s112_rechnung_erstellen(v_b, ARRAY[v_ls2], v_heute, '[]'::jsonb, NULL);
  PERFORM set_config('s112.loeschen_erlaubt', '', true);
  v_diff := pg_temp.t04s_differenz(v_b, v_f);

  PERFORM pg_temp.s112_mutiere('ohne_rueckbuchung',
    format($m$SELECT pg_temp.t04s_ersetze(%L::regprocedure, $r$GROUP BY b.fuellung_id, b.verkaufsposten_id$r$, $r$AND false GROUP BY b.fuellung_id, b.verkaufsposten_id$r$)$m$, c_fn));
  PERFORM pg_temp.s112_mutiere('bestand_egal',
    format($m$SELECT pg_temp.t04s_ersetze(%L::regprocedure, $r$IF v_alt - v_b.stk < greatest(v_res, 0) THEN$r$, $r$IF false THEN$r$)$m$, c_fn));
  PERFORM pg_temp.s112_mutiere('storniert_zaehlt_weiter',
    $m$SELECT pg_temp.t04s_ersetze('public.s112_gutschrift_summe(uuid, uuid)'::regprocedure, $r$AND g.aktiv AND NOT g.storniert$r$, $r$AND g.aktiv$r$)$m$);
  PERFORM pg_temp.s112_mutiere('restmenge_gesperrt',
    $m$SELECT pg_temp.t04s_ersetze('public.s112_gutschrift_anlegen(uuid, uuid, date, text, jsonb, numeric, text)'::regprocedure,
      $r$AND g.art = 'gutschrift' AND g.aktiv AND NOT g.storniert$r$, $r$AND g.art = 'gutschrift' AND g.aktiv$r$)$m$);
  PERFORM pg_temp.s112_mutiere('rechnung_bleibt_gesperrt',
    $m$SELECT pg_temp.t04s_ersetze('public.s112_stornobeleg_anlegen(uuid, uuid, text, date)'::regprocedure,
      $r$AND g.aktiv AND NOT g.storniert) THEN$r$, $r$AND g.aktiv) THEN$r$)$m$);
  PERFORM pg_temp.s112_mutiere('ohne_kellerbuch_sperre',
    format($m$SELECT pg_temp.t04s_ersetze(%L::regprocedure, $r$IF v_kb IS NOT NULL AND v_datum <= v_kb THEN$r$, $r$IF false THEN$r$)$m$, c_fn));
  PERFORM pg_temp.s112_mutiere('uva_ohne_steuerfall_frei',
    $m$SELECT pg_temp.t04s_ersetze('public.berechne_ea_uva(uuid, smallint, text)'::regprocedure,
      $r$WHERE v_doppik AND s.tenant_id = p_tenant_id AND s.art = 'storno' AND s.aktiv$r$,
      $r$WHERE v_doppik AND s.tenant_id = p_tenant_id AND s.art = 'storno' AND s.aktiv AND o.art = 'rechnung'$r$)$m$);

  -- ── 1. Rechte ──────────────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('rechte',
    concat_ws('|', has_function_privilege('authenticated', c_fn::regprocedure, 'EXECUTE'), has_function_privilege('anon', c_fn::regprocedure, 'EXECUTE')), 't|f');
  v_uva := pg_temp.t04s_uva(v_b, v_heute);

  -- ── 2. Gutschrift heute: 2 Flaschen und 1 Saft kommen zurück, dazu die freie Position ─────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('gutschrift_ok',
    pg_temp.s112_fehlertext(format(c_gs, v_b, v_r, v_heute, 'S112TEST falsche Lieferung zurück',
      jsonb_build_array(jsonb_build_object('position_id', v_pf, 'menge', 2, 'ruecknahme', true),
                        jsonb_build_object('position_id', v_ps, 'menge', 1, 'ruecknahme', true),
                        jsonb_build_object('position_id', v_px, 'menge', 1))::text)), 'ok');
  SELECT id INTO v_g1 FROM public.rechnungen WHERE tenant_id = v_b AND art = 'gutschrift' AND gutschrift_zu_id = v_r;
  v_erg := v_erg || pg_temp.s112_erwarte('nach_gutschrift',
    concat_ws('|', (SELECT bestand_flaschen FROM public.fuellungen WHERE id = v_f),
      (SELECT sum(x.menge)::numeric(12, 0) FROM public.sonstige_artikel_bewegungen x WHERE x.artikel_id = v_art),
      pg_temp.t04s_uva(v_b, v_heute) <> v_uva), '96|17|t');

  -- ── 3. Ablehnungen: Rollen, Betrieb, Grund, Datum, falscher Beleg ───────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_abgelehnt',
    split_part(pg_temp.s112_fehlertext(format(c_st, v_b, v_g1, 'S112TEST Leser darf nicht', v_heute)), ': ', 1), '42501');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb',
    split_part(pg_temp.s112_fehlertext(format(c_st, v_m, v_g1, 'S112TEST fremder Betrieb', v_heute)), ': ', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('grund_zu_kurz',
    split_part(pg_temp.s112_fehlertext(format(c_st, v_b, v_g1, 'zu kurz', v_heute)), ': ', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('datum_vor_gutschrift',
    pg_temp.s112_fehlertext(format(c_st, v_b, v_g1, 'S112TEST vor der Gutschrift', v_heute - 1)) ~ '^23514: .*vor dem Datum der Gutschrift.*HINT: storno_datum$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('datum_zukunft',
    pg_temp.s112_fehlertext(format(c_st, v_b, v_g1, 'S112TEST in der Zukunft', v_heute + 1)) ~ '^23514: .*in der Zukunft.*HINT: storno_datum$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('rechnung_ist_keine_gutschrift',
    split_part(pg_temp.s112_fehlertext(format(c_st, v_b, v_r, 'S112TEST Rechnung statt Gutschrift', v_heute)), ': ', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('rechnungsstorno_lehnt_gutschrift_ab',
    pg_temp.s112_fehlertext(format('SELECT public.s112_rechnung_stornieren(%L::uuid, %L::uuid, %L, %L::date)', v_b, v_g1, 'S112TEST falscher Weg', v_heute))
      ~ '^22023: .*über „Gutschrift stornieren“.*HINT: gutschrift$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_stornieren',
    pg_temp.s112_versuch(format('UPDATE public.rechnungen SET storniert = true WHERE id = %L', v_g1)), 'G');

  -- ── 4. Die zurückgenommene Ware ist nicht mehr da: Storno abgelehnt, nichts geändert ──────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  PERFORM public.fuellung_bestand_buchen(v_b, v_f, 'bruch', v_heute, -95, NULL, 'S112TEST Bruch');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('bestand_zu_klein',
    pg_temp.s112_fehlertext(format(c_st, v_b, v_g1, 'S112TEST Ware schon wieder weg', v_heute))
      ~ '^22023: .*nicht mehr im Bestand \(Bestand 1, .*zurückzubuchen 2\).*HINT: ruecknahme_bestand$', true);
  PERFORM pg_temp.s112_als_postgres();
  PERFORM public.fuellung_bestand_buchen(v_b, v_f, 'korrektur', v_heute, 95, NULL, 'S112TEST zurück');
  INSERT INTO public.sonstige_artikel_bewegungen (tenant_id, artikel_id, datum, art, menge) VALUES (v_b, v_art, v_heute, 'inventur', -17);
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('lager_zu_klein',
    pg_temp.s112_fehlertext(format(c_st, v_b, v_g1, 'S112TEST Saft schon wieder weg', v_heute))
      ~ '^22023: .*nicht mehr auf Lager \(Lagerstand 0, zurückzubuchen 1\).*HINT: ruecknahme_bestand$', true);
  PERFORM pg_temp.s112_als_postgres();
  INSERT INTO public.sonstige_artikel_bewegungen (tenant_id, artikel_id, datum, art, menge) VALUES (v_b, v_art, v_heute, 'inventur', 17);
  v_diff := pg_temp.t04s_differenz(v_b, v_f);
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('abgelehnt_nichts_geaendert',
    concat_ws('|', (SELECT storniert FROM public.rechnungen WHERE id = v_g1), (SELECT count(*) FROM public.rechnungen WHERE tenant_id = v_b AND art = 'storno'),
      (SELECT bestand_flaschen FROM public.fuellungen WHERE id = v_f)), 'f|0|96');

  -- ── 5. Storno heute: Stornobeleg, Gutschrift storniert, Ware wieder ab, UVA wie vor der Gutschrift ─────────────
  v_erg := v_erg || pg_temp.s112_erwarte('storno_ok',
    pg_temp.s112_fehlertext(format(c_st, v_b, v_g1, 'S112TEST Gutschrift war ein Irrtum', v_heute)), 'ok');
  SELECT id INTO v_s1 FROM public.rechnungen WHERE tenant_id = v_b AND art = 'storno' AND storno_von_id = v_g1;
  v_erg := v_erg || pg_temp.s112_erwarte('stornobeleg',
    (SELECT concat_ws('|', s.art, s.rechnungsnummer ~ '^ST-[0-9]{4}-[0-9]+$', s.datum = v_heute, s.notizen, s.storniert, s.aktiv)
       FROM public.rechnungen s WHERE s.id = v_s1), 'storno|t|t|S112TEST Gutschrift war ein Irrtum|f|t');
  v_erg := v_erg || pg_temp.s112_erwarte('gutschrift_storniert',
    (SELECT concat_ws('|', g.storniert, g.aktiv, g.storniert_durch_id = v_s1, g.storno_grund, jsonb_array_length(g.storno_positionen),
              (SELECT sum((x.pos ->> 'menge')::numeric)::numeric(12, 0) FROM jsonb_array_elements(g.storno_positionen) AS x(pos)),
              (SELECT sum((x.pos ->> 'menge')::numeric)::numeric(12, 0) FROM jsonb_array_elements(g.gutschrift_positionen) AS x(pos)))
       FROM public.rechnungen g WHERE g.id = v_g1), 't|t|t|S112TEST Gutschrift war ein Irrtum|3|-4|4');
  v_erg := v_erg || pg_temp.s112_erwarte('flasche_bestand', (SELECT bestand_flaschen FROM public.fuellungen WHERE id = v_f), 94);
  v_erg := v_erg || pg_temp.s112_erwarte('flasche_bewegung',
    (SELECT string_agg(concat_ws('|', b.art, b.menge_stk, b.bestand_vorher, b.bestand_nachher, b.datum = v_heute, b.verkaufsposten_id = v_ls,
                      b.gutschrift_id = v_g1, b.grund LIKE 'Storno der Rücknahme zu Gutschrift GS-%(ST-%)'), ';')
       FROM public.fuellung_bewegungen b WHERE b.tenant_id = v_b AND b.art = 'ruecknahme_storno'),
    'ruecknahme_storno|-2|96|94|t|t|t|t');
  v_erg := v_erg || pg_temp.s112_erwarte('artikel_bestand',
    (SELECT sum(x.menge)::numeric(12, 0) FROM public.sonstige_artikel_bewegungen x WHERE x.artikel_id = v_art), 16);
  v_erg := v_erg || pg_temp.s112_erwarte('artikel_bewegung',
    (SELECT string_agg(concat_ws('|', s.art, s.menge::numeric(12, 0), s.datum = v_heute, o.art, o.gutschrift_id = v_g1, s.gutschrift_id IS NULL), ';')
       FROM public.sonstige_artikel_bewegungen s JOIN public.sonstige_artikel_bewegungen o ON o.id = s.storno_von_id
      WHERE s.tenant_id = v_b AND s.art = 'storno'), 'storno|-1|t|ruecknahme|t|t');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('journal_zeile',
    (SELECT string_agg(concat_ws('|', k.buchungsart_code, k.menge_stk, k.menge_liter, k.datum = v_heute, k.hinweis LIKE 'Storno der Rücknahme zu Gutschrift GS-%'), ';')
       FROM public.kellerbuch_buchungen k JOIN public.fuellung_bewegungen b ON b.id = k.quelle_id
      WHERE k.tenant_id = v_b AND k.quelle_tabelle = 'fuellung_bewegungen' AND b.art = 'ruecknahme_storno'),
    'VK_FL_AT|-2|-1.500|t|t');
  v_erg := v_erg || pg_temp.s112_erwarte('journal_saldo', pg_temp.t04s_differenz(v_b, v_f), v_diff);
  v_erg := v_erg || pg_temp.s112_erwarte('uva_neutral', pg_temp.t04s_uva(v_b, v_heute), v_uva);
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('zweimal',
    pg_temp.s112_fehlertext(format(c_st, v_b, v_g1, 'S112TEST noch einmal stornieren', v_heute)) ~ '^22023: .*bereits storniert', true);
  v_erg := v_erg || pg_temp.s112_erwarte('stornobeleg_nicht_stornierbar',
    split_part(pg_temp.s112_fehlertext(format(c_st, v_b, v_s1, 'S112TEST Stornobeleg stornieren', v_heute)), ': ', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('restmenge_frei',
    pg_temp.s112_fehlertext(format(c_gs, v_b, v_r, v_heute, 'S112TEST über der Menge',
      jsonb_build_array(jsonb_build_object('position_id', v_pf, 'menge', 7))::text))
      ~ '^23514: .*höchstens 6 gutschreibbar \(verrechnet 6, bereits gutgeschrieben 0\)', true);

  -- ── 5b. Gutschrift gestern mit Rücknahme, Kellerbuch bis gestern abgeschlossen: Storno gestern abgelehnt, heute möglich ──
  v_erg := v_erg || pg_temp.s112_erwarte('gutschrift_gestern',
    pg_temp.s112_fehlertext(format(c_gs, v_b, v_r, v_heute - 1, 'S112TEST eine Flasche zurück',
      jsonb_build_array(jsonb_build_object('position_id', v_pf, 'menge', 1, 'ruecknahme', true))::text)), 'ok');
  SELECT id INTO v_g3 FROM public.rechnungen WHERE tenant_id = v_b AND art = 'gutschrift' AND gutschrift_zu_id = v_r AND NOT storniert;
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('abschluss',
    pg_temp.s112_fehlertext(format('SELECT public.kellerbuch_abschliessen(%L, %L)', v_b, v_heute - 1)), 'ok');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('kellerbuch_gesperrt',
    pg_temp.s112_fehlertext(format(c_st, v_b, v_g3, 'S112TEST Storno im Abschluss', v_heute - 1))
      ~ '^42501: Storno mit Datum .* nicht möglich: Das Kellerbuch ist bis .* abgeschlossen, und die Gutschrift hat Flaschen.*HINT: periodensperre$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('nach_abschluss_heute',
    pg_temp.s112_fehlertext(format(c_st, v_b, v_g3, 'S112TEST Storno nach dem Abschluss', v_heute)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('nach_abschluss_bestand', (SELECT bestand_flaschen FROM public.fuellungen WHERE id = v_f), 94);
  v_erg := v_erg || pg_temp.s112_erwarte('rechnung_wieder_stornierbar',
    pg_temp.s112_fehlertext(format('SELECT public.s112_rechnung_stornieren(%L::uuid, %L::uuid, %L, %L::date)', v_b, v_r, 'S112TEST Rechnung doch stornieren', v_heute)), 'ok');

  -- ── 6. Ganz gutgeschriebene Rechnung gilt als ausgeglichen – nach dem Storno der Gutschrift wieder offen ────────
  v_erg := v_erg || pg_temp.s112_erwarte('voll_ok',
    pg_temp.s112_fehlertext(format(c_gs, v_b, v_r2, v_heute, 'S112TEST ganze Rechnung erlassen',
      jsonb_build_array(jsonb_build_object('position_id', v_p2, 'menge', 1))::text)), 'ok');
  SELECT id INTO v_g2 FROM public.rechnungen WHERE tenant_id = v_b AND art = 'gutschrift' AND gutschrift_zu_id = v_r2;
  v_erg := v_erg || pg_temp.s112_erwarte('bezahlt_mit_gutschrift',
    (SELECT concat_ws('|', r.bezahlt, (SELECT v.bezahlt FROM public.verkaufsposten v WHERE v.id = v_ls2)) FROM public.rechnungen r WHERE r.id = v_r2), 't|t');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_ohne_ruecknahme',
    pg_temp.s112_fehlertext(format(c_st, v_b, v_g2, 'S112TEST Erlass war ein Irrtum', NULL)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('bezahlt_nach_storno',
    (SELECT concat_ws('|', r.bezahlt, (SELECT v.bezahlt FROM public.verkaufsposten v WHERE v.id = v_ls2),
              (SELECT s.datum = v_heute FROM public.rechnungen s WHERE s.storno_von_id = v_g2)) FROM public.rechnungen r WHERE r.id = v_r2), 'f|f|t');

  -- ── 7. Der Stornobeleg bleibt endgültig ─────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('stornobeleg_endgueltig',
    pg_temp.s112_fehlertext(format('UPDATE public.rechnungen SET storniert = true WHERE id = %L', v_s1)) <> 'ok', true);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 38);
END
$test$;
