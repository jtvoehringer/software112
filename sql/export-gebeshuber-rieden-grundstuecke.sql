-- ═══════════════════════════════════════════════════════════════════════════════
-- Export der AKTUELLEN Rieden + Grundstücke aus "Weingut Johannes Gebeshuber",
-- damit sie nach dem kompletten Mandanten-Reset über den Datenimport
-- (Tabs "Rieden" und "Grundstücke") wieder eingespielt werden können.
--
-- Tenant-ID Gebeshuber: c3d357c5-239e-4eac-85b2-4774476bc435
--
-- Anleitung:
-- 1. Query 1 ausführen, Ergebnis über den "Download CSV"-Button im Supabase
--    SQL-Editor speichern → das ist die Datei für den Import-Tab "Rieden".
-- 2. Query 2 ausführen, genauso als CSV speichern → für den Import-Tab
--    "Grundstücke".
-- 3. Erst NACHDEM beide CSVs gespeichert sind: den Mandanten löschen
--    (seit KAN-151 über public.s112_mandant_loeschen, Runbook docs/Mandant_loeschen.md), neuen
--    leeren Mandanten anlegen, dort unter /admin/import beide CSVs
--    hochladen (zuerst "Rieden", danach "Grundstücke" - "Grundstücke"
--    braucht die "Rieden"-Bezeichnung als Zuordnung).
--
-- WICHTIG: Die Spalte "ried_flaeche" in Query 2 muss beim Import exakt mit
-- der Spalte "name" aus Query 1 übereinstimmen (Groß-/Kleinschreibung egal,
-- aber sonst exakt) - das ist die Verknüpfung zwischen den beiden CSVs.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Query 1: für Import-Tab "Rieden" ─────────────────────────────────────────
SELECT
  w.name        AS name,
  w.ried        AS ried,
  w.rebsorte    AS rebsorte,
  w.pflanzjahr  AS pflanzjahr,
  w.weinart     AS weinart,
  w.flaeche_ha  AS flaeche_ha
FROM weingarten w
WHERE w.tenant_id = 'c3d357c5-239e-4eac-85b2-4774476bc435'
ORDER BY w.ried, w.name;

-- ── Query 2: für Import-Tab "Grundstücke" (separat ausführen + exportieren) ──
SELECT
  g.gst_nr               AS gst_nr,
  w.name                 AS ried_flaeche,
  g.katastralgemeinde     AS katastralgemeinde,
  g.flaeche_ha            AS flaeche_ha,
  g.flaeche_ha_kataster   AS flaeche_ha_kataster,
  g.rebsorte              AS rebsorte,
  g.bewirtschaftung       AS bewirtschaftung,
  g.status                AS status
FROM grundstuecke g
JOIN weingarten w ON w.id = g.weingarten_id
WHERE g.tenant_id = 'c3d357c5-239e-4eac-85b2-4774476bc435'
ORDER BY w.name, g.gst_nr;
