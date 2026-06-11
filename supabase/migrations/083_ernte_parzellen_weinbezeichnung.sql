-- Migration 083: weinbezeichnung in pressungen
-- Der Weinname (z.B. "Gemischter Satz") entsteht bei der Pressung,
-- nicht bei der Ernte. Sortenreine Weingärten bleiben historisch erhalten.
-- Cuvées (aus fertigen Gebinden) sind ein separater Workflow.

ALTER TABLE pressungen
  ADD COLUMN IF NOT EXISTS weinbezeichnung text;

COMMENT ON COLUMN pressungen.weinbezeichnung IS
  'Optionaler Weinname der Pressung (z.B. "Gemischter Satz"). Reinsortige Weine lassen dieses Feld leer.';
