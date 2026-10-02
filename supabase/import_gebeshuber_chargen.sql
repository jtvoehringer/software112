-- Hinweis KAN-130 Etappe 3 (02.10.2026): Dieses Skript ist bereits gelaufen (DKB-Import 16.09.2026) – nicht
-- erneut ausführen. Künftige SQL-Importskripte für Chargen geben zum Mostgewicht die gemessene Einheit mit:
-- Spalte mostgewicht_einheit (Standard 'kmw'; 'oechsle', wenn die Quelle °Oe liefert) und den Messwert in
-- kmw bzw. oechsle – die jeweils andere Spalte rechnet der Trigger b_mostgewicht (KAN-128, Rechenregeln 1–4).
-- Beispiel: INSERT INTO weinausbau (…, kmw, mostgewicht_einheit, …) VALUES (…, 17.4, 'kmw', …)
--          bzw.  INSERT INTO weinausbau (…, oechsle, mostgewicht_einheit, …) VALUES (…, 84, 'oechsle', …)
-- Gebeshuber: 77 Chargen
WITH z AS (
  INSERT INTO transaktionszaehler (tenant_id, typ, prefix, zaehler, jahr, stellen)
  VALUES ('097f67ed-381e-4bb3-952e-758aa9d3a501', 'eroeffnung', 'EB', 77, 2026, 4)
  ON CONFLICT (tenant_id, typ, jahr) DO UPDATE SET zaehler = transaktionszaehler.zaehler + 77
  RETURNING zaehler
), v(beh, name, jahrgang, rebsorte, liter, qual, herkunft, weinart, kmw, chnr, notizen, nr) AS (
  SELECT *, row_number() OVER () FROM (VALUES
  ('a5', 'ried satzing', 2024, 'St. Laurent', 1100, 'dac', 'thermenregion_riedenwein', 'rot', 20, '260092', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260092 · Sorte SL · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('a8', 'ried viereck', 2023, 'Blauburgunder', 834, 'dac', 'thermenregion_riedenwein', 'rot', 19.9, '250567', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 250567 · Sorte BB · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA) · DKB %-FJ 7.5'),
  ('a9', 'gendl', 2023, 'Blauburgunder', 300, 'dac', 'thermenregion_gebietswein', 'rot', 18.1, '250566', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 250566 · Sorte BB · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA) · DKB %-FJ 6.82'),
  ('b6', 'ried satzing', 2024, 'St. Laurent', 500, 'dac', 'thermenregion_riedenwein', 'rot', 20, '260164', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260164 · Sorte SL · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('ba', 'ried student', 2025, 'Rotgipfler', 440, 'dac', 'thermenregion_riedenwein', 'weiss', 20.8, '250478', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 250478 · Sorte RG · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('c2', 'ried glas', 2024, 'St. Laurent', 1400, 'dac', 'thermenregion_riedenwein', 'rot', 17.9, '260090', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260090 · Sorte SL · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('c3', 'ried student', 2025, 'Rotgipfler', 4000, 'dac', 'thermenregion_riedenwein', 'weiss', 17.5, '260235', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260235 · Sorte RG · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('c4', 'ried student', 2025, 'Rotgipfler', 1700, 'dac', 'thermenregion_riedenwein', 'weiss', 19, '260053', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260053 · Sorte RG · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('c5', 'ried satzing', 2024, 'St. Laurent', 100, 'dac', 'thermenregion_riedenwein', 'rot', 20, '260162', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260162 · Sorte SL · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('c7', 'sl satzing', 2022, 'St. Laurent', 2444, 'qualitaetswein', 'thermenregion_gebietswein', 'rot', 17, '230463', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 230463 · Sorte SL · Qual. QUW · Herkunft WLTH · BIO (Demeter+BA)'),
  ('c8', 'ried student', 2025, 'Rotgipfler', 2500, 'dac', 'thermenregion_riedenwein', 'weiss', 18.3, '250516', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 250516 · Sorte RG · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('c9', 'St. Laurent 2022', 2022, 'St. Laurent', 3625, 'qualitaetswein', 'thermenregion_gebietswein', 'rot', 16.5, '260087', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260087 · Sorte SL · Qual. QUW · Herkunft WLTH · BIO (Demeter+BA) · DKB %-FJ 4.83'),
  ('d9', 'ried modler', 2024, 'Zierfandler', 430, 'dac', 'thermenregion_riedenwein', 'weiss', 21, '250563', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 250563 · Sorte ZF · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('p1', 'level33', 2023, 'Sortenverschnitt rot', 500, 'sonstiges', 'wlnoe', 'rot', 19.3, '260227', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260227 · Sorte SO · Qual. SOE · Herkunft WLNO · BIO (Demeter+BA) · Produkt Destillat · DKB %-FJ 2.49'),
  ('t1', 'liter ware', 2021, 'Sortenverschnitt rot', 969, 'qualitaetswein', 'thermenregion_gebietswein', 'rot', 17.3, '240546', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 240546 · Sorte SO · Qual. QUW · Herkunft WLTH · BIO (Demeter+BA) · Alkohol 13,5 % vol · DKB %-FJ 10.32'),
  ('t2', 'ried student', 2024, 'Rotgipfler', 490, 'dac', 'thermenregion_riedenwein', 'weiss', 21.4, '260059', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260059 · Sorte RG · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('t3', 'satzing', 2020, 'St. Laurent', 900, 'qualitaetswein', 'thermenregion_gebietswein', 'rot', 18, '260061', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260061 · Sorte SL · Qual. QUW · Herkunft WLTH · BIO (Demeter+BA)'),
  ('t4', 'student', 2022, 'Rotgipfler', 750, 'qualitaetswein', 'thermenregion_gebietswein', 'weiss', 19.4, '260057', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260057 · Sorte RG · Qual. QUW · Herkunft WLTH · BIO (Demeter+BA)'),
  ('t5', 'Rotgipfler 2023', 2023, 'Rotgipfler', 680, 'dac', 'thermenregion_gebietswein', 'weiss', 19.3, '260058', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260058 · Sorte RG · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('t7', 'ried student', 2025, 'Rotgipfler', 900, 'dac', 'thermenregion_riedenwein', 'weiss', 17.5, '260074', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260074 · Sorte RG · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('t8', 'zf gpk', 2024, 'Zierfandler', 580, 'dac', 'thermenregion_gebietswein', 'weiss', 18.3, '250294', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 250294 · Sorte ZF · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA) · DKB %-FJ 0.17'),
  ('t9', 'zf-rg gpk', 2025, 'Sortenverschnitt weiß', 300, 'dac', 'thermenregion_gebietswein', 'weiss', 18.6, '260149', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260149 · Sorte SW · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA) · DKB %-FJ 13.5'),
  ('w6', 'Cabernet Sauvignon 2023', 2023, 'Cabernet Sauvignon', 400, 'qualitaetswein', 'thermenregion_gebietswein', 'rot', 21, '240158', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 240158 · Sorte CS · Qual. QUW · Herkunft WLTH · Umstellung (UM)'),
  ('a10', 'Zierfandler 2024', 2024, 'Zierfandler', 1233, 'dac', 'thermenregion_gebietswein', 'weiss', 18.5, '250569', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 250569 · Sorte ZF · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA) · DKB %-FJ 2.69'),
  ('a12', 'ried satzing', 2024, 'St. Laurent', 1850, 'dac', 'thermenregion_riedenwein', 'rot', 20, '260211', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260211 · Sorte SL · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('a17', 'ried wiege', 2024, 'Zierfandler', 1730, 'dac', 'thermenregion_riedenwein', 'weiss', 19.9, '240513', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 240513 · Sorte ZF · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('a20', 'ried student', 2024, 'Rotgipfler', 1500, 'dac', 'thermenregion_riedenwein', 'weiss', 21.3, '260006', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260006 · Sorte RG · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('a23', 'ried modler', 2025, 'Zierfandler', 1250, 'dac', 'thermenregion_riedenwein', 'weiss', 18.6, '260113', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260113 · Sorte ZF · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('b01', 'modler', 2023, 'Zierfandler', 676, 'dac', 'thermenregion_gebietswein', 'weiss', 18, '260009', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260009 · Sorte ZF · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('b12', 'ried wiege', 2025, 'Zierfandler', 2600, 'dac', 'thermenregion_riedenwein', 'weiss', 19, '250494', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 250494 · Sorte ZF · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('b13', 'ried student', 2024, 'Rotgipfler', 1600, 'dac', 'thermenregion_riedenwein', 'weiss', 21.3, '260137', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260137 · Sorte RG · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('b14', 'viereck', 2019, 'Blauburgunder', 1000, 'qualitaetswein', 'thermenregion_gebietswein', 'rot', 19.3, '220139', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 220139 · Sorte BB · Qual. QUW · Herkunft WLTH · BIO (biologisch organisch) · DKB %-FJ 0.25'),
  ('b15', 'student', 2020, 'Rotgipfler', 900, 'qualitaetswein', 'thermenregion_gebietswein', 'weiss', 19.9, '260056', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260056 · Sorte RG · Qual. QUW · Herkunft WLTH · BIO (Demeter+BA)'),
  ('b16', 'Zierfandler 2025', 2025, 'Zierfandler', 1470, 'dac', 'thermenregion_gebietswein', 'weiss', 18.5, '260055', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260055 · Sorte ZF · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('ba1', 'pinot noir Susul', 2015, 'Blauburgunder', 220, 'qualitaetswein', 'thermenregion_gebietswein', 'rot', NULL, '200624', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 200624 · Sorte BB · Qual. QUW · Herkunft WLTH · BIO (biologisch organisch)'),
  ('ba4', 'Sortenverschnitt rot 2018', 2018, 'Sortenverschnitt rot', 440, 'qualitaetswein', 'thermenregion_gebietswein', 'rot', NULL, '200648', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 200648 · Sorte SO · Qual. QUW · Herkunft WLTH · BIO (biologisch organisch) · Alkohol 12,5 % vol · DKB %-FJ 50'),
  ('c10', 'Sortenverschnitt rot', NULL, 'Sortenverschnitt rot', 2400, 'qualitaetswein', 'thermenregion_gebietswein', 'rot', 19.6, '230510', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 230510 · Sorte SO · Qual. QUW · Herkunft WLTH · BIO (bio) · Alkohol 12,9 % vol'),
  ('c11', 'Sortenverschnitt rot 2022', 2022, 'Sortenverschnitt rot', 2500, 'qualitaetswein', 'thermenregion_gebietswein', 'rot', 18.1, '230544', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 230544 · Sorte SO · Qual. QUW · Herkunft WLTH · BIO (Demeter+BA)'),
  ('c12', 'ried student', 2024, 'Rotgipfler', 521, 'dac', 'thermenregion_riedenwein', 'weiss', 21.3, '250288', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 250288 · Sorte RG · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('c13', 'Zierfandler 2025', 2025, 'Zierfandler', 5000, 'dac', 'thermenregion_gebietswein', 'weiss', 18.5, '260238', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260238 · Sorte ZF · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('c18', 'zf-rg cuvée', 2022, 'Sortenverschnitt weiß', 240, 'qualitaetswein', 'thermenregion_gebietswein', 'weiss', 19.2, '250565', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 250565 · Sorte SW · Qual. QUW · Herkunft WLTH · BIO (Demeter+BA)'),
  ('c19', 'querfeldein weiß', 2025, 'Gemischter Satz', 9950, 'qualitaetswein', 'thermenregion_gebietswein', 'weiss', 15.4, '260173', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260173 · Sorte GW · Qual. QUW · Herkunft WLTH · BIO (Demeter+BA)'),
  ('d10', 'querfeldein', 2023, 'Gemischter Satz', 333, 'qualitaetswein', 'wlnoe', 'weiss', 18.3, '250562', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 250562 · Sorte GW · Qual. QUW · Herkunft WLNO · BIO (Demeter+BA)'),
  ('d12', 'ried laim', 2025, 'Rotgipfler', 800, 'dac', 'thermenregion_riedenwein', 'weiss', 19, '260088', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260088 · Sorte RG · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('d23', 'rg gpk', 2024, 'Rotgipfler', 800, 'dac', 'thermenregion_gebietswein', 'weiss', 19, '250261', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 250261 · Sorte RG · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('d24', 'ried student', 2024, 'Rotgipfler', 500, 'dac', 'thermenregion_riedenwein', 'weiss', 21.4, '250559', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 250559 · Sorte RG · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('d25', 'rg student', 2022, 'Rotgipfler', 500, 'qualitaetswein', 'thermenregion_gebietswein', 'weiss', 19.9, '250111', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 250111 · Sorte RG · Qual. QUW · Herkunft WLTH · BIO (Demeter+BA)'),
  ('d26', 'zf gpk', 2024, 'Zierfandler', 800, 'dac', 'thermenregion_gebietswein', 'weiss', 21, '250265', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 250265 · Sorte ZF · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('d27', 'Zierfandler 2023', 2023, 'Zierfandler', 500, 'qualitaetswein', 'wlnoe', 'weiss', 17.6, '250279', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 250279 · Sorte ZF · Qual. QUW · Herkunft WLNO · BIO (Demeter+BA) · DKB %-FJ 41.18'),
  ('t09', 'ried modler', 2024, 'Zierfandler', 530, 'dac', 'thermenregion_riedenwein', 'weiss', 21, '240514', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 240514 · Sorte ZF · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('t0b', 'Cabernet Sauvignon 2023', 2023, 'Cabernet Sauvignon', 100, 'qualitaetswein', 'thermenregion_gebietswein', 'rot', 21, '260039', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260039 · Sorte CS · Qual. QUW · Herkunft WLTH · Umstellung (UM)'),
  ('t15', 'ried viereck', 2024, 'Blauburgunder', 620, 'dac', 'thermenregion_riedenwein', 'rot', 21, '260154', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260154 · Sorte BB · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('t17', 'ried laim', 2025, 'Zierfandler', 1400, 'dac', 'thermenregion_riedenwein', 'weiss', 18.1, '250496', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 250496 · Sorte ZF · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('t31', 'zf-rg gpk', 2024, 'Sortenverschnitt weiß', 780, 'dac', 'thermenregion_gebietswein', 'weiss', 19.7, '250262', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 250262 · Sorte SW · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('t32', 'satzing', 2021, 'St. Laurent', 720, 'qualitaetswein', 'thermenregion_gebietswein', 'rot', 17, '240137', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 240137 · Sorte SL · Qual. QUW · Herkunft WLTH · BIO (Demeter+BA)'),
  ('t34', 'ried satzing', 2024, 'St. Laurent', 200, 'dac', 'thermenregion_riedenwein', 'rot', 20, '250292', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 250292 · Sorte SL · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('t35', 'Blauburgunder 2025', 2025, 'Blauburgunder', 650, 'dac', 'thermenregion_gebietswein', 'rot', 20, '250551', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 250551 · Sorte BB · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('tr4', 'glas', 2023, 'Blauburgunder', 1070, 'dac', 'thermenregion_gebietswein', 'rot', 20, '240293', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 240293 · Sorte BB · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('tr5', 'Rotgipfler 2025', 2025, 'Rotgipfler', 300, 'dac', 'thermenregion_gebietswein', 'weiss', 19, '260076', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260076 · Sorte RG · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('tr6', 'sl satzing', 2018, 'St. Laurent', 851, 'qualitaetswein', 'thermenregion_gebietswein', 'rot', 18.4, '220312', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 220312 · Sorte SL · Qual. QUW · Herkunft WLTH · BIO (bio) · Alkohol 12,5 % vol · DKB %-FJ 62.4'),
  ('tr7', 'SL barrique', 2015, 'St. Laurent', 1000, 'qualitaetswein', 'thermenregion_gebietswein', 'rot', NULL, '190804', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 190804 · Sorte SL · Qual. QUW · Herkunft WLTH · BIO (biologisch organisch)'),
  ('tr8', 'Chardonnay 2025', 2025, 'Chardonnay', 600, 'dac', 'thermenregion_gebietswein', 'weiss', 17.8, '260170', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260170 · Sorte CH · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('ba12', 'vöslau', 2018, 'Sortenverschnitt rot', 420, 'qualitaetswein', 'thermenregion_gebietswein', 'rot', 17, '200253', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 200253 · Sorte SO · Qual. QUW · Herkunft WLTH · BIO (biologisch organisch) · Alkohol 12,5 % vol · DKB %-FJ 52.38'),
  ('ba20', 'satzing', 2023, 'St. Laurent', 220, 'dac', 'thermenregion_gebietswein', 'rot', 19, '230494', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 230494 · Sorte SL · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('ba30', 'gendl', 2023, 'Blauburgunder', 500, 'dac', 'thermenregion_gebietswein', 'rot', 18, '230500', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 230500 · Sorte BB · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('ba31', 'satzing', 2023, 'St. Laurent', 500, 'dac', 'thermenregion_gebietswein', 'rot', 19, '230493', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 230493 · Sorte SL · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('ba32', 'liter ware', NULL, 'Sortenverschnitt rot', 500, 'qualitaetswein', 'thermenregion_gebietswein', 'rot', 18.3, '210073', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 210073 · Sorte SO · Qual. QUW · Herkunft WLTH · BIO (bio)'),
  ('ba36', 'glas', 2023, 'St. Laurent', 500, 'dac', 'thermenregion_gebietswein', 'rot', 20, '230499', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 230499 · Sorte SL · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('ba37', 'satzing', 2023, 'St. Laurent', 500, 'dac', 'thermenregion_gebietswein', 'rot', 19, '230496', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 230496 · Sorte SL · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('ba38', 'satzing', 2023, 'St. Laurent', 220, 'dac', 'thermenregion_gebietswein', 'rot', 19, '230495', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 230495 · Sorte SL · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('ba39', 'glas', 2023, 'St. Laurent', 220, 'dac', 'thermenregion_gebietswein', 'rot', 20, '230498', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 230498 · Sorte SL · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('ba46', 'glas', 2023, 'St. Laurent', 220, 'dac', 'thermenregion_gebietswein', 'rot', 20, '230497', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 230497 · Sorte SL · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('ta12', 'St. Laurent 2022', 2022, 'St. Laurent', 1000, 'qualitaetswein', 'thermenregion_gebietswein', 'rot', 16.4, '250541', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 250541 · Sorte SL · Qual. QUW · Herkunft WLTH · BIO (Demeter+BA)'),
  ('tr10', 'satzing', 2023, 'St. Laurent', 736, 'dac', 'thermenregion_gebietswein', 'rot', 19, '240295', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 240295 · Sorte SL · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('tr23', 'viereck', 2022, 'Blauburgunder', 662, 'qualitaetswein', 'thermenregion_gebietswein', 'rot', 18.9, '260160', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260160 · Sorte BB · Qual. QUW · Herkunft WLTH · BIO (Demeter+BA) · DKB %-FJ 5.31'),
  ('kanister', 'ried laim', 2025, 'Rotgipfler', 200, 'dac', 'thermenregion_riedenwein', 'weiss', 19, '250503', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 250503 · Sorte RG · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)'),
  ('kanister 2', 'ried student', 2024, 'Rotgipfler', 165, 'dac', 'thermenregion_riedenwein', 'weiss', 21, '260072', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260072 · Sorte RG · Qual. DAC · Herkunft WLTH · BIO (Demeter+BA)')
  ) AS x
)
INSERT INTO weinausbau (tenant_id, name, jahrgang, rebsorte, behaelter_id, menge_liter, anfangsbestand_liter, qualitaetsstufe, herkunft_code, weinart, kmw, referenz_altsystem, notizen, transaktions_nr, status, ist_eroeffnungsbestand, aktiv, created_at)
SELECT '097f67ed-381e-4bb3-952e-758aa9d3a501', v.name, v.jahrgang, v.rebsorte, b.id, v.liter, v.liter, v.qual, v.herkunft, v.weinart, v.kmw, v.chnr, v.notizen,
       'EB-2026-' || lpad(((SELECT zaehler FROM z) - 77 + v.nr)::text, 4, '0'),
       'ausbau', true, true, '2026-01-01T00:00:00+01:00'
FROM v JOIN behaelter b ON b.tenant_id = '097f67ed-381e-4bb3-952e-758aa9d3a501' AND b.name = v.beh
WHERE NOT EXISTS (SELECT 1 FROM weinausbau w WHERE w.tenant_id = '097f67ed-381e-4bb3-952e-758aa9d3a501' AND w.referenz_altsystem = v.chnr);

-- Spaetrot: 19 Chargen
WITH z AS (
  INSERT INTO transaktionszaehler (tenant_id, typ, prefix, zaehler, jahr, stellen)
  VALUES ('0569d025-576d-4d47-a102-17173835dc5d', 'eroeffnung', 'EB', 19, 2026, 4)
  ON CONFLICT (tenant_id, typ, jahr) DO UPDATE SET zaehler = transaktionszaehler.zaehler + 19
  RETURNING zaehler
), v(beh, name, jahrgang, rebsorte, liter, qual, herkunft, weinart, kmw, chnr, notizen, nr) AS (
  SELECT *, row_number() OVER () FROM (VALUES
  ('a3', 'Gemischter Satz 2024', 2024, 'Gemischter Satz', 400, 'qualitaetswein', 'wlnoe', 'weiss', 18.6, '250540', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 250540 · Sorte GW · Qual. QUW · Herkunft WLNO · konventionell'),
  ('b4', 'gw thallern', 2025, 'Gemischter Satz', 911, 'qualitaetswein', 'wlnoe', 'weiss', 15.4, '260202', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260202 · Sorte GW · Qual. QUW · Herkunft WLNO · konventionell'),
  ('b5', 'zf gpk thallern', 2025, 'Zierfandler', 520, 'dac', 'thermenregion_gebietswein', 'weiss', 17, '260208', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260208 · Sorte ZF · Qual. DAC · Herkunft WLTH · konventionell'),
  ('b7', 'zf-rg cuvée wowhite', 2025, 'Sortenverschnitt weiß', 18.5, 'dac', 'thermenregion_gebietswein', 'weiss', 17.3, '260206', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260206 · Sorte SW · Qual. DAC · Herkunft WLTH · konventionell'),
  ('c1', 'Zierfandler 2024', 2024, 'Zierfandler', 1029, 'dac', 'thermenregion_gebietswein', 'weiss', 19.5, '240485', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 240485 · Sorte ZF · Qual. DAC · Herkunft WLTH · konventionell'),
  ('c6', '1 liter rot', NULL, 'Sortenverschnitt rot', 4000, 'qualitaetswein', 'thermenregion_gebietswein', 'rot', 18.3, '230542', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 230542 · Sorte SO · Qual. QUW · Herkunft WLTH · konventionell · Alkohol 12,8 % vol'),
  ('d7', 'zf-rg', 2025, 'Sortenverschnitt weiß', 167, 'dac', 'thermenregion_gebietswein', 'weiss', 18, '250360', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 250360 · Sorte SW · Qual. DAC · Herkunft WLTH · konventionell'),
  ('t6', 'Rotgipfler 2025', 2025, 'Rotgipfler', 970, 'dac', 'thermenregion_gebietswein', 'weiss', 18, '260167', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260167 · Sorte RG · Qual. DAC · Herkunft WLTH · konventionell'),
  ('c15', 'Gemischter Satz 2025', 2025, 'Gemischter Satz', 8310, 'qualitaetswein', 'wlnoe', 'weiss', 15.4, '250514', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 250514 · Sorte GW · Qual. QUW · Herkunft WLNO · konventionell'),
  ('c16', 'zf-rg cuvée', 2025, 'Sortenverschnitt weiß', 10000, 'dac', 'thermenregion_gebietswein', 'weiss', 17.3, '260200', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260200 · Sorte SW · Qual. DAC · Herkunft WLTH · konventionell'),
  ('c17', 'Zierfandler 2025', 2025, 'Zierfandler', 100, 'dac', 'thermenregion_gebietswein', 'weiss', 17, '260209', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260209 · Sorte ZF · Qual. DAC · Herkunft WLTH · konventionell'),
  ('d13', 'zf-rg klosterneuburg (c13)', 2024, 'Sortenverschnitt weiß', 1741, 'dac', 'thermenregion_gebietswein', 'weiss', 19.5, '260030', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260030 · Sorte SW · Qual. DAC · Herkunft WLTH · konventionell · Alkohol 12,2 % vol · DKB %-FJ 14.65'),
  ('d28', 'rest florian', 2022, 'Rotgipfler', 600, 'qualitaetswein', 'thermenregion_gebietswein', 'weiss', NULL, '260079', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260079 · Sorte RG · Qual. QUW · Herkunft WLTH · konventionell · Alkohol 13,0 % vol'),
  ('d29', 'rg-zf', 2025, 'Sortenverschnitt weiß', 555, 'dac', 'thermenregion_gebietswein', 'weiss', 17.8, '260080', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260080 · Sorte SW · Qual. DAC · Herkunft WLTH · konventionell'),
  ('peg', 'rg gpk thallern', 2025, 'Rotgipfler', 1030, 'dac', 'thermenregion_gebietswein', 'weiss', NULL, '260232', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260232 · Sorte RG · Qual. DAC · Herkunft WLTH · konventionell · Alkohol 13,3 % vol'),
  ('t12', 'Gemischter Satz 2024', 2024, 'Gemischter Satz', 1000, 'qualitaetswein', 'wlnoe', 'weiss', 18.6, '250192', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 250192 · Sorte GW · Qual. QUW · Herkunft WLNO · konventionell'),
  ('tr26', '1 liter ware', 2023, 'Sortenverschnitt weiß', 2130, 'qualitaetswein', 'wlnoe', 'weiss', 17.3, '240286', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 240286 · Sorte SW · Qual. QUW · Herkunft WLNO · konventionell · Alkohol 12,1 % vol · DKB %-FJ 15.83'),
  ('kanister 3', 'Gemischter Satz 2024', 2024, 'Gemischter Satz', 283, 'qualitaetswein', 'wlnoe', 'weiss', 17.5, '260075', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260075 · Sorte GW · Qual. QUW · Herkunft WLNO · konventionell'),
  ('kanister 4', 'rg-zf höbenstreit', 2025, 'Sortenverschnitt weiß', 100, 'dac', 'thermenregion_gebietswein', 'weiss', 17.2, '260153', 'DKB-Import 16.9.2026 (Fassweinliste 09-2026) · Chargennr. 260153 · Sorte SW · Qual. DAC · Herkunft WLTH · konventionell · Alkohol 13,5 % vol')
  ) AS x
)
INSERT INTO weinausbau (tenant_id, name, jahrgang, rebsorte, behaelter_id, menge_liter, anfangsbestand_liter, qualitaetsstufe, herkunft_code, weinart, kmw, referenz_altsystem, notizen, transaktions_nr, status, ist_eroeffnungsbestand, aktiv, created_at)
SELECT '0569d025-576d-4d47-a102-17173835dc5d', v.name, v.jahrgang, v.rebsorte, b.id, v.liter, v.liter, v.qual, v.herkunft, v.weinart, v.kmw, v.chnr, v.notizen,
       'EB-2026-' || lpad(((SELECT zaehler FROM z) - 19 + v.nr)::text, 4, '0'),
       'ausbau', true, true, '2026-01-01T00:00:00+01:00'
FROM v JOIN behaelter b ON b.tenant_id = '097f67ed-381e-4bb3-952e-758aa9d3a501' AND b.name = v.beh
WHERE NOT EXISTS (SELECT 1 FROM weinausbau w WHERE w.tenant_id = '0569d025-576d-4d47-a102-17173835dc5d' AND w.referenz_altsystem = v.chnr);

