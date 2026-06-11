-- ═══════════════════════════════════════════════════════════════════════════════
-- software:112 – Testdaten-Cleanup
-- Löscht alle operativen Wein-/Keller-/Lesedaten für den Sandbox-Tenant.
-- BEHÄLT: behaelter, weingarten, grundstuecke, lagen, CRM, tenant_einstellungen
--
-- Tenant-ID Sandbox: fa22dc07-eca5-43df-af96-f7b9b09f0471
-- Ausführen im Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════════

-- Trigger temporär deaktivieren (verhindert updated_at-Fehler bei FK-Cascades)
SET session_replication_role = 'replica';

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

  DELETE FROM verkaufsposten WHERE tenant_id = v_tid;
  RAISE NOTICE 'verkaufsposten gelöscht';

  DELETE FROM fuellungen WHERE tenant_id = v_tid;
  RAISE NOTICE 'fuellungen gelöscht';

  DELETE FROM zukauf_posten WHERE tenant_id = v_tid;
  RAISE NOTICE 'zukauf_posten gelöscht';

  -- ── 2. Kellerbuch ──────────────────────────────────────────────────────────
  DELETE FROM keller_behandlungen WHERE tenant_id = v_tid;
  RAISE NOTICE 'keller_behandlungen gelöscht';

  DELETE FROM keller_umzuege WHERE tenant_id = v_tid;
  RAISE NOTICE 'keller_umzuege gelöscht';

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

  DELETE FROM weinausbau WHERE tenant_id = v_tid;
  RAISE NOTICE 'weinausbau gelöscht';

  DELETE FROM ama_meldepositionen
  WHERE meldung_id IN (
    SELECT id FROM ama_erntemeldungen WHERE tenant_id = v_tid
  );
  DELETE FROM ama_erntemeldungen WHERE tenant_id = v_tid;
  RAISE NOTICE 'ama_erntemeldungen gelöscht';

  -- ── 4. DAC / Analysen / Jahrgänge ──────────────────────────────────────────
  DELETE FROM dac_antrag WHERE tenant_id = v_tid;
  RAISE NOTICE 'dac_antrag gelöscht';

  DELETE FROM weinanalysen WHERE tenant_id = v_tid;
  RAISE NOTICE 'weinanalysen gelöscht';

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

-- Trigger wieder aktivieren
SET session_replication_role = 'origin';

-- ── Kontrolle: Was ist noch da? ────────────────────────────────────────────
SELECT
  'weinausbau'        AS tabelle, COUNT(*) FROM weinausbau        WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL SELECT 'keller_umzuege',  COUNT(*) FROM keller_umzuege  WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL SELECT 'pressungen',      COUNT(*) FROM pressungen      WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL SELECT 'fuellungen',      COUNT(*) FROM fuellungen      WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL SELECT 'verkaufsposten',  COUNT(*) FROM verkaufsposten  WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL SELECT 'ama_erntemeldungen', COUNT(*) FROM ama_erntemeldungen WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL SELECT 'behaelter (bleibt)', COUNT(*) FROM behaelter   WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
ORDER BY tabelle;
