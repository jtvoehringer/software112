-- Zeiterfassung 20.07.2026 – software:112
-- Automatisch aus der Git-Commit-Historie dieses Tages rekonstruiert (Dateien/Zeilen-Heuristik
-- fuer Stundenschaetzung, bei den KI-Abfrage/Breadcrumb/Weinbuch-Eintraegen vom 7.8. anhand
-- des tatsaechlichen Gespraechsverlaufs praezisiert) - BITTE STUNDEN VOR DEM AUSFUEHREN PRUEFEN.
INSERT INTO zeiterfassung (tenant_id, datum, phase, beschreibung, stunden, stundensatz) VALUES

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-20', 4,
   'crm – Outlook-Kalender des angemeldeten Users im CRM-Kalender spiegeln (Calendars.Read-Scope, neue API-Route, eigene Farbe/Kennzeichnung)',
   1.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-20', 4,
   'docs: Handbuch + FAQ v2.3 - Kellerbuch-Umbau, Zukauf, bawb.at, KI-Ertragshistorie, Massnahmenformular-Feintuning, Outlook-Kalender nachgetragen',
   0.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-20', 4,
   'crm – temporaere Anzeige fuer Anzahl geladener Outlook-Termine + sichtbare Fehler statt stillem Schlucken',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-20', 4,
   'crm – Outlook-Termine bei Folgefehlern nicht mehr loeschen + echte Fehlerursache in Server-Logs sichtbar machen',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-20', 4,
   'crm – Outlook-Diagnose Runde 2 - persistente Fehleranzeige, Zeitraum/Terminvorschau im Badge, Error-Boundary um Kalenderansicht',
   0.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-20', 4,
   'crm – Outlook-Diagnose Runde 3 - Zaehler fuer Termine im aktuell angezeigten Zeitraum',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-20', 4,
   'crm – Outlook-Kalenderabfrage paginiert jetzt vollstaendig (@odata.nextLink) statt nur die ersten 250 Termine pro Fenster zu laden',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-20', 4,
   'crm – temporaere Outlook-Diagnose-Anzeigen entfernt (Badge, Zaehler, Error-Boundary) - Ursache behoben, Fixes bleiben',
   1.25, 50);
