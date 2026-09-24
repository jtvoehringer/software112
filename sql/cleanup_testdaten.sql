-- ═══════════════════════════════════════════════════════════════════════════════
-- software:112 – Testdaten-Cleanup
-- Löscht alle operativen Wein-/Keller-/Lesedaten für den Sandbox-Tenant.
-- BEHÄLT: behaelter, weingarten, grundstuecke, lagen, CRM, tenant_einstellungen
--
-- Tenant-ID Sandbox: fa22dc07-eca5-43df-af96-f7b9b09f0471
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
--    bestandsprotokoll – auch im SQL-Editor und bei FK-Kaskaden. Das ist gewollt:
--    dieser Cleanup ist danach im Protokoll nachvollziehbar.
--  • TRUNCATE ist auf diesen Tabellen gesperrt – nur zeilenweise mit DELETE löschen.
--  • Deshalb läuft das Skript NICHT mehr mit SET session_replication_role = 'replica'
--    (bis 24.09.2026 so): das schaltet Protokoll-Trigger, FK-Prüfungen UND
--    FK-Kaskaden ab – Löschungen blieben ungeprotokolliert, abhängige Zeilen
--    (z. B. fuellung_bewegungen, verschneidungen) blieben verwaist zurück.
--  • Löschreihenfolge wegen der FKs ohne ON DELETE (NO ACTION): verschneidungen
--    (samt verschneidung_quellen), keller_behandlungen, keller_umzuege,
--    fuellung_chargen und pressung_behaelter VOR weinausbau; weinausbau,
--    keller_umzuege, keller_behandlungen und pressung_behaelter VOR behaelter;
--    traubenverkauf VOR weinjahrgaenge. Bis 24.09.2026 fehlten hier verschneidungen
--    und traubenverkauf (fiel unter 'replica' nur nicht auf).
--  • Mengenkorrekturen nicht per UPDATE, sondern über die RPCs schwund_buchen(...)
--    (Liter einer Charge mindern) bzw. fuellung_bestand_buchen(...) (Flaschenbestand
--    ±) – sie legen datierte Bewegungszeilen an.
--  • Der DO-Block läuft als eine Transaktion: scheitert ein DELETE (z. B. 23503
--    wegen einer neuen Tabelle mit FK auf weinausbau), wird nichts gelöscht.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_tid UUID := 'fa22dc07-eca5-43df-af96-f7b9b09f0471';
BEGIN

  RAISE NOTICE '--- Starte Cleanup für Tenant % ---', v_tid;

  -- ── 1. Weinhandel ──────────────────────────────────────────────────────────
  DELETE FROM verkauf_positionen
  WHERE verkaufsposten_id IN (
    SELECT id FROM verkaufsposten WHERE tenant_id = v_tid
  );
  RAISE NOTICE 'verkauf_positionen gelöscht';

  DELETE FROM verkaufsposten WHERE tenant_id = v_tid;   -- zahlungen per CASCADE
  RAISE NOTICE 'verkaufsposten gelöscht';

  -- KAN-35: traubenverkauf.jahrgang_id ist NO ACTION → vor weinjahrgaenge löschen
  DELETE FROM traubenverkauf WHERE tenant_id = v_tid;
  RAISE NOTICE 'traubenverkauf gelöscht';

  -- fuellung_chargen und fuellung_bewegungen gehen per CASCADE mit
  DELETE FROM fuellungen WHERE tenant_id = v_tid;
  RAISE NOTICE 'fuellungen gelöscht';

  DELETE FROM zukauf_posten WHERE tenant_id = v_tid;
  RAISE NOTICE 'zukauf_posten gelöscht';

  -- ── 2. Kellerbuch (alles, was auf weinausbau zeigt, vor weinausbau) ────────
  DELETE FROM keller_behandlungen WHERE tenant_id = v_tid;
  RAISE NOTICE 'keller_behandlungen gelöscht';

  DELETE FROM keller_umzuege WHERE tenant_id = v_tid;
  RAISE NOTICE 'keller_umzuege gelöscht';

  -- KAN-35: verschneidungen.ziel_weinausbau_id ist NO ACTION (vorher CASCADE);
  -- verschneidung_quellen gehen per CASCADE mit
  DELETE FROM verschneidungen WHERE tenant_id = v_tid;
  RAISE NOTICE 'verschneidungen + verschneidung_quellen gelöscht';

  -- ── 3. Lese / Pressung (vor weinausbau, wegen FK pressung_behaelter→weinausbau) ──
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

  -- DAC-Anträge und Analysen vor den Chargen (sonst setzt die Kaskade erst ihre
  -- weinausbau_id auf NULL, bevor sie ohnehin gelöscht werden)
  DELETE FROM dac_antrag WHERE tenant_id = v_tid;
  RAISE NOTICE 'dac_antrag gelöscht';

  DELETE FROM weinanalysen WHERE tenant_id = v_tid;
  RAISE NOTICE 'weinanalysen gelöscht';

  DELETE FROM weinausbau WHERE tenant_id = v_tid;       -- weinausbau_weingaerten per CASCADE
  RAISE NOTICE 'weinausbau gelöscht';

  DELETE FROM ama_meldepositionen
  WHERE meldung_id IN (
    SELECT id FROM ama_erntemeldungen WHERE tenant_id = v_tid
  );
  DELETE FROM ama_erntemeldungen WHERE tenant_id = v_tid;
  RAISE NOTICE 'ama_erntemeldungen gelöscht';

  -- ── 4. Jahrgänge (ernte_parzellen per CASCADE) ────────────────────────────
  DELETE FROM weinjahrgaenge WHERE tenant_id = v_tid;
  RAISE NOTICE 'weinjahrgaenge gelöscht';

  -- ── 5. Kostenrechnung (Wein-bezogene Buchungen) ────────────────────────────
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

  -- ── 6. Transaktionszähler zurücksetzen ─────────────────────────────────────
  DELETE FROM transaktionszaehler WHERE tenant_id = v_tid;
  RAISE NOTICE 'transaktionszaehler zurückgesetzt';

  -- ── 7. Chargennummer-Zähler in tenant_einstellungen zurücksetzen ───────────
  UPDATE tenant_einstellungen
  SET charge_zaehler = 1
  WHERE tenant_id = v_tid;
  RAISE NOTICE 'charge_zaehler zurückgesetzt';

  RAISE NOTICE '--- Cleanup abgeschlossen ---';
  RAISE NOTICE 'Behalten: behaelter, weingarten, grundstuecke, lagen, CRM, PSM, Behandlungen-Typen';

END $$;

-- ── Kontrolle: Was ist noch da? ────────────────────────────────────────────
SELECT
  'weinausbau'        AS tabelle, COUNT(*) FROM weinausbau        WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL SELECT 'keller_umzuege',  COUNT(*) FROM keller_umzuege  WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL SELECT 'verschneidungen', COUNT(*) FROM verschneidungen WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL SELECT 'pressungen',      COUNT(*) FROM pressungen      WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL SELECT 'fuellungen',      COUNT(*) FROM fuellungen      WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL SELECT 'fuellung_bewegungen', COUNT(*) FROM fuellung_bewegungen WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL SELECT 'verkaufsposten',  COUNT(*) FROM verkaufsposten  WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL SELECT 'traubenverkauf',  COUNT(*) FROM traubenverkauf  WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL SELECT 'ama_erntemeldungen', COUNT(*) FROM ama_erntemeldungen WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL SELECT 'behaelter (bleibt)', COUNT(*) FROM behaelter   WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL SELECT 'bestandsprotokoll (neu)', COUNT(*) FROM bestandsprotokoll WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471' AND erstellt_am > now() - interval '1 hour'
ORDER BY tabelle;
