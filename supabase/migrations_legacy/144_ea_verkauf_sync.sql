-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 144: E&A <-> Verkauf-Verknüpfung für automatische Zahlungseingangs-
-- Buchung (Punkt 7 der Punkteliste).
--
-- Ein Zahlungseingang (voll oder teilweise bezahlt) auf einen Verkaufsposten
-- soll automatisch als E&A-Einnahme gebucht werden (USt-satzgenau) und damit
-- in die UVA einfließen. Dafür braucht ea_transaktionen eine Rückverknüpfung
-- zum auslösenden Verkaufsposten, damit die Buchung bei Änderungen (weitere
-- Zahlung, Storno, Löschung einer Zahlung) automatisch neu berechnet werden
-- kann, statt sich zu duplizieren.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE ea_transaktionen
  ADD COLUMN verkaufsposten_id uuid REFERENCES verkaufsposten(id) ON DELETE SET NULL;

COMMENT ON COLUMN ea_transaktionen.verkaufsposten_id IS
  'Verknüpfung zu automatisch aus einem Zahlungseingang (Verkauf) erzeugten Einnahme-Buchungen; NULL bei manuellen/importierten Buchungen';

CREATE INDEX idx_ea_tx_verkaufsposten ON ea_transaktionen(verkaufsposten_id);

-- 'verkauf' als neue import_quelle zulassen, damit automatisch erzeugte
-- Buchungen in der UI von manuellen/importierten unterschieden werden können.
ALTER TABLE ea_transaktionen DROP CONSTRAINT IF EXISTS ea_transaktionen_import_quelle_check;
ALTER TABLE ea_transaktionen
  ADD CONSTRAINT ea_transaktionen_import_quelle_check
  CHECK (import_quelle IN ('manuell', 'camt053', 'csv', 'verkauf'));
