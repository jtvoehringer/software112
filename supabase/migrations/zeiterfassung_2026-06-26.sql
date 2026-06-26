-- Zeiterfassung 26.06.2026 – software:112

INSERT INTO zeiterfassung (tenant_id, datum, phase, beschreibung, stunden, stundensatz) VALUES

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-06-26', 4,
   'Kellerbuch – Pressung: UPDATE-Pfad + ErnteDetail-Dedup – erntemeldung/actions.ts UPDATE-Pfad setzte rebsorte/qualitaetsstufe/weinart nicht (nur INSERT-Pfad); Fix: alle drei Felder auch im UPDATE gesetzt; ErnteDetailClient.tsx GST-Dedup: bei mehreren ernte_parzellen pro GST wird jetzt die Parzelle gewählt deren menge_kg am nächsten am verfügbaren Rest liegt (statt erster Treffer)',
   0.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-06-26', 4,
   'Kellerbuch – Umziehen: Abstufungs-Notiz + Banner – umziehen/actions.ts: erkennt Qualitätsabstufung beim Zusammenführen gleicher Rebsorte (altQualitaet vs. neueQualitaet); Text „Abstufung von X auf Y" in weinausbau.notizen gespeichert; Return-Typ erweitert um abstufung-Objekt; UmziehenWidget.tsx: Redirect mit ?abstufung=...; page.tsx: Amber-Banner zeigt Abstufung nach Umziehen an',
   1.0, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-06-26', 4,
   'Kellerbuch – Verschneidung: rebsorte_fehlt-Falschmeldung entfernt – VerschneidungForm.tsx: Case rebsorte_fehlt komplett entfernt; Fallback src.rebsorte ?? src.name für Quell-Chargen ohne DB-Rebsorte (Chargen aus Pressung vor Fix haben oft Namen = Rebsorte); kein Abbruch mehr bei fehlender Rebsorte',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-06-26', 4,
   'Kellerbuch – Verschneidung: Abstufungs-Warnung für alle beteiligten Chargen – weinqualitaet.ts: PRAEDIKATSWEIN_ORDER (11 klassische Stufen, kein DAC/Reserve/Sekt); maxQualitaet() Funktion; istNiedrigerAls() nutzt PRAEDIKATSWEIN_ORDER; kellerbuch/actions.ts: Abstufungs-Check vergleicht neueQualitaet gegen maxQualitaet aller beteiligten Chargen (vorher nur Ziel) → Auslese-Quelle in Kabinett-Ziel wird jetzt korrekt erkannt',
   0.75, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-06-26', 4,
   'Kellerbuch – Verschneidung: BESTEHT AUS – gleiche Rebsorten zu einer Bubble summieren – VerschneidungWidget.tsx: quellenMap-Key auf rebsorte ?? name umgestellt (vorher: Charge-Name → doppelte Bubbles bei gleicher Rebsorte); Original-Anteil (Eigenbestand vor Verschneidung) wird unter originalLabel in quellenMap eingetragen und mit gleichnamiger Quelle zusammengeführt; page.tsx + buch/page.tsx: verschneidung_quellen-Query holt jetzt auch rebsorte der Quell-Charge',
   1.0, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-06-26', 4,
   'Kellerbuch – Verschneidung: Sortenverschnitt-Falschmeldung bei Ziel ohne rebsorte – VerschneidungForm.tsx: zielRebsorte = zielCharge.rebsorte ?? zielCharge.name; Ziel-Menge wurde nicht in Anteile-Map eingetragen wenn rebsorte null → 700/2800 = 25% statt 2800/2800 = 100%; Fix behebt Falschmeldung bei Zierfandler+Zierfandler-Verschneidung',
   0.5, 50),

  ('fa22dc07-eca5-43df-af96-f7b9b09f0471', '2026-06-26', 4,
   'Kellerbuch – VerschneidungWidget: immer rendern – page.tsx: Render-Bedingung alleChargen.length > 0 entfernt; Widget war unsichtbar wenn keine anderen aktiven Chargen vorhanden → Verschneidungsprotokoll-Tabelle und BESTEHT AUS wurden nicht angezeigt obwohl Daten in DB vorhanden',
   0.25, 50);
