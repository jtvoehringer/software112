-- Migration 061: Unique-Constraint für kellerplan_positionen (Voraussetzung für upsert)
ALTER TABLE kellerplan_positionen
  DROP CONSTRAINT IF EXISTS kellerplan_positionen_kellerplan_behaelter_unique;

ALTER TABLE kellerplan_positionen
  ADD CONSTRAINT kellerplan_positionen_kellerplan_behaelter_unique
  UNIQUE (kellerplan_id, behaelter_id);
