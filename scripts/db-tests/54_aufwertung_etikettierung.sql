-- @bereich: Aufwertungssperre der Charge und Etikettierung (KAN-41 Paket 3e/3d)
-- @ziel: 3e – Ohne Folgebuchung darf die Qualitätsstufe einer Charge korrigiert werden; danach lehnt die Datenbank eine
-- @ziel: höhere oder entfernte Stufe ab (42501, HINT aufwertung). Erlaubt bleiben Abstufungen, die Rücknahme auf den
-- @ziel: Stand vor einem noch aktiven Verschnitt (Storno) und die Korrektur der Betriebsleitung (s112_freeze_korrektur).
-- @ziel: 3d – Unetikettiert abgefüllte Flaschen dürfen nicht verkauft bzw. ausgebucht werden; „Etikettieren“ (RPC) senkt
-- @ziel: den unetikettierten Bestand, ein Storno hebt ihn wieder (nicht über den Flaschenbestand); fremde Füllung bzw.
-- @ziel: Etikettierung und Leser werden abgelehnt.
-- @mutation aufwertung_frei: Trigger lässt jede Aufwertung durch | rot: aufwertung_gesperrt
-- @mutation etikett_frei: unetikettierte Flaschen dürfen ausgebucht werden | rot: bruch_unetikettiert
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 54 (Stand 06.10.2026, KAN-41). Alles zurückgerollt.

CREATE FUNCTION pg_temp.t54_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_alt text := pg_get_functiondef(p_fn);
  v_neu text;
BEGIN
  v_neu := regexp_replace(v_alt, p_muster, p_ersatz);
  IF v_neu = v_alt THEN
    RAISE EXCEPTION 't54_ersetze: Muster % greift nicht in %', p_muster, p_fn;
  END IF;
  EXECUTE v_neu;
