-- Migration 083: weinbezeichnung in ernte_parzellen
-- Ermöglicht die Angabe der Weinbezeichnung (z.B. "Gemischter Satz") pro Parzelle,
-- damit diese im Gebinde/Kellerbuch angezeigt werden kann.

ALTER TABLE ernte_parzellen
  ADD COLUMN IF NOT EXISTS weinbezeichnung text;

COMMENT ON COLUMN ernte_parzellen.weinbezeichnung IS
  'Optionale Weinbezeichnung (z.B. "Gemischter Satz", "Grüner Veltliner Reserve") für Anzeige in Pressung/Gebinde';
