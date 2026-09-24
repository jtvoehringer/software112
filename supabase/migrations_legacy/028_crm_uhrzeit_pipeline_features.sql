-- ── Migration 028: Aktivitäten Uhrzeit + Pipeline Kategorie/Erledigt ──────────
--
-- aktivitaeten: Von-Bis Uhrzeiten + Ganztags-Flag
-- pipeline_eintraege: Kategorie-Freitext + Erledigt-Status

-- ── aktivitaeten ─────────────────────────────────────────────────────────────

ALTER TABLE aktivitaeten
  ADD COLUMN IF NOT EXISTS ganztags     boolean   NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS uhrzeit_von  time,
  ADD COLUMN IF NOT EXISTS uhrzeit_bis  time;

-- ── pipeline_eintraege ────────────────────────────────────────────────────────

ALTER TABLE pipeline_eintraege
  ADD COLUMN IF NOT EXISTS kategorie    text,
  ADD COLUMN IF NOT EXISTS erledigt     boolean   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS erledigt_am  timestamptz;
