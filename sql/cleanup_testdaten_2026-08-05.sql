-- ═══════════════════════════════════════════════════════════════════════════════
-- software:112 – Testdaten-Cleanup (aktualisierte Fassung, 5.8.2026)
-- Löscht alle operativen Wein-/Keller-/Lesedaten für den Sandbox-Tenant.
-- BEHÄLT: behaelter, weingarten, grundstuecke, lagen, CRM, tenant_einstellungen,
--         Kunden, Artikel, Preislisten (preislisten_positionen bleibt unangetastet –
--         das sind Preisdefinitionen, keine Transaktionen)
--
-- Basiert auf sql/cleanup_testdaten.sql (mit KAN-151 entfernt, siehe Git-Historie), erweitert um Tabellen, die seither dazu-
-- gekommen sind bzw. bisher nicht mitgelöscht wurden (siehe "NEU" markierte Blöcke):
--   - Verschneidungen (verschneidungen, verschneidung_quellen) – Feature erst seit
--     Kurzem im aktiven Test (heute erstmals über bot:112 getestet)
--   - fuellung_chargen (Verschnitt-Zusammensetzung einer Abfüllung)
--   - weinausbau_weingaerten (Verknüpfungstabelle Charge↔Weingarten)
--   - traubenverkauf (Traubenverkauf – Teil von "alle Verkäufe")
--   - zahlungen, transportbescheinigungen (Folgedokumente von Verkäufen)
--   - ea_transaktionen (E/A-Buchhaltungseinträge, die durch Test-Verkäufe entstanden
--     sind – da es sich um den Sandbox-Tenant handelt, unbedenklich)
--
-- BEWUSST NICHT gelöscht: preislisten_positionen (Preislisten = Stammdaten),
-- bestellungen/bestellung_positionen (im aktuellen Code ungenutzt/CRM-Altlast,
-- falls doch relevant bitte Bescheid geben).
--
-- Tenant-ID Sandbox: fa22dc07-eca5-43df-af96-f7b9b09f0471
-- (bitte kurz gegenprüfen, ob das nach wie vor der richtige Sandbox-Tenant ist)
-- Ausführen im Supabase SQL Editor
--
-- ─── ACHTUNG seit KAN-35 (24.09.2026) ─────────────────────────────────────────
-- Migration 20260924170709_kan35_datenintegritaet:
--  • Jede Löschung und bestandsrelevante Änderung an Kellerbuch-, Lese- und
--    Verkaufstabellen (weinausbau, keller_umzuege, verschneidungen, verschneidung_
--    quellen, keller_behandlungen, fuellungen, fuellung_chargen, fuellung_bewegungen,
--    zukauf_posten, pressungen, pressung_behaelter, pressung_weingaerten,
--    ernte_parzellen, traubenverkauf, verkaufsposten, verkauf_positionen,
--    ama_erntemeldungen, ama_meldepositionen, weinjahrgaenge) landet per Trigger im
--    bestandsprotokoll – auch im SQL-Editor und bei FK-Kaskaden. Das ist gewollt.
--  • TRUNCATE ist auf diesen Tabellen gesperrt – nur zeilenweise mit DELETE löschen.
--  • Nicht mit SET session_replication_role = 'replica' arbeiten: das schaltet
--    Protokoll-Trigger, FK-Prüfungen UND FK-Kaskaden ab (ungeprotokollierte
--    Löschungen, verwaiste Zeilen z. B. in fuellung_bewegungen).
--  • Löschreihenfolge wegen der FKs ohne ON DELETE (NO ACTION): verschneidungen
--    (samt verschneidung_quellen), keller_behandlungen, keller_umzuege,
--    fuellung_chargen und pressung_behaelter VOR weinausbau; weinausbau,
--    keller_umzuege, keller_behandlungen und pressung_behaelter VOR behaelter;
--    traubenverkauf VOR weinjahrgaenge.
--  • Mengenkorrekturen nicht per UPDATE, sondern über die RPCs schwund_buchen(...)
--    (Liter einer Charge mindern, datierte Schwundzeile) bzw. fuellung_bestand_buchen(...)
--    (Flaschenbestand ±, datierte Zeile in fuellung_bewegungen) – aus dem SQL-Editor
--    mit Parameternamen aufrufbar, z. B.
--      select schwund_buchen(p_tenant_id => '…', p_weinausbau_id => '…', p_liter => 12.5,
--                            p_datum => current_date, p_notiz => 'Korrektur …');
--    Ein direktes UPDATE von menge_liter/bestand_flaschen wird zwar protokolliert,
--    hinterlässt aber keine datierte Bewegung im Bewegungsbuch.
--  • Dieses Skript lief am 5.8.2026 mit session_replication_role = 'replica'; die
--    Zeile ist seit KAN-35 auskommentiert. Die Reihenfolge unten ist FK-gerecht.
-- ───────────────────────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════════

