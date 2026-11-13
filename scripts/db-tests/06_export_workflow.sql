-- @bereich: Weinexport – Statuswechsel des Exportauftrags mit Prüfung, Ausfuhr- und Gelangensnachweis (KAN-440)
-- @ziel: Der Status ändert sich nur über s112_exportauftrag_status_setzen: Entwurf → Bestätigt → Versendet → Abgeschlossen,
-- @ziel: je ein Schritt; „Versendet“ nur mit Rechnung bzw. ausgebuchtem Muster; zurück nur die Betriebsleitung mit Grund,
-- @ziel: auf „Entwurf“ nur ohne Rechnung/Muster; „Abgeschlossen“ ist endgültig. Direkt (Update, Insert mit Status) geht
-- @ziel: es nicht. Der Grund steht im Änderungsprotokoll. Leser, fremde Betriebe und Betriebe ohne Export-Modul nicht.
-- @mutation ohne_schutz: Trigger a_export_workflow entfernt | rot: direkt_.*
-- @mutation ohne_rechnungspruefung: „Versendet“ auch ohne Rechnung bzw. Muster | rot: versendet_ohne_.*
-- @mutation ohne_rollenpruefung: Zurückstufen prüft die Betriebsleitung nicht | rot: zurueck_mitarbeiter
-- @ziel: Teil 2: Nachweise (export_nachweise) legt ein Mitarbeiter direkt an und entfernt sie – nie ändern, nicht mit
-- @ziel: Datum in der Zukunft, nicht im fremden Ordner bzw. Betrieb, nicht als Leser. „Abgeschlossen“ nur mit Nachweis
-- @ziel: oder Begründung (steht dann am Auftrag); Mustersendungen ohne. Danach sind Nachweise und die Angaben zur
-- @ziel: Ausfuhranmeldung (MRN, Datum) gesperrt; die Begründung setzt nur der Statuswechsel.
-- @mutation ohne_nachweispruefung: „Abgeschlossen“ auch ohne Nachweis und ohne Begründung | rot: abschluss_ohne_nachweis
-- @mutation ohne_nachweis_schutz: Trigger a_nachweis_schutz entfernt | rot: nachweis_zukunft|nachweis_gesperrt_.*
-- @ziel: KAN-437 Teil 3: Die länderspezifischen Belegnummern (laender_belege, Liste mit höchstens 20 Einträgen) bleiben
-- @ziel: mit Rechnung und ab „Versendet“ änderbar und sind nach „Abgeschlossen“ gesperrt.
-- @mutation belege_nach_abschluss: der Schutz kennt die Belegnummern nicht | rot: belege_gesperrt
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 06 (Stand 13.11.2026, KAN-440). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '06_export_workflow';
  c_rpc   constant text := 'SELECT public.s112_exportauftrag_status_setzen(%L::uuid, %L::uuid, %L, %L)';
  c_fn    constant regprocedure := 'public.s112_exportauftrag_status_setzen(uuid, uuid, text, text)'::regprocedure;
  c_nw    constant text := 'INSERT INTO public.export_nachweise (tenant_id, exportauftrag_id, art, datum, datei_pfad, dateiname) VALUES (%L, %L, %L, %L, %L, %L)';
  c_mrn   constant text := 'UPDATE public.exportauftraege SET ausfuhr_mrn = %L, ausfuhr_anmeldung_datum = %L WHERE id = %L';
  c_bel   constant text := 'UPDATE public.exportauftraege SET laender_belege = %L::jsonb WHERE id = %L';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_m     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_bta   uuid;
  v_mw    uuid;
  v_auf   uuid;
  v_mus   uuid;
  v_sto   uuid;
  v_ohn   uuid;
  v_heute date;
  v_vp    uuid := gen_random_uuid();
  v_n     bigint;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_mw := (v_a ->> 'm_w')::uuid;
  UPDATE public.tenant_einstellungen SET modul_export = true WHERE tenant_id IN (v_b, v_m);
  v_auf := (pg_temp.s112_beispiel('exportauftraege', v_b, v_bw, jsonb_build_object('status', 'entwurf', 'storniert_am', NULL,
    'datum', pg_temp.s112_heute(), 'destination_land', 'US', 'mustersendung', false)) ->> 'id')::uuid;
  v_mus := (pg_temp.s112_beispiel('exportauftraege', v_b, v_bw, jsonb_build_object('status', 'bestaetigt', 'storniert_am', NULL,
    'datum', pg_temp.s112_heute(), 'destination_land', 'US', 'mustersendung', true)) ->> 'id')::uuid;
  v_sto := (pg_temp.s112_beispiel('exportauftraege', v_b, v_bw, jsonb_build_object('status', 'entwurf', 'storniert_am', NULL,
    'datum', pg_temp.s112_heute(), 'destination_land', 'US', 'mustersendung', false)) ->> 'id')::uuid;
  v_heute := pg_temp.s112_heute();
  v_ohn := (pg_temp.s112_beispiel('exportauftraege', v_b, v_bw, jsonb_build_object('status', 'versendet', 'storniert_am', NULL,
    'datum', v_heute, 'destination_land', 'US', 'mustersendung', false)) ->> 'id')::uuid;
  PERFORM pg_temp.s112_zeile('verkaufsposten', v_b, jsonb_build_object('id', v_vp, 'rechnung_spaeter', true, 'steuerfall', 'ausfuhr', 'lieferland', 'US'));

  PERFORM pg_temp.s112_mutiere('ohne_schutz', $m$DROP TRIGGER a_export_workflow ON public.exportauftraege$m$);
  PERFORM pg_temp.s112_mutiere('ohne_rechnungspruefung', $m$DO $d$ BEGIN
    EXECUTE replace(pg_get_functiondef('public.s112_exportauftrag_status_setzen(uuid, uuid, text, text)'::regprocedure),
      $a$IF p_status = 'versendet' AND v_a.verkaufsposten_id IS NULL$a$, $a$IF p_status = 'nie' AND v_a.verkaufsposten_id IS NULL$a$);
  END $d$$m$);
  PERFORM pg_temp.s112_mutiere('ohne_nachweispruefung', $m$DO $d$ BEGIN
    EXECUTE replace(pg_get_functiondef('public.s112_exportauftrag_status_setzen(uuid, uuid, text, text)'::regprocedure),
      $a$IF p_status = 'abgeschlossen' AND NOT coalesce(v_a.mustersendung, false)$a$, $a$IF p_status = 'nie' AND NOT coalesce(v_a.mustersendung, false)$a$);
  END $d$$m$);
  PERFORM pg_temp.s112_mutiere('ohne_nachweis_schutz', $m$DROP TRIGGER a_nachweis_schutz ON public.export_nachweise$m$);
  PERFORM pg_temp.s112_mutiere('belege_nach_abschluss', $m$DO $d$ BEGIN
    EXECUTE replace(pg_get_functiondef('public.s112_export_workflow_schutz()'::regprocedure),
      $a$NEW.laender_belege IS DISTINCT FROM OLD.laender_belege$a$, $a$false$a$);
  END $d$$m$);
  PERFORM pg_temp.s112_mutiere('ohne_rollenpruefung', $m$DO $d$ BEGIN
    EXECUTE replace(pg_get_functiondef('public.s112_exportauftrag_status_setzen(uuid, uuid, text, text)'::regprocedure),
      $a$IF v_uid IS NOT NULL AND NOT EXISTS ($a$, $a$IF v_uid IS NULL AND NOT EXISTS ($a$);
  END $d$$m$);

  -- ── 1. Direkt geht es nicht: Update und Insert mit Status ────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_update',
    pg_temp.s112_fehlertext(format('UPDATE public.exportauftraege SET status = %L WHERE id = %L', 'bestaetigt', v_auf)) LIKE '42501:%nur über den Statuswechsel%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_insert',
    split_part(pg_temp.s112_fehlertext(format('INSERT INTO public.exportauftraege (tenant_id, datum, status) VALUES (%L, %L, %L)', v_b, pg_temp.s112_heute(), 'versendet')), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('insert_entwurf',
    pg_temp.s112_fehlertext(format('INSERT INTO public.exportauftraege (tenant_id, datum, status, notizen) VALUES (%L, %L, %L, %L)', v_b, pg_temp.s112_heute(), 'entwurf', 'S112TEST neu')), 'ok');
  -- andere Felder bleiben direkt änderbar (Status unverändert mitgeschickt)
  v_erg := v_erg || pg_temp.s112_erwarte('anderes_feld',
    pg_temp.s112_versuch(format('UPDATE public.exportauftraege SET status = %L, lieferdatum = %L WHERE id = %L', 'entwurf', pg_temp.s112_heute(), v_auf)), 'k1');

  -- ── 2. Vorwärts: je ein Schritt; „Versendet“ nur mit Rechnung ────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('unbekannter_status',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, 'geliefert', NULL)), ':', 1), '22023');
  v_erg := v_erg || pg_temp.s112_erwarte('gleicher_status',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, 'entwurf', NULL)) LIKE '23514:%bereits „Entwurf“%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('sprung',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, 'versendet', NULL)) LIKE '23514:%Schritt für Schritt%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('bestaetigen',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, 'bestaetigt', NULL)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('versendet_ohne_rechnung',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, 'versendet', NULL)) LIKE '23514:%wenn die Rechnung gestellt ist%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('versendet_ohne_muster',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_mus, 'versendet', NULL)) LIKE '23514:%wenn das Muster ausgebucht ist%', true);

  -- (unter der Mutation ohne_rechnungspruefung wären beide jetzt „Versendet“ – für den weiteren Ablauf zurück als Wartung)
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.exportauftraege SET status = 'bestaetigt' WHERE id IN (v_auf, v_mus) AND status <> 'bestaetigt';
  PERFORM pg_temp.s112_als(v_bw);

  -- ── 3. Zurück: nur Betriebsleitung, mit Grund; auf Entwurf nur ohne Rechnung ─────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('zurueck_mitarbeiter',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, 'entwurf', 'S112TEST doch noch nicht bestätigt')) LIKE '42501:%nur die Betriebsleitung%', true);
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('zurueck_ohne_grund',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, 'entwurf', 'zu kurz')) LIKE '23514:%mindestens 10 Zeichen%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('zurueck_auf_entwurf',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, 'entwurf', 'S112TEST doch noch nicht bestätigt')), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  SELECT count(*) INTO v_n FROM public.bestandsprotokoll p
   WHERE p.tabelle = 'exportauftraege' AND p.datensatz_id = v_auf AND p.aktion = 'UPDATE' AND p.benutzer_id = v_bta
     AND p.grund = 'Statuswechsel Bestätigt → Entwurf: S112TEST doch noch nicht bestätigt' AND 'status' = ANY (p.geaenderte_spalten);
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_grund', v_n, 1::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('kennzeichen_leer',
    coalesce(current_setting('s112.freeze_frei', true), '') || coalesce(current_setting('s112.aenderung_grund', true), ''), '');

  -- mit Rechnung: Versendet geht, zurück auf Bestätigt ja, weiter auf Entwurf nein
  PERFORM pg_temp.s112_als(v_bw);
  PERFORM public.s112_exportauftrag_status_setzen(v_b, v_auf, 'bestaetigt', NULL);
  UPDATE public.exportauftraege SET verkaufsposten_id = v_vp WHERE id = v_auf;
  v_erg := v_erg || pg_temp.s112_erwarte('versendet_mit_rechnung',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, 'versendet', NULL)), 'ok');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('zurueck_auf_bestaetigt',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, 'bestaetigt', 'S112TEST Lieferung verschoben')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('entwurf_mit_rechnung',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, 'entwurf', 'S112TEST ganz zurück auf Anfang')) LIKE '23514:%solange es eine Rechnung%', true);

  -- ── 4. Abgeschlossen ist endgültig ───────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  PERFORM public.s112_exportauftrag_status_setzen(v_b, v_auf, 'versendet', NULL);
  -- Teil 2: ohne Nachweis nur mit Begründung
  v_erg := v_erg || pg_temp.s112_erwarte('abschluss_ohne_nachweis',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, 'abgeschlossen', NULL)) LIKE '23514:%fehlt der Ausfuhr- bzw. Gelangensnachweis%', true);
  -- (unter der Mutation ohne_nachweispruefung wäre der Auftrag jetzt abgeschlossen – für den weiteren Ablauf zurück als Wartung)
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.exportauftraege SET status = 'versendet', abschluss_ohne_nachweis = NULL WHERE id = v_auf AND status <> 'versendet';
  PERFORM pg_temp.s112_als(v_bw);

  -- Angaben zur Ausfuhranmeldung: auch mit Rechnung und ab „Versendet“ änderbar; MRN = 18 Zeichen
  v_erg := v_erg || pg_temp.s112_erwarte('mrn',
    pg_temp.s112_versuch(format(c_mrn, '26AT100000ABCDEFG1', v_heute, v_auf)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('mrn_format',
    split_part(pg_temp.s112_fehlertext(format(c_mrn, 'zu kurz', v_heute, v_auf)), ':', 1), '23514');
  -- KAN-437 Teil 3: Belegnummern – mit Rechnung und ab „Versendet“ änderbar; nur als Liste, höchstens 20 Einträge
  v_erg := v_erg || pg_temp.s112_erwarte('belege',
    pg_temp.s112_versuch(format(c_bel, '[{"bezeichnung": "COLA", "nummer": "S112TEST-1"}, {"bezeichnung": "Prior Notice", "nummer": "S112TEST-2"}]', v_auf)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('belege_keine_liste',
    split_part(pg_temp.s112_fehlertext(format(c_bel, '{"bezeichnung": "COLA"}', v_auf)), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('belege_zu_viele',
    split_part(pg_temp.s112_fehlertext(format(c_bel, (SELECT jsonb_agg(jsonb_build_object('bezeichnung', 'S112TEST', 'nummer', n)) FROM generate_series(1, 21) n)::text, v_auf)), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_abschluss_grund',
    pg_temp.s112_fehlertext(format('UPDATE public.exportauftraege SET abschluss_ohne_nachweis = %L WHERE id = %L', 'S112TEST direkt gesetzt', v_auf)) LIKE '42501:%nur über den Statuswechsel%', true);

  -- Nachweise: anlegen ja – nicht in der Zukunft, nicht im fremden Ordner, nie ändern
  v_erg := v_erg || pg_temp.s112_erwarte('nachweis_zukunft',
    pg_temp.s112_fehlertext(format(c_nw, v_b, v_auf, 'ausgangsvermerk', v_heute + 1, v_b || '/' || v_auf || '/s112test-z.pdf', 'S112TEST.pdf')) LIKE '23514:%in der Zukunft%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('nachweis_fremder_ordner',
    split_part(pg_temp.s112_fehlertext(format(c_nw, v_b, v_auf, 'ausgangsvermerk', v_heute, v_m || '/' || v_auf || '/s112test-f.pdf', 'S112TEST.pdf')), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('nachweis_unbekannte_art',
    split_part(pg_temp.s112_fehlertext(format(c_nw, v_b, v_auf, 'quittung', v_heute, v_b || '/' || v_auf || '/s112test-a.pdf', 'S112TEST.pdf')), ':', 1), '23514');
  v_erg := v_erg || pg_temp.s112_erwarte('nachweis_anlegen',
    pg_temp.s112_fehlertext(format(c_nw, v_b, v_auf, 'ausgangsvermerk', v_heute, v_b || '/' || v_auf || '/s112test-1.pdf', 'S112TEST.pdf')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('nachweis_zweiter',
    pg_temp.s112_fehlertext(format(c_nw, v_b, v_auf, 'frachtbrief', v_heute, v_b || '/' || v_auf || '/s112test-2.pdf', 'S112TEST CMR.pdf')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('nachweis_aendern',
    split_part(pg_temp.s112_fehlertext(format('UPDATE public.export_nachweise SET notiz = %L WHERE exportauftrag_id = %L', 'S112TEST geändert', v_auf)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('nachweis_entfernen',
    pg_temp.s112_versuch(format('DELETE FROM public.export_nachweise WHERE exportauftrag_id = %L AND art = %L', v_auf, 'frachtbrief')), 'k1');
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('nachweis_leser',
    split_part(pg_temp.s112_fehlertext(format(c_nw, v_b, v_auf, 'sonstiger', v_heute, v_b || '/' || v_auf || '/s112test-l.pdf', 'S112TEST.pdf')), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_mw);
  v_erg := v_erg || pg_temp.s112_erwarte('nachweis_fremder_betrieb',
    split_part(pg_temp.s112_fehlertext(format(c_nw, v_b, v_auf, 'sonstiger', v_heute, v_b || '/' || v_auf || '/s112test-m.pdf', 'S112TEST.pdf')), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('nachweis_fremder_auftrag',
    pg_temp.s112_fehlertext(format(c_nw, v_m, v_auf, 'sonstiger', v_heute, v_m || '/' || v_auf || '/s112test-x.pdf', 'S112TEST.pdf')) <> 'ok', true);
  v_erg := v_erg || pg_temp.s112_erwarte('nachweis_fremd_unsichtbar',
    (SELECT count(*) FROM public.export_nachweise WHERE exportauftrag_id = v_auf), 0::bigint);

  -- mit Nachweis: abschließen ohne Begründung; danach ist alles gesperrt
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('abschliessen',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, 'abgeschlossen', NULL)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('nachweis_gesperrt_entfernen',
    pg_temp.s112_fehlertext(format('DELETE FROM public.export_nachweise WHERE exportauftrag_id = %L', v_auf)) LIKE '42501:%abgeschlossen%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('nachweis_gesperrt_anlegen',
    pg_temp.s112_fehlertext(format(c_nw, v_b, v_auf, 'sonstiger', v_heute, v_b || '/' || v_auf || '/s112test-3.pdf', 'S112TEST.pdf')) LIKE '42501:%abgeschlossen%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('belege_gesperrt',
    pg_temp.s112_fehlertext(format(c_bel, '[]', v_auf)) LIKE '42501:%abgeschlossen%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('mrn_gesperrt',
    pg_temp.s112_fehlertext(format(c_mrn, '26AT100000ABCDEFG2', v_heute, v_auf)) LIKE '42501:%abgeschlossen%', true);

  -- ohne Nachweis mit Begründung: steht am Auftrag; Mustersendung ohne beides
  v_erg := v_erg || pg_temp.s112_erwarte('abschluss_mit_begruendung',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_ohn, 'abgeschlossen', 'S112TEST Beleg liegt beim Spediteur')), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('begruendung_am_auftrag',
    (SELECT concat_ws('|', a.status, a.abschluss_ohne_nachweis) FROM public.exportauftraege a WHERE a.id = v_ohn), 'abgeschlossen|S112TEST Beleg liegt beim Spediteur');
  v_erg := v_erg || pg_temp.s112_erwarte('mit_nachweis_keine_begruendung',
    (SELECT a.abschluss_ohne_nachweis IS NULL FROM public.exportauftraege a WHERE a.id = v_auf), true);
  UPDATE public.exportauftraege SET status = 'versendet' WHERE id = v_mus;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('muster_ohne_nachweis',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_mus, 'abgeschlossen', NULL)), 'ok');
  -- der Auftrag lässt sich samt Nachweisen löschen (Kaskade, als Wartung) – der Schutz hält die Kaskade nicht auf
  PERFORM pg_temp.s112_als_postgres();
  PERFORM set_config('s112.loeschen_erlaubt', v_b::text, true);
  v_erg := v_erg || pg_temp.s112_erwarte('kaskade',
    pg_temp.s112_fehlertext(format('DELETE FROM public.exportauftraege WHERE id = %L', v_auf)), 'ok');   -- storno-ausnahme: Test der Kaskade auf die Nachweise, wird zurückgerollt
  PERFORM set_config('s112.loeschen_erlaubt', '', true);
  v_erg := v_erg || pg_temp.s112_erwarte('kaskade_nachweise_weg',
    (SELECT count(*) FROM public.export_nachweise WHERE exportauftrag_id = v_auf), 0::bigint);
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('abgeschlossen_endgueltig',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_ohn, 'versendet', 'S112TEST noch einmal öffnen')) LIKE '23514:%abgeschlossen%', true);

  -- ── 5. Storniert, Rechte, Modul ──────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.exportauftraege SET storniert_am = now(), storno_grund = 'S112TEST storniert' WHERE id = v_sto;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('storniert',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_sto, 'bestaetigt', NULL)) LIKE '42501:%storniert%', true);
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_sto, 'bestaetigt', NULL)), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_mw);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_sto, 'bestaetigt', NULL)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_auftrag',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_m, v_sto, 'bestaetigt', NULL)), ':', 1), 'P0002');
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.tenant_einstellungen SET modul_export = false WHERE tenant_id = v_b;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_export_modul',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_sto, 'bestaetigt', NULL)), ':', 1), '42501');
  -- ohne Export-Modul auch keine Nachweise (Paket-Modul-Policy)
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.exportauftraege SET storniert_am = NULL, storno_grund = NULL WHERE id = v_sto;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('nachweis_ohne_export_modul',
    split_part(pg_temp.s112_fehlertext(format(c_nw, v_b, v_sto, 'sonstiger', v_heute, v_b || '/' || v_sto || '/s112test-o.pdf', 'S112TEST.pdf')), ':', 1), '42501');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('rechte',
    concat_ws('/',
      has_function_privilege('anon', c_fn, 'EXECUTE')::text,
      has_function_privilege('authenticated', c_fn, 'EXECUTE')::text,
      has_function_privilege('authenticated', 'public.s112_export_workflow_schutz()', 'EXECUTE')::text,
      has_function_privilege('authenticated', 'public.s112_export_nachweis_schutz()', 'EXECUTE')::text,
      has_table_privilege('anon', 'public.export_nachweise', 'SELECT')::text,
      has_table_privilege('authenticated', 'public.export_nachweise', 'UPDATE')::text),
    'false/true/false/false/false/false');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 55);
END
$test$;
