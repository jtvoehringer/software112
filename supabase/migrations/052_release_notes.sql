-- Migration 052: Release Notes / What's New
-- Admins können neue Features und Fixes publizieren; User sehen es einmalig nach Login

CREATE TABLE IF NOT EXISTS release_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version       text NOT NULL,              -- z.B. "2.2.0"
  titel         text NOT NULL,
  features      text[],                     -- Liste neuer Funktionen
  fixes         text[],                     -- Liste behobener Fehler
  aktiv         boolean DEFAULT true,
  veroeffentlicht_am date DEFAULT current_date,
  erstellt_am   timestamptz DEFAULT now()
);

-- Welche User welche Release Notes gesehen haben
CREATE TABLE IF NOT EXISTS release_notes_gesehen (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  release_note_id uuid NOT NULL REFERENCES release_notes(id) ON DELETE CASCADE,
  gesehen_am      timestamptz DEFAULT now(),
  UNIQUE(user_id, release_note_id)
);

ALTER TABLE release_notes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_notes_gesehen ENABLE ROW LEVEL SECURITY;

-- Alle angemeldeten User sehen aktive Release Notes
CREATE POLICY "rn_read" ON release_notes FOR SELECT USING (auth.uid() IS NOT NULL AND aktiv = true);

-- System-Admins dürfen auch anlegen/bearbeiten
CREATE POLICY "rn_admin" ON release_notes USING (
  auth.uid() IN (SELECT user_id FROM tenant_memberships WHERE rolle = 'system_admin')
);

-- User sieht/schreibt nur eigene Gesehen-Einträge
CREATE POLICY "rng_own" ON release_notes_gesehen
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
