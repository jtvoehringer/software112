-- Migration 171: "Status" durch "Nutzart"/"Nutzung" ablösen
--
-- Rückmeldung 24.8.2026: "Status" (aktiv/brache/gruenbrache/gerodet) wird
-- durch "Nutzart" (A/G/WI, siehe Migration 170) abgelöst - vollständiger
-- Umbau, ausdrücklich vom Mandanten bestätigt:
--   - Anzeige: "Status"-Spalte/Badge heißt jetzt "Nutzung", Inhalt kommt aus
--     nutzart (A → Grünbrache, G → Grünlandbrache, WI → Wein).
--   - Geschäftslogik: alle bisherigen .eq('status','aktiv')-Stellen
--     (Ernte-Meldung, Behandlungsplanung/Spritzbar, KI-Assistent-
--     Validierung, Zukauf-Flächensumme, globale Suche) laufen jetzt über
--     nutzart==='WI'.
--   - Die bisherigen Status-Werte werden laut Anweisung gelöscht (NULL).
--
-- WICHTIG - Betriebsauswirkung: nutzart ist ein brandneues Feld ohne
-- Bestandsdaten. Nach dieser Migration ist für JEDES bestehende
-- Grundstück nutzart = NULL und spritzbar = false, d.h. Ernte-Meldung,
-- Spritz-/Behandlungsplanung und die Zukauf-Flächensumme berücksichtigen
-- vorübergehend KEIN bestehendes Grundstück mehr, bis die Nutzart manuell
-- nachgetragen wird (Grundstücke-Formular, Pflichtfeld "Nutzart").
--
-- Die Spalte "status" selbst bleibt bestehen (kein DROP COLUMN, um keinen
-- Breaking Change für evtl. externe Auswertungen/Reports zu riskieren),
-- wird aber im Code nicht mehr geschrieben oder gelesen.

ALTER TABLE grundstuecke
  ALTER COLUMN status DROP NOT NULL;

ALTER TABLE grundstuecke
  ALTER COLUMN status DROP DEFAULT;

UPDATE grundstuecke SET status = NULL;

-- spritzbar folgt jetzt ausschließlich aus nutzart (aktuell für alle
-- Grundstücke NULL, d.h. spritzbar wird für alle auf false zurückgesetzt,
-- bis nutzart nachgetragen ist). COALESCE ist hier nötig: "nutzart = 'WI'"
-- ergibt bei nutzart IS NULL in SQL NULL (nicht false, Drei-Werte-Logik) -
-- das verletzt den NOT-NULL-Constraint auf spritzbar (Fehler beim ersten
-- Ausführungsversuch: "null value in column spritzbar violates not-null
-- constraint").
UPDATE grundstuecke SET spritzbar = COALESCE(nutzart = 'WI', false);
