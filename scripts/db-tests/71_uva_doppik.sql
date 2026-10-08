-- @bereich: UVA-Berechnung nach Buchhaltungsart (KAN-105 Teil B) – berechne_ea_uva
-- @ziel: E&A-Betriebe: Umsätze nach Zahlung (ea_transaktionen, auch import_quelle 'verkauf'), Rechnungen zählen nicht.
-- @ziel: Doppik: Umsätze aus den Rechnungen nach Rechnungsdatum (aktiv, nicht storniert, Positionen aller Lieferscheine,
-- @ziel: Netto je Rechnung und Satz gerundet), Zahlungseinnahmen 'verkauf' zählen dort nicht (keine Doppelzählung);
-- @ziel: übrige Einnahmen und Vorsteuer in beiden Fällen aus ea_transaktionen. Fremder Betrieb: 42501.
-- @mutation doppelt: Doppik zählt die Zahlungseinnahmen zusätzlich | rot: doppik
-- @mutation mit_storno: Doppik zählt stornierte Rechnungen mit | rot: doppik
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 71 (Stand 08.10.2026, KAN-105). Alles zurückgerollt.

CREATE FUNCTION pg_temp.t71_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't71_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

CREATE FUNCTION pg_temp.t71_uva(p_tenant uuid, p_jahr smallint, p_zeitraum text) RETURNS text LANGUAGE sql AS $f$
  SELECT concat_ws('|', u.bmgl_13::numeric(12, 2), u.bmgl_20::numeric(12, 2), u.ust_13::numeric(12, 2), u.ust_20::numeric(12, 2), u.vst_20::numeric(12, 2))
  FROM public.berechne_ea_uva(p_tenant, p_jahr, p_zeitraum) u
$f$;

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  v_jahr  smallint;
  v_zr    text;
  c_datei constant text := '71_uva_doppik';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_m     uuid;
  v_ls1   uuid;
  v_ls2   uuid;
  v_ls3   uuid;
  v_ls4   uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();
  v_jahr := extract(year FROM v_heute)::smallint;
  v_zr := to_char(v_heute, 'MM');

  -- ── 0. Aufbau (als postgres) ──────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_m := (v_a ->> 'm')::uuid;

  PERFORM pg_temp.s112_mutiere('doppelt',
    $m$SELECT pg_temp.t71_ersetze('public.berechne_ea_uva(uuid, smallint, text)'::regprocedure,
      $r$AND NOT \(v_doppik AND t\.typ = 'einnahme' AND t\.import_quelle = 'verkauf'\)$r$, $r$AND true$r$)$m$);
  PERFORM pg_temp.s112_mutiere('mit_storno',
    $m$SELECT pg_temp.t71_ersetze('public.berechne_ea_uva(uuid, smallint, text)'::regprocedure,
      $r$AND r\.aktiv AND NOT r\.storniert$r$, $r$AND r.aktiv$r$)$m$);

  -- Rechnungen im laufenden Monat: 10 × 12 € zu 20 % (netto 100), 3 × 11,30 € zu 13 % (netto 30),
  -- eine stornierte (24 € zu 20 %) und ein nicht berechneter Lieferschein (60 € zu 20 %) – beide zählen nicht
  INSERT INTO public.verkaufsposten (tenant_id, datum) VALUES (v_b, v_heute) RETURNING id INTO v_ls1;
  INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz)
  VALUES (v_b, v_ls1, 'sonstiges', 'S112TEST Kiste', 10, 'Stk', 12, 20);
  INSERT INTO public.verkaufsposten (tenant_id, datum) VALUES (v_b, v_heute) RETURNING id INTO v_ls2;
  INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz)
  VALUES (v_b, v_ls2, 'sonstiges', 'S112TEST Saft', 3, 'Stk', 11.30, 13);
  INSERT INTO public.verkaufsposten (tenant_id, datum) VALUES (v_b, v_heute) RETURNING id INTO v_ls3;
  INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz)
  VALUES (v_b, v_ls3, 'sonstiges', 'S112TEST storniert', 1, 'Stk', 24, 20);
  UPDATE public.verkaufsposten SET storniert = true, storno_grund = 'S112TEST falsch erfasst' WHERE id = v_ls3;
  INSERT INTO public.verkaufsposten (tenant_id, datum, rechnung_spaeter) VALUES (v_b, v_heute, true) RETURNING id INTO v_ls4;
  INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz)
  VALUES (v_b, v_ls4, 'sonstiges', 'S112TEST nicht berechnet', 5, 'Stk', 12, 20);

  -- E&A: Zahlungseinnahme 50 € netto zu 20 % (Teilzahlung), manuelle Einnahme 10 € zu 13 %, Ausgabe 100 € zu 20 %
  INSERT INTO public.ea_transaktionen (tenant_id, typ, import_quelle, verkaufsposten_id, datum, beschreibung, betrag_netto, ust_satz)
  VALUES (v_b, 'einnahme', 'verkauf', v_ls1, v_heute, 'S112TEST Zahlungseingang', 50, 20),
         (v_b, 'einnahme', 'manuell', NULL, v_heute, 'S112TEST Einnahme', 10, 13),
         (v_b, 'ausgabe', 'manuell', NULL, v_heute, 'S112TEST Ausgabe', 100, 20);

  -- ── 1. E&A: nach Zahlung ──────────────────────────────────────────────────────────────────────────────
  UPDATE public.tenant_einstellungen SET buchhaltungsart = 'ea' WHERE tenant_id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('ea', pg_temp.t71_uva(v_b, v_jahr, v_zr), '10.00|50.00|1.30|10.00|20.00');

  -- ── 2. Doppik: Umsätze aus den Rechnungen, Zahlungseinnahme nicht doppelt ─────────────────────────────
  UPDATE public.tenant_einstellungen SET buchhaltungsart = 'doppik' WHERE tenant_id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('doppik', pg_temp.t71_uva(v_b, v_jahr, v_zr), '40.00|100.00|5.20|20.00|20.00');

  -- ── 3. Als Mitarbeiter des Betriebs ja, fremder Betrieb nein ──────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('mitglied', pg_temp.t71_uva(v_b, v_jahr, v_zr), '40.00|100.00|5.20|20.00|20.00');
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.berechne_ea_uva(%L::uuid, %s::smallint, %L)', v_m, v_jahr, v_zr)), ':', 1), '42501');
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 4);
END $test$;
