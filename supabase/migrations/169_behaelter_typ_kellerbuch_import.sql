-- Migration 169: Behälter-Typen für Kellerbuch-Import erweitern
-- Die Altsystem-Kellerbücher (z.B. Weingut Gebeshuber) verwenden zusätzliche
-- Gebinde-/Behälterarten, die im UI (BehaelterForm, GebindeClient,
-- kellerbuch/gebinde/page.tsx) jetzt zur Auswahl stehen, aber noch nicht im
-- CHECK-Constraint erlaubt waren → würde beim Anlegen/Bearbeiten bzw. beim
-- späteren Datenimport mit einem 500er/DB-Fehler abbrechen.

ALTER TABLE behaelter
  DROP CONSTRAINT IF EXISTS behaelter_typ_check;

ALTER TABLE behaelter
  ADD CONSTRAINT behaelter_typ_check
    CHECK (typ IN (
      'stahltank', 'lagertank', 'immervolltank', 'holzfass', 'betonei', 'amphore',
      'bottich', 'gaerstaender', 'zisterne', 'presse', 'barrique', 'doppelbarrique',
      'sonstiges'
    ));
