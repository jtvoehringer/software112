-- Migration 080: Einstandspreis pro Liter in zukauf_posten
-- Ermöglicht direkten Einstandspreis-Input (unabhängig von Gesamtpreis ÷ Menge)

ALTER TABLE zukauf_posten
  ADD COLUMN IF NOT EXISTS einstandspreis_pro_liter numeric(10,4) DEFAULT NULL;

COMMENT ON COLUMN zukauf_posten.einstandspreis_pro_liter IS
  'Einstandspreis pro Liter (netto). Wird auf die zugehörige weinausbau-Charge übertragen.';
