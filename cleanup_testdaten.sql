-- ══════════════════════════════════════════════════════════════════════
-- software:112 – Testdaten-Bereinigung Sandbox-Tenant
-- Tenant-ID: fa22dc07-eca5-43df-af96-f7b9b09f0471
--
-- BLEIBT: weingarten, grundstuecke, behaelter, kellerplaene,
--         kellerplan_positionen, psm_stammdaten, weinjahrgaenge,
--         kontakte, firmen, preislisten, kostenstellen, kostenarten
--
-- WIRD GELÖSCHT: weinausbau, pressungen, ernte_parzellen,
--                zukauf_posten, verkaufsposten, fuellungen,
--                behandlungen, psm_lager_bewegungen,
--                keller_umzuege, verschneidungen, traubenverkauf,
--                exportauftraege, kosteneintraege,
--                aktivitaeten, pipeline_eintraege
-- ══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Exportmodul ────────────────────────────────────────────────────
DELETE FROM export_dokumente
WHERE exportauftrag_id IN (
  SELECT id FROM exportauftraege WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
);

DELETE FROM exportauftrag_positionen
WHERE exportauftrag_id IN (
  SELECT id FROM exportauftraege WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
);

DELETE FROM exportauftraege
WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';

-- ── 2. Verkauf ────────────────────────────────────────────────────────
DELETE FROM verkauf_positionen
WHERE verkaufsposten_id IN (
  SELECT id FROM verkaufsposten WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
);

DELETE FROM verkaufsposten
WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';

-- ── 3. Zukauf ─────────────────────────────────────────────────────────
DELETE FROM zukauf_posten
WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';

-- ── 4. Traubenverkauf ─────────────────────────────────────────────────
DELETE FROM traubenverkauf
WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';

-- ── 5. Füllungen / Warenlager ─────────────────────────────────────────
DELETE FROM fuellungen
WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';

-- ── 6. Verschneidungen ────────────────────────────────────────────────
DELETE FROM verschneidung_quellen
WHERE verschneidung_id IN (
  SELECT id FROM verschneidungen WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
);

DELETE FROM verschneidungen
WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';

-- ── 7. Keller-Umzüge ──────────────────────────────────────────────────
DELETE FROM keller_umzuege
WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';

-- ── 8. Pressungen ─────────────────────────────────────────────────────
DELETE FROM pressung_weingaerten
WHERE pressung_id IN (
  SELECT id FROM pressungen WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
);

DELETE FROM pressungen
WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';

-- ── 9. Erntedaten (kein tenant_id → via weinjahrgaenge) ──────────────
DELETE FROM ernte_parzellen
WHERE jahrgang_id IN (
  SELECT id FROM weinjahrgaenge WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
);

-- ── 10. Weinausbau-Chargen (Gebinde bleiben, Inhalt weg) ──────────────
DELETE FROM weinausbau
WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';

-- ── 11. Behandlungen / PSM-Einsätze ──────────────────────────────────
DELETE FROM behandlung_grundstuecke
WHERE behandlung_id IN (
  SELECT id FROM behandlungen WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
);

DELETE FROM behandlungen
WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';

-- ── 12. PSM-Lager-Bewegungen ──────────────────────────────────────────
DELETE FROM psm_lager_bewegungen
WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';

-- ── 13. Kosteneinträge (Kostenstellen/Kostenarten bleiben) ────────────
DELETE FROM kosteneintraege
WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';

-- ── 14. CRM: Aktivitäten + Pipeline (Kontakte/Firmen bleiben) ─────────
DELETE FROM aktivitaeten
WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';

DELETE FROM pipeline_eintraege
WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';

-- ── Abschlusskontrolle ────────────────────────────────────────────────
SELECT 'weinausbau'        AS tabelle, COUNT(*) AS verbleibend FROM weinausbau      WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL
SELECT 'pressungen',                   COUNT(*) FROM pressungen                     WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL
SELECT 'ernte_parzellen',              COUNT(*) FROM ernte_parzellen WHERE jahrgang_id IN (SELECT id FROM weinjahrgaenge WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471')
UNION ALL
SELECT 'fuellungen',                   COUNT(*) FROM fuellungen                     WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL
SELECT 'verkaufsposten',               COUNT(*) FROM verkaufsposten                 WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL
SELECT 'zukauf_posten',                COUNT(*) FROM zukauf_posten                  WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL
SELECT 'behaelter (bleibt)',           COUNT(*) FROM behaelter                      WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL
SELECT 'weingarten (bleibt)',          COUNT(*) FROM weingarten                     WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
UNION ALL
SELECT 'grundstuecke (bleibt)',        COUNT(*) FROM grundstuecke                   WHERE tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';

COMMIT;
