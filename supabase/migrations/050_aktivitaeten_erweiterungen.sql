-- Migration 050: Aktivitäten-Erweiterungen
-- ist_privat, erstellt_von, bis_datum (Mehrtagestermine), Urlaub-Kategorie

ALTER TABLE aktivitaeten
  ADD COLUMN IF NOT EXISTS ist_privat   boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS erstellt_von uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bis_datum    date;  -- Enddatum für Mehrtagestermine (zB Urlaub)

COMMENT ON COLUMN aktivitaeten.ist_privat   IS 'Nur Ersteller sieht Details, andere sehen nur "Privat"';
COMMENT ON COLUMN aktivitaeten.erstellt_von IS 'User der die Aktivität angelegt hat';
COMMENT ON COLUMN aktivitaeten.bis_datum    IS 'Enddatum für Mehrtagestermine (zB Urlaub Mo-Fr)';

-- Index für erstellt_von (häufige Filter-Abfrage)
CREATE INDEX IF NOT EXISTS idx_aktivitaeten_erstellt_von ON aktivitaeten(erstellt_von);
