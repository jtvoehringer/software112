-- Zeiterfassung 16.07.2026 – software:112

INSERT INTO zeiterfassung (tenant_id, datum, phase, beschreibung, stunden, stundensatz) VALUES

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-16', 4,
   'Erntemeldung – Jahrgang-Duplikat zeigt verständliche Meldung statt 500-Fehler; erntemeldung/actions.ts + NeuerJahrgangForm.tsx angepasst',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-16', 4,
   'Kellerplan – Gebinde nur einem Standort zuordenbar + Löschfunktion; LoeschenButton.tsx, kellerplan/actions.ts + [id]/page.tsx, Migration 131 (Unique Constraint Single-Standort)',
   0.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-16', 4,
   'UI – Bearbeiten/Löschen als Hover-Icons statt Text-Buttons, sticky Aktionsspalte bei breiten Tabellen (TraubenverkaufSection, PSMClient, GrundstueckePanel, TraubenverkaufClient)',
   0.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-16', 4,
   'UI – Icons für Bearbeiten/Löschen systemweit vereinheitlicht (permanent sichtbar statt Hover); GebindeClient, KellerplanEditModal, LoeschenButton, ConfirmDeleteForm + 25 weitere Dateien',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-16', 4,
   'UI – weitere übersehene Bearbeiten/Löschen-Buttons auf Icons umgestellt (PSM-Lager, DAC, Gebinde-Tabs)',
   0.25, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-16', 4,
   'Maßnahmen – Behandlungen zu "Maßnahmen" umbenannt, PSM-Stammdaten in PSM-Lager zusammengeführt (Sidebar, Handbuch, 16 Dateien); alte /pflanzenschutz-Route entfernt',
   0.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-16', 4,
   'Neue Maßnahme – Lese-Option entfernt, Ried(en)-Auswahl umbenannt (vorher Weingarten-Auswahl), GST-Feinauswahl ergänzt; behandlungen/actions.ts, NeueBehandlungForm.tsx, neu/page.tsx',
   1.0, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-16', 4,
   'PSM-Lager – Produkt klickbar zur Rückverfolgung, Kellerbuch-Charge-/Analysen-Anzeige in Rückverfolgung gefixt',
   0.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-16', 4,
   'Weinhandel – Verkaufsbeleg: Rechnung als Default-Ansicht, Skonto-Hinweis auf gedruckter Rechnung',
   0.25, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-16', 4,
   'Rückverfolgung – Behandlungen/PSM fehlten (Junction-Tabelle behandlung_grundstuecke nicht berücksichtigt) + Pressung-Herkunft Grundstück-Embed gefixt',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-16', 4,
   'Weinbuch – zeigt Ernte-Details (Ried/GST/KMW/Qualitätsstufe) und Schwund bei Abfüllung jetzt korrekt an',
   0.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-16', 4,
   'Code-Review – 33 Bugs beseitigt (kritisch/mittel/niedrig) über 31 Dateien: API-Routes (CRM-Dokumente, Import, KI-Abfrage, Weinexport), Newsletter-Actions, w/[charge]-Seite u.a.',
   2.0, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-16', 4,
   'Neue Maßnahme – Lese-Option kurzzeitig testweise zurückgeholt und wieder entfernt (war bewusste Design-Entscheidung vom Vormittag, siehe 59f1386)',
   0.25, 50);