END $f$;

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;   -- wie die RPCs (Wiener Zeit, nicht UTC)
  c_datei constant text := '54_aufwertung_etikettierung';
  c_upd   constant text := 'UPDATE public.weinausbau SET qualitaetsstufe = %L WHERE id = %L';
  c_etk   constant text := 'SELECT public.s112_fuellung_etikettieren(%L::uuid, %L::uuid, pg_temp.s112_heute(), %s, NULL)';
  c_bruch constant text := 'SELECT public.fuellung_bestand_buchen(%L::uuid, %L::uuid, %L, pg_temp.s112_heute(), %s, NULL, %L)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bw    uuid;
  v_bta   uuid;
  v_bl    uuid;
  v_wa    uuid;
  v_fe    uuid;
  v_fm    uuid;
  v_et    uuid;
  v_etm   uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ──────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_wa := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "500", "status": "ausbau", "aktiv": true, "storniert_am": null, "qualitaetsstufe": "landwein"}') ->> 'id')::uuid;
  v_fe := (pg_temp.s112_beispiel('fuellungen', v_b, v_bw, jsonb_build_object('anzahl_flaschen', 10, 'bestand_flaschen', 10,
    'anzahl_unetikettiert', 6, 'datum', v_heute - 1, 'storniert_am', NULL)) ->> 'id')::uuid;
  v_fm := (pg_temp.s112_beispiel('fuellungen', v_m, NULL, '{"anzahl_flaschen": 10, "bestand_flaschen": 10, "anzahl_unetikettiert": 5, "storniert_am": null}') ->> 'id')::uuid;
  v_etm := (pg_temp.s112_beispiel('fuellung_etikettierungen', v_m, NULL, jsonb_build_object('fuellung_id', v_fm, 'datum', v_heute,
    'menge_stk', 1, 'storniert_am', NULL)) ->> 'id')::uuid;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('aufwertung_frei',
    $m$SELECT pg_temp.t54_ersetze('public.s112_aufwertung_sperre()'::regprocedure,
      $r$IF NOT public\.s112_charge_hat_folgebuchung\(NEW\.id\) THEN$r$, $r$IF true THEN$r$)$m$);
  PERFORM pg_temp.s112_mutiere('etikett_frei',
    $m$SELECT pg_temp.t54_ersetze('public.s112_etikett_bestand()'::regprocedure,
      $r$IF NEW\.storniert_am IS NULL AND NEW\.bestand_unetikettiert > NEW\.bestand_flaschen THEN$r$, $r$IF false THEN$r$)$m$);

  -- ── 1. Aufwertung (3e) ────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_folgebuchung_korrigierbar',
    pg_temp.s112_fehlertext(format(c_upd, 'qualitaetswein', v_wa)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  PERFORM pg_temp.s112_beispiel('keller_behandlungen', v_b, v_bw, jsonb_build_object('weinausbau_id', v_wa, 'storniert_am', NULL));
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('aufwertung_gesperrt',
    pg_temp.s112_fehlertext(format(c_upd, 'kabinett', v_wa)) LIKE '42501: Aufwertung nicht zulässig%HINT: aufwertung%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('stufe_entfernen_gesperrt',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.weinausbau SET qualitaetsstufe = NULL WHERE id = %L', v_wa)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('abstufung_erlaubt',
    pg_temp.s112_fehlertext(format(c_upd, 'wein', v_wa)), 'ok');
  -- Rücknahme beim Verschnitt-Storno: zurück auf ziel_qualitaet_vorher der noch aktiven Buchung
  PERFORM pg_temp.s112_als_postgres();
  PERFORM pg_temp.s112_beispiel('verschneidungen', v_b, v_bw, jsonb_build_object('ziel_weinausbau_id', v_wa,
    'ziel_qualitaet_vorher', 'qualitaetswein', 'storniert_am', NULL));
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('ruecknahme_storno',
    pg_temp.s112_fehlertext(format(c_upd, 'qualitaetswein', v_wa)), 'ok');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('korrektur_betriebsleitung',
    pg_temp.s112_fehlertext(format('SELECT public.s112_freeze_korrektur(%L, %L, %L, %L::jsonb, %L)', v_b, 'weinausbau', v_wa,
      '{"qualitaetsstufe": "auslese"}', 'S112TEST Korrektur Stufe')), 'ok');

  -- ── 2. Etikettierung (3d) ─────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('unetikettiert_beim_anlegen',
    (SELECT concat_ws('|', f.anzahl_unetikettiert, f.bestand_unetikettiert) FROM public.fuellungen f WHERE f.id = v_fe), '6|6');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('bruch_unetikettiert',
    split_part(pg_temp.s112_fehlertext(format(c_bruch, v_b, v_fe, 'bruch', -5, 'S112TEST Bruch')), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('etikettieren_ok',
    pg_temp.s112_fehlertext(format(c_etk, v_b, v_fe, 4)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('bestand_unetikettiert',
    (SELECT f.bestand_unetikettiert::text FROM public.fuellungen f WHERE f.id = v_fe), '2');
  SELECT e.id INTO v_et FROM public.fuellung_etikettierungen e WHERE e.fuellung_id = v_fe;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('bruch_etikettiert_ok',
    pg_temp.s112_fehlertext(format(c_bruch, v_b, v_fe, 'bruch', -5, 'S112TEST Bruch')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('mehr_als_unetikettiert',
    split_part(pg_temp.s112_fehlertext(format(c_etk, v_b, v_fe, 3)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('fremde_fuellung',
    split_part(pg_temp.s112_fehlertext(format(c_etk, v_b, v_fm, 1)), ':', 1), 'P0002');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_fremd',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_etikettierung_stornieren(%L, %L, %L)', v_b, v_etm, 'S112TEST fremde Buchung')), ':', 1), 'P0002');
  -- Storno: 4 Flaschen wieder ohne Etikett → 6 > Bestand 5 → abgelehnt
  v_erg := v_erg || pg_temp.s112_erwarte('storno_ueber_bestand',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_etikettierung_stornieren(%L, %L, %L)', v_b, v_et, 'S112TEST zu spät')), ':', 1), '23514');
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_nicht',
    split_part(pg_temp.s112_fehlertext(format(c_etk, v_b, v_fe, 1)), ':', 1), '42501');
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 15);
END $test$;
