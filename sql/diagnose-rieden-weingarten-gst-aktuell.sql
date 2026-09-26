-- ═══════════════════════════════════════════════════════════════════════════════
-- Diagnose: aktueller Stand Rieden/Weingärten/Grundstücke bei "Weingut Johannes
-- Gebeshuber" nach dem CSV-Reimport - rein lesend, ändert nichts.
--
-- Bitte im Supabase SQL-Editor ausführen und mir alle vier Ergebnisse (Screenshot
-- oder Text) schicken, bevor wir den Sweep (sql/sweep-rieden-weingarten-gst.sql, mit
-- KAN-151 entfernt – nicht wiederherstellen, Produktivbetrieb) laufen lassen - damit ich sehe, WAS beim
-- Import genau schiefgelaufen ist (falsche Zuordnung, doppelte Rieden/Weingärten,
-- nicht gefundene Zuordnungen), und die Import-Logik entsprechend korrigieren kann,
-- bevor du nochmal importierst.
--
-- (Korrigiert gegenüber der ersten Version: die Kombination aus Komma-Join und
-- LEFT JOIN in einem FROM hat Postgres zurecht abgelehnt - jede Query trägt die
-- Tenant-ID jetzt direkt als Literal statt über eine gemeinsame "t"-Tabelle.)
--
-- Tenant-ID Gebeshuber (per /api/me/active-tenant am 15.8. bestätigt):
-- 097f67ed-381e-4bb3-952e-758aa9d3a501
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Alle Rieden (lagen) mit Anzahl zugeordneter Weingärten/Grundstücke ────
SELECT
  l.id                          AS lage_id,
  l.name                        AS ried_name,
  count(DISTINCT w.id)          AS anzahl_weingaerten,
  count(g.id)                   AS anzahl_grundstuecke,
  array_agg(DISTINCT w.name ORDER BY w.name) AS weingarten_namen
FROM lagen l
LEFT JOIN weingarten w ON w.lage_id = l.id AND w.tenant_id = '097f67ed-381e-4bb3-952e-758aa9d3a501'
LEFT JOIN grundstuecke g ON g.weingarten_id = w.id
WHERE l.tenant_id = '097f67ed-381e-4bb3-952e-758aa9d3a501'
GROUP BY l.id, l.name
ORDER BY l.name;

-- ── 2. Gibt es mehrere Rieden (lagen) mit demselben oder sehr ähnlichem Namen? ─
--    (z.B. durch Gross-/Kleinschreibung, Leerzeichen oder Mehrfach-Import)
SELECT lower(btrim(name)) AS name_normalisiert, count(*) AS anzahl, array_agg(name) AS namen, array_agg(id) AS ids
FROM lagen
WHERE tenant_id = '097f67ed-381e-4bb3-952e-758aa9d3a501'
GROUP BY lower(btrim(name))
HAVING count(*) > 1;

-- ── 3. Alle Grundstücke mit ihrem Weingarten UND dessen Ried, sortiert nach GST-Nr. -
--    hier sollte sichtbar werden, ob z.B. GST 2355/1 wirklich zweimal (je Rebsorte)
--    vorkommt oder ob da eine falsche Zuordnung passiert ist
SELECT
  g.gst_nr, g.rebsorte AS gst_rebsorte, g.flaeche_ha_kataster, g.flaeche_ha AS gst_flaeche,
  w.name AS weingarten_name, w.rebsorte AS weingarten_rebsorte, w.pflanzjahr,
  l.name AS ried_name
FROM grundstuecke g
JOIN weingarten w ON w.id = g.weingarten_id
LEFT JOIN lagen l ON l.id = w.lage_id
WHERE g.tenant_id = '097f67ed-381e-4bb3-952e-758aa9d3a501'
ORDER BY l.name, g.gst_nr, w.name;

-- ── 4. Weingärten OHNE lage_id (Ried-Zuordnung fehlgeschlagen) oder OHNE Grundstücke ─
SELECT w.id, w.name, w.ried AS ried_text, w.lage_id,
  (SELECT count(*) FROM grundstuecke g WHERE g.weingarten_id = w.id) AS anzahl_grundstuecke
FROM weingarten w
WHERE w.tenant_id = '097f67ed-381e-4bb3-952e-758aa9d3a501'
  AND (w.lage_id IS NULL OR NOT EXISTS (SELECT 1 FROM grundstuecke g WHERE g.weingarten_id = w.id))
ORDER BY w.name;
