-- Migration 186: kundensegment Enum um Medien, Importeur, Sonstige erweitern
-- Kundenwunsch (1.9.2026), direkte Folge-Ergänzung zu Migration 185.
ALTER TYPE kundensegment ADD VALUE IF NOT EXISTS 'medien';
ALTER TYPE kundensegment ADD VALUE IF NOT EXISTS 'importeur';
ALTER TYPE kundensegment ADD VALUE IF NOT EXISTS 'sonstige';
