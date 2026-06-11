-- Migration 082: weingarten.lage_id aus ried-Text syncen
-- Bestehende Datensätze, bei denen ried (Text) einem Lagen-Namen entspricht
-- aber lage_id noch NULL ist, werden einmalig befüllt.
-- Läuft idempotent: WHERE lage_id IS NULL schützt bereits zugeordnete Zeilen.

UPDATE weingarten w
SET lage_id = l.id,
    ried     = l.name   -- Schreibweise aus Lagen-Tabelle übernehmen
FROM lagen l
WHERE l.name    = w.ried
  AND l.tenant_id = w.tenant_id
  AND w.lage_id IS NULL;
