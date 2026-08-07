-- Zeiterfassung 06.08.2026 – software:112
-- Automatisch aus der Git-Commit-Historie dieses Tages rekonstruiert (Dateien/Zeilen-Heuristik
-- fuer Stundenschaetzung, bei den KI-Abfrage/Breadcrumb/Weinbuch-Eintraegen vom 7.8. anhand
-- des tatsaechlichen Gespraechsverlaufs praezisiert) - BITTE STUNDEN VOR DEM AUSFUEHREN PRUEFEN.
INSERT INTO zeiterfassung (tenant_id, datum, phase, beschreibung, stunden, stundensatz) VALUES

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-06', 4,
   'Dashboard-Umbau Teil 1: Lagerbestand-Kachel und Fuellen/Umziehen-Schnellzugriff entfernt, alle-Link bei Naechste Termine; BMD NTCS ins E&A-Rechnung-Menue verschoben',
   1.25, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-06', 4,
   'Zukauf-Preis/L blieb nach Verkauf nicht stabil (Doppelbuchung ueber Zukauf-Pfad), Gebinde-Vorschau zeigt Hinweis bei bereits bewegter Charge',
   1.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-06', 4,
   'negativer Bestand nach Verkauf aus leerer Charge (fehlende Bestandspruefung + ungeprueftes Auto-Sync-Zurueckschreiben)',
   0.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-06', 4,
   'Zahlungsziel vom Betrieb zum Kunden verschoben (Pflichtfeld pro Kontakt/Firma, 0 = bei Erhalt)',
   3.0, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-06', 4,
   'Vercel-Build-Fehler nach Zahlungsziel-Umzug (Listen-Seiten Kontakte/Firmen hatten zahlungsziel_tage vergessen)',
   0.25, 50);
