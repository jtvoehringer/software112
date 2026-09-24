-- Import-Herkunft an allen Datensätzen, die über Admin → Datenimport angelegt
-- werden (Rückmeldung 2.9.2026: "allen Einträgen einen Text 'Datenmigration
-- aus Drittsystem' hinzufügen").
--
-- Zusätzlich zum sichtbaren Hinweis im Notizen-Feld (wird von der Import-API
-- vorangestellt) bekommen alle sieben Import-Zieltabellen zwei strukturierte
-- Spalten, damit importierte Datensätze später sauber filter-, auswert- und
-- gesammelt bereinigbar sind (z.B. "alle Importe vom 2.9. wieder löschen"),
-- ohne im Notizen-Freitext suchen zu müssen. Gebinde (behaelter) hat gar kein
-- Notizen-Feld - dort sind die Spalten die einzige Kennzeichnung.
--
-- Manuell angelegte Datensätze lassen beide Spalten NULL.

ALTER TABLE kontakte     ADD COLUMN IF NOT EXISTS import_quelle text, ADD COLUMN IF NOT EXISTS importiert_am timestamptz;
ALTER TABLE firmen       ADD COLUMN IF NOT EXISTS import_quelle text, ADD COLUMN IF NOT EXISTS importiert_am timestamptz;
ALTER TABLE fuellungen   ADD COLUMN IF NOT EXISTS import_quelle text, ADD COLUMN IF NOT EXISTS importiert_am timestamptz;
ALTER TABLE weingarten   ADD COLUMN IF NOT EXISTS import_quelle text, ADD COLUMN IF NOT EXISTS importiert_am timestamptz;
ALTER TABLE grundstuecke ADD COLUMN IF NOT EXISTS import_quelle text, ADD COLUMN IF NOT EXISTS importiert_am timestamptz;
ALTER TABLE behaelter    ADD COLUMN IF NOT EXISTS import_quelle text, ADD COLUMN IF NOT EXISTS importiert_am timestamptz;
ALTER TABLE lagen        ADD COLUMN IF NOT EXISTS import_quelle text, ADD COLUMN IF NOT EXISTS importiert_am timestamptz;

COMMENT ON COLUMN kontakte.import_quelle     IS 'Herkunftstext aus dem Datenimport (z.B. "Datenmigration aus Drittsystem"); NULL bei manueller Anlage';
COMMENT ON COLUMN firmen.import_quelle       IS 'Herkunftstext aus dem Datenimport; NULL bei manueller Anlage';
COMMENT ON COLUMN fuellungen.import_quelle   IS 'Herkunftstext aus dem Datenimport; NULL bei manueller Anlage';
COMMENT ON COLUMN weingarten.import_quelle   IS 'Herkunftstext aus dem Datenimport; NULL bei manueller Anlage';
COMMENT ON COLUMN grundstuecke.import_quelle IS 'Herkunftstext aus dem Datenimport; NULL bei manueller Anlage';
COMMENT ON COLUMN behaelter.import_quelle    IS 'Herkunftstext aus dem Datenimport; NULL bei manueller Anlage';
COMMENT ON COLUMN lagen.import_quelle        IS 'Herkunftstext aus dem Datenimport (Ried beim Import "Rieden (Details)" automatisch angelegt); NULL bei manueller Anlage';
