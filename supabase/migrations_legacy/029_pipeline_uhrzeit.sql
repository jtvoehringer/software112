-- Migration 029: Pipeline-Einträge mit Uhrzeit (Ganztags/Von-Bis)
-- Ergänzt pipeline_eintraege um die gleichen Zeitfelder wie aktivitaeten

ALTER TABLE pipeline_eintraege
  ADD COLUMN IF NOT EXISTS ganztags    boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS uhrzeit_von time    DEFAULT null,
  ADD COLUMN IF NOT EXISTS uhrzeit_bis time    DEFAULT null;