-- Trigger temporär deaktivieren (verhindert updated_at-Fehler bei FK-Cascades und
-- macht die Löschreihenfolge unkritisch, da FK-Prüfungen dabei ebenfalls aussetzen)
-- KAN-35 (24.09.2026): auskommentiert – 'replica' schaltet Protokoll-Trigger, FK-Prüfungen
-- und FK-Kaskaden ab (siehe Kopfkommentar). Nicht wieder aktivieren.
-- SET session_replication_role = 'replica';

DO $$
DECLARE
  v_tid UUID := 'fa22dc07-eca5-43df-af96-f7b9b09f0471';
BEGIN

  RAISE NOTICE '--- Starte Cleanup für Tenant % ---', v_tid;

  -- ── 1. Verkaufs-Folgedokumente (NEU) – vor verkaufsposten löschen ───────────
  DELETE FROM zahlungen
  WHERE verkaufsposten_id IN (
    SELECT id FROM verkaufsposten WHERE tenant_id = v_tid
  );
  RAISE NOTICE 'zahlungen gelöscht';

  DELETE FROM transportbescheinigungen
  WHERE verkaufsposten_id IN (
    SELECT id FROM verkaufsposten WHERE tenant_id = v_tid
  );
  RAISE NOTICE 'transportbescheinigungen gelöscht';

  DELETE FROM ea_transaktionen
  WHERE verkaufsposten_id IN (
    SELECT id FROM verkaufsposten WHERE tenant_id = v_tid
  );
  RAISE NOTICE 'ea_transaktionen (verkaufsbezogen) gelöscht';

  -- ── 2. Weinhandel ──────────────────────────────────────────────────────────
  DELETE FROM verkauf_positionen
  WHERE verkaufsposten_id IN (
    SELECT id FROM verkaufsposten WHERE tenant_id = v_tid
  );
  RAISE NOTICE 'verkauf_positionen gelöscht';

  DELETE FROM verkaufsposten WHERE tenant_id = v_tid;
  RAISE NOTICE 'verkaufsposten gelöscht';

  DELETE FROM traubenverkauf WHERE tenant_id = v_tid;
  RAISE NOTICE 'traubenverkauf gelöscht (NEU)';

  -- ── 3. Abfüllung (inkl. Verschnitt-Zusammensetzung, NEU) ─────────────────────
  DELETE FROM fuellung_chargen
  WHERE fuellung_id IN (
    SELECT id FROM fuellungen WHERE tenant_id = v_tid
  );
  RAISE NOTICE 'fuellung_chargen gelöscht (NEU)';

  DELETE FROM fuellungen WHERE tenant_id = v_tid;
  RAISE NOTICE 'fuellungen gelöscht';

  DELETE FROM zukauf_posten WHERE tenant_id = v_tid;
  RAISE NOTICE 'zukauf_posten gelöscht';

  -- ── 4. Kellerbuch ──────────────────────────────────────────────────────────
  DELETE FROM keller_behandlungen WHERE tenant_id = v_tid;
  RAISE NOTICE 'keller_behandlungen gelöscht';

  DELETE FROM keller_umzuege WHERE tenant_id = v_tid;
  RAISE NOTICE 'keller_umzuege gelöscht';

  -- Verschneidungen (NEU – erst seit Kurzem aktiv im Test)
  DELETE FROM verschneidung_quellen
  WHERE verschneidung_id IN (
    SELECT id FROM verschneidungen WHERE tenant_id = v_tid
  );
  DELETE FROM verschneidungen WHERE tenant_id = v_tid;
  RAISE NOTICE 'verschneidungen + verschneidung_quellen gelöscht (NEU)';

  -- ── 5. Lese / Pressung (vor weinausbau, wegen FK pressung_behaelter→weinausbau) ──
  DELETE FROM pressung_behaelter
  WHERE pressung_id IN (
    SELECT id FROM pressungen WHERE tenant_id = v_tid
  );
  DELETE FROM pressung_weingaerten
  WHERE pressung_id IN (
    SELECT id FROM pressungen WHERE tenant_id = v_tid
  );
  DELETE FROM pressungen WHERE tenant_id = v_tid;
  RAISE NOTICE 'pressungen + pressung_behaelter + pressung_weingaerten gelöscht';

  -- Verknüpfungstabelle Charge↔Weingarten (NEU) – vor weinausbau löschen
  DELETE FROM weinausbau_weingaerten
  WHERE weinausbau_id IN (
    SELECT id FROM weinausbau WHERE tenant_id = v_tid
  );
  RAISE NOTICE 'weinausbau_weingaerten gelöscht (NEU)';

  DELETE FROM weinausbau WHERE tenant_id = v_tid;
  RAISE NOTICE 'weinausbau gelöscht';

  DELETE FROM ama_meldepositionen
  WHERE meldung_id IN (
    SELECT id FROM ama_erntemeldungen WHERE tenant_id = v_tid
  );
  DELETE FROM ama_erntemeldungen WHERE tenant_id = v_tid;
  RAISE NOTICE 'ama_erntemeldungen gelöscht';

  -- ── 6. DAC / Analysen / Jahrgänge ──────────────────────────────────────────
  DELETE FROM dac_antrag WHERE tenant_id = v_tid;
  RAISE NOTICE 'dac_antrag gelöscht';

  DELETE FROM weinanalysen WHERE tenant_id = v_tid;
  RAISE NOTICE 'weinanalysen gelöscht';

  DELETE FROM weinjahrgaenge WHERE tenant_id = v_tid;
  RAISE NOTICE 'weinjahrgaenge gelöscht';

  -- ── 7. Kostenrechnung (Wein-bezogene Buchungen) ────────────────────────────
  DELETE FROM kosteneintrag_behaelter
  WHERE kosteneintrag_id IN (
    SELECT id FROM kosteneintraege WHERE tenant_id = v_tid
  );
  DELETE FROM kosteneintrag_weingaerten
  WHERE kosteneintrag_id IN (
    SELECT id FROM kosteneintraege WHERE tenant_id = v_tid
  );
  DELETE FROM kosteneintraege WHERE tenant_id = v_tid;
  RAISE NOTICE 'kosteneintraege gelöscht';

  -- ── 8. Transaktionszähler zurücksetzen ─────────────────────────────────────
  DELETE FROM transaktionszaehler WHERE tenant_id = v_tid;
  RAISE NOTICE 'transaktionszaehler zurückgesetzt';

  -- ── 9. Chargennummer-Zähler in tenant_einstellungen zurücksetzen ───────────
  UPDATE tenant_einstellungen
  SET charge_zaehler = 1
  WHERE tenant_id = v_tid;
  RAISE NOTICE 'charge_zaehler zurückgesetzt';

  RAISE NOTICE '--- Cleanup abgeschlossen ---';
  RAISE NOTICE 'Behalten: behaelter, weingarten, grundstuecke, lagen, CRM, PSM, Behandlungen-Typen, Preislisten';

END $$;

-- Trigger wieder aktivieren
-- SET session_replication_role = 'origin';   -- KAN-35: siehe oben

-- ── Kontrolle: Was ist noch da? (sollte überall 0 sein, außer behaelter) ─────
SELECT
  'weinausbau'              AS tabelle, COUNT(*) FROM weinausbau              WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL SELECT 'keller_umzuege',       COUNT(*) FROM keller_umzuege         WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL SELECT 'verschneidungen',      COUNT(*) FROM verschneidungen        WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL SELECT 'pressungen',           COUNT(*) FROM pressungen             WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL SELECT 'fuellungen',           COUNT(*) FROM fuellungen             WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL SELECT 'zukauf_posten',        COUNT(*) FROM zukauf_posten          WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL SELECT 'verkaufsposten',       COUNT(*) FROM verkaufsposten         WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL SELECT 'traubenverkauf',       COUNT(*) FROM traubenverkauf         WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL SELECT 'ama_erntemeldungen',   COUNT(*) FROM ama_erntemeldungen     WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL SELECT 'behaelter (bleibt)',   COUNT(*) FROM behaelter              WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL SELECT 'weingarten (bleibt)',  COUNT(*) FROM weingarten             WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
ORDER BY tabelle;
