-- @bereich: Rechnung sofort oder später, getrennter Storno (KAN-103) – rechnung_spaeter, s112_rechnung_erstellen/_stornieren
-- @ziel: Ein Lieferschein mit „Rechnung später“ hat keine Rechnungsnummer und keine Rechnung. s112_rechnung_erstellen
-- @ziel: berechnet ihn (Nummer, Preise, Leistungszeitraum), auch mehrere eines Empfängers; ein berechneter Lieferschein lässt
-- @ziel: sich nicht stornieren. s112_rechnung_stornieren nur ohne gültige Zahlung; danach ist der Lieferschein wieder offen,
-- @ziel: die Rechnung behält ihre Nummer. Leser dürfen nicht; Spiegel-Rechnungen (sofort) stornieren wie bisher gemeinsam.
-- @mutation ohne_sperre: Storno-Sperre für berechnete Lieferscheine fehlt | rot: ls_storno_berechnet
-- @mutation storno_mit_zahlung: Rechnungsstorno prüft keine Zahlungen | rot: storno_mit_zahlung
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 70 (Stand 08.10.2026, KAN-103). Alles zurückgerollt.

CREATE FUNCTION pg_temp.t70_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't70_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  c_datei constant text := '70_rechnung_spaeter';
  c_erst  constant text := 'SELECT public.s112_rechnung_erstellen(%L::uuid, %L::uuid[], %L::date, %L::jsonb, NULL)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_k     uuid;
  v_ls1   uuid;
  v_ls2   uuid;
  v_ls3   uuid;
  v_ls4   uuid;
  v_sof   uuid;
  v_pos   uuid;
  v_re    uuid;
  v_re2   uuid;
  v_z     uuid;
  v_nr    text;
  v_m     uuid;
  v_mls   uuid;   -- Lieferschein im fremden Betrieb
  v_mre   uuid;   -- Rechnung im fremden Betrieb
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ──────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_k := (pg_temp.s112_beispiel('kontakte', v_b, NULL, '{"nachname": "S112TEST Kundin"}') ->> 'id')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_mls := (pg_temp.s112_beispiel('verkaufsposten', v_m, NULL, jsonb_build_object('datum', v_heute, 'storniert', false, 'rechnung_spaeter', true)) ->> 'id')::uuid;
  v_mre := public.s112_rechnung_erstellen(v_m, ARRAY[(pg_temp.s112_beispiel('verkaufsposten', v_m, NULL,
    jsonb_build_object('datum', v_heute, 'storniert', false, 'rechnung_spaeter', true)) ->> 'id')::uuid], v_heute, '[]'::jsonb, NULL);

  PERFORM pg_temp.s112_mutiere('ohne_sperre', $m$DROP TRIGGER a_lieferschein_storno_sperre ON public.verkaufsposten$m$);
  PERFORM pg_temp.s112_mutiere('storno_mit_zahlung',
    $m$SELECT pg_temp.t70_ersetze('public.s112_rechnung_stornieren(uuid, uuid, text)'::regprocedure,
      $r$IF EXISTS \(SELECT 1 FROM public\.zahlungen z WHERE z\.rechnung_id = p_rechnung_id AND z\.storniert_am IS NULL\) THEN$r$, $r$IF false THEN$r$)$m$);

  -- ── 1. Lieferschein „Rechnung später“: keine Nummer, keine Rechnung ───────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen, rechnung_spaeter) VALUES (v_b, v_heute - 3, 'S112TEST KAN-103 a', true)
    RETURNING id INTO v_ls1;
  INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz)
  VALUES (v_b, v_ls1, 'sonstiges', 'S112TEST Kiste', 2, 'Stk', 10, 20) RETURNING id INTO v_pos;
  v_erg := v_erg || pg_temp.s112_erwarte('spaeter_ohne_rechnung',
    (SELECT concat_ws('|', v.rechnungsnummer IS NULL, v.rechnung_id IS NULL, v.lieferscheinnummer IS NOT NULL) FROM public.verkaufsposten v WHERE v.id = v_ls1), 't|t|t');

  -- ── 2. Rechnung erstellen: Nummer, Preis aus der Rechnung, Leistungszeitraum ──────────────────────────
  v_re := public.s112_rechnung_erstellen(v_b, ARRAY[v_ls1], v_heute, jsonb_build_array(jsonb_build_object('position_id', v_pos, 'preis_brutto', 12)), NULL);
  v_erg := v_erg || pg_temp.s112_erwarte('rechnung_erstellt',
    (SELECT concat_ws('|', r.rechnungsnummer = v.rechnungsnummer, r.datum = v_heute, r.leistung_von = v_heute - 3, r.spiegel, r.storniert)
       FROM public.rechnungen r JOIN public.verkaufsposten v ON v.rechnung_id = r.id WHERE v.id = v_ls1 AND r.id = v_re), 't|t|t|f|f');
  v_erg := v_erg || pg_temp.s112_erwarte('preis_bei_rechnung',
    (SELECT p.preis_brutto::numeric(10, 2)::text FROM public.verkauf_positionen p WHERE p.id = v_pos), '12.00');
  v_erg := v_erg || pg_temp.s112_erwarte('doppelt_berechnen',
    split_part(pg_temp.s112_fehlertext(format(c_erst, v_b, ARRAY[v_ls1], v_heute, '[]')), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('ls_storno_berechnet',
    pg_temp.s112_versuch(format('UPDATE public.verkaufsposten SET storniert = true, storno_grund = %L WHERE id = %L', 'S112TEST falsch geliefert', v_ls1)), 'T');

  -- ── 3. Rechnungsstorno nur ohne Zahlung; danach Lieferschein wieder offen und stornierbar ──────────────
  INSERT INTO public.zahlungen (tenant_id, verkaufsposten_id, betrag, art, datum) VALUES (v_b, v_ls1, 24, 'bar', v_heute) RETURNING id INTO v_z;
  v_erg := v_erg || pg_temp.s112_erwarte('bezahlt_nach_zahlung',
    (SELECT r.bezahlt FROM public.rechnungen r WHERE r.id = v_re), true);
  v_erg := v_erg || pg_temp.s112_erwarte('storno_mit_zahlung',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_rechnung_stornieren(%L, %L, %L)', v_b, v_re, 'S112TEST Preis falsch')), ':', 1), '22023');
  PERFORM pg_temp.s112_als_postgres();
  PERFORM public.s112_zahlung_stornieren(v_b, v_z, 'S112TEST Zahlung zurück', v_heute);
  PERFORM pg_temp.s112_als(v_bw);
  SELECT rechnungsnummer INTO v_nr FROM public.rechnungen WHERE id = v_re;
  v_erg := v_erg || pg_temp.s112_erwarte('rechnung_storniert',
    pg_temp.s112_fehlertext(format('SELECT public.s112_rechnung_stornieren(%L, %L, %L)', v_b, v_re, 'S112TEST Preis falsch')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('ls_wieder_offen',
    (SELECT concat_ws('|', v.rechnung_id IS NULL, v.rechnungsnummer IS NULL, r.storniert, r.rechnungsnummer = v_nr)
       FROM public.verkaufsposten v, public.rechnungen r WHERE v.id = v_ls1 AND r.id = v_re), 't|t|t|t');
  v_erg := v_erg || pg_temp.s112_erwarte('ls_storno_offen_ok',
    pg_temp.s112_versuch(format('UPDATE public.verkaufsposten SET storniert = true, storno_grund = %L WHERE id = %L', 'S112TEST falsch geliefert', v_ls1)), 'k1');

  -- ── 4. Sammelrechnung: zwei Lieferscheine eines Kunden; verschiedene Kunden abgelehnt ──────────────────
  INSERT INTO public.verkaufsposten (tenant_id, datum, rechnung_spaeter, kontakt_id) VALUES (v_b, v_heute - 2, true, v_k) RETURNING id INTO v_ls2;
  INSERT INTO public.verkaufsposten (tenant_id, datum, rechnung_spaeter, kontakt_id) VALUES (v_b, v_heute - 1, true, v_k) RETURNING id INTO v_ls3;
  INSERT INTO public.verkaufsposten (tenant_id, datum, rechnung_spaeter) VALUES (v_b, v_heute - 1, true) RETURNING id INTO v_ls4;
  v_erg := v_erg || pg_temp.s112_erwarte('verschiedene_kunden',
    split_part(pg_temp.s112_fehlertext(format(c_erst, v_b, ARRAY[v_ls2, v_ls4], v_heute, '[]')), ':', 1), '22023');
  v_re2 := public.s112_rechnung_erstellen(v_b, ARRAY[v_ls2, v_ls3], v_heute, '[]'::jsonb, NULL);
  v_erg := v_erg || pg_temp.s112_erwarte('sammelrechnung',
    (SELECT concat_ws('|', count(*), min(r.leistung_von) = v_heute - 2, min(r.leistung_bis) = v_heute - 1)
       FROM public.verkaufsposten v JOIN public.rechnungen r ON r.id = v.rechnung_id WHERE r.id = v_re2), '2|t|t');

  -- ── 4b. Fremder Betrieb (IDOR): fremder Lieferschein bzw. fremde Rechnung unter dem eigenen Betrieb ─────
  v_erg := v_erg || pg_temp.s112_erwarte('idor_fremder_lieferschein',
    split_part(pg_temp.s112_fehlertext(format(c_erst, v_b, ARRAY[v_mls], v_heute, '[]')), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('idor_fremde_rechnung',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_rechnung_stornieren(%L, %L, %L)', v_b, v_mre, 'S112TEST fremde Rechnung')), ':', 1), 'P0002');

  -- ── 5. Leser dürfen nicht; „sofort“ storniert wie bisher Lieferschein und Rechnung ─────────────────────
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_nicht',
    split_part(pg_temp.s112_fehlertext(format(c_erst, v_b, ARRAY[v_ls4], v_heute, '[]')), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bw);
  INSERT INTO public.verkaufsposten (tenant_id, datum) VALUES (v_b, v_heute) RETURNING id INTO v_sof;
  UPDATE public.verkaufsposten SET storniert = true, storno_grund = 'S112TEST Ab-Hof falsch' WHERE id = v_sof;
  v_erg := v_erg || pg_temp.s112_erwarte('sofort_storno_gemeinsam',
    (SELECT concat_ws('|', r.spiegel, r.storniert) FROM public.rechnungen r JOIN public.verkaufsposten v ON v.rechnung_id = r.id WHERE v.id = v_sof), 't|t');
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 16);
END $test$;
