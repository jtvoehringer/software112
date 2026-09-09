-- ═══════════════════════════════════════════════════════════════════════════════
-- SWEEP: alle Rieden, Weingärten und Grundstücke bei "Weingut Johannes Gebeshuber"
-- löschen, um sauber neu zu importieren.
--
-- ⚠️  Bitte ERST diagnose-rieden-weingarten-gst-aktuell.sql laufen lassen und mir
--     das Ergebnis schicken - danach schaue ich mir an, was beim Import genau
--     falsch gelaufen ist, und korrigiere die Import-Logik. Erst DANACH diesen
--     Sweep ausführen und neu importieren, sonst reimportieren wir denselben
--     Fehler nochmal.
--
-- Betroffen sind NUR: lagen (Rieden), weingarten, weingarten_rebsorten (kaskadiert
-- automatisch mit weingarten), grundstuecke - alles andere (Kellerbuch, Verkäufe,
-- Kalender, Kontakte, ...) bleibt unangetastet.
--
-- Einzige Tabelle mit einem "harten" Fremdschlüssel auf weingarten ohne Kaskade:
-- traubenverkauf (Traubenverkauf-Belege referenzieren ein Weingarten). Schritt 0
-- prüft, ob es davon überhaupt welche gibt - bei einem frisch angelegten Mandanten
-- wie Gebeshuber sollte das 0 sein. Falls NICHT 0: bitte abbrechen und mir
-- Bescheid geben, bevor du weitermachst, damit wir diese Belege nicht versehentlich
-- mit verlieren.
--
-- Tenant-ID Gebeshuber (per /api/me/active-tenant am 15.8. bestätigt):
-- 097f67ed-381e-4bb3-952e-758aa9d3a501
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Schritt 0: Sicherheitscheck - gibt es Traubenverkauf-Belege, die an einem
--    Weingarten dieses Mandanten hängen? Sollte 0 sein. Falls nicht: NICHT
--    weitermachen, sondern mir Bescheid geben. ────────────────────────────────
SELECT count(*) AS traubenverkauf_betroffen
FROM traubenverkauf
WHERE tenant_id = '097f67ed-381e-4bb3-952e-758aa9d3a501';

-- ── Ab hier nur ausführen, wenn obiges Ergebnis 0 war ────────────────────────

DO $$
DECLARE
  v_tid UUID := '097f67ed-381e-4bb3-952e-758aa9d3a501';
  v_anzahl_gst INT;
  v_anzahl_wg  INT;
  v_anzahl_lg  INT;
BEGIN

  -- Sicherheitscheck: nur fortfahren, wenn der Name noch stimmt
  IF NOT EXISTS (
    SELECT 1 FROM tenants WHERE id = v_tid AND name = 'Weingut Johannes Gebeshuber'
  ) THEN
    RAISE EXCEPTION 'Sicherheitscheck fehlgeschlagen: Mandant % heißt nicht mehr "Weingut Johannes Gebeshuber" (oder existiert nicht mehr) - Abbruch, nichts wurde gelöscht.', v_tid;
  END IF;

  -- Sicherheitscheck: keine Traubenverkauf-Belege betroffen
  IF EXISTS (SELECT 1 FROM traubenverkauf WHERE tenant_id = v_tid) THEN
    RAISE EXCEPTION 'Sicherheitscheck fehlgeschlagen: es gibt Traubenverkauf-Belege für diesen Mandanten - Abbruch, nichts wurde gelöscht. Bitte erst klären, ob die auch weg sollen.';
  END IF;

  SELECT count(*) INTO v_anzahl_gst FROM grundstuecke WHERE tenant_id = v_tid;
  SELECT count(*) INTO v_anzahl_wg  FROM weingarten    WHERE tenant_id = v_tid;
  SELECT count(*) INTO v_anzahl_lg  FROM lagen         WHERE tenant_id = v_tid;
  RAISE NOTICE '--- Lösche % Grundstücke, % Weingärten, % Rieden für Gebeshuber (%) ---', v_anzahl_gst, v_anzahl_wg, v_anzahl_lg, v_tid;

  DELETE FROM grundstuecke WHERE tenant_id = v_tid;
  DELETE FROM weingarten   WHERE tenant_id = v_tid;   -- kaskadiert weingarten_rebsorten automatisch
  DELETE FROM lagen        WHERE tenant_id = v_tid;

  RAISE NOTICE '--- Fertig. Rieden/Weingärten/Grundstücke für Gebeshuber sind leer, bereit für Neu-Import. ---';

END $$;

-- ── Kontrolle: alle drei sollten 0 sein ──────────────────────────────────────
SELECT
  (SELECT count(*) FROM grundstuecke WHERE tenant_id = '097f67ed-381e-4bb3-952e-758aa9d3a501') AS grundstuecke_sollte_0_sein,
  (SELECT count(*) FROM weingarten   WHERE tenant_id = '097f67ed-381e-4bb3-952e-758aa9d3a501') AS weingarten_sollte_0_sein,
  (SELECT count(*) FROM lagen        WHERE tenant_id = '097f67ed-381e-4bb3-952e-758aa9d3a501') AS lagen_sollte_0_sein;
