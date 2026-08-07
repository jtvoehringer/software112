-- Zeiterfassung 02.08.2026 – software:112
-- Automatisch aus der Git-Commit-Historie dieses Tages rekonstruiert (Dateien/Zeilen-Heuristik
-- fuer Stundenschaetzung, bei den KI-Abfrage/Breadcrumb/Weinbuch-Eintraegen vom 7.8. anhand
-- des tatsaechlichen Gespraechsverlaufs praezisiert) - BITTE STUNDEN VOR DEM AUSFUEHREN PRUEFEN.
INSERT INTO zeiterfassung (tenant_id, datum, phase, beschreibung, stunden, stundensatz) VALUES

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-02', 4,
   'Design-Relaunch Phase A: neue Hohenstein-Farbpalette, Poppins/IBM Plex Schriften, neues Favicon-Set',
   2.25, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-02', 4,
   'Migration 135: Fix aktivitaeten_art_check Constraint-Kollision',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-02', 4,
   'Design-Relaunch Phase B: Sidebar/Navigation im neuen Design-System',
   2.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-02', 4,
   'Design-Relaunch Phase C: Dashboard im neuen Design-System + neues ICP-Logo',
   2.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-02', 4,
   'Design-Relaunch Phase D: Assistent-Panel als UI-Huelle',
   1.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-02', 4,
   'Design-Relaunch: alten gruen/gelben Marken-Standard entfernt + software112-Logo getauscht',
   0.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-02', 4,
   'Migration 137: primary_color/secondary_color bedingungslos zuruecksetzen',
   0.25, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-02', 4,
   'Design-Relaunch: Ursache fuer wiederkehrendes altes Gruen/Gelb behoben',
   1.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-02', 4,
   'Design-Relaunch Phase E (Batch 1): Emoji-Icons im Kellerbuch auf Lucide umgestellt',
   1.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-02', 4,
   'Design-Relaunch Phase E (Batch 2): Emoji-Icons in Profil/Benutzer/Formularen auf Lucide umgestellt',
   1.0, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-02', 4,
   'Design-Relaunch Phase E (Batch 3): Emoji-Icons im CRM-Kalender auf Lucide/entfernt',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-02', 4,
   'Design-Relaunch Phase E (Batch 4): Emoji-Icons in CRM Firmen-/Kontakte-Ansichten',
   2.0, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-02', 4,
   'Design-Relaunch Phase E (Controlling): Emoji-Icons in BMD/Export/Kostenrechnung',
   0.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-02', 4,
   'Design-Relaunch Phase E (Batch 5): Emoji-Icons in Verkauf/Behandlungen/Erntemeldung',
   1.0, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-02', 4,
   'Design-Relaunch Phase E: grosser Emoji-zu-Icon-Sweep (76 Dateien)',
   8.0, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-02', 4,
   'ConfirmDeleteForm label-Prop akzeptiert ReactNode statt nur string',
   0.25, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-02', 4,
   'Design-Relaunch Phase E: Runde 2 - geteilte Komponenten + oeffentliche Seiten (20 Dateien)',
   4.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-08-02', 4,
   'Rückverfolgbarkeit Feature 5: Blend-Protokoll (Herkunfts-Zusammensetzung)',
   6.0, 50);
