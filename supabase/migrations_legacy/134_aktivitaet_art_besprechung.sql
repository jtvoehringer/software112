-- Migration 134: Aktivitäts-Art "Besprechung" (+ Nachziehen bereits genutzter Werte)
--
-- Der CHECK-Constraint auf aktivitaeten.art (siehe Migration 020) kennt bisher nur
-- ('notiz','anruf','email','verkostung','messe','besuch','angebot','sonstiges').
-- 'urlaub', 'abwesenheit' und 'verkauf' werden im Frontend/Produktivbetrieb bereits
-- erfolgreich verwendet (offenbar wurde der Constraint zu einem früheren Zeitpunkt
-- direkt per SQL im Supabase-Dashboard gelockert, ohne dass das in einer Migration
-- landete) - daher hier zur Sicherheit mit aufgenommen, damit der Code-Stand wieder
-- mit der tatsächlichen DB übereinstimmt.
--
-- Da der aktuelle Constraint-Name durch die vermutete manuelle Änderung nicht mehr
-- sicher "aktivitaeten_art_check" sein muss, wird er hier dynamisch über
-- pg_constraint ermittelt statt den Standardnamen anzunehmen.

DO $$
DECLARE
  con_name text;
BEGIN
  SELECT con.conname INTO con_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'aktivitaeten'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%art%IN%';

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE aktivitaeten DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE aktivitaeten ADD CONSTRAINT aktivitaeten_art_check
  CHECK (art IN (
    'notiz','anruf','email','verkostung','messe','besuch','angebot','sonstiges',
    'urlaub','abwesenheit','verkauf','besprechung'
  ));
