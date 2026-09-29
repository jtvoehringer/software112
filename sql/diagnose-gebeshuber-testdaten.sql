-- ═══════════════════════════════════════════════════════════════════════════════
-- Diagnose: Welche Testdaten stecken noch im Mandanten "Weingut Johannes Gebeshuber"?
-- Rein lesend (nur SELECT/COUNT) – löscht nichts. Bitte im Supabase SQL-Editor
-- ausführen und mir das Ergebnis schicken, dann baue ich darauf das eigentliche
-- Lösch-Script.
--
-- Tenant-ID Gebeshuber: c3d357c5-239e-4eac-85b2-4774476bc435
-- (per Diagnose vom 14.8. bestätigt)
--
-- BLEIBT in jedem Fall unangetastet (bewusste Ausnahme "so lassen"):
--   lagen, weingarten, grundstuecke, weingarten_rebsorten, behaelter (Gebinde-
--   Stammdaten), tenants, tenant_einstellungen, tenant_memberships
--
-- Hinweis: Preislisten (Migration 151) und Fibu (Migration 143) wurden als
-- Features komplett aus der App entfernt - die Tabellen existieren nicht mehr
-- und sind hier daher nicht enthalten.
-- ═══════════════════════════════════════════════════════════════════════════════

WITH t AS (SELECT 'c3d357c5-239e-4eac-85b2-4774476bc435'::uuid AS id)

-- ── 1. Kellerbuch ─────────────────────────────────────────────────────────────
SELECT 'Kellerbuch' AS kategorie, 'keller_behandlungen' AS tabelle, COUNT(*) FROM keller_behandlungen, t WHERE tenant_id = t.id
UNION ALL SELECT 'Kellerbuch', 'keller_umzuege',        COUNT(*) FROM keller_umzuege, t         WHERE tenant_id = t.id
UNION ALL SELECT 'Kellerbuch', 'kellerplaene',          COUNT(*) FROM kellerplaene, t           WHERE tenant_id = t.id

-- ── 2. Chargen / Abfüllung ───────────────────────────────────────────────────
UNION ALL SELECT 'Chargen', 'weinausbau',      COUNT(*) FROM weinausbau, t      WHERE tenant_id = t.id
UNION ALL SELECT 'Chargen', 'fuellungen',      COUNT(*) FROM fuellungen, t      WHERE tenant_id = t.id
UNION ALL SELECT 'Chargen', 'verschneidungen', COUNT(*) FROM verschneidungen, t WHERE tenant_id = t.id

-- ── 3. Kalender (CRM) ─────────────────────────────────────────────────────────
UNION ALL SELECT 'Kalender', 'aktivitaeten',      COUNT(*) FROM aktivitaeten, t      WHERE tenant_id = t.id
UNION ALL SELECT 'Kalender', 'pipeline_eintraege', COUNT(*) FROM pipeline_eintraege, t WHERE tenant_id = t.id

-- ── 4. Warenlager (PSM/Dünger) + Maßnahmen (treibt den Verbrauch) ────────────
UNION ALL SELECT 'Warenlager', 'psm_lager_bewegungen',        COUNT(*) FROM psm_lager_bewegungen, t        WHERE tenant_id = t.id
UNION ALL SELECT 'Warenlager', 'duengemittel_lager_bewegungen', COUNT(*) FROM duengemittel_lager_bewegungen, t WHERE tenant_id = t.id
UNION ALL SELECT 'Warenlager', 'behandlungen (Maßnahmen)',    COUNT(*) FROM behandlungen, t                WHERE tenant_id = t.id

-- ── 5. Verkäufe / Einkäufe / Offene Posten (= verkaufsposten+zahlungen) ──────
UNION ALL SELECT 'Verkäufe', 'verkaufsposten',            COUNT(*) FROM verkaufsposten, t            WHERE tenant_id = t.id
UNION ALL SELECT 'Verkäufe', 'traubenverkauf',            COUNT(*) FROM traubenverkauf, t            WHERE tenant_id = t.id
UNION ALL SELECT 'Verkäufe', 'zahlungen',                 COUNT(*) FROM zahlungen, t                 WHERE tenant_id = t.id
UNION ALL SELECT 'Verkäufe', 'zukauf_posten (Einkäufe)',  COUNT(*) FROM zukauf_posten, t             WHERE tenant_id = t.id
UNION ALL SELECT 'Verkäufe', 'ea_transaktionen',          COUNT(*) FROM ea_transaktionen, t          WHERE tenant_id = t.id

