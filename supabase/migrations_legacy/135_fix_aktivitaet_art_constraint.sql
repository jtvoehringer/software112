-- Migration 135: Fix für Migration 134
--
-- Migration 134 versuchte, den bestehenden CHECK-Constraint auf aktivitaeten.art
-- dynamisch zu finden (über pg_get_constraintdef(...) ILIKE '%art%IN%'), um ihn
-- vor dem Neuanlegen zu droppen. Das schlug fehl, weil Postgres "IN (...)" in der
-- Constraint-Definition intern zu "= ANY (ARRAY[...])" umschreibt - der Text
-- enthält also gar kein "IN" mehr, das ILIKE-Muster hat nie gegriffen. Dadurch
-- blieb der alte Constraint bestehen und das anschließende
-- "ADD CONSTRAINT aktivitaeten_art_check" kollidierte mit dem gleichnamigen,
-- immer noch existierenden alten Constraint (Fehler 42710).
--
-- Fix hier: statt den Constraint-Text zu parsen, wird über pg_attribute/conkey
-- direkt die eingeschränkte SPALTE ermittelt (unabhängig davon, wie Postgres die
-- Bedingung textuell formatiert) - das ist robust gegen genau dieses Problem.

DO $$
DECLARE
  con_name text;
BEGIN
  SELECT con.conname INTO con_name
  FROM pg_constraint con
  JOIN pg_class rel      ON rel.oid = con.conrelid
  JOIN pg_attribute att  ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
  WHERE rel.relname = 'aktivitaeten'
    AND con.contype = 'c'
    AND att.attname = 'art'
  LIMIT 1;

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE aktivitaeten DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE aktivitaeten ADD CONSTRAINT aktivitaeten_art_check
  CHECK (art IN (
    'notiz','anruf','email','verkostung','messe','besuch','angebot','sonstiges',
    'urlaub','abwesenheit','verkauf','besprechung'
  ));
