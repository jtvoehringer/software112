-- Migration 033: Sonderrabatt direkt auf Kontakt / Firma
-- Wird bei Verkaufserfassung automatisch als Positions-Sonderrabatt vorbelegt

ALTER TABLE kontakte
  ADD COLUMN IF NOT EXISTS sonderrabatt_pct numeric(5,2) DEFAULT 0;

ALTER TABLE firmen
  ADD COLUMN IF NOT EXISTS sonderrabatt_pct numeric(5,2) DEFAULT 0;

-- PostgREST Schema-Cache neu laden
NOTIFY pgrst, 'reload schema';
