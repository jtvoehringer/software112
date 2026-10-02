-- pilot-abraeumen-export.sql – Sicherung der Daten, die scripts/pilot-abraeumen.sql löscht (KAN-185). NUR LESEND.
-- Betriebe: „Weingut Johannes Gebeshuber“ 097f67ed-381e-4bb3-952e-758aa9d3a501, „Spaetrot Gebeshuber GmbH“
-- 0569d025-576d-4d47-a102-17173835dc5d. Als postgres ausführen (SQL-Editor), sonst blendet RLS Zeilen aus.
-- Unmittelbar vor dem echten Lauf (Mitte Dezember) ausführen – Tabellenliste = Abschnitt „abräumen“ in pilot-abraeumen.sql
-- (kommt dort eine Tabelle dazu, hier ebenfalls ergänzen).
--
-- WEGE ZUM EXPORT
--   A) Alles in EINER Datei (empfohlen): im Supabase SQL-Editor nur die Abfrage „TEIL A“ markieren und ausführen →
--      Ergebnis → „Export“ → CSV. Je gelöschter Zeile eine Zeile: tabelle, tenant_id, zeile (komplette Zeile als JSON).
--      Der SQL-Editor zeigt/exportiert bei großen Ergebnissen ggf. nicht alles – Zeilenzahl mit der Summe aus
--      „TEIL A – Kontrolle“ vergleichen; reicht es nicht, Weg C verwenden.
--   B) Je Tabelle eine CSV: in „TEIL B“ die gewünschte Abfrage markieren, ausführen, „Export“ → CSV.
--   C) psql (Verbindungs-URI aus Dashboard → Connect → Session pooler; Passwort nicht in Dateien ablegen), z. B.:
--        \copy (SELECT * FROM public.weinausbau WHERE tenant_id IN (…)) TO 'weinausbau.csv' WITH (FORMAT csv, HEADER)
--      bzw. für TEIL A: \copy (<Abfrage TEIL A ohne Semikolon>) TO 'pilot-export.csv' WITH (FORMAT csv, HEADER)
--      (\copy schreibt auf den eigenen Rechner; COPY … TO STDOUT funktioniert genauso über psql -c).
--   Zusätzlich: Dashboard → Database → Backups – Datum des letzten Backups bzw. PITR-Zeitpunkt notieren.
--   Storage-Dateien (Belege) löscht pilot-abraeumen.sql nicht; sie brauchen keinen Export.

-- ── TEIL A: alles in einer Abfrage ──────────────────────────────────────────────────────────────
SELECT 'weinausbau' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.weinausbau x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'weinausbau_weingaerten' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.weinausbau_weingaerten x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'keller_umzuege' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.keller_umzuege x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'verschneidungen' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.verschneidungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'keller_behandlungen' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.keller_behandlungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'weinanalysen' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.weinanalysen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'pressungen' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.pressungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'lesen' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.lesen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'weinjahrgaenge' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.weinjahrgaenge x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'traubenverkauf' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.traubenverkauf x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'zukauf_posten' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.zukauf_posten x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'fuellungen' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.fuellungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'fuellung_chargen' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.fuellung_chargen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'fuellung_bewegungen' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.fuellung_bewegungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'dac_antrag' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.dac_antrag x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'pruefnummernantraege' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.pruefnummernantraege x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'ama_erntemeldungen' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.ama_erntemeldungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'verkaufsposten' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.verkaufsposten x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'verkauf_positionen' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.verkauf_positionen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'zahlungen' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.zahlungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'bestellungen' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.bestellungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'sumup_checkouts' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.sumup_checkouts x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'sumup_transaktionen' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.sumup_transaktionen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'transportbescheinigungen' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.transportbescheinigungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'exportauftraege' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.exportauftraege x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'ea_transaktionen' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.ea_transaktionen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'ea_belege' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.ea_belege x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'ea_monatsabschluss' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.ea_monatsabschluss x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'ea_uva' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.ea_uva x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'ea_dauerauftrag_log' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.ea_dauerauftrag_log x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'konto_umbuchungen' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.konto_umbuchungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'kosteneintraege' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.kosteneintraege x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'behandlungen' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.behandlungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'psm_lager_bewegungen' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.psm_lager_bewegungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'duengemittel_lager_bewegungen' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.duengemittel_lager_bewegungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'betriebsmittel_lager_bewegungen' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.betriebsmittel_lager_bewegungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'transaktionszaehler' AS tabelle, x.tenant_id, to_jsonb(x) AS zeile FROM public.transaktionszaehler x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'verschneidung_quellen', p.tenant_id, to_jsonb(k) FROM public.verschneidung_quellen k JOIN public.verschneidungen p ON p.id = k.verschneidung_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'pressung_behaelter', p.tenant_id, to_jsonb(k) FROM public.pressung_behaelter k JOIN public.pressungen p ON p.id = k.pressung_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'pressung_weingaerten', p.tenant_id, to_jsonb(k) FROM public.pressung_weingaerten k JOIN public.pressungen p ON p.id = k.pressung_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'ernte_parzellen', p.tenant_id, to_jsonb(k) FROM public.ernte_parzellen k JOIN public.weinjahrgaenge p ON p.id = k.jahrgang_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'ama_meldepositionen', p.tenant_id, to_jsonb(k) FROM public.ama_meldepositionen k JOIN public.ama_erntemeldungen p ON p.id = k.meldung_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'bestellung_positionen', p.tenant_id, to_jsonb(k) FROM public.bestellung_positionen k JOIN public.bestellungen p ON p.id = k.bestellung_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'exportauftrag_positionen', p.tenant_id, to_jsonb(k) FROM public.exportauftrag_positionen k JOIN public.exportauftraege p ON p.id = k.exportauftrag_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'export_dokumente', p.tenant_id, to_jsonb(k) FROM public.export_dokumente k JOIN public.exportauftraege p ON p.id = k.exportauftrag_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'kosteneintrag_behaelter', p.tenant_id, to_jsonb(k) FROM public.kosteneintrag_behaelter k JOIN public.kosteneintraege p ON p.id = k.kosteneintrag_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'kosteneintrag_weingaerten', p.tenant_id, to_jsonb(k) FROM public.kosteneintrag_weingaerten k JOIN public.kosteneintraege p ON p.id = k.kosteneintrag_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'behandlung_grundstuecke', p.tenant_id, to_jsonb(k) FROM public.behandlung_grundstuecke k JOIN public.behandlungen p ON p.id = k.behandlung_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'tenant_einstellungen (Nummernkreise)', e.tenant_id, jsonb_build_object('rechnung_zaehler', e.rechnung_zaehler, 'rechnung_zaehler_jahr', e.rechnung_zaehler_jahr, 'charge_zaehler', e.charge_zaehler, 'liefernummer_zaehler', e.liefernummer_zaehler, 'export_zaehler', e.export_zaehler) FROM public.tenant_einstellungen e WHERE e.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
ORDER BY 1, 2;

