-- @bereich: Sonstige Produkte mit Lagerstand – Traubensaft, Essig, Destillat (KAN-115)
-- @ziel: Verarbeiten einer Charge bucht in derselben Transaktion den Zugang beim Produkt; ein Verkauf mindert den
-- @ziel: Lagerstand (alles oder nichts, nicht über den Bestand, je Position einmal), sein Storno bucht zurück; das Storno der
-- @ziel: Verarbeitung nimmt den Zugang zurück, aber nicht, wenn schon verkauft. Bewegungen nur per RPC (append-only), Leser
-- @ziel: ohne Schreibrecht, Vorzeichen geprüft, Produkt mit Bewegungen nicht löschbar; s112_mandant_loeschen räumt einen
-- @ziel: Betrieb mit Lagerbewegungen und Stoffkonto-Buchungen (KAN-107) vollständig ab.
-- @mutation direktes_insert: INSERT auf sonstige_artikel_bewegungen für authenticated freigegeben | rot: kein_direktes_insert
-- @mutation ohne_vorzeichen: CHECK sonstige_artikel_bewegungen_vorzeichen entfernt | rot: vorzeichen_verkauf_positiv
-- @mutation ohne_lagerpruefung: Verkauf über den Bestand wird angenommen | rot: verkauf_ueber_bestand
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 61 (Stand 07.10.2026, KAN-115). Alles zurückgerollt.

