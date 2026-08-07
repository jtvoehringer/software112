-- Zeiterfassung 05.08.2026 – software:112
-- Automatisch aus der Git-Commit-Historie dieses Tages rekonstruiert (Dateien/Zeilen-Heuristik
-- fuer Stundenschaetzung, bei den KI-Abfrage/Breadcrumb/Weinbuch-Eintraegen vom 7.8. anhand
-- des tatsaechlichen Gespraechsverlaufs praezisiert) - BITTE STUNDEN VOR DEM AUSFUEHREN PRUEFEN.
INSERT INTO zeiterfassung (tenant_id, datum, phase, beschreibung, stunden, stundensatz) VALUES

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-05', 4,
   'Offene Posten: Zahlung buchen oeffnet Zahlungseingangsdialog (Teilzahlungen moeglich)',
   1.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-05', 4,
   'Aufraeumen: erledigte Commit-Skripte und lokale Arbeitsdateien per .gitignore ausblenden',
   0.25, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-05', 4,
   'Prozess-Assistent (Bot) Phase 0: Datenmodell, Kontext-Loader, Chat-API, Chat-Widget',
   4.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-05', 4,
   'Admin: Toggle fuer Prozess-Assistent (Bot) im Mandanten-Modul-Tab',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-05', 4,
   'Prozess-Assistent (Bot) Phase 1: Pilot Massnahme dokumentieren + serverseitige Bio-Sperre',
   2.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-05', 4,
   'Bot-Fixes: Eingabefeld behaelt Fokus, korrektes Tagesdatum fuer ''heute/gestern/morgen''',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-05', 4,
   'Bot: Umbenennung auf ''bot:112'' in Chat-Widget, Admin-Toggle und System-Prompt',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-05', 4,
   'Bot: eigenes Doppel-Sparkle-Icon statt generischem lucide Bot-Icon',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-05', 4,
   'Bot: gefuehrter Einstieg mit Themen-Vorschlaegen statt generischer Q&A-Anmutung',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-05', 4,
   'Prozess-Assistent (bot:112) Phase 2: Pilot Verkauf anlegen (Flasche + Tank)',
   2.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-05', 4,
   'Prozess-Assistent (bot:112) Phase 3: Pilot Ernte erfassen (Rieden + Grundstuecke)',
   2.25, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-05', 4,
   'Prozess-Assistent (bot:112) Phase 4 (Release 2): Umziehen, Kellerbehandlungen, Abfuellen, Verschneiden',
   6.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-05', 4,
   'Prozess-Assistent (bot:112) Phase 5: Korrekturgedaechtnis (soll ich mir das merken?)',
   1.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-05', 4,
   'Prozess-Assistent (bot:112): Bugfix Verlauf-Abfrage laedt jetzt die neuesten statt der aeltesten Nachrichten',
   0.25, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-05', 4,
   'Kellerbuch/Zukauf: Bugfix fehlender Zukauf-Zugang im Bewegungsbuch + destruktives Verhalten beim Bearbeiten bereits bewegter Zukauf-Chargen',
   1.0, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-05', 4,
   'Kellerbuch/Zukauf: Bugfix fehlender Zukauf-Zugang im Bewegungsbuch, destruktives Verhalten beim Bearbeiten bereits bewegter Zukauf-Chargen, doppelt gezaehlte Zukaeufe auf der Lager-Seite',
   0.25, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-05', 4,
   'Kellerbuch: fehlenden Zukauf-Zugang im Bewegungsbuch der Chargen-Detailseite ergaenzt (behebt falschen Auto-Sync-Rueckschrieb von menge_liter)',
   0.25, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-05', 4,
   'Kellerbuch-Uebersicht: Spaltenbreiten der Chargen-Tabellen fixiert, damit Jg./Status/Liter ueber alle Behaelter-Karten hinweg ausgerichtet bleiben',
   0.25, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-05', 4,
   'Zukauf: Lieferant-Feld wie Verkauf-Kunde (Kontakt/Firma kombiniert + z.H.), Pressung: KMW aus Trauben-Zukauf uebernehmen',
   1.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-05', 4,
   'Umziehen: Rebsortenmix-Erkennung bei rebsortenlosen Zielchargen (Sortenverschnitt) korrigiert, doppelten Anfangsbestand bei neu angelegten Umzugschargen behoben, Abfuellen-Button aus Kellerbuch-Uebersicht entfernt',
   0.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-05', 4,
   'Umziehen: Router-Race behoben, das den automatischen Verschneiden-Redirect nach einem erkannten Rebsortenmix verhinderte',
   0.25, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-05', 4,
   'Umziehen: harte Navigation (window.location) statt router.push fuer Verschneiden-Redirect, um Next.js-internes Auto-Refresh-Race endgueltig zu beheben',
   0.25, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-05', 4,
   'Verschneiden: Sektion scrollt nach automatischem Oeffnen (Redirect aus Umziehen) ins Bild, falls sie unterhalb des sichtbaren Bereichs liegt',
   0.25, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-05', 4,
   'Umziehen: Rebsortenmix-Erkennung funktioniert jetzt auch bei mehreren bereits im Ziel-Gebinde liegenden Chargen (maybeSingle-Bug behoben, betraf auch bot:112)',
   0.25, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-05', 4,
   'bot:112: Chargen im Status Gaerung/Ernte waren dem Bot komplett unsichtbar (falscher Status-Filter) - dadurch Falschmeldung ueber angeblich durchgefuehrten Umzug; zusaetzliche System-Prompt-Absicherung gegen erfundene Erfolgsmeldungen',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-05', 4,
   'Umziehen (allgemeine Seite): Inhalt/Kapazitaet im Ziel-Dropdown, Rebsortenmix-Warnung und automatischer Verschneiden-Redirect nachgezogen - Paritaet mit dem Umziehen-Widget der Charge-Seite',
   0.75, 50);
