-- @bereich: Füllung – Leergewicht der Flasche, Exportauftrag – Verpackung (KAN-414)
-- @ziel: Das Leergewicht einer gespeicherten Füllung ändert ein Mitarbeiter nur über s112_fuellung_aendern mit Grund
-- @ziel: (1 … 5.000 g oder leer); direkt endet es mit 42501, die Sperre der übrigen Felder bleibt. Der Grund steht im
-- @ziel: Bestandsprotokoll. Das Verpackungsgewicht eines Exportauftrags ist eine Zahl ab 0.
-- @mutation ohne_grund_trigger: Trigger a_grund_pflicht ohne die Spalte leergewicht_g | rot: direkt_ohne_grund
-- @mutation ohne_check: CHECK fuellungen_leergewicht_chk entfernt | rot: check_.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 91 (Stand 11.11.2026, KAN-414). Alles zurückgerollt.
-- Personen: Mitarbeiter b_w und Leser b_l in Betrieb B.

DO $test$
DECLARE
  c_datei constant text := '91_leergewicht';
  c_rpc   constant text := 'SELECT public.s112_fuellung_aendern(%L, %L, %L::jsonb, %L)';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_b     uuid;
  v_bw    uuid;
  v_bl    uuid;
  v_f     uuid;
  v_ex    uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  -- ── 0. Aufbau (als postgres) ─────────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_f := (pg_temp.s112_beispiel('fuellungen', v_b, v_bw, '{"bestand_flaschen": "100", "anzahl_flaschen": "100"}') ->> 'id')::uuid;
  UPDATE public.tenant_einstellungen SET modul_export = true WHERE tenant_id = v_b;
  v_ex := (pg_temp.s112_beispiel('exportauftraege', v_b, v_bw) ->> 'id')::uuid;

  PERFORM pg_temp.s112_mutiere('ohne_grund_trigger', $m$
    DROP TRIGGER a_grund_pflicht ON public.fuellungen;
    CREATE TRIGGER a_grund_pflicht BEFORE UPDATE OF name, vk_preis_brutto, einstandspreis, mwst_pct, zolltarifnummer, notizen, aktiv
      ON public.fuellungen FOR EACH ROW EXECUTE FUNCTION public.s112_fuellung_grund_pflicht()$m$);
  PERFORM pg_temp.s112_mutiere('ohne_check', $m$ALTER TABLE public.fuellungen DROP CONSTRAINT fuellungen_leergewicht_chk$m$);

  -- ── 1. Katalog: Positivliste, Grund-Pflicht, Protokoll ───────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('freeze_positivliste',
    (SELECT pg_get_triggerdef(t.oid) LIKE '%aktiv,leergewicht_g,aktualisiert_am%' FROM pg_trigger t
      WHERE t.tgrelid = 'public.fuellungen'::regclass AND t.tgname = 'a_freeze'), true);
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_ueberwacht',
    (SELECT pg_get_triggerdef(t.oid) LIKE '%''leergewicht_g'')' FROM pg_trigger t
      WHERE t.tgrelid = 'public.fuellungen'::regclass AND t.tgname = 'z_protokoll_aendern'), true);

  -- ── 2. Mitarbeiter: nur mit Grund über die RPC ───────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('direkt_ohne_grund',
    pg_temp.s112_versuch(format('UPDATE public.fuellungen SET leergewicht_g = 500 WHERE id = %L', v_f)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_mit_grund',
    pg_temp.s112_fehlertext(format(c_rpc, v_b, v_f, '{"leergewicht_g": 500}', 'S112TEST Leergewicht nachgetragen')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('wert_gespeichert',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.fuellungen WHERE id = %L AND leergewicht_g = 500', v_f)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_leeren',
    pg_temp.s112_versuch(format(c_rpc, v_b, v_f, '{"leergewicht_g": null}', 'S112TEST Leergewicht entfernt')), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_grund_kurz',
    pg_temp.s112_versuch(format(c_rpc, v_b, v_f, '{"leergewicht_g": 480}', 'kurz')), 'E22023');
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_null_gramm',
    pg_temp.s112_versuch(format(c_rpc, v_b, v_f, '{"leergewicht_g": 0}', 'S112TEST Leergewicht null Gramm')), 'E22023');
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_zu_schwer',
    pg_temp.s112_versuch(format(c_rpc, v_b, v_f, '{"leergewicht_g": 5001}', 'S112TEST Leergewicht zu schwer')), 'E22023');
  v_erg := v_erg || pg_temp.s112_erwarte('andere_felder_bleiben_gesperrt',
    pg_temp.s112_versuch(format(c_rpc, v_b, v_f, '{"anzahl_flaschen": 5}', 'S112TEST gesperrtes Feld ändern')), 'E22023');
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('leser_abgelehnt',
    pg_temp.s112_versuch(format(c_rpc, v_b, v_f, '{"leergewicht_g": 480}', 'S112TEST Leser ändert Gewicht')), 'T');

  -- ── 3. Bestandsprotokoll trägt den Grund ─────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('grund_im_protokoll',
    (SELECT count(*) FROM public.bestandsprotokoll p
      WHERE p.tenant_id = v_b AND p.tabelle = 'fuellungen' AND p.datensatz_id::text = v_f::text AND p.grund = 'S112TEST Leergewicht nachgetragen'), 1::bigint);

  -- ── 4. CHECKs (als postgres: ohne Trigger-Pflichten der API-Rollen) ──────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('check_negativ',
    pg_temp.s112_versuch(format('UPDATE public.fuellungen SET leergewicht_g = -1 WHERE id = %L', v_f)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('check_zu_schwer',
    pg_temp.s112_versuch(format('UPDATE public.fuellungen SET leergewicht_g = 5000.5 WHERE id = %L', v_f)), 'E23514');
  v_erg := v_erg || pg_temp.s112_erwarte('verpackung_negativ',
    pg_temp.s112_versuch(format('UPDATE public.exportauftraege SET verpackung_kg = -0.5 WHERE id = %L', v_ex)), 'E23514');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('verpackung_setzen',
    pg_temp.s112_versuch(format('UPDATE public.exportauftraege SET verpackung_kg = 60 WHERE id = %L', v_ex)), 'k1');
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 14);
END
$test$;
