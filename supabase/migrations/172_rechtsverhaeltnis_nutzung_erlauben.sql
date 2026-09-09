-- Migration 172: Rechtsverhältnis "Nutzung" als gültigen Wert erlauben
--
-- Rückmeldung 24.8.2026: Dropdown "Rechtsverhältnis" (Grundstück-Formular)
-- wurde im Code um die Option "Nutzung" (Wert: nutzung) erweitert - bisher
-- nur eigentum/pacht. Beim Speichern kam ein Server-Fehler ("This page
-- couldn't load"), was auf einen DB-seitigen CHECK-Constraint auf der Spalte
-- grundstuecke.rechtsverhaeltnis hindeutet, der nur eigentum/pacht zulässt.
--
-- Die Spalte rechtsverhaeltnis stammt aus dem initialen Schema, nicht aus
-- einer nachvollziehbaren Migration in diesem Repo - der genaue Name eines
-- eventuell bestehenden Constraints ist daher hier nicht bekannt. Er wird
-- deshalb dynamisch über pg_constraint gesucht und ersetzt (funktioniert
-- unabhängig davon, ob/wie der bestehende Constraint benannt ist - und auch,
-- falls noch gar keiner existiert, in dem Fall passiert im DO-Block einfach
-- nichts).

DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(c.conkey)
    WHERE rel.relname = 'grundstuecke'
      AND att.attname = 'rechtsverhaeltnis'
      AND c.contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE grundstuecke DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

ALTER TABLE grundstuecke
  ADD CONSTRAINT grundstuecke_rechtsverhaeltnis_check
    CHECK (rechtsverhaeltnis IS NULL OR rechtsverhaeltnis IN ('eigentum', 'pacht', 'nutzung'));
