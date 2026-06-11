-- Migration 076: Einstandspreis pro Liter in weinausbau (Tanks im Direktverkauf)
-- Ermöglicht Lagerbewertung für Tank-Wein analog zu fuellungen.einstandspreis

ALTER TABLE weinausbau
  ADD COLUMN IF NOT EXISTS einstandspreis_pro_liter numeric(10,4) DEFAULT NULL;

COMMENT ON COLUMN weinausbau.einstandspreis_pro_liter IS
  'Einstandspreis / Kalkulationskosten pro Liter (netto). '
  'Basis für Lagerwert-Berechnung bei Tankware – unabhängig vom VK-Preis.';
