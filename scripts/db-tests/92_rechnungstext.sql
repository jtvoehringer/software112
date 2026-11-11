-- @bereich: Verkauf – Text auf Rechnung am Lieferschein (KAN-416 Punkt 1)
-- @ziel: Der Text auf Rechnung eines Lieferscheins lässt sich ändern, solange keine Rechnung dazu erstellt ist – danach
-- @ziel: nicht mehr (42501, HINT rechnungstext); die interne Notiz bleibt änderbar. Höchstens 1.000 Zeichen. Leser und
-- @ziel: fremde Betriebe ändern nichts.
-- @mutation ohne_schutz: Trigger a_rechnungstext_schutz entfernt | rot: berechnet_text_gesperrt.*
-- @mutation ohne_check: CHECK verkaufsposten_rechnungstext_chk entfernt | rot: check_zu_lang
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 92 (Stand 11.11.2026, KAN-416). Alles zurückgerollt.
-- Personen: Mitarbeiter b_w und Leser b_l in Betrieb B; Betrieb M fremd.

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  c_datei constant text := '92_rechnungstext';
  c_upd   constant text := 'UPDATE public.verkaufsposten SET %s WHERE id = %L';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_frei  uuid;   -- Lieferschein ohne Rechnung
  v_ber   uuid;   -- Lieferschein mit Rechnung
  v_txt   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres, ohne Wartungskennzeichen) ───────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen, rechnung_spaeter) VALUES (v_b, v_heute, 'S112TEST frei', true) RETURNING id INTO v_frei;
  INSERT INTO public.verkaufsposten (tenant_id, datum, notizen, rechnungstext, rechnung_spaeter) VALUES (v_b, v_heute, 'S112TEST berechnet', 'S112TEST Bestellung 4711', true) RETURNING id INTO v_ber;
  INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, name, menge, einheit, preis_brutto, ust_satz)
  VALUES (v_b, v_ber, 'sonstiges', 'S112TEST Kiste', 2, 'Stk', 12, 20);
  PERFORM public.s112_rechnung_erstellen(v_b, ARRAY[v_ber], v_heute, '[]'::jsonb, NULL);

  PERFORM pg_temp.s112_mutiere('ohne_schutz', $m$DROP TRIGGER a_rechnungstext_schutz ON public.verkaufsposten$m$);
  PERFORM pg_temp.s112_mutiere('ohne_check', $m$ALTER TABLE public.verkaufsposten DROP CONSTRAINT verkaufsposten_rechnungstext_chk$m$);

  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_rechnung_haengt_dran',
    (SELECT rechnung_id IS NOT NULL FROM public.verkaufsposten WHERE id = v_ber), true);
  v_erg := v_erg || pg_temp.s112_erwarte('trigger_fn_nicht_aufrufbar',
    has_function_privilege('authenticated', 'public.s112_rechnungstext_schutz()', 'EXECUTE'), false);

  -- ── 1. Lieferschein ohne Rechnung: Text und Notiz änderbar ───────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('frei_text_setzen',
    pg_temp.s112_fehlertext(format(c_upd, format('rechnungstext = %L', 'S112TEST Lieferung frei Haus'), v_frei)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('frei_text_aendern',
    pg_temp.s112_versuch(format(c_upd, format('rechnungstext = %L', 'S112TEST geändert'), v_frei)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('frei_text_leeren',
    pg_temp.s112_versuch(format(c_upd, 'rechnungstext = NULL', v_frei)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('check_zu_lang',
    pg_temp.s112_versuch(format(c_upd, format('rechnungstext = %L', repeat('x', 1001)), v_frei)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('genau_1000_geht',
    pg_temp.s112_versuch(format(c_upd, format('rechnungstext = %L', repeat('x', 1000)), v_frei)), 'k1');

  -- ── 2. Lieferschein mit Rechnung: Text gesperrt, Notiz frei ──────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('berechnet_text_gesperrt',
    pg_temp.s112_versuch(format(c_upd, format('rechnungstext = %L', 'S112TEST nachträglich'), v_ber)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('berechnet_text_gesperrt_leeren',
    pg_temp.s112_versuch(format(c_upd, 'rechnungstext = NULL', v_ber)), 'T');
  v_txt := pg_temp.s112_fehlertext(format(c_upd, format('rechnungstext = %L', 'S112TEST nachträglich'), v_ber));
  v_erg := v_erg || pg_temp.s112_erwarte('berechnet_text_gesperrt_meldung',
    v_txt LIKE '42501: Der Text auf der Rechnung lässt sich nicht mehr ändern%HINT: rechnungstext', true);
  v_erg := v_erg || pg_temp.s112_erwarte('berechnet_notiz_frei',
    pg_temp.s112_versuch(format(c_upd, format('notizen = %L', 'S112TEST interne Notiz'), v_ber)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('berechnet_gleicher_text_geht',   -- unveränderter Wert im Update ist keine Änderung
    pg_temp.s112_versuch(format(c_upd, format('rechnungstext = %L, notizen = %L', 'S112TEST Bestellung 4711', 'S112TEST x'), v_ber)), 'k1');

  -- ── 3. Rechte ────────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_aendert_nichts',
    left(pg_temp.s112_versuch(format(c_upd, format('rechnungstext = %L', 'S112TEST Leser'), v_frei)), 1) IN ('k', 'R', 'T'), true);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_text_unveraendert',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.verkaufsposten WHERE id = %L AND rechnungstext = %L', v_frei, 'S112TEST Lieferung frei Haus')), '1');
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 12);
END
$test$;