-- TEIL A – Kontrolle: Zeilen je Tabelle
SELECT tabelle, count(*) FROM (
SELECT 'weinausbau' AS tabelle FROM public.weinausbau x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'weinausbau_weingaerten' AS tabelle FROM public.weinausbau_weingaerten x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'keller_umzuege' AS tabelle FROM public.keller_umzuege x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'verschneidungen' AS tabelle FROM public.verschneidungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'keller_behandlungen' AS tabelle FROM public.keller_behandlungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'weinanalysen' AS tabelle FROM public.weinanalysen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'pressungen' AS tabelle FROM public.pressungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'lesen' AS tabelle FROM public.lesen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'weinjahrgaenge' AS tabelle FROM public.weinjahrgaenge x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'traubenverkauf' AS tabelle FROM public.traubenverkauf x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'zukauf_posten' AS tabelle FROM public.zukauf_posten x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'fuellungen' AS tabelle FROM public.fuellungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'fuellung_chargen' AS tabelle FROM public.fuellung_chargen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'fuellung_bewegungen' AS tabelle FROM public.fuellung_bewegungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'dac_antrag' AS tabelle FROM public.dac_antrag x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'pruefnummernantraege' AS tabelle FROM public.pruefnummernantraege x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'ama_erntemeldungen' AS tabelle FROM public.ama_erntemeldungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'verkaufsposten' AS tabelle FROM public.verkaufsposten x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'verkauf_positionen' AS tabelle FROM public.verkauf_positionen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'zahlungen' AS tabelle FROM public.zahlungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'bestellungen' AS tabelle FROM public.bestellungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'sumup_checkouts' AS tabelle FROM public.sumup_checkouts x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'sumup_transaktionen' AS tabelle FROM public.sumup_transaktionen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'transportbescheinigungen' AS tabelle FROM public.transportbescheinigungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'exportauftraege' AS tabelle FROM public.exportauftraege x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'ea_transaktionen' AS tabelle FROM public.ea_transaktionen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'ea_belege' AS tabelle FROM public.ea_belege x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'ea_monatsabschluss' AS tabelle FROM public.ea_monatsabschluss x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'ea_uva' AS tabelle FROM public.ea_uva x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'ea_dauerauftrag_log' AS tabelle FROM public.ea_dauerauftrag_log x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'konto_umbuchungen' AS tabelle FROM public.konto_umbuchungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'kosteneintraege' AS tabelle FROM public.kosteneintraege x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'behandlungen' AS tabelle FROM public.behandlungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'psm_lager_bewegungen' AS tabelle FROM public.psm_lager_bewegungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'duengemittel_lager_bewegungen' AS tabelle FROM public.duengemittel_lager_bewegungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'betriebsmittel_lager_bewegungen' AS tabelle FROM public.betriebsmittel_lager_bewegungen x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'transaktionszaehler' AS tabelle FROM public.transaktionszaehler x WHERE x.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'verschneidung_quellen' FROM public.verschneidung_quellen k JOIN public.verschneidungen p ON p.id = k.verschneidung_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'pressung_behaelter' FROM public.pressung_behaelter k JOIN public.pressungen p ON p.id = k.pressung_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'pressung_weingaerten' FROM public.pressung_weingaerten k JOIN public.pressungen p ON p.id = k.pressung_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'ernte_parzellen' FROM public.ernte_parzellen k JOIN public.weinjahrgaenge p ON p.id = k.jahrgang_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'ama_meldepositionen' FROM public.ama_meldepositionen k JOIN public.ama_erntemeldungen p ON p.id = k.meldung_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'bestellung_positionen' FROM public.bestellung_positionen k JOIN public.bestellungen p ON p.id = k.bestellung_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'exportauftrag_positionen' FROM public.exportauftrag_positionen k JOIN public.exportauftraege p ON p.id = k.exportauftrag_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'export_dokumente' FROM public.export_dokumente k JOIN public.exportauftraege p ON p.id = k.exportauftrag_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'kosteneintrag_behaelter' FROM public.kosteneintrag_behaelter k JOIN public.kosteneintraege p ON p.id = k.kosteneintrag_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'kosteneintrag_weingaerten' FROM public.kosteneintrag_weingaerten k JOIN public.kosteneintraege p ON p.id = k.kosteneintrag_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'behandlung_grundstuecke' FROM public.behandlung_grundstuecke k JOIN public.behandlungen p ON p.id = k.behandlung_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
UNION ALL SELECT 'tenant_einstellungen (Nummernkreise)' FROM public.tenant_einstellungen e WHERE e.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d')
) s GROUP BY 1 ORDER BY 1;

