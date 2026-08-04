-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 145: Eingangs-Rechnungsnummer (Belegnr. des Lieferanten) für Zukäufe
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE zukauf_posten
  ADD COLUMN eingangsrechnungsnummer text;

COMMENT ON COLUMN zukauf_posten.eingangsrechnungsnummer IS
  'Rechnungs-/Belegnummer lt. Eingangsrechnung des Lieferanten (frei vergeben, alphanumerisch)';
