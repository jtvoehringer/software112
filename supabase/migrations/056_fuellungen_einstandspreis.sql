-- Migration 056: Einstandspreis je Flasche in fuellungen
-- Trennt Lagerwert (Produktionskosten) vom Verkaufspreis

ALTER TABLE fuellungen
  ADD COLUMN IF NOT EXISTS einstandspreis numeric(10,2) DEFAULT NULL;

COMMENT ON COLUMN fuellungen.einstandspreis IS
  'Einstandspreis / Kalkulationskosten pro Flasche (netto). '
  'Basis für Lagerbewertung – unabhängig vom VK-Preis.';
