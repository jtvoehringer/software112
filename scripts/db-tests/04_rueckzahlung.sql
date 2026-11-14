-- @bereich: Rückzahlung am Guthaben einer Rechnung (KAN-453 G3c)
-- @ziel: s112_rueckzahlung_erfassen bucht eine Rückzahlung als negative Zahlung an der Rechnung – höchstens das Guthaben
-- @ziel: (Zahlungen + Gutschriften über dem Rechnungsbetrag), auch in Teilen; Datum nicht vor der Rechnung, nicht in der
-- @ziel: Zukunft, nicht im abgeschlossenen Monat. Direkt lässt sich kein negativer Betrag buchen, ein Betrag 0 nie. Die
-- @ziel: Rechnung bleibt ausgeglichen. Eine Gutschrift, zu deren Rechnung es eine Rückzahlung gibt, lässt sich nicht
-- @ziel: stornieren; nach dem Storno der Rückzahlung ist das Guthaben wieder da. Die E&A-Einnahme einer Rückzahlung darf
-- @ziel: negativ sein, jede andere Buchung nicht. Leser und fremde Betriebe sind abgelehnt.
-- @mutation ohne_schutz: negative Zahlung direkt buchbar | rot: direkt_negativ|direkt_negativ_postgres
-- @mutation ohne_obergrenze: Rückzahlung über dem Guthaben | rot: ohne_guthaben|ueber_guthaben|rest_ueber_guthaben|nichts_mehr
-- @mutation ohne_datumspruefung: Rückzahlung ohne eigene Prüfung des Zeitraums | rot: datum_gesperrt
-- @mutation gutschrift_storno_trotz_rueckzahlung: Gutschrift stornierbar, obwohl ihr Guthaben ausbezahlt ist | rot: gutschrift_storno_gesperrt
-- @mutation einnahme_beliebig_negativ: jede E&A-Buchung darf negativ sein | rot: ea_negativ_nur_rueckzahlung
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 04 (Stand 14.11.2026, KAN-453). Alles zurückgerollt.
-- Betrieb B: Rechnung vor drei Tagen über 100 € (bezahlt), Gutschrift 20 € → Guthaben 20 €; Rechnung im abgeschlossenen
-- Monat „vor zwei Monaten“ über 24 € (bezahlt), Gutschrift heute 6 €.

