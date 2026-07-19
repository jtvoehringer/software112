-- Zeiterfassung 17.07.2026 – software:112

INSERT INTO zeiterfassung (tenant_id, datum, phase, beschreibung, stunden, stundensatz) VALUES

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-17', 4,
   'Herkunft-Code (BKI) – wird durch Lese → Kellerbuch → Füllung mitgeführt, nur Abstufung (nicht Aufwertung) erlaubt; neue lib/herkunft.ts, VerschneidungForm.tsx erweitert, weinhandel/actions.ts + Füllungsformulare angepasst, Migration 132',
   1.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-17', 4,
   'Login/Betrieb-Wahl – Lade-Feedback (BetriebCard.tsx, loading.tsx) + empfohlene Primär-/Sekundärfarbe im Admin; zusätzlich Testdaten-Bereinigungsscript scripts/cleanup_testdaten.sql erstellt',
   1.0, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-07-17', 4,
   'Favicon – altes software:112-Favicon (teal/gelb) wiederhergestellt, war durch Hohenstein-Sandbox-Branding vom Vortag global überschrieben worden',
   0.25, 50);
