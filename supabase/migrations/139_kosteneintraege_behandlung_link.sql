-- Migration 139: Kosteneintraege mit der ausloesenden Massnahme (Behandlung) verknuepfen
--
-- Bisher hatte kosteneintraege keine Verknuepfung zurueck zur Massnahme, aus der sie
-- (ueber die Kosten-Vorschlagsfunktion) automatisch angelegt wurden. Dadurch konnten
-- Kosten beim Bearbeiten einer Massnahme weder angezeigt noch aktualisiert werden
-- (Bereinigungsliste 2026-08-04, Punkte 6, 7, 9).

ALTER TABLE kosteneintraege
  ADD COLUMN IF NOT EXISTS behandlung_id uuid REFERENCES behandlungen(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_kosteneintraege_behandlung_id ON kosteneintraege(behandlung_id);

COMMENT ON COLUMN kosteneintraege.behandlung_id IS
  'Verknuepfung zur ausloesenden Massnahme (Behandlung), falls automatisch ueber die Kosten-Vorschlagsfunktion angelegt. NULL = manuell erfasster oder anderweitig verknuepfter Kosteneintrag.';

NOTIFY pgrst, 'reload schema';