CREATE FUNCTION pg_temp.t04z_ersetze(p_fn regprocedure, p_alt text, p_neu text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text := replace(v_alt, p_alt, p_neu);
BEGIN
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't04z_ersetze: Muster % greift nicht in %', p_alt, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  c_datei constant text := '04_rueckzahlung';
  c_rz    constant text := 'SELECT public.s112_rueckzahlung_erfassen(%L::uuid, %L::uuid, %s, %L::date, %L)';
  c_gs    constant text := 'SELECT public.s112_gutschrift_anlegen(%L::uuid, %L::uuid, %L::date, %L, %L::jsonb, %s, NULL)';
  c_fn    constant text := 'public.s112_rueckzahlung_erfassen(uuid, uuid, numeric, date, text, uuid, text)';
  c_zins  constant text := 'INSERT INTO public.zahlungen (tenant_id, verkaufsposten_id, betrag, art, datum) VALUES (%L, %L, %s, %L, %L)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_m     uuid;
  v_zu    date;
  v_ls    uuid;
  v_r     uuid;
  v_ls0   uuid;
  v_r0    uuid;
  v_g     uuid;
  v_z1    uuid;
  v_z2    uuid;
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
  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen, rechnung_spaeter) VALUES (v_b, v_zu, 'S112TEST KAN-453 alt', true) RETURNING id INTO v_ls0;
  INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz)
  VALUES (v_b, v_ls0, 'sonstiges', 'S112TEST Alt', 1, 'Stk', 24, 20);
  v_r0 := public.s112_rechnung_erstellen(v_b, ARRAY[v_ls0], v_zu, '[]'::jsonb, NULL);
  INSERT INTO public.zahlungen (tenant_id, verkaufsposten_id, rechnung_id, betrag, art, datum) VALUES (v_b, v_ls0, v_r0, 24, 'bar', v_zu);
  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen, rechnung_spaeter) VALUES (v_b, v_heute - 3, 'S112TEST KAN-453', true) RETURNING id INTO v_ls;
  INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz)
  VALUES (v_b, v_ls, 'sonstiges', 'S112TEST Kiste', 10, 'Stk', 10, 20);
  v_r := public.s112_rechnung_erstellen(v_b, ARRAY[v_ls], v_heute - 3, '[]'::jsonb, NULL);
  PERFORM pg_temp.s112_zeile('ea_monatsabschluss', v_b,
    jsonb_build_object('jahr', extract(year FROM v_zu)::int::text, 'monat', extract(month FROM v_zu)::int::text));
  PERFORM set_config('s112.loeschen_erlaubt', '', true);

  PERFORM pg_temp.s112_mutiere('ohne_schutz', $m$DROP TRIGGER a_rueckzahlung_schutz ON public.zahlungen$m$);
  PERFORM pg_temp.s112_mutiere('ohne_obergrenze',
    format($m$SELECT pg_temp.t04z_ersetze(%L::regprocedure, $r$IF v_betrag > v_guthaben THEN$r$, $r$IF false THEN$r$)$m$, c_fn));
  PERFORM pg_temp.s112_mutiere('ohne_datumspruefung',
    format($m$SELECT pg_temp.t04z_ersetze(%L::regprocedure, $r$IF NOT public.s112_wartung_frei(p_tenant_id) THEN$r$, $r$IF false THEN$r$)$m$, c_fn));
  PERFORM pg_temp.s112_mutiere('gutschrift_storno_trotz_rueckzahlung',
    $m$SELECT pg_temp.t04z_ersetze('public.s112_gutschrift_stornieren(uuid, uuid, text, date)'::regprocedure,
      $r$AND z.storniert_am IS NULL AND z.betrag < 0) THEN$r$, $r$AND false) THEN$r$)$m$);
  PERFORM pg_temp.s112_mutiere('einnahme_beliebig_negativ',
    $m$ALTER TABLE public.ea_transaktionen DROP CONSTRAINT ea_transaktionen_betrag_netto_check$m$);

  -- ── 1. Rechte; direkt lässt sich weder ein negativer Betrag noch 0 buchen ───────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('rechte',
    concat_ws('|', has_function_privilege('authenticated', c_fn::regprocedure, 'EXECUTE'), has_function_privilege('anon', c_fn::regprocedure, 'EXECUTE'),
      has_function_privilege('authenticated', 'public.s112_rueckzahlung_schutz()', 'EXECUTE')), 't|f|f');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('zahlung_ok',
    pg_temp.s112_fehlertext(format(c_zins, v_b, v_ls, 100, 'bar', v_heute - 2)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_negativ',
    pg_temp.s112_fehlertext(format(c_zins, v_b, v_ls, -5, 'bar', v_heute)) ~ '^42501: .*nur über „Rückzahlung erfassen“.*HINT: rueckzahlung$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_null',
    split_part(pg_temp.s112_fehlertext(format(c_zins, v_b, v_ls, 0, 'bar', v_heute)), ': ', 1), '23514');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_negativ_postgres',
    split_part(pg_temp.s112_fehlertext(format(c_zins, v_b, v_ls, -5, 'bar', v_heute)), ': ', 1), '42501');
  PERFORM pg_temp.s112_als(v_bw);

  -- ── 2. Ohne Guthaben keine Rückzahlung; Gutschrift über 20 € → Guthaben 20 € ─────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_guthaben',
    pg_temp.s112_fehlertext(format(c_rz, v_b, v_r, 5, v_heute, 'bar'))
      ~ '^23514: Die Rückzahlung \(5,00 €\) übersteigt das Guthaben der Rechnung .* \(0,00 €\)\..*HINT: rueckzahlung_betrag$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('gutschrift_ok',
    pg_temp.s112_fehlertext(format(c_gs, v_b, v_r, v_heute - 1, 'S112TEST Treuebonus zum Jahresende', '[]', 20)), 'ok');
  SELECT id INTO v_g FROM public.rechnungen WHERE tenant_id = v_b AND art = 'gutschrift' AND gutschrift_zu_id = v_r;

  -- ── 3. Ablehnungen ─────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_abgelehnt',
    split_part(pg_temp.s112_fehlertext(format(c_rz, v_b, v_r, 5, v_heute, 'bar')), ': ', 1), '42501');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb',
    split_part(pg_temp.s112_fehlertext(format(c_rz, v_m, v_r, 5, v_heute, 'bar')), ': ', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('betrag_null',
    pg_temp.s112_fehlertext(format(c_rz, v_b, v_r, 0, v_heute, 'bar')) ~ '^23514: .*HINT: rueckzahlung_betrag$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('ueber_guthaben',
    pg_temp.s112_fehlertext(format(c_rz, v_b, v_r, 20.01, v_heute, 'bar')) ~ '^23514: .*\(20,01 €\) übersteigt das Guthaben .* \(20,00 €\)', true);
  v_erg := v_erg || pg_temp.s112_erwarte('datum_zukunft',
    pg_temp.s112_fehlertext(format(c_rz, v_b, v_r, 5, v_heute + 1, 'bar')) ~ '^23514: .*in der Zukunft.*HINT: storno_datum$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('datum_vor_rechnung',
    pg_temp.s112_fehlertext(format(c_rz, v_b, v_r, 5, v_heute - 4, 'bar')) ~ '^23514: .*vor dem Rechnungsdatum.*HINT: storno_datum$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('art_unbekannt',
    split_part(pg_temp.s112_fehlertext(format(c_rz, v_b, v_r, 5, v_heute, 'gutschrift')), ': ', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('gutschrift_ist_keine_rechnung',
    split_part(pg_temp.s112_fehlertext(format(c_rz, v_b, v_g, 5, v_heute, 'bar')), ': ', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('abgelehnt_nichts_gebucht',
    (SELECT count(*) FROM public.zahlungen z WHERE z.tenant_id = v_b AND z.betrag < 0), 0);

  -- ── 4. Rückzahlung in Teilen bis zum Guthaben; die Rechnung bleibt ausgeglichen ──────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('teil_ok',
    pg_temp.s112_fehlertext(format(c_rz, v_b, v_r, 15, v_heute, 'bar')), 'ok');
  SELECT id INTO v_z1 FROM public.zahlungen WHERE tenant_id = v_b AND rechnung_id = v_r AND betrag < 0;
  v_erg := v_erg || pg_temp.s112_erwarte('zahlung',
    (SELECT concat_ws('|', z.betrag, z.art, z.datum = v_heute, z.rechnung_id = v_r, z.verkaufsposten_id = v_ls, z.notizen, z.storniert_am IS NULL,
                      (SELECT r.bezahlt FROM public.rechnungen r WHERE r.id = v_r))
       FROM public.zahlungen z WHERE z.id = v_z1), '-15.00|bar|t|t|t|Rückzahlung|t|t');
  v_erg := v_erg || pg_temp.s112_erwarte('rest_ueber_guthaben',
    pg_temp.s112_fehlertext(format(c_rz, v_b, v_r, 5.01, v_heute, 'bank')) ~ '^23514: .*übersteigt das Guthaben .* \(5,00 €\)', true);
  v_erg := v_erg || pg_temp.s112_erwarte('rest_ok',
    pg_temp.s112_fehlertext(format(c_rz, v_b, v_r, 5, v_heute, 'bank')), 'ok');
  SELECT id INTO v_z2 FROM public.zahlungen WHERE tenant_id = v_b AND rechnung_id = v_r AND betrag < 0 AND id <> v_z1;
  v_erg := v_erg || pg_temp.s112_erwarte('nichts_mehr',
    pg_temp.s112_fehlertext(format(c_rz, v_b, v_r, 0.01, v_heute, 'bank')) ~ '^23514: .*\(0,00 €\)', true);
  v_erg := v_erg || pg_temp.s112_erwarte('summe',
    (SELECT concat_ws('|', sum(z.betrag), count(*), (SELECT r.bezahlt FROM public.rechnungen r WHERE r.id = v_r))
       FROM public.zahlungen z WHERE z.rechnung_id = v_r AND z.storniert_am IS NULL), '80.00|3|t');

  -- ── 5. Gutschrift mit ausbezahltem Guthaben: Storno gesperrt; Storno der Rückzahlung gibt das Guthaben zurück ────
  v_erg := v_erg || pg_temp.s112_erwarte('gutschrift_storno_gesperrt',
    pg_temp.s112_fehlertext(format('SELECT public.s112_gutschrift_stornieren(%L::uuid, %L::uuid, %L, %L::date)', v_b, v_g, 'S112TEST Storno trotz Rückzahlung', v_heute))
      ~ '^22023: Zur Rechnung .* gibt es eine Rückzahlung – bitte zuerst die Rückzahlung stornieren.*HINT: rueckzahlung$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('rueckzahlung_storno',
    pg_temp.s112_fehlertext(format('SELECT public.s112_zahlung_stornieren(%L::uuid, %L::uuid, %L)', v_b, v_z2, 'S112TEST Rückzahlung war ein Irrtum')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('guthaben_wieder_da',
    concat_ws('|', pg_temp.s112_fehlertext(format(c_rz, v_b, v_r, 5.01, v_heute, 'bank')) ~ '\(5,00 €\)',
      pg_temp.s112_fehlertext(format(c_rz, v_b, v_r, 5, v_heute, 'karte'))), 't|ok');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_aendern',
    pg_temp.s112_fehlertext(format('UPDATE public.zahlungen SET betrag = -500 WHERE id = %L', v_z1)) <> 'ok', true);

  -- ── 6. Abgeschlossener Monat: Rückzahlung dort abgelehnt, heute möglich ─────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('alt_gutschrift',
    pg_temp.s112_fehlertext(format(c_gs, v_b, v_r0, v_heute, 'S112TEST Nachlass auf die alte Rechnung', '[]', 6)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('datum_gesperrt',
    pg_temp.s112_fehlertext(format(c_rz, v_b, v_r0, 6, v_zu + 1, 'bar'))
      ~ '^42501: Rückzahlung mit Datum .* nicht möglich: Monat .* abgeschlossen\..*HINT: periodensperre$', true);
  v_erg := v_erg || pg_temp.s112_erwarte('alt_heute_ok',
    pg_temp.s112_fehlertext(format(c_rz, v_b, v_r0, 6, v_heute, 'bar')), 'ok');

  -- ── 7. E&A: nur die Einnahme einer Verkaufszahlung darf negativ sein ─────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('ea_negativ_nur_rueckzahlung',
    (SELECT pg_get_constraintdef(k.oid) ~ 'betrag_netto >= \(0\)::numeric\) OR \(storno_von_id IS NOT NULL\) OR \(\(typ = ''einnahme''::text\) AND \(import_quelle = ''verkauf''::text\) AND \(zahlung_id IS NOT NULL\)\)'
       FROM pg_constraint k WHERE k.conrelid = 'public.ea_transaktionen'::regclass AND k.conname = 'ea_transaktionen_betrag_netto_check'), true);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 30);
END
$test$;