CREATE FUNCTION pg_temp.t61_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't61_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  c_datei constant text := '61_sonstige_produkte_lager';
  c_verarb constant text := 'SELECT public.s112_verarbeitung_buchen(%L::uuid, %L::uuid, %L::date, %s, %L, NULL, %L::uuid, %s)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_art   uuid;
  v_wa    uuid;
  v_v     uuid;
  v_p1    uuid;
  v_p2    uuid;
  v_l     uuid;
  v_la    uuid;
  v_lw    uuid;
  v_lv    uuid;
  v_lp    uuid;
  v_lkm   uuid;
  v_lkb   uuid;
  v_t     text;
  v_m     uuid;
  v_ma    uuid;
  v_mb    uuid;
  v_mp    uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres): Produkt mit Lagerstand, Charge 300 L ──────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  INSERT INTO public.sonstige_artikel (tenant_id, name, einheit, default_preis, art, bestand_fuehren, liter_je_stk)
  VALUES (v_b, 'S112TEST Traubensaft 1 l', 'Stk', 4.5, 'traubensaft', true, 1) RETURNING id INTO v_art;
  v_wa := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "300", "status": "ausbau", "aktiv": true, "storniert_am": null}') ->> 'id')::uuid;

  PERFORM pg_temp.s112_mutiere('direktes_insert', $m$GRANT INSERT ON public.sonstige_artikel_bewegungen TO authenticated;
    CREATE POLICY s112test_ins ON public.sonstige_artikel_bewegungen FOR INSERT TO authenticated WITH CHECK (true)$m$);
  PERFORM pg_temp.s112_mutiere('ohne_vorzeichen', $m$ALTER TABLE public.sonstige_artikel_bewegungen DROP CONSTRAINT sonstige_artikel_bewegungen_vorzeichen$m$);
  PERFORM pg_temp.s112_mutiere('ohne_lagerpruefung',
    $m$SELECT pg_temp.t61_ersetze('public.s112_artikel_verkauf_buchen(uuid, uuid)'::regprocedure,
      $r$IF r\.menge > v_best \+ 0\.0005 THEN$r$, $r$IF false THEN$r$)$m$);

  -- ── 1. Verarbeiten: 300 L → 300 Stk Traubensaft, Charge leer ───────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('verarbeitung_ohne_stueck',
    split_part(pg_temp.s112_fehlertext(format(c_verarb, v_b, v_wa, v_heute, 300, 'traubensaft', v_art, 'NULL')), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('verarbeitung_ok',
    pg_temp.s112_fehlertext(format(c_verarb, v_b, v_wa, v_heute, 300, 'traubensaft', v_art, 300)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  SELECT id INTO v_v FROM public.keller_verarbeitungen WHERE weinausbau_id = v_wa;
  v_erg := v_erg || pg_temp.s112_erwarte('zugang_gebucht', public.s112_artikel_bestand(v_art), 300::numeric);
  v_erg := v_erg || pg_temp.s112_erwarte('charge_leer', (SELECT menge_liter FROM public.weinausbau WHERE id = v_wa), 0::numeric);

  -- ── 2. Nur per RPC; Vorzeichen; Leser ohne Recht ─────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('kein_direktes_insert',
    pg_temp.s112_fehlertext(format('INSERT INTO public.sonstige_artikel_bewegungen (tenant_id, artikel_id, datum, art, menge) VALUES (%L, %L, %L, %L, 5)', v_b, v_art, v_heute, 'zugang')) <> 'ok', true);
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_kein_buchen',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_artikel_buchen(%L::uuid, %L::uuid, %L::date, %L, 5, NULL)', v_b, v_art, v_heute, 'zugang')), ':', 1), '42501');

  PERFORM pg_temp.s112_als_postgres();

  -- ── 3. Verkauf mindert, einmal je Position, nicht über den Bestand ───────────────────────────────────
  v_p1 := (pg_temp.s112_beispiel('verkaufsposten', v_b, NULL, jsonb_build_object('datum', v_heute, 'storniert', false)) ->> 'id')::uuid;
  PERFORM pg_temp.s112_beispiel('verkauf_positionen', v_b, NULL, jsonb_build_object('verkaufsposten_id', v_p1, 'typ', 'sonstiges',
    'sonstige_artikel_id', v_art, 'name', 'Traubensaft', 'menge', 50, 'fuellung_id', NULL, 'weinausbau_id', NULL, 'traubenverkauf_id', NULL));
  v_p2 := (pg_temp.s112_beispiel('verkaufsposten', v_b, NULL, jsonb_build_object('datum', v_heute, 'storniert', false)) ->> 'id')::uuid;
  PERFORM pg_temp.s112_beispiel('verkauf_positionen', v_b, NULL, jsonb_build_object('verkaufsposten_id', v_p2, 'typ', 'sonstiges',
    'sonstige_artikel_id', v_art, 'name', 'Traubensaft', 'menge', 400, 'fuellung_id', NULL, 'weinausbau_id', NULL, 'traubenverkauf_id', NULL));
  v_erg := v_erg || pg_temp.s112_erwarte('vorzeichen_verkauf_positiv',
    split_part(pg_temp.s112_fehlertext(format('INSERT INTO public.sonstige_artikel_bewegungen (tenant_id, artikel_id, datum, art, menge, verkauf_position_id) SELECT %L, %L, %L, %L, 5, id FROM public.verkauf_positionen WHERE verkaufsposten_id = %L', v_b, v_art, v_heute, 'verkauf', v_p1)), ':', 1), '23514');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('verkauf_ok',
    pg_temp.s112_fehlertext(format('SELECT public.s112_artikel_verkauf_buchen(%L::uuid, %L::uuid)', v_b, v_p1)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('verkauf_einmal',
    pg_temp.s112_fehlertext(format('SELECT public.s112_artikel_verkauf_buchen(%L::uuid, %L::uuid)', v_b, v_p1)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('verkauf_ueber_bestand',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_artikel_verkauf_buchen(%L::uuid, %L::uuid)', v_b, v_p2)), ':', 1), '22023');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('bestand_nach_verkauf', public.s112_artikel_bestand(v_art), 250::numeric);

  -- ── 4. Storno der Verarbeitung nach Verkauf abgelehnt; Storno des Verkaufs bucht zurück; dann geht es ────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('verarbeitung_storno_verkauft',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_verarbeitung_stornieren(%L::uuid, %L::uuid, %L)', v_b, v_v, 'S112TEST Fehlbuchung korrigieren')), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('verkauf_storno_ok',
    pg_temp.s112_fehlertext(format('SELECT public.s112_artikel_verkauf_stornieren(%L::uuid, %L::uuid, %L)', v_b, v_p1, 'S112TEST Kunde storniert')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('verarbeitung_storno_ok',
    pg_temp.s112_fehlertext(format('SELECT public.s112_verarbeitung_stornieren(%L::uuid, %L::uuid, %L)', v_b, v_v, 'S112TEST Fehlbuchung korrigieren')), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('bestand_null', public.s112_artikel_bestand(v_art), 0::numeric);
  v_erg := v_erg || pg_temp.s112_erwarte('charge_zurueck', (SELECT menge_liter FROM public.weinausbau WHERE id = v_wa), 300::numeric);

  -- ── 5. Inventur bucht die Differenz; Produkt mit Bewegungen nicht löschbar ───────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('inventur_ok',
    pg_temp.s112_fehlertext(format('SELECT public.s112_artikel_buchen(%L::uuid, %L::uuid, %L::date, %L, 12, NULL)', v_b, v_art, v_heute, 'inventur')), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('inventur_differenz', public.s112_artikel_bestand(v_art), 12::numeric);
  v_erg := v_erg || pg_temp.s112_erwarte('produkt_nicht_loeschbar',
    split_part(pg_temp.s112_fehlertext(format('DELETE FROM public.sonstige_artikel WHERE id = %L', v_art)), ':', 1), '23503');

  -- ── 5b. IDOR: Produkt, Buchung und Verkauf eines fremden Betriebs (M) über die eigene tenant_id (B) ───────
  v_m := (v_a ->> 'm')::uuid;
  INSERT INTO public.sonstige_artikel (tenant_id, name, einheit, bestand_fuehren) VALUES (v_m, 'S112TEST Fremdsaft', 'Stk', true) RETURNING id INTO v_ma;
  INSERT INTO public.sonstige_artikel_bewegungen (tenant_id, artikel_id, datum, art, menge) VALUES (v_m, v_ma, v_heute, 'zugang', 9) RETURNING id INTO v_mb;
  v_mp := (pg_temp.s112_beispiel('verkaufsposten', v_m, NULL, jsonb_build_object('datum', v_heute, 'storniert', false)) ->> 'id')::uuid;
  INSERT INTO public.sonstige_artikel_bewegungen (tenant_id, artikel_id, datum, art, menge, verkauf_position_id, verkaufsposten_id)
  SELECT v_m, v_ma, v_heute, 'verkauf', -1, (pg_temp.s112_beispiel('verkauf_positionen', v_m, NULL, jsonb_build_object('verkaufsposten_id', v_mp, 'typ', 'sonstiges',
    'sonstige_artikel_id', v_ma, 'menge', 1, 'fuellung_id', NULL, 'weinausbau_id', NULL, 'traubenverkauf_id', NULL)) ->> 'id')::uuid, v_mp;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('idor_artikel_buchen',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_artikel_buchen(%L::uuid, %L::uuid, %L::date, %L, 5, NULL)', v_b, v_ma, v_heute, 'zugang')), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('idor_bewegung_stornieren',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_artikel_bewegung_stornieren(%L::uuid, %L::uuid, %L)', v_b, v_mb, 'S112TEST fremde Buchung')), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('idor_verkauf_buchen',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_artikel_verkauf_buchen(%L::uuid, %L::uuid)', v_b, v_mp)), ':', 1), 'P0002');
  PERFORM pg_temp.s112_fehlertext(format('SELECT public.s112_artikel_verkauf_stornieren(%L::uuid, %L::uuid, %L)', v_b, v_mp, 'S112TEST fremder Verkauf'));
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('idor_verkauf_stornieren_wirkungslos', public.s112_artikel_bestand(v_ma), 8::numeric);

  -- ── 6. Mandanten-Löschung mit Lagerbewegungen, Verkauf und Stoffkonto (KAN-107) ──────────────────────
  v_l := pg_temp.s112_betrieb('Löschtest Lager');
  INSERT INTO public.sonstige_artikel (tenant_id, name, einheit, bestand_fuehren) VALUES (v_l, 'S112TEST Essig', 'Stk', true) RETURNING id INTO v_la;
  v_lw := (pg_temp.s112_beispiel('weinausbau', v_l, NULL, '{"menge_liter": "100"}') ->> 'id')::uuid;
  v_lv := (pg_temp.s112_beispiel('keller_verarbeitungen', v_l, NULL, jsonb_build_object('weinausbau_id', v_lw, 'datum', v_heute, 'menge_liter', 10, 'zweck', 'essig', 'storniert_am', NULL)) ->> 'id')::uuid;
  INSERT INTO public.sonstige_artikel_bewegungen (tenant_id, artikel_id, datum, art, menge, keller_verarbeitung_id) VALUES (v_l, v_la, v_heute, 'verarbeitung', 10, v_lv);
  v_lp := (pg_temp.s112_beispiel('verkaufsposten', v_l, NULL, jsonb_build_object('datum', v_heute)) ->> 'id')::uuid;
  INSERT INTO public.sonstige_artikel_bewegungen (tenant_id, artikel_id, datum, art, menge, verkauf_position_id, verkaufsposten_id)
  SELECT v_l, v_la, v_heute, 'verkauf', -2, (pg_temp.s112_beispiel('verkauf_positionen', v_l, NULL, jsonb_build_object('verkaufsposten_id', v_lp, 'typ', 'sonstiges',
    'sonstige_artikel_id', v_la, 'menge', 2, 'fuellung_id', NULL, 'weinausbau_id', NULL, 'traubenverkauf_id', NULL)) ->> 'id')::uuid, v_lp;
  INSERT INTO public.kellermittel (tenant_id, name, einheit) VALUES (v_l, 'S112TEST Saccharose', 'kg') RETURNING id INTO v_lkm;
  v_lkb := (pg_temp.s112_beispiel('keller_behandlungen', v_l, NULL, jsonb_build_object('weinausbau_id', v_lw)) ->> 'id')::uuid;
  INSERT INTO public.kellermittel_buchungen (tenant_id, kellermittel_id, datum, art, menge, keller_behandlung_id, weinausbau_id)
  VALUES (v_l, v_lkm, v_heute, 'verwendung', -3, v_lkb, v_lw);
  v_t := pg_temp.s112_fehlertext(format('SELECT public.s112_mandant_loeschen(%L::uuid, %L)', v_l, 'S112TEST Löschtest Lager'));
  v_erg := v_erg || pg_temp.s112_erwarte('mandant_loeschen_ok', v_t, 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('mandant_ohne_reste',
    (SELECT count(*) FROM public.sonstige_artikel_bewegungen WHERE tenant_id = v_l) + (SELECT count(*) FROM public.kellermittel_buchungen WHERE tenant_id = v_l), 0::bigint);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 25);
END $test$;
