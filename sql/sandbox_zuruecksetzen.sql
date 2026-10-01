-- ═══════════════════════════════════════════════════════════════════════════════
-- software:112 – Sandbox zurücksetzen (KAN-151, 01.10.2026)
-- Ersetzt sql/cleanup_testdaten_2026-08-05.sql (Git-Historie).
--
-- Löscht alle Bewegungen des Sandbox-Betriebs: Kellerbuch, Lese, Pressungen, Verkauf, E/A, Anträge, Analysen,
-- Export. BEHÄLT die Stammdaten: Gebinde, Lagen, Rieden, Grundstücke, CRM, Artikel, Preislisten, Einstellungen,
-- Mitglieder. Bewegungen der Rieden (Maßnahmen) bleiben ebenfalls – sie gehören zu den Aufzeichnungspflichten.
--
-- Ausführen im Supabase SQL Editor (als postgres). Läuft in EINER Transaktion; jede Löschung landet im
-- Änderungsprotokoll (bestandsprotokoll) – das ist gewollt.
--   • Schutzprüfung: Betrieb fa22dc07-eca5-43df-af96-f7b9b09f0471 mit Namen „Sandbox“, sonst Abbruch.
--   • Wartungs-Kennzeichen s112.loeschen_erlaubt nur für die Sandbox (transaktionslokal) – Löschsperren und
--     Stammdaten-Sperre lassen die Löschungen dieses Betriebs durch, nie die eines anderen.
--   • Reihenfolge wie s112_mandant_loeschen (NO ACTION/RESTRICT), Kinder ohne tenant_id zuerst (KAN-124).
--   • Nie SET session_replication_role = 'replica', nie DISABLE TRIGGER (KAN-124).
--   • Danach scripts/fk-waisen.sql ausführen – 0 Zeilen erwartet.
-- Andere Betriebe nie mit diesem Skript, sondern über s112_mandant_loeschen (docs/Mandant_loeschen.md).
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_tid  constant uuid := 'fa22dc07-eca5-43df-af96-f7b9b09f0471';
  v_name text;
  v_tab  text;
  v_n    bigint;
  v_rest text := '';
