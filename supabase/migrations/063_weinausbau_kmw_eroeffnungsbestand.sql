-- Migration 060: KMW + Eröffnungsbestand-Markierung in weinausbau

ALTER TABLE weinausbau
  ADD COLUMN IF NOT EXISTS kmw                    NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS ist_eroeffnungsbestand BOOLEAN DEFAULT false;
