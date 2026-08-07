-- Zeiterfassung 19.07.2026 – software:112
-- Automatisch aus der Git-Commit-Historie dieses Tages rekonstruiert (Dateien/Zeilen-Heuristik
-- fuer Stundenschaetzung, bei den KI-Abfrage/Breadcrumb/Weinbuch-Eintraegen vom 7.8. anhand
-- des tatsaechlichen Gespraechsverlaufs praezisiert) - BITTE STUNDEN VOR DEM AUSFUEHREN PRUEFEN.
INSERT INTO zeiterfassung (tenant_id, datum, phase, beschreibung, stunden, stundensatz) VALUES

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-19', 4,
   'Zeiterfassung: Migrationen 2026-07-15 bis 2026-07-18 nachgetragen',
   1.25, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-19', 4,
   'massnahmen – Feld-Sichtbarkeit Schnitt/Sonstiges + einklappbare Ried-Auswahl; fix(lager): Transportschein-Hinweis entfernt; feat(kellerplan): Gebinde-Klick oeffnet Umziehen/Behandlungen/Abfuellen-Dialog',
   1.5, 50);
