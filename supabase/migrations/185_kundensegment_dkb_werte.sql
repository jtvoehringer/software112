-- Migration 185: kundensegment Enum um DKB-Altsystem-Kundengruppen erweitern
-- Kundenwunsch (1.9.2026): Segment im Bereich Kontakte/Firmen um die
-- Kundengruppen aus dem alten "DKB"-System ergänzen, damit der CSV-Import
-- (Kontakte_Firmen_DKB.csv, Spalte "Kundengruppe") diese direkt und ohne
-- pauschalen Fallback übernehmen kann.
ALTER TYPE kundensegment ADD VALUE IF NOT EXISTS 'firmenkunde';
ALTER TYPE kundensegment ADD VALUE IF NOT EXISTS 'vinothek';
ALTER TYPE kundensegment ADD VALUE IF NOT EXISTS 'abhof';
ALTER TYPE kundensegment ADD VALUE IF NOT EXISTS 'restaurant';
ALTER TYPE kundensegment ADD VALUE IF NOT EXISTS 'tourismus';
