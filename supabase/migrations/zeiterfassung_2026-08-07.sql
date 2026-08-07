-- Zeiterfassung 07.08.2026 – software:112
-- Automatisch aus der Git-Commit-Historie dieses Tages rekonstruiert (Dateien/Zeilen-Heuristik
-- fuer Stundenschaetzung, bei den KI-Abfrage/Breadcrumb/Weinbuch-Eintraegen vom 7.8. anhand
-- des tatsaechlichen Gespraechsverlaufs praezisiert) - BITTE STUNDEN VOR DEM AUSFUEHREN PRUEFEN.
INSERT INTO zeiterfassung (tenant_id, datum, phase, beschreibung, stunden, stundensatz) VALUES

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-07', 4,
   'Preislisten-Modul entfernt (unbenutzt, keine Verknuepfung zum Rest des Systems); Neuer-Auftrag-Button von der Uebersicht entfernt',
   5.25, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-07', 4,
   'CRM-Kalender: ueberlappende Termine im Tagesraster nebeneinander statt uebereinander darstellen',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-07', 4,
   'Benutzername wird zentral unter Admin > Mandant > Benutzer administriert (Pflichtfeld) statt vom User selbst unter Mein Profil',
   1.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-07', 4,
   'CRM-Kalender: User-Filter zeigt nur noch Namen aufloesbarer (aktueller) Benutzer, keine rohen ID-Kuerzel entfernter Mitglieder mehr',
   0.25, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-07', 4,
   'Termin: Anhaenge-Funktion entfernt, neue Art Aufgabe mit Erledigt-Haken (verschwindet danach aus dem Kalender)',
   2.0, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-07', 4,
   'Massnahmen: Tabellen-Ueberschriften+Alignment, Bearbeiten-Formular respektiert Art-Feldmatrix, Berichte-Tabs zu ''Ried'' zusammengelegt mit Ried/Art-Filter',
   2.25, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-07', 4,
   'Kosten-CSV-Export, Exportauftraege als Mandanten-Modul, Pressung- und Ernte-Formular-Fixes (Status/Anmelden/Qualitaet/Pflichtfelder/Komma/Lesemethode)',
   4.0, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-07', 4,
   'Datenimport: Rieden- und Gebinde-CSV-Import, Anfangsbestandsbuchung (Charge aus Altsystem) im Gebinde-Import, Referenz-Altsystem-Feld fuer Eroeffnungsbestand',
   2.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-07', 4,
   'Abfuellung: Schwundbuchung-Haekchen nicht mehr vorbelegt, stattdessen deutlicher Ja/Nein-Warnhinweis bei Restbestand',
   0.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-07', 4,
   'Rueckverfolgung: Filter nach Jahrgang/Sorte/Bezeichnung mit Trefferliste, Durchschnittsbestand und PDF/CSV-Export',
   2.0, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-07', 4,
   'Auswertungen: neuer Tab Verkaufsstatistik, Breadcrumb-Fixes (Reports->Auswertungen, fehlender Breadcrumb bei Kosten-Auswertung)',
   3.25, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-07', 4,
   'Systemweiter Breadcrumb-Batch: fehlende Breadcrumbs auf allen Listen-/Einstiegsseiten ergaenzt, 2 uneinheitliche Breadcrumbs korrigiert (Warenlager->Weinhandel, einfache Zurueck-Links -> einheitliches Breadcrumb-Muster)',
   3.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-07', 4,
   'Bugfix: abgeschlossene Weinausbau-Chargen ohne genullte Restmenge (bereinigCharge); Weinausbau-Uebersicht: Abgeschlossene Chargen einklappbar; NEU: Weinbuch-Sammlung in Auswertungen fuer BKI-Pruefungen',
   6.0, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-07', 4,
   'Frag dein Weingut: echtes von Claude generiertes SQL statt fixer Tabellen-/Filter-Vorlage (Rebsorten-Filter, JOINs, Summenbildung), Modell auf Sonnet umgestellt',
   5.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-07', 4,
   'Frag dein Weingut: Spalten-Verwechslung rebsorte/bezeichnung/name im KI-Prompt behoben (Sortenverschnitt-Bug) + generelle Mehrspalten-OR-Suche als Absicherung',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-07', 4,
   'Frag dein Weingut: robusterer Umgang mit komplexen/kombinierten Fragen (mehr max_tokens, Korrektur-Versuch bei kaputtem JSON, Regel fuer Summe+Liste in einer Abfrage)',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-07', 4,
   'Frag dein Weingut: korrekte Stueck-zu-Liter-Umrechnung bei Flaschenverkaeufen (flaschengroesse_ml) im KI-Prompt ergaenzt',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-07', 4,
   'Frag dein Weingut: Gesamtsummen (gesamt_*) werden einmalig als Zusammenfassung statt wiederholt in jeder Tabellenzeile angezeigt',
   1.0, 50);
