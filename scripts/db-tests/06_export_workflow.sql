-- @bereich: Weinexport – Statuswechsel des Exportauftrags mit Prüfung (KAN-440 Teil 1)
-- @ziel: Der Status ändert sich nur über s112_exportauftrag_status_setzen: Entwurf → Bestätigt → Versendet → Abgeschlossen,
-- @ziel: je ein Schritt; „Versendet“ nur mit Rechnung bzw. ausgebuchtem Muster; zurück nur die Betriebsleitung mit Grund,
-- @ziel: auf „Entwurf“ nur ohne Rechnung/Muster; „Abgeschlossen“ ist endgültig. Direkt (Update, Insert mit Status) geht
-- @ziel: es nicht. Der Grund steht im Änderungsprotokoll. Leser, fremde Betriebe und Betriebe ohne Export-Modul nicht.
-- @mutation ohne_schutz: Trigger a_export_workflow entfernt | rot: direkt_.*
-- @mutation ohne_rechnungspruefung: „Versendet“ auch ohne Rechnung bzw. Muster | rot: versendet_ohne_.*
-- @mutation ohne_rollenpruefung: Zurückstufen prüft die Betriebsleitung nicht | rot: zurueck_mitarbeiter
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 06 (Stand 13.11.2026, KAN-440). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '06_export_workflow';
  c_rpc   constant text := 'SELECT public.s112_exportauftrag_status_setzen(%L::uuid, %L::uuid, %L, %L)';
  c_fn    constant regprocedure := 'public.s112_exportauftrag_status_setzen(uuid, uuid, text, text)'::regprocedure;
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
  PERFORM pg_temp.s112_zeile('verkaufsposten', v_b, jsonb_build_object('id', v_vp, 'rechnung_spaeter', true, 'steuerfall', 'ausfuhr', 'lieferland', 'US'));

  PERFORM pg_temp.s112_mutiere('ohne_schutz', $m$DROP TRIGGER a_export_workflow ON public.exportauftraege$m$);
  PERFORM pg_temp.s112_mutiere('ohne_rechnungspruefung', $m$DO $d$ BEGIN
    EXECUTE replace(pg_get_functiondef('public.s112_exportauftrag_status_setzen(uuid, uuid, text, text)'::regprocedure),
      $a$IF p_status = 'versendet' AND v_a.verkaufsposten_id IS NULL$a$, $a$IF p_status = 'nie' AND v_a.verkaufsposten_id IS NULL$a$);
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
  v_erg := v_erg || pg_temp.s112_erwarte('abschliessen',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, 'abgeschlossen', NULL)), 'ok');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('abgeschlossen_endgueltig',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_auf, 'versendet', 'S112TEST noch einmal öffnen')) LIKE '23514:%abgeschlossen%', true);

  -- ── 5. Storniert, Rechte, Modul ──────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.exportauftraege SET storniert_am = now(), storno_grund = 'S112TEST storniert' WHERE id = v_sto;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('storniert',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_sto, 'bestaetigt', NULL)) LIKE '42501:%storniert%', true);
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_mus, 'entwurf', NULL)), ':', 1), '42501');
  PERFORM pg_temp.s112_als(v_mw);
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_betrieb',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_mus, 'versendet', NULL)), ':', 1), '42501');
  v_erg := v_erg || pg_temp.s112_erwarte('fremder_auftrag',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_m, v_mus, 'versendet', NULL)), ':', 1), 'P0002');
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.tenant_einstellungen SET modul_export = false WHERE tenant_id = v_b;
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_export_modul',
    split_part(pg_temp.s112_fehlertext(format(c_rpc, v_b, v_mus, 'versendet', NULL)), ':', 1), '42501');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('rechte',
    concat_ws('/',
      has_function_privilege('anon', c_fn, 'EXECUTE')::text,
      has_function_privilege('authenticated', c_fn, 'EXECUTE')::text,
      has_function_privilege('authenticated', 'public.s112_export_workflow_schutz()', 'EXECUTE')::text),
    'false/true/false');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 26);
END
$test$;
