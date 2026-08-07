-- Zeiterfassung 04.08.2026 – software:112
-- Automatisch aus der Git-Commit-Historie dieses Tages rekonstruiert (Dateien/Zeilen-Heuristik
-- fuer Stundenschaetzung, bei den KI-Abfrage/Breadcrumb/Weinbuch-Eintraegen vom 7.8. anhand
-- des tatsaechlichen Gespraechsverlaufs praezisiert) - BITTE STUNDEN VOR DEM AUSFUEHREN PRUEFEN.
INSERT INTO zeiterfassung (tenant_id, datum, phase, beschreibung, stunden, stundensatz) VALUES

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-04', 4,
   'Globale Suche: Scope erweitern + ESC-Button klickbar machen',
   1.0, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-04', 4,
   'Ried/GST direkt anklickbar machen (Punkt 5)',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-04', 4,
   'Massnahmen-Kosten: Bearbeiten + Uebersicht + GST-Verlauf (Punkte 6-10)',
   3.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-04', 4,
   'Erntemeldung: AMA nach Pressungen + Pressungen einklappbar + Buttons hervorheben (Punkte 12, 14)',
   1.0, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-04', 4,
   'PSM-Lager in Betriebsmittel umbenennen (Punkt 11)',
   2.0, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-04', 4,
   'Weinbuch als PDF exportierbar machen (Punkt 13)',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-04', 4,
   'Fuellung: Qualitaets-/Herkunft-Dropdowns auf moegliche Abstufungen beschraenkt',
   0.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-04', 4,
   'Verkaufsformular: Kontakt/Firma zu einheitlichem Kunde-Feld zusammengefasst',
   0.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-04', 4,
   'Auswertungen: Umsatz mit waehlbarem Zeitraum + Monatsvergleich',
   3.0, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-04', 4,
   'Weinbaugebiete-Selbstverwaltung: Winzer koennen fehlende Gebiete selbst anlegen',
   4.0, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-04', 4,
   'Punkt 3: Zugekaufte Trauben als Pressungs-Vorschlag und Verkaufsquelle nutzbar',
   4.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-04', 4,
   'Punkte 1, 2, 4: Zukauf-Kapazitaetsbug, Gebinde-Spalte, CRM-Verkaeufe-Tab',
   2.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-04', 4,
   'Punkt 9: Transportschein fuer Most-, Wein- und Traubenverkauf',
   0.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-04', 4,
   'Punkt 5: Duengemittel-Lagerbewegungen (wie PSM) + Button umbenannt',
   4.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-04', 4,
   'Punkt 6: FIBU-Modul vollstaendig entfernt (UI + Datenbank)',
   6.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-04', 4,
   'Punkte 7, 8: Zahlungseingang -> automatische E&A-Buchung, amtliches UVA-Layout, CSV-Export',
   4.0, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-04', 4,
   'Sidebar: Klick auf Modul-Header springt immer auf die Hauptseite',
   0.25, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-04', 4,
   'Pressungs-/Zukauf-Bugfixes, Belegnr., anklickbare Zeilen, Traubenzukaufsgrenze',
   4.0, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-04', 4,
   'UVA-Meldung: Als uebermittelt markieren (Zeitstempel + Sperre der Buchungen)',
   1.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-04', 4,
   'Verkauf: Direkter Rechnungsversand per E-Mail (PDF-Anhang, bestehende SMTP/M365-Anbindung)',
   8.0, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-04', 4,
   'Server-Komponenten-Absturz auf Verkauf-/Zukauf-Liste (Event-Handler durfte nicht als Prop uebergeben werden)',
   0.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-04', 4,
   'PDF-Erzeugung (Rechnungsversand) - @react-pdf/renderer als serverExternalPackages markieren',
   0.25, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-04', 4,
   'PDF-Erzeugung (Rechnungsversand) - SVG-Logos nicht mehr an react-pdf Image uebergeben',
   0.25, 50);