-- ── TEIL B: je Tabelle eine Abfrage ──────────────────────────────────────────────────────────────
SELECT * FROM public.weinausbau WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.weinausbau_weingaerten WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.keller_umzuege WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.verschneidungen WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.keller_behandlungen WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.weinanalysen WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.pressungen WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.lesen WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.weinjahrgaenge WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.traubenverkauf WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.zukauf_posten WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.fuellungen WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.fuellung_chargen WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.fuellung_bewegungen WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.dac_antrag WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.pruefnummernantraege WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.ama_erntemeldungen WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.verkaufsposten WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.verkauf_positionen WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.zahlungen WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.bestellungen WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.sumup_checkouts WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.sumup_transaktionen WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.transportbescheinigungen WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.exportauftraege WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.ea_transaktionen WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.ea_belege WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.ea_monatsabschluss WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.ea_uva WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.ea_dauerauftrag_log WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.konto_umbuchungen WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.kosteneintraege WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.behandlungen WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.psm_lager_bewegungen WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.duengemittel_lager_bewegungen WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.betriebsmittel_lager_bewegungen WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT * FROM public.transaktionszaehler WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY tenant_id;
SELECT p.tenant_id AS betrieb, k.* FROM public.verschneidung_quellen k JOIN public.verschneidungen p ON p.id = k.verschneidung_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY 1;
SELECT p.tenant_id AS betrieb, k.* FROM public.pressung_behaelter k JOIN public.pressungen p ON p.id = k.pressung_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY 1;
SELECT p.tenant_id AS betrieb, k.* FROM public.pressung_weingaerten k JOIN public.pressungen p ON p.id = k.pressung_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY 1;
SELECT p.tenant_id AS betrieb, k.* FROM public.ernte_parzellen k JOIN public.weinjahrgaenge p ON p.id = k.jahrgang_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY 1;
SELECT p.tenant_id AS betrieb, k.* FROM public.ama_meldepositionen k JOIN public.ama_erntemeldungen p ON p.id = k.meldung_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY 1;
SELECT p.tenant_id AS betrieb, k.* FROM public.bestellung_positionen k JOIN public.bestellungen p ON p.id = k.bestellung_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY 1;
SELECT p.tenant_id AS betrieb, k.* FROM public.exportauftrag_positionen k JOIN public.exportauftraege p ON p.id = k.exportauftrag_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY 1;
SELECT p.tenant_id AS betrieb, k.* FROM public.export_dokumente k JOIN public.exportauftraege p ON p.id = k.exportauftrag_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY 1;
SELECT p.tenant_id AS betrieb, k.* FROM public.kosteneintrag_behaelter k JOIN public.kosteneintraege p ON p.id = k.kosteneintrag_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY 1;
SELECT p.tenant_id AS betrieb, k.* FROM public.kosteneintrag_weingaerten k JOIN public.kosteneintraege p ON p.id = k.kosteneintrag_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY 1;
SELECT p.tenant_id AS betrieb, k.* FROM public.behandlung_grundstuecke k JOIN public.behandlungen p ON p.id = k.behandlung_id WHERE p.tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d') ORDER BY 1;
SELECT tenant_id, rechnung_prefix, rechnung_suffix, rechnung_stellen, rechnung_zaehler, rechnung_zaehler_jahr, charge_prefix, charge_zaehler, liefernummer_prefix, liefernummer_zaehler, export_prefix, export_zaehler FROM public.tenant_einstellungen WHERE tenant_id IN ('097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d');
