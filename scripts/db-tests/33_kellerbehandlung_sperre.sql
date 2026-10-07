-- @bereich: Kellerbehandlung – Kellerbuch-Periodensperre und Sperre bei Chargen mit Prüfnummer (KAN-206)
-- @ziel: Lag die Charge am Tag der Behandlung unter einer gültigen Prüfnummer, sind nach dem Speichern nur Notizen und
-- @ziel: Storno änderbar (42501, HINT freeze); Behandlungen ohne Prüfnummer bzw. vor deren Beginn bleiben änderbar.
-- @ziel: Die Betriebsleitung korrigiert über s112_freeze_korrektur. Im abgeschlossenen Kellerbuch-Zeitraum lehnt die
-- @ziel: Datenbank Anlegen und Ändern ab (a_periodensperre), danach ist Anlegen möglich.
-- @mutation freeze_aus: kein Freeze-Trigger auf keller_behandlungen | rot: gesperrt_.*
-- @mutation periode_aus: keine Periodensperre auf keller_behandlungen | rot: periode_.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 33 (Stand 05.10.2026, KAN-206). Alles zurückgerollt.

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;   -- wie die RPCs (Wiener Zeit, nicht UTC)
  c_datei constant text := '33_kellerbehandlung_sperre';
  c_rpc   constant text := 'SELECT public.s112_pruefnummernantrag_status_setzen(%L::uuid, %L::uuid, %L, %L::date, %L, %L)';
  c_upd   constant text := 'UPDATE public.keller_behandlungen SET %s WHERE id = %L';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_bta   uuid;
  v_wa    uuid;
  v_wb    uuid;
  v_d     uuid;
  v_typ   uuid;
  v_k1    uuid;
  v_k2    uuid;
  v_k3    uuid;
  v_k4    uuid;
  v_txt   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ───────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_wa := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "1000", "qualitaetsstufe": "qualitaetswein"}') ->> 'id')::uuid;
  v_wb := (pg_temp.s112_beispiel('weinausbau', v_b, NULL, '{"menge_liter": "500", "qualitaetsstufe": "qualitaetswein"}') ->> 'id')::uuid;
  v_d := (pg_temp.s112_beispiel('dac_antrag', v_b, NULL, jsonb_build_object('weinausbau_id', v_wa, 'menge_liter', 1000)) ->> 'id')::uuid;
  v_typ := (pg_temp.s112_beispiel('keller_behandlungstypen', v_b, NULL, '{"name": "S112TEST Schwefelung", "pn_wirkung": "pflege"}') ->> 'id')::uuid;

  -- ── Mutationen ────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('freeze_aus', $m$DROP TRIGGER a_freeze ON public.keller_behandlungen$m$);
  PERFORM pg_temp.s112_mutiere('periode_aus', $m$DROP TRIGGER a_periodensperre ON public.keller_behandlungen$m$);

  -- Antrag eingereicht vor 20 Tagen → Prüfnummer der Charge v_wa gilt ab dann
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('einreichen',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_d, 'eingereicht', v_heute - 20, NULL, NULL)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_k1 := (pg_temp.s112_beispiel('keller_behandlungen', v_b, NULL, jsonb_build_object('weinausbau_id', v_wa, 'typ_id', v_typ, 'datum', v_heute - 5, 'menge', 10)) ->> 'id')::uuid;
  v_k2 := (pg_temp.s112_beispiel('keller_behandlungen', v_b, NULL, jsonb_build_object('weinausbau_id', v_wb, 'typ_id', v_typ, 'datum', v_heute - 5, 'menge', 10)) ->> 'id')::uuid;
  v_k3 := (pg_temp.s112_beispiel('keller_behandlungen', v_b, NULL, jsonb_build_object('weinausbau_id', v_wa, 'typ_id', v_typ, 'datum', v_heute - 30, 'menge', 10)) ->> 'id')::uuid;
  v_k4 := (pg_temp.s112_beispiel('keller_behandlungen', v_b, NULL, jsonb_build_object('weinausbau_id', v_wa, 'typ_id', v_typ, 'datum', v_heute - 1, 'menge', 10)) ->> 'id')::uuid;

  -- ── 1. Sperre bei Charge mit Prüfnummer ───────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('erlaubt_notizen',
    pg_temp.s112_versuch(format(c_upd, format('notizen = %L', 'S112TEST Notiz'), v_k1)), 'k1');
  v_txt := pg_temp.s112_fehlertext(format(c_upd, 'menge = 12', v_k1));
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_menge',
    v_txt LIKE '42501: Gesperrt: Behandlung einer Charge mit Prüfnummer am % (nicht: menge).%HINT: freeze', true);
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_datum',
    pg_temp.s112_versuch(format(c_upd, 'datum = datum - 1', v_k1)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrt_charge',
    pg_temp.s112_versuch(format(c_upd, format('weinausbau_id = %L', v_wb), v_k1)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('frei_ohne_pruefnummer',
    pg_temp.s112_versuch(format(c_upd, 'menge = 12', v_k2)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('frei_vor_pruefnummer',
    pg_temp.s112_versuch(format(c_upd, 'menge = 12', v_k3)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('storno_erlaubt',
    pg_temp.s112_versuch(format(c_upd, format('storniert_am = now(), storno_grund = %L', 'S112TEST Storno-Grund'), v_k1)), 'k1');

  -- ── 2. Korrektur durch die Betriebsleitung ────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('korrektur_mitarbeiter',
    split_part(pg_temp.s112_fehlertext(format('SELECT public.s112_freeze_korrektur(%L, %L, %L, %L::jsonb, %L)',
      v_b, 'keller_behandlungen', v_k4, '{"menge": 11}', 'S112TEST Tippfehler Menge')), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('korrektur_betriebsleitung',
    pg_temp.s112_fehlertext(format('SELECT public.s112_freeze_korrektur(%L, %L, %L, %L::jsonb, %L)',
      v_b, 'keller_behandlungen', v_k4, '{"menge": 11}', 'S112TEST Tippfehler Menge')), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('korrektur_wert',
    (SELECT k.menge = 11 FROM public.keller_behandlungen k WHERE k.id = v_k4), true);

  -- ── 3. Kellerbuch-Periodensperre ──────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('abschliessen',
    pg_temp.s112_fehlertext(format('SELECT public.kellerbuch_abschliessen(%L, pg_temp.s112_heute() - 3)', v_b)), 'ok');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('periode_anlegen',
    pg_temp.s112_versuch(format('INSERT INTO public.keller_behandlungen (tenant_id, behaelter_id, typ_id, typ_name_snapshot, datum, menge, einheit, weinausbau_id) '
      || 'SELECT tenant_id, behaelter_id, typ_id, typ_name_snapshot, pg_temp.s112_heute() - 4, 1, einheit, weinausbau_id FROM public.keller_behandlungen WHERE id = %L', v_k2)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('periode_aendern',
    pg_temp.s112_versuch(format(c_upd, 'menge = 13', v_k2)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('nach_abschluss_anlegen',
    pg_temp.s112_versuch(format('INSERT INTO public.keller_behandlungen (tenant_id, behaelter_id, typ_id, typ_name_snapshot, datum, menge, einheit, weinausbau_id) '
      || 'SELECT tenant_id, behaelter_id, typ_id, typ_name_snapshot, pg_temp.s112_heute(), 1, einheit, weinausbau_id FROM public.keller_behandlungen WHERE id = %L', v_k2)), 'k1');

  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('kennzeichen_leer', coalesce(current_setting('s112.freeze_frei', true), ''), '');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 16);
END $test$;
