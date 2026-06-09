-- Migration 062: von_behaelter_id zu keller_umzuege
-- Problem: Bewegungsbuch für Quell-Behälter leer wenn Charge manuell erstellt
--          wurde (kein pressung_behaelter-Eintrag) und vollständig umgezogen
--          → behaelter_id=null verhinderte chargeId-Sammlung
-- Lösung: von_behaelter_id direkt in keller_umzuege speichern

ALTER TABLE keller_umzuege ADD COLUMN IF NOT EXISTS von_behaelter_id uuid REFERENCES behaelter(id);

-- Backfill: aus weinausbau (für Chargen mit noch vorhandener behaelter_id)
UPDATE keller_umzuege ku
SET von_behaelter_id = w.behaelter_id
FROM weinausbau w
WHERE ku.von_weinausbau_id = w.id
  AND w.behaelter_id IS NOT NULL
  AND ku.von_behaelter_id IS NULL;

-- Backfill: über pressung_behaelter (für Chargen mit behaelter_id=null)
UPDATE keller_umzuege ku
SET von_behaelter_id = pb.behaelter_id
FROM weinausbau w
JOIN pressung_behaelter pb ON pb.weinausbau_id = w.id
WHERE ku.von_weinausbau_id = w.id
  AND w.behaelter_id IS NULL
  AND ku.von_behaelter_id IS NULL;
