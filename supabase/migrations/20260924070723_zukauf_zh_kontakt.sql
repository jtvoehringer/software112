-- Migration 149: z.H.-Kontakt bei Zukäufen von Firmen-Lieferanten
-- Analog zu Migration 053 (verkaufsposten.zh_kontakt_id) – ermöglicht "z.H. Vorname Nachname"
-- als Ansprechpartner, wenn der Lieferant eines Zukaufs eine Firma ist.
-- Nachgezogen am 24.09.2026 (war lokal als 149 vorhanden, aber nie live eingespielt).

ALTER TABLE zukauf_posten
  ADD COLUMN IF NOT EXISTS zh_kontakt_id uuid REFERENCES kontakte(id) ON DELETE SET NULL;

COMMENT ON COLUMN zukauf_posten.zh_kontakt_id IS 'Optionaler Ansprechpartner bei Firmen-Lieferant (zu Händen)';
