-- Migration 108: Lizenzkosten-Spalte in Zeiterfassung

ALTER TABLE zeiterfassung ADD COLUMN IF NOT EXISTS lizenzkosten_euro numeric(10,2);
