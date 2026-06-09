-- Migration 053: z.H.-Kontakt bei Firmenverkäufen
-- Ermöglicht "z.H. Vorname Nachname" auf Rechnung/Lieferschein

ALTER TABLE verkaufsposten
  ADD COLUMN IF NOT EXISTS zh_kontakt_id uuid REFERENCES kontakte(id) ON DELETE SET NULL;

COMMENT ON COLUMN verkaufsposten.zh_kontakt_id IS 'Optionaler Ansprechpartner bei Firmenverkauf (zu Händen)';
