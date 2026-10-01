-- @bereich: Mandanten-Löschung (KAN-151)
-- @ziel: s112_mandant_loeschen löscht einen Betrieb vollständig (Bewegungen, Stammdaten, stornierte Zeilen, Tabellen
-- @ziel: ohne FK auf tenants) ohne 42501 und ohne CHECK-Fehler (Pressung/Traubenverkauf aus Zukauf-Trauben); danach
-- @ziel: 0 Zeilen mit dieser tenant_id außer im Bestandsprotokoll, 0 FK-Waisen, keine Protokollzeile ohne tenant_id,
-- @ziel: genau ein Eintrag in system_ereignisse. Fehlerfälle: falscher Name, Kellergemeinschaft (55000, nichts
-- @ziel: geändert), authenticated ohne Recht; Nur-Lesen-Modus ist löschbar; ohne Kennzeichen sperrt DELETE FROM tenants.
-- @mutation execute_authenticated: GRANT EXECUTE auf s112_mandant_loeschen an authenticated | rot: authenticated_ohne_recht
-- @mutation ohne_kellergemeinschaft: Gebinde-Prüfung (Kellergemeinschaft) in s112_mandant_loeschen ausgeschaltet | rot: kellergemeinschaft_.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 21 (Stand 01.10.2026, KAN-151 G1).
-- Personas: eigene Testbetriebe (s112_betrieb) und der Musterhof (Demo, vollständige Daten) – alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '21_mandant_loeschen';
  c_m     constant uuid := '33333333-3333-4333-8333-333333333333';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_x     uuid;   -- Testbetrieb mit Zukauf-Trauben
  v_y     uuid;   -- Gebinde-Eigentümer (Kellergemeinschaft)
  v_z     uuid;   -- Betrieb mit Charge im fremden Gebinde
  v_g     uuid;   -- gekündigter Betrieb (Nur-Lesen-Modus)
  v_zk    uuid;
  v_beh   uuid;
  v_uid   uuid;
  v_j     jsonb;
  v_n     bigint;
  v_r     text;
  v_se0   bigint;
  v_bp0   bigint;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();
  SELECT count(*) INTO v_bp0 FROM public.bestandsprotokoll WHERE tenant_id IS NULL;

  -- ── 1. Altlasten (Migration G1) ───────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('altlast_set_verkauf_storniert_weg', to_regprocedure('public.set_verkauf_storniert(uuid)') IS NULL, true);
  v_erg := v_erg || pg_temp.s112_erwarte('altlast_mark_verkauf_bezahlt_weg', to_regprocedure('public.mark_verkauf_bezahlt(uuid)') IS NULL, true);
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_ohne_tenant_vorher', v_bp0, 0::bigint);

  -- ── 2. Zukauf-Trauben: Pressung und Traubenverkauf mit Quelle Zukauf ───────────────────────────────────
  v_x := pg_temp.s112_betrieb('Löschtest Zukauf');
  v_zk := (pg_temp.s112_beispiel('zukauf_posten', v_x) ->> 'id')::uuid;
  PERFORM pg_temp.s112_beispiel('pressung_weingaerten', v_x, NULL, jsonb_build_object('zukauf_posten_id', v_zk, 'weingarten_id', NULL, 'grundstueck_id', NULL));
  PERFORM pg_temp.s112_beispiel('traubenverkauf', v_x, NULL, jsonb_build_object('zukauf_posten_id', v_zk, 'weingarten_id', NULL, 'grundstueck_id', NULL));
  PERFORM pg_temp.s112_beispiel('keller_behandlungen', v_x, NULL,
    '{"storniert_am": "2026-09-30T10:00:00Z", "storno_grund": "S112TEST storniert"}');
  SELECT count(*) INTO v_n FROM public.pressung_weingaerten pw JOIN public.pressungen p ON p.id = pw.pressung_id
   WHERE p.tenant_id = v_x AND pw.zukauf_posten_id = v_zk;
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_zukauf_pressung', v_n, 1::bigint);

  PERFORM pg_temp.s112_mutiere('execute_authenticated', $m$GRANT EXECUTE ON FUNCTION public.s112_mandant_loeschen(uuid, text) TO authenticated$m$);
  PERFORM pg_temp.s112_mutiere('ohne_kellergemeinschaft', $m$DO $x$ BEGIN EXECUTE replace(pg_get_functiondef('public.s112_mandant_loeschen(uuid,text)'::regprocedure), 'IF v_fremd > 0 THEN', 'IF false THEN'); END $x$$m$);

  -- falscher Name
  v_erg := v_erg || pg_temp.s112_erwarte('falscher_name',
    pg_temp.s112_versuch(format('SELECT public.s112_mandant_loeschen(%L, %L)', v_x, 'Falscher Name')), 'E22023');
  -- authenticated (system_admin des Betriebs) ohne Ausführungsrecht
  v_uid := pg_temp.s112_benutzer('system_admin', v_x);
  PERFORM pg_temp.s112_als(v_uid, 'authenticated', 'aal2');
  v_erg := v_erg || pg_temp.s112_erwarte('authenticated_ohne_recht',
    pg_temp.s112_versuch(format('SELECT public.s112_mandant_loeschen(%L, %L)', v_x, 'S112TEST Löschtest Zukauf')), 'G');   -- kein EXECUTE-Recht
  PERFORM pg_temp.s112_als_postgres();

  SELECT count(*) INTO v_se0 FROM public.system_ereignisse WHERE quelle = 's112_mandant_loeschen';
  v_j := public.s112_mandant_loeschen(v_x, 'S112TEST Löschtest Zukauf');
  v_erg := v_erg || pg_temp.s112_erwarte('zukauf_betrieb_geloescht', NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = v_x), true);
  v_erg := v_erg || pg_temp.s112_erwarte('zukauf_rueckgabe_mit_zukauf', (v_j -> 'zeilen' ->> 'zukauf_posten')::int, 1);
  v_erg := v_erg || pg_temp.s112_erwarte('zukauf_ereignis', (SELECT count(*) FROM public.system_ereignisse WHERE quelle = 's112_mandant_loeschen') - v_se0, 1::bigint);

  -- ── 3. Kellergemeinschaft: Charge eines anderen Betriebs im eigenen Gebinde → 55000, nichts geändert ──
  v_y := pg_temp.s112_betrieb('Löschtest Gebinde');
  v_z := pg_temp.s112_betrieb('Löschtest Gast');
  v_beh := (pg_temp.s112_beispiel('behaelter', v_y) ->> 'id')::uuid;
  PERFORM pg_temp.s112_beispiel('weinausbau', v_z, NULL, jsonb_build_object('behaelter_id', v_beh, 'menge_liter', 0));
  v_erg := v_erg || pg_temp.s112_erwarte('kellergemeinschaft_55000',
    pg_temp.s112_versuch(format('SELECT public.s112_mandant_loeschen(%L, %L)', v_y, 'S112TEST Löschtest Gebinde')), 'E55000');
  v_erg := v_erg || pg_temp.s112_erwarte('kellergemeinschaft_nichts_geaendert',
    EXISTS (SELECT 1 FROM public.tenants WHERE id = v_y) AND EXISTS (SELECT 1 FROM public.behaelter WHERE id = v_beh), true);
  -- der Gast lässt sich löschen (seine Charge im fremden Gebinde geht mit)
  PERFORM public.s112_mandant_loeschen(v_z, 'S112TEST Löschtest Gast');
  v_erg := v_erg || pg_temp.s112_erwarte('gast_geloescht', NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = v_z), true);

  -- ── 4. Nur-Lesen-Modus (gekündigt) ist löschbar ───────────────────────────────────────────────────────
  v_g := pg_temp.s112_betrieb('Löschtest gekündigt', 'canceled');
  PERFORM pg_temp.s112_beispiel('weinausbau', v_g);
  PERFORM public.s112_mandant_loeschen(v_g, 'S112TEST Löschtest gekündigt');
  v_erg := v_erg || pg_temp.s112_erwarte('nur_lesen_geloescht', NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = v_g), true);

  -- ── 4b. Signup-Rückbau: ein frischer Betrieb ohne Bewegungen lässt sich weiter direkt löschen ─────────
  v_g := pg_temp.s112_betrieb('Löschtest frisch');
  v_erg := v_erg || pg_temp.s112_erwarte('signup_rueckbau_frischer_betrieb',
    pg_temp.s112_versuch(format('DELETE FROM public.tenants WHERE id = %L', v_g)), 'k1');

  -- ── 5. Musterhof: ohne Kennzeichen gesperrt, mit der Routine vollständig ──────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_kennzeichen_gesperrt',
    pg_temp.s112_versuch(format('DELETE FROM public.tenants WHERE id = %L', c_m)), 'T');   -- Löschsperre (Trigger)
  v_j := public.s112_mandant_loeschen(c_m, 'Weingut Musterhof (Demo)');
  v_erg := v_erg || pg_temp.s112_erwarte('musterhof_geloescht', NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = c_m), true);
  v_erg := v_erg || pg_temp.s112_erwarte('musterhof_zeilen_mindestens_500', (v_j ->> 'gesamt')::bigint >= 500, true);
  SELECT string_agg(c.relname, ',') INTO v_r FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname <> 'bestandsprotokoll'
     AND pg_temp.s112_zaehle(format('SELECT count(*) FROM public.%I WHERE tenant_id = %L', c.relname, c_m)) <> '0';
  v_erg := v_erg || pg_temp.s112_erwarte('musterhof_reste', coalesce(v_r, ''), '');
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_ohne_tenant_nachher',
    (SELECT count(*) FROM public.bestandsprotokoll WHERE tenant_id IS NULL), 0::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('musterhof_protokoll_bleibt',
    EXISTS (SELECT 1 FROM public.bestandsprotokoll WHERE tenant_id = c_m AND aktion = 'DELETE'), true);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 15);
END $test$;
