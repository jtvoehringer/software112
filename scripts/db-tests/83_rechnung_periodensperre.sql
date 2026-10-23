-- @bereich: Periodensperre für Rechnungen (KAN-355) – rechnungen.datum und Rechnungspositionen im abgeschlossenen Zeitraum
-- @ziel: Eine Rechnung mit Datum in einem abgeschlossenen Monat (ea_monatsabschluss) oder einem per UVA übermittelten
-- @ziel: Zeitraum entsteht weder sofort mit dem Verkauf noch über s112_rechnung_erstellen; das Datum einer Rechnung lässt
-- @ziel: sich weder aus noch in einen gesperrten Zeitraum verschieben (auch nicht über den Spiegel vom Lieferschein); die
-- @ziel: Beträge ihrer Positionen bleiben unverändert. Lieferscheine ohne Rechnung, Rechnungen im offenen Zeitraum, der
-- @ziel: Storno im offenen Zeitraum und die Wartung bleiben möglich; den Storno einer Rechnung im gesperrten Zeitraum
-- @ziel: (Rechnung wie Verkauf über den Spiegel) lehnt die Datenbank vorläufig ab (bis KAN-379, Entscheidung 23.10.2026).
-- @mutation ohne_rechnungssperre: DROP TRIGGER a_ea_periodensperre auf rechnungen | rot: sofort_.*|erstellen_gesperrt.*|datum_.*|storno_.*_gesperrt.*
-- @mutation ohne_positionssperre: DROP TRIGGER a_rechnung_periodensperre auf verkauf_positionen | rot: pos_.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 83 (Stand 23.10.2026, KAN-355). Alles zurückgerollt.
-- Betrieb B (frisch): Monat „vor zwei Monaten“ abgeschlossen, Quartal „vor einem Jahr“ per UVA übermittelt, heute offen.

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  c_datei constant text := '83_rechnung_periodensperre';
  c_erst  constant text := 'SELECT public.s112_rechnung_erstellen(%L::uuid, %L::uuid[], %L::date, %L::jsonb, NULL)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_zu    date;    -- Tag im abgeschlossenen Monat
  v_uva   date;    -- Tag im per UVA übermittelten Quartal
  v_ls    uuid;    -- Lieferschein „Rechnung später“ im abgeschlossenen Monat
  v_lso   uuid;    -- Verkauf sofort, offen
  v_re    uuid;
  v_vz    uuid;    -- Verkauf sofort im abgeschlossenen Monat (Wartung)
  v_rz    uuid;    -- eigene Rechnung im abgeschlossenen Monat (Wartung)
  v_lz    uuid;
  v_pz    uuid;
  v_txt   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ──────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_zu := (date_trunc('month', v_heute) - interval '2 months')::date + 9;
  v_uva := (date_trunc('month', v_heute) - interval '12 months')::date + 4;
  PERFORM pg_temp.s112_zeile('ea_monatsabschluss', v_b,
    jsonb_build_object('jahr', extract(year FROM v_zu)::int::text, 'monat', extract(month FROM v_zu)::int::text));
  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);
  PERFORM pg_temp.s112_zeile('ea_uva', v_b, jsonb_build_object('jahr', extract(year FROM v_uva)::int::text,
    'zeitraum', 'Q' || ceil(extract(month FROM v_uva) / 3.0)::int, 'gesperrt', 'true'));
  -- Wartung: Verkauf sofort (Spiegel) und eigene Rechnung im abgeschlossenen Monat, je mit Position
  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen) VALUES (v_b, v_zu, 'S112TEST KAN-355 Spiegel alt') RETURNING id INTO v_vz;
  INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz)
  VALUES (v_b, v_vz, 'sonstiges', 'S112TEST Spiegel', 1, 'Stk', 10, 20);
  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen, rechnung_spaeter) VALUES (v_b, v_zu, 'S112TEST KAN-355 eigene alt', true)
    RETURNING id INTO v_lz;
  INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz)
  VALUES (v_b, v_lz, 'sonstiges', 'S112TEST eigene', 2, 'Stk', 15, 20) RETURNING id INTO v_pz;
  v_rz := public.s112_rechnung_erstellen(v_b, ARRAY[v_lz], v_zu, '[]'::jsonb, NULL);
  PERFORM set_config('s112.loeschen_erlaubt', '', true);
  v_erg := v_erg || pg_temp.s112_erwarte('wartung_frei',
    (SELECT concat_ws('|', count(*), bool_and(r.datum = v_zu)) FROM public.rechnungen r
      WHERE r.id IN (v_rz, (SELECT rechnung_id FROM public.verkaufsposten WHERE id = v_vz))), '2|t');

  PERFORM pg_temp.s112_mutiere('ohne_rechnungssperre', $m$DROP TRIGGER a_ea_periodensperre ON public.rechnungen$m$);
  PERFORM pg_temp.s112_mutiere('ohne_positionssperre', $m$DROP TRIGGER a_rechnung_periodensperre ON public.verkauf_positionen$m$);

  PERFORM pg_temp.s112_als(v_bw);

  -- ── 1. Verkauf mit „Rechnung sofort“: offen ja, abgeschlossen bzw. UVA nein ──────────────────────────────
  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen) VALUES (v_b, v_heute, 'S112TEST KAN-355 offen') RETURNING id INTO v_lso;
  v_erg := v_erg || pg_temp.s112_erwarte('offen_mit_rechnung',
    (SELECT v.rechnung_id IS NOT NULL FROM public.verkaufsposten v WHERE v.id = v_lso), true);
  v_erg := v_erg || pg_temp.s112_erwarte('sofort_abgeschlossen',
    pg_temp.s112_versuch(format('INSERT INTO public.verkaufsposten (tenant_id, datum, notizen) VALUES (%L, %L, %L)', v_b, v_zu, 'S112TEST zu')), 'T');
  v_txt := pg_temp.s112_fehlertext(format('INSERT INTO public.verkaufsposten (tenant_id, datum, notizen) VALUES (%L, %L, %L)', v_b, v_zu, 'S112TEST zu'));
  v_erg := v_erg || pg_temp.s112_erwarte('sofort_meldung',
    v_txt ~ ('^42501: Rechnung mit Datum ' || to_char(v_zu, 'DD\.MM\.YYYY') || ' nicht möglich: Monat .* abgeschlossen\..*offenen Zeitraum.*HINT: periodensperre$'), true);
  v_erg := v_erg || pg_temp.s112_erwarte('sofort_uva',
    split_part(pg_temp.s112_fehlertext(format('INSERT INTO public.verkaufsposten (tenant_id, datum, notizen) VALUES (%L, %L, %L)', v_b, v_uva, 'S112TEST uva')), ': ', 1)
    || '|' || (pg_temp.s112_fehlertext(format('INSERT INTO public.verkaufsposten (tenant_id, datum, notizen) VALUES (%L, %L, %L)', v_b, v_uva, 'S112TEST uva')) ~ 'per UVA übermittelt'), '42501|true');

  -- ── 2. Lieferschein ohne Rechnung im abgeschlossenen Monat ja; Rechnung dazu nur mit offenem Datum ───────
  v_erg := v_erg || pg_temp.s112_erwarte('lieferschein_ohne_rechnung_frei',
    pg_temp.s112_fehlertext(format('INSERT INTO public.verkaufsposten (tenant_id, datum, notizen, rechnung_spaeter) VALUES (%L, %L, %L, true)', v_b, v_zu, 'S112TEST LS')), 'ok');
  SELECT id INTO v_ls FROM public.verkaufsposten WHERE tenant_id = v_b AND notizen = 'S112TEST LS';
  v_erg := v_erg || pg_temp.s112_erwarte('erstellen_gesperrt',
    split_part(pg_temp.s112_fehlertext(format(c_erst, v_b, ARRAY[v_ls], v_zu, '[]')), ': ', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('erstellen_gesperrt_nichts_berechnet',
    (SELECT v.rechnung_id IS NULL FROM public.verkaufsposten v WHERE v.id = v_ls), true);
  -- über fehlertext: ohne Sperre wäre der Lieferschein oben schon berechnet (22023) – dann FEHLER statt Abbruch
  v_txt := pg_temp.s112_fehlertext(format(c_erst, v_b, ARRAY[v_ls], v_heute, '[]'));
  SELECT v.rechnung_id INTO v_re FROM public.verkaufsposten v WHERE v.id = v_ls;
  v_erg := v_erg || pg_temp.s112_erwarte('erstellen_offen',
    v_txt || '|' || coalesce((SELECT concat_ws('|', r.datum = v_heute, r.leistung_von = v_zu) FROM public.rechnungen r WHERE r.id = v_re), '-'), 'ok|t|t');

  -- ── 3. Datum verschieben: in den gesperrten Zeitraum (Spiegel) und aus ihm heraus ────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('datum_in_gesperrt_spiegel',
    pg_temp.s112_versuch(format('UPDATE public.verkaufsposten SET datum = %L WHERE id = %L', v_zu, v_lso)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('datum_offen_ok',
    pg_temp.s112_versuch(format('UPDATE public.verkaufsposten SET datum = %L WHERE id = %L', v_heute - 1, v_lso)), 'k1');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('datum_aus_gesperrt_service',
    pg_temp.s112_versuch(format('UPDATE public.rechnungen SET datum = %L WHERE id = %L', v_heute, v_rz)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('datum_in_gesperrt_service',
    pg_temp.s112_versuch(format('UPDATE public.rechnungen SET datum = %L WHERE id = %L', v_zu, v_re)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('datum_loeschen_gesperrt',
    pg_temp.s112_versuch(format('DELETE FROM public.rechnungen WHERE id = %L', v_rz)), 'T');
  -- andere Spalten (Versand, Notiz) einer gesperrten Rechnung bleiben frei
  v_erg := v_erg || pg_temp.s112_erwarte('rechnung_versand_frei',
    pg_temp.s112_versuch(format('UPDATE public.rechnungen SET rechnung_versendet_am = now(), rechnung_versendet_an = %L WHERE id = %L', 's112test@software112.test', v_rz)), 'k1');
  PERFORM pg_temp.s112_als(v_bw);

  -- ── 4. Positionen einer Rechnung im gesperrten Zeitraum: Beträge nein, Bezeichnung ja ───────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('pos_preis_gesperrt',
    pg_temp.s112_versuch(format('UPDATE public.verkauf_positionen SET preis_brutto = 99 WHERE id = %L', v_pz)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('pos_neu_gesperrt',
    pg_temp.s112_versuch(format($s$INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz)
      VALUES (%L, %L, 'sonstiges', 'S112TEST dazu', 1, 'Stk', 5, 20)$s$, v_b, v_vz)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('pos_meldung',
    pg_temp.s112_fehlertext(format('UPDATE public.verkauf_positionen SET rabatt_pct = 10 WHERE id = %L', v_pz)) ~ '^42501: Die Positionen der Rechnung .* lassen sich nicht ändern', true);
  v_erg := v_erg || pg_temp.s112_erwarte('pos_name_frei',
    pg_temp.s112_versuch(format('UPDATE public.verkauf_positionen SET name = %L WHERE id = %L', 'S112TEST umbenannt', v_pz)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('offen_pos_frei',
    pg_temp.s112_versuch(format($s$INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz)
      VALUES (%L, %L, 'sonstiges', 'S112TEST offen', 1, 'Stk', 5, 20)$s$, v_b, v_lso)), 'k1');

  -- ── 5. Storno: im gesperrten Zeitraum vorläufig abgelehnt (bis KAN-379), im offenen Zeitraum und als Wartung frei ──
  v_txt := pg_temp.s112_fehlertext(format('SELECT public.s112_rechnung_stornieren(%L, %L, %L)', v_b, v_rz, 'S112TEST Rechnung falsch'));
  v_erg := v_erg || pg_temp.s112_erwarte('storno_rechnung_gesperrt',
    v_txt ~ ('^42501: Storno nicht möglich: Die Rechnung .* liegt im abgeschlossenen Zeitraum ' || to_char(v_zu, 'MM/YYYY')
             || '\. Die Gegenbuchung im offenen Zeitraum folgt mit KAN-379\..*HINT: periodensperre_storno$'), true);
  v_erg := v_erg || pg_temp.s112_erwarte('storno_rechnung_gesperrt_unveraendert',
    (SELECT concat_ws('|', r.storniert, (SELECT count(*) FROM public.verkaufsposten v WHERE v.rechnung_id = r.id)) FROM public.rechnungen r WHERE r.id = v_rz), 'f|1');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_verkauf_gesperrt',
    pg_temp.s112_versuch(format('UPDATE public.verkaufsposten SET storniert = true, storno_grund = %L WHERE id = %L', 'S112TEST Verkauf falsch', v_vz)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_rechnung_offen_ok',
    pg_temp.s112_fehlertext(format('SELECT public.s112_rechnung_stornieren(%L, %L, %L)', v_b, v_re, 'S112TEST Rechnung offen falsch')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_verkauf_offen_ok',
    pg_temp.s112_versuch(format('UPDATE public.verkaufsposten SET storniert = true, storno_grund = %L WHERE id = %L', 'S112TEST Verkauf offen falsch', v_lso)), 'k1');
  -- Wartung (Service-Role mit s112.loeschen_erlaubt) storniert auch im gesperrten Zeitraum
  PERFORM pg_temp.s112_als_postgres();
  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);
  v_erg := v_erg || pg_temp.s112_erwarte('storno_wartung_frei',
    pg_temp.s112_fehlertext(format('SELECT public.s112_rechnung_stornieren(%L, %L, %L)', v_b, v_rz, 'S112TEST Wartung Storno')), 'ok');
  PERFORM set_config('s112.loeschen_erlaubt', '', true);
  -- nach dem Storno zählt die Rechnung nicht mehr – ihre Positionen sind wieder frei (Lieferschein offen)
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('storno_pos_wieder_frei',
    pg_temp.s112_versuch(format('UPDATE public.verkauf_positionen SET preis_brutto = 16 WHERE id = %L', v_pz)), 'k1');
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 25);
END
$test$;