BEGIN
  SELECT name INTO v_name FROM public.tenants WHERE id = v_tid;
  IF v_name IS DISTINCT FROM 'Sandbox' THEN
    RAISE EXCEPTION 'Abbruch: Betrieb % heißt „%“, nicht „Sandbox“ – nichts geändert.', v_tid, coalesce(v_name, '(nicht vorhanden)');
  END IF;

  PERFORM set_config('s112.loeschen_erlaubt', v_tid::text, true);

  -- 1. Verkauf und E/A (Gegenbuchungen vor den Originalen, RESTRICT)
  DELETE FROM public.zahlungen WHERE tenant_id = v_tid;   -- storno-ausnahme: Sandbox-Reset (KAN-151), Kennzeichen nur für die Sandbox
  DELETE FROM public.transportbescheinigungen WHERE tenant_id = v_tid;   -- storno-ausnahme: Sandbox-Reset (KAN-151), Kennzeichen nur für die Sandbox
  DELETE FROM public.ea_transaktionen WHERE tenant_id = v_tid AND storno_von_id IS NOT NULL;   -- storno-ausnahme: Sandbox-Reset (KAN-151), Gegenbuchungen zuerst
  DELETE FROM public.ea_transaktionen WHERE tenant_id = v_tid;   -- storno-ausnahme: Sandbox-Reset (KAN-151), Kennzeichen nur für die Sandbox
  DELETE FROM public.ea_uva WHERE tenant_id = v_tid;   -- storno-ausnahme: Sandbox-Reset (KAN-151), Kennzeichen nur für die Sandbox
  DELETE FROM public.ea_monatsabschluss WHERE tenant_id = v_tid;   -- storno-ausnahme: Sandbox-Reset (KAN-151), Kennzeichen nur für die Sandbox
  DELETE FROM public.konto_umbuchungen WHERE tenant_id = v_tid;   -- storno-ausnahme: Sandbox-Reset (KAN-151), Kennzeichen nur für die Sandbox
  DELETE FROM public.verkauf_positionen WHERE tenant_id = v_tid;   -- storno-ausnahme: Sandbox-Reset (KAN-151), Kennzeichen nur für die Sandbox
  DELETE FROM public.verkaufsposten WHERE tenant_id = v_tid;   -- storno-ausnahme: Sandbox-Reset (KAN-151), Kennzeichen nur für die Sandbox
  DELETE FROM public.exportauftraege WHERE tenant_id = v_tid;   -- storno-ausnahme: Sandbox-Reset (KAN-151), Positionen und Dokumente per Kaskade

  -- 2. Kellerbuch, Lese, Pressungen (NO-ACTION-Reihenfolge, Kinder ohne tenant_id ausdrücklich)
  DELETE FROM public.verschneidung_quellen WHERE verschneidung_id IN (SELECT id FROM public.verschneidungen WHERE tenant_id = v_tid);   -- storno-ausnahme: Sandbox-Reset (KAN-151), Kind ohne tenant_id
  DELETE FROM public.verschneidungen WHERE tenant_id = v_tid;   -- storno-ausnahme: Sandbox-Reset (KAN-151), Kennzeichen nur für die Sandbox
  DELETE FROM public.keller_behandlungen WHERE tenant_id = v_tid;   -- storno-ausnahme: Sandbox-Reset (KAN-151), Kennzeichen nur für die Sandbox
  DELETE FROM public.keller_umzuege WHERE tenant_id = v_tid;   -- storno-ausnahme: Sandbox-Reset (KAN-151), Kennzeichen nur für die Sandbox
  DELETE FROM public.fuellung_chargen WHERE tenant_id = v_tid;   -- storno-ausnahme: Sandbox-Reset (KAN-151), Kennzeichen nur für die Sandbox
  DELETE FROM public.fuellungen WHERE tenant_id = v_tid;   -- storno-ausnahme: Sandbox-Reset (KAN-151), Bewegungen per Kaskade
  DELETE FROM public.pressung_behaelter WHERE pressung_id IN (SELECT id FROM public.pressungen WHERE tenant_id = v_tid);   -- storno-ausnahme: Sandbox-Reset (KAN-151), Kind ohne tenant_id
  DELETE FROM public.pressung_weingaerten WHERE pressung_id IN (SELECT id FROM public.pressungen WHERE tenant_id = v_tid);   -- storno-ausnahme: Sandbox-Reset (KAN-151), Kind ohne tenant_id
  DELETE FROM public.pressungen WHERE tenant_id = v_tid;   -- storno-ausnahme: Sandbox-Reset (KAN-151), Kennzeichen nur für die Sandbox
  DELETE FROM public.traubenverkauf WHERE tenant_id = v_tid;   -- storno-ausnahme: Sandbox-Reset (KAN-151), Kennzeichen nur für die Sandbox
  DELETE FROM public.zukauf_posten WHERE tenant_id = v_tid;   -- storno-ausnahme: Sandbox-Reset (KAN-151), nach Pressungen und Traubenverkäufen (CHECK Quelle)
  DELETE FROM public.pruefnummernantraege WHERE tenant_id = v_tid;   -- storno-ausnahme: Sandbox-Reset (KAN-151), Kennzeichen nur für die Sandbox
  DELETE FROM public.dac_antrag WHERE tenant_id = v_tid;   -- storno-ausnahme: Sandbox-Reset (KAN-151), Kennzeichen nur für die Sandbox
  DELETE FROM public.weinanalysen WHERE tenant_id = v_tid;   -- storno-ausnahme: Sandbox-Reset (KAN-151), Kennzeichen nur für die Sandbox
  DELETE FROM public.weinausbau WHERE tenant_id = v_tid;   -- storno-ausnahme: Sandbox-Reset (KAN-151), Herkunft (weinausbau_weingaerten) per Kaskade
  DELETE FROM public.ama_erntemeldungen WHERE tenant_id = v_tid;   -- storno-ausnahme: Sandbox-Reset (KAN-151), Positionen per Kaskade
  DELETE FROM public.ernte_parzellen WHERE jahrgang_id IN (SELECT id FROM public.weinjahrgaenge WHERE tenant_id = v_tid);   -- storno-ausnahme: Sandbox-Reset (KAN-151), Kind ohne tenant_id (KAN-124)
  DELETE FROM public.weinjahrgaenge WHERE tenant_id = v_tid;   -- storno-ausnahme: Sandbox-Reset (KAN-151), Lesen per Kaskade

  -- 3. Restprüfung: keine Bewegungen mehr
  FOREACH v_tab IN ARRAY ARRAY['zahlungen', 'transportbescheinigungen', 'ea_transaktionen', 'ea_uva', 'ea_monatsabschluss',
                               'konto_umbuchungen', 'verkauf_positionen', 'verkaufsposten', 'exportauftraege', 'verschneidungen',
                               'keller_behandlungen', 'keller_umzuege', 'fuellung_chargen', 'fuellungen', 'pressungen',
                               'traubenverkauf', 'zukauf_posten', 'pruefnummernantraege', 'dac_antrag', 'weinanalysen',
                               'weinausbau', 'ama_erntemeldungen', 'weinjahrgaenge', 'lesen'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id = $1', v_tab) INTO v_n USING v_tid;
    IF v_n > 0 THEN v_rest := v_rest || format('%s=%s ', v_tab, v_n); END IF;
  END LOOP;
  IF v_rest <> '' THEN
    RAISE EXCEPTION 'Sandbox-Reset unvollständig, zurückgerollt: %', v_rest;
  END IF;
  PERFORM set_config('s112.loeschen_erlaubt', '', true);
  RAISE NOTICE 'Sandbox zurückgesetzt – bitte jetzt scripts/fk-waisen.sql ausführen (0 Zeilen erwartet).';
END $$;
