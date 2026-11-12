-- @bereich: Weinexport – Exportauftrag bearbeiten (KAN-429)
-- @ziel: Ein Exportauftrag lässt sich in Entwurf und Bestätigt über s112_exportauftrag_aendern ändern (Kopf und Positionen
-- @ziel: in einer Transaktion, ausgestellte Dokumente zurück auf ausstehend). Ab Versendet ist er gesperrt – über die RPC
-- @ziel: und direkt (Kopf und Positionen); Status, EMCS und Verpackung bleiben änderbar. Positionen ohne Menge über 0
-- @ziel: werden abgelehnt. Leser, Mitarbeiter ohne Warenwirtschaft, fremde Betriebe und Betriebe ohne Export-Modul nicht.
-- @mutation ohne_freeze: Trigger a_freeze an exportauftraege entfernt | rot: direkt_kopf_gesperrt
-- @mutation ohne_mengenpruefung: s112_exportauftrag_aendern prüft die Menge nicht | rot: menge_null
-- @mutation ohne_modul: s112_pruefe_schreibmodul prüft nichts mehr | rot: ohne_warenwirtschaft
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 09 (Stand 12.11.2026, KAN-429; die Nummern 10–99 sind vergeben). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '09_exportauftrag_aendern';
  c_rpc   constant text := 'SELECT public.s112_exportauftrag_aendern(%L::uuid, %L::uuid, %L::jsonb, %L::jsonb)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_bx    uuid;
  v_f     uuid;
  v_fm    uuid;
  v_auf   uuid;
  v_auf_m uuid;
  v_pos   uuid;
  v_kopf  jsonb;
  v_ok    jsonb;
  v_def   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_bx := pg_temp.s112_benutzer('winzer', v_b, ARRAY['crm']);   -- Mitarbeiter ohne Warenwirtschaft
  UPDATE public.tenant_einstellungen SET modul_export = true WHERE tenant_id IN (v_b, v_m);
  v_f := (pg_temp.s112_zeile('fuellungen', v_b, jsonb_build_object('name', 'S112TEST Export', 'anzahl_flaschen', 600, 'bestand_flaschen', 600, 'aktiv', true)) ->> 'id')::uuid;
  v_fm := (pg_temp.s112_zeile('fuellungen', v_m, jsonb_build_object('name', 'S112TEST fremd', 'anzahl_flaschen', 10, 'bestand_flaschen', 10, 'aktiv', true)) ->> 'id')::uuid;
  v_auf := (pg_temp.s112_beispiel('exportauftraege', v_b, v_bw, jsonb_build_object('status', 'entwurf', 'storniert_am', NULL, 'datum', pg_temp.s112_heute())) ->> 'id')::uuid;
  v_auf_m := (pg_temp.s112_beispiel('exportauftraege', v_m, NULL, jsonb_build_object('status', 'entwurf', 'storniert_am', NULL)) ->> 'id')::uuid;
  INSERT INTO public.exportauftrag_positionen (exportauftrag_id, beschreibung, menge, einheit, preis_eur, sort_order)
  VALUES (v_auf, 'S112TEST alt', 0, 'Fl', 0, 0);
  INSERT INTO public.export_dokumente (exportauftrag_id, dokument_art, status, ausgestellt_am) VALUES (v_auf, 'eur1', 'ausgestellt', pg_temp.s112_heute()), (v_auf, 'rechnung', 'ausstehend', NULL);
  v_kopf := jsonb_build_object('datum', pg_temp.s112_heute(), 'incoterms', 'DAP', 'transport_art', 'LKW', 'destination_land', 'DE', 'destination_stadt', ' München ', 'verpackung_kg', 40,
    'versanddatum', pg_temp.s112_heute(), 'zahlungsbedingungen', ' S112TEST 30 Tage netto ', 'kunde_uid', ' de 123456789 ');   -- KAN-432
  v_ok := jsonb_build_array(jsonb_build_object('fullung_id', v_f, 'beschreibung', 'S112TEST A', 'menge', 60, 'einheit', 'Fl', 'preis_eur', 9.5, 'flaschen_je_karton', '6'),
                            jsonb_build_object('beschreibung', 'S112TEST B', 'menge', '2', 'einheit', 'HL', 'preis_eur', ''));

  SELECT pg_get_functiondef('public.s112_exportauftrag_aendern(uuid, uuid, jsonb, jsonb)'::regprocedure) INTO v_def;
  PERFORM pg_temp.s112_mutiere('ohne_freeze', $m$DROP TRIGGER a_freeze ON public.exportauftraege$m$);
  PERFORM pg_temp.s112_mutiere('ohne_mengenpruefung', replace(v_def, 'IF v_m IS NULL OR v_m <= 0 THEN', 'IF false THEN'));
  PERFORM pg_temp.s112_mutiere('ohne_modul',
    $m$CREATE OR REPLACE FUNCTION public.s112_pruefe_schreibmodul(p_tenant_id uuid, VARIADIC p_module text[]) RETURNS void
       LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$ BEGIN RETURN; END $f$$m$);

  -- ── 1. Wer nicht darf ───────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, v_kopf, v_ok)), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bx);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_warenwirtschaft',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, v_kopf, v_ok)), ':', 1), '42501');
  PERFORM pg_temp.s112_als((v_a ->> 'm_ta')::uuid);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, v_kopf, v_ok)), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_auftrag',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf_m, v_kopf, v_ok)), ':', 1), 'P0002');

  -- ── 2. Prüfungen, dann Ändern im Entwurf ────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('menge_null',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, v_kopf, jsonb_build_array(jsonb_build_object('beschreibung', 'S112TEST', 'menge', 0)))), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('menge_fehlt',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, v_kopf, jsonb_build_array(jsonb_build_object('beschreibung', 'S112TEST', 'menge', '')))), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_fuellung_und_text',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, v_kopf, jsonb_build_array(jsonb_build_object('menge', 5)))), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('einheit_unbekannt',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, v_kopf, jsonb_build_array(jsonb_build_object('beschreibung', 'S112TEST', 'menge', 5, 'einheit', 'Palette')))), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_datum',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, v_kopf - 'datum', v_ok)), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('fremde_fuellung',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, v_kopf, jsonb_build_array(jsonb_build_object('fullung_id', v_fm, 'menge', 5)))) <> 'ok', true);
  -- nach den Ablehnungen ist nichts geändert (alles oder nichts)
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('nichts_geaendert',
    (SELECT count(*) || '/' || coalesce(max(beschreibung), '') FROM public.exportauftrag_positionen WHERE exportauftrag_id = v_auf), '1/S112TEST alt');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('aendern_entwurf',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, v_kopf, v_ok)), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('positionen_ersetzt',
    (SELECT string_agg(beschreibung || '=' || menge::numeric(10,0) || ' ' || einheit || '#' || sort_order, ', ' ORDER BY sort_order) FROM public.exportauftrag_positionen WHERE exportauftrag_id = v_auf),
    'S112TEST A=60 Fl#0, S112TEST B=2 HL#1');
  v_erg := v_erg || pg_temp.s112_erwarte('kopf_geaendert',
    (SELECT incoterms || '/' || destination_stadt || '/' || verpackung_kg::numeric(10,0) FROM public.exportauftraege WHERE id = v_auf), 'DAP/München/40');
  -- KAN-432: Grunddaten – UID bereinigt (ohne Leerzeichen, groß), Text getrimmt, Flaschen je Karton je Position (lose Ware ohne)
  v_erg := v_erg || pg_temp.s112_erwarte('grunddaten_kopf',
    (SELECT concat_ws('/', (versanddatum = pg_temp.s112_heute())::text, zahlungsbedingungen, kunde_uid) FROM public.exportauftraege WHERE id = v_auf),
    'true/S112TEST 30 Tage netto/DE123456789');
  v_erg := v_erg || pg_temp.s112_erwarte('grunddaten_karton',
    (SELECT string_agg(coalesce(flaschen_je_karton::text, '-'), ',' ORDER BY sort_order) FROM public.exportauftrag_positionen WHERE exportauftrag_id = v_auf), '6,-');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('karton_ungueltig',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, v_kopf, jsonb_build_array(jsonb_build_object('beschreibung', 'S112TEST', 'menge', 1, 'flaschen_je_karton', '61')))), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('betrieb_vorgabe_lesbar',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.tenant_einstellungen WHERE tenant_id = %L AND export_flaschen_je_karton = 6 AND NOT kleiner_weinerzeuger', v_b)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('betrieb_vorgabe_nicht_direkt',
    left(pg_temp.s112_versuch(format('UPDATE public.tenant_einstellungen SET export_flaschen_je_karton = 12, betrieb_eori = %L WHERE tenant_id = %L', 'ATEOS1', v_b)), 1) <> 'k', true);
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('dokumente_zurueck',
    (SELECT string_agg(dokument_art || '=' || status || coalesce('!' || ausgestellt_am, ''), ', ' ORDER BY dokument_art) FROM public.export_dokumente WHERE exportauftrag_id = v_auf),
    'eur1=ausstehend, rechnung=ausstehend');

  -- ── 3. Bestätigt: weiter bearbeitbar ────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('status_bestaetigt',
    pg_temp.s112_fehlertext(format('UPDATE public.exportauftraege SET status = %L WHERE id = %L', 'bestaetigt', v_auf)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('aendern_bestaetigt',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, v_kopf || '{"incoterms": "EXW"}', v_ok)), 'ok');

  -- ── 4. Versendet: gesperrt – RPC und direkt ─────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('status_versendet',
    pg_temp.s112_fehlertext(format('UPDATE public.exportauftraege SET status = %L WHERE id = %L', 'versendet', v_auf)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('aendern_versendet',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, v_kopf, v_ok)) LIKE '42501:%versendet%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_kopf_gesperrt',
    pg_temp.s112_versuch(format('UPDATE public.exportauftraege SET lieferdatum = pg_temp.s112_heute() WHERE id = %L', v_auf)), 'T');
  -- KAN-432: die neuen Spalten stehen nicht in der Positivliste – ab „Versendet“ gesperrt
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_grunddaten_gesperrt',
    pg_temp.s112_versuch(format('UPDATE public.exportauftraege SET versanddatum = pg_temp.s112_heute() - 1, kunde_uid = %L WHERE id = %L', 'DE999', v_auf)), 'T');
  PERFORM pg_temp.s112_als_postgres();
  SELECT id INTO v_pos FROM public.exportauftrag_positionen WHERE exportauftrag_id = v_auf ORDER BY sort_order LIMIT 1;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_position_gesperrt',
    pg_temp.s112_versuch(format('UPDATE public.exportauftrag_positionen SET menge = 1 WHERE id = %L', v_pos)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_position_neu_gesperrt',
    pg_temp.s112_versuch(format('INSERT INTO public.exportauftrag_positionen (exportauftrag_id, beschreibung, menge) VALUES (%L, %L, 1)', v_auf, 'S112TEST neu')), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('erlaubt_bleibt_aenderbar',
    pg_temp.s112_versuch(format('UPDATE public.exportauftraege SET verpackung_kg = 55, emcs_status = %L WHERE id = %L', 'eingereicht', v_auf)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('dokument_bleibt_aenderbar',
    pg_temp.s112_versuch(format('UPDATE public.export_dokumente SET status = %L WHERE exportauftrag_id = %L AND dokument_art = %L', 'ausgestellt', v_auf, 'eur1')), 'k1');

  -- ── 5. Zurückstufen hebt die Sperre auf (Status ist die Steuerung) ──────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('zurueckstufen',
    pg_temp.s112_fehlertext(format('UPDATE public.exportauftraege SET status = %L WHERE id = %L', 'bestaetigt', v_auf)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('aendern_nach_zurueckstufen',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, v_kopf, v_ok)), 'ok');

  -- ── 6. Ohne Export-Modul, Rechte ────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.tenant_einstellungen SET modul_export = false WHERE tenant_id = v_b;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_export_modul',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, v_kopf, v_ok)), ':', 1), '42501');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('rechte',
    has_function_privilege('anon', 'public.s112_exportauftrag_aendern(uuid, uuid, jsonb, jsonb)', 'EXECUTE'), false);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 34);
END $test$;
