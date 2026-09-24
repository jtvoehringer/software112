-- Migration 034: Lead-Feld auf Kontakte + Firmen
-- Neue Datensätze starten als Lead (is_lead = true)
-- Erste Verkaufsbuchung setzt is_lead automatisch auf false

ALTER TABLE kontakte ADD COLUMN IF NOT EXISTS is_lead boolean DEFAULT true;
ALTER TABLE firmen   ADD COLUMN IF NOT EXISTS is_lead boolean DEFAULT true;

-- Bestehende Datensätze sind bereits Kunden
UPDATE kontakte SET is_lead = false WHERE is_lead IS NULL;
UPDATE firmen   SET is_lead = false WHERE is_lead IS NULL;

NOTIFY pgrst, 'reload schema';
