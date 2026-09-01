-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 190: Mobilnummer für Firmen
--
-- Rückmeldung 1.9.2026: beim Firmen-Import sollen auch eine Betriebsnummer
-- (existiert bereits als firmen.betrieb_nr, war aber weder in der
-- Spaltenzuordnung des Imports noch - bei Anlage über die Firmenliste -
-- vollständig durchgemappt) und eine Mobilnummer zuordenbar sein. Kontakte
-- haben bereits mobil/mobil_vorwahl (Migration 034); Firmen bisher nicht.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE firmen
  ADD COLUMN IF NOT EXISTS mobil          text,
  ADD COLUMN IF NOT EXISTS mobil_vorwahl  text NOT NULL DEFAULT '+43';

COMMENT ON COLUMN firmen.mobil IS
  'Mobilnummer der Firma (ohne Vorwahl) - analog zu kontakte.mobil.';
COMMENT ON COLUMN firmen.mobil_vorwahl IS
  'Landesvorwahl zu firmen.mobil, z.B. "+43" - analog zu kontakte.mobil_vorwahl.';
