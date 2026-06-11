-- Migration 079: Profiles – full_name Spalte sicherstellen + Schema-Cache-Refresh
-- Behebt: "Could not find the 'full_name' column of 'profiles' in the schema cache"

-- Spalte hinzufügen, falls noch nicht vorhanden (idempotent)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS full_name text;

-- Falls ältere Instanz display_name hatte: Daten migrieren
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'display_name'
  ) THEN
    UPDATE profiles SET full_name = display_name WHERE full_name IS NULL AND display_name IS NOT NULL;
  END IF;
END $$;

-- updated_at Alias sicherstellen (Code nutzt updated_at, Tabelle hat aktualisiert_am)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- Bestehende Zeilen befüllen
UPDATE profiles SET updated_at = aktualisiert_am WHERE updated_at IS NULL;

-- Notify PostgREST: Schema-Cache neu laden
NOTIFY pgrst, 'reload schema';