-- ── 6. Sonstige Produkte (Katalog, keine Bewegung) ───────────────────────────
UNION ALL SELECT 'Sonstige Produkte', 'sonstige_artikel', COUNT(*) FROM sonstige_artikel, t WHERE tenant_id = t.id

-- ── 7. Sonstiges/Weiteres, was ich zusätzlich gefunden habe ("vielleicht noch mehr") ──
UNION ALL SELECT 'Weiteres', 'pressungen',           COUNT(*) FROM pressungen, t           WHERE tenant_id = t.id
UNION ALL SELECT 'Weiteres', 'ama_erntemeldungen',   COUNT(*) FROM ama_erntemeldungen, t    WHERE tenant_id = t.id
UNION ALL SELECT 'Weiteres', 'dac_antrag',           COUNT(*) FROM dac_antrag, t            WHERE tenant_id = t.id
UNION ALL SELECT 'Weiteres', 'weinanalysen',         COUNT(*) FROM weinanalysen, t          WHERE tenant_id = t.id
UNION ALL SELECT 'Weiteres', 'weinjahrgaenge',       COUNT(*) FROM weinjahrgaenge, t        WHERE tenant_id = t.id
UNION ALL SELECT 'Weiteres', 'lesen',                COUNT(*) FROM lesen, t                 WHERE tenant_id = t.id
UNION ALL SELECT 'Weiteres', 'kosteneintraege',      COUNT(*) FROM kosteneintraege, t       WHERE tenant_id = t.id
UNION ALL SELECT 'Weiteres', 'zeiterfassung',        COUNT(*) FROM zeiterfassung, t         WHERE tenant_id = t.id
UNION ALL SELECT 'Weiteres', 'sumup_transaktionen',  COUNT(*) FROM sumup_transaktionen, t   WHERE tenant_id = t.id
UNION ALL SELECT 'Weiteres', 'sumup_checkouts',      COUNT(*) FROM sumup_checkouts, t       WHERE tenant_id = t.id
UNION ALL SELECT 'Weiteres', 'exportauftraege',      COUNT(*) FROM exportauftraege, t       WHERE tenant_id = t.id
UNION ALL SELECT 'Weiteres', 'export_dokumente (über exportauftraege)', COUNT(*)
  FROM export_dokumente ed, t WHERE ed.exportauftrag_id IN (SELECT id FROM exportauftraege WHERE tenant_id = t.id)
UNION ALL SELECT 'Weiteres', 'ernte_parzellen (über weinjahrgaenge)', COUNT(*)
  FROM ernte_parzellen ep, t WHERE ep.jahrgang_id IN (SELECT id FROM weinjahrgaenge WHERE tenant_id = t.id)
UNION ALL SELECT 'Weiteres', 'pruefnummernantraege', COUNT(*) FROM pruefnummernantraege, t  WHERE tenant_id = t.id
UNION ALL SELECT 'Weiteres', 'assistent_unterhaltungen (bot:112)', COUNT(*) FROM assistent_unterhaltungen, t WHERE tenant_id = t.id

-- ── 8. Stammdaten – hast du NICHT explizit genannt, per Policy aber fraglich ──
UNION ALL SELECT 'Stammdaten (Rückfrage)', 'kontakte', COUNT(*) FROM kontakte, t WHERE tenant_id = t.id
UNION ALL SELECT 'Stammdaten (Rückfrage)', 'firmen',   COUNT(*) FROM firmen, t   WHERE tenant_id = t.id
UNION ALL SELECT 'Stammdaten (Rückfrage)', 'weinbaugebiete_custom', COUNT(*) FROM weinbaugebiete_custom, t WHERE tenant_id = t.id

-- ── Zur Kontrolle: das BLEIBT (Sonderfall Rieden-Kopie) ──────────────────────
UNION ALL SELECT 'Bleibt (Sonderfall)', 'lagen',       COUNT(*) FROM lagen, t       WHERE tenant_id = t.id
UNION ALL SELECT 'Bleibt (Sonderfall)', 'weingarten',  COUNT(*) FROM weingarten, t  WHERE tenant_id = t.id
UNION ALL SELECT 'Bleibt (Sonderfall)', 'grundstuecke', COUNT(*) FROM grundstuecke, t WHERE tenant_id = t.id
UNION ALL SELECT 'Bleibt (Sonderfall)', 'behaelter (Gebinde-Stammdaten)', COUNT(*) FROM behaelter, t WHERE tenant_id = t.id

ORDER BY kategorie, tabelle;
