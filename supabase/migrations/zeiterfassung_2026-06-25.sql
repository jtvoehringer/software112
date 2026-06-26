-- Zeiterfassung 25.06.2026 – software:112

INSERT INTO zeiterfassung (tenant_id, datum, phase, beschreibung, stunden, stundensatz) VALUES

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-06-25', 4,
   'KI-Modul – Ertragshistorie Fix – Falscher Supabase-Join (jahrgang:jahrgang_id(jahr) → weinjahrgaenge!jahrgang_id(jahrgang)); Spaltenname jahrgang statt jahr; FUSE-Truncation-Bug behoben (null bytes stripped); KI-Abfragen Ertragshistorie liefern nun korrekte Ergebnisse',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-06-25', 4,
   'Testdaten-Bereinigung – cleanup_testdaten.sql: DELETE-Script in korrekter FK-Reihenfolge (exportauftraege → verkauf → zukauf → traubenverkauf → fuellungen → verschneidungen → keller_umzuege → pressungen → ernte_parzellen via weinjahrgaenge → weinausbau → behandlungen → psm_lager → kosteneintraege → aktivitaeten → pipeline); ernte_parzellen tenant_id Subquery-Fix; ama_erntemeldungen separat',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-06-25', 4,
   'Kellerbuch – Weinart-Bug bei Pressung – upsertPressung: GST (grundstuecke.weinart) hat Vorrang vor Weingarten; autoWeinart wird korrekt aus GST-Array abgeleitet; FUSE-Truncation in erntemeldung/actions.ts repariert',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-06-25', 4,
   'Kellerbuch – Verschneidung: Qualitätsabstufungs-Notification – VerschneidungForm: qualitaetAbgestufInfo State; createVerschneidung gibt { qualitaetAbgestuft } zurück; expliziter TS Return-Type (Promise<{...}>); Post-Submit-Screen zeigt Abstufung von→nach mit Schließen-Button',
   1.0, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-06-25', 4,
   'Kellerbuch – Verschneidung: Qualitätsabstufung Root-Cause-Fix – Alter Code las qualitaetsstufe NACH DB-Update → zielQ = neueQualitaet → istNiedrigerAls immer false → kein Hinweis; Fix: direkter Vergleich zielQualitaetVorher vs. neueQualitaet (beide bereits berechnet); doppelter Re-Query-Block entfernt',
   0.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-06-25', 4,
   'Kellerbuch – Verschneidung: BESTEHT AUS Eigenbestand-Fix – VerschneidungWidget: originalMenge wurde weggefiltert wenn zielCharge.rebsorte === Sortenverschnitt; Fix: immer inkludieren, Label = rebsorte wenn nicht SV, sonst zielCharge.name als Fallback',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-06-25', 4,
   'Kellerbuch – Verschneidung: Weinart-Konflikt-Validation – Rot+Weiß-Verschneidung (österr. Weingesetz) blockiert: weinartKompatibel() in VerschneidungForm (Client-Blocking mit 🚫-Banner + disabled Submit); Server-Guard in createVerschneidung (throw); weinart in ChargeOpt, VerschneidungWidget.ChargeOpt, WeinausbauRow, alleChargen-Query; 3 TypeScript-Build-Fehler behoben',
   1.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-06-25', 4,
   'Kellerbuch – Verschneidung: Rebsorte-Berechnung + BESTEHT AUS Aggregation – neueRebsorte nutzt dominante[0] statt zielRebsorteJetzt (Quell-Rebsorte kann dominieren); quellenMap aggregiert nach Name statt Charge-ID (gleiche Rebsorte erscheint nicht doppelt)',
   0.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-06-25', 4,
   'Kellerbuch – Migration 127: v_behaelter_fuellstand um Verschneidungen erweitert – Zwei neue CTEs verschneidungen_ein (Liter in Ziel-Behälter) + verschneidungen_aus (Liter aus Quell-Behälter); Behälter-Füllstand-Übersicht zeigte falsche Werte (A01 +1400L zu viel, A02 -4190L negativ); nach Migration korrekt',
   0.75, 50);
