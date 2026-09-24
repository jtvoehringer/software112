-- ═══════════════════════════════════════════════════════════════════════════
-- cleanup_testdaten.sql — Einmalige Testdaten-Bereinigung vor dem Echtbetrieb
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ZWECK:
--   software:112 geht von interner Testphase in den echten Nutzertest über.
--   Dieses Skript löscht ALLE Bewegungs-/Transaktionsdaten (jeder Tenant),
--   die während der Entwicklung/Tests angelegt wurden, und lässt sämtliche
--   Stammdaten (Tenants, Weingärten, Grundstücke, Rebsorten, Behälter,
--   Preislisten, CRM-Kontakte/Firmen, Kostenarten/-stellen,
--   Einstellungen usw.) unangetastet.
--
-- WICHTIG:
--   - Dies ist KEIN nummeriertes Schema-Migrations-Skript (nicht als
--     supabase/migrations/133_*.sql einchecken). Es ist ein manuell, EINMALIG
--     im Supabase SQL-Editor auszuführendes Aufräum-Skript.
--   - Es verändert kein Datenbankschema (keine DDL-Änderungen), nur Zeilen
--     in bestehenden Tabellen werden gelöscht.
--   - Datum der Erstellung: 2026-07-17.
--
-- HINWEIS ZU "zeiterfassung":
--   zeiterfassung enthält reale IC&P-Beratungsstunden/Abrechnungsdaten für
--   Gebeshuber (den echten Pilotkunden), keine Testdaten — wurde daher aus
--   diesem Skript bewusst ausgenommen und bleibt unangetastet (Stammdaten-
--   /Abrechnungscharakter, siehe zeiterfassung_import.sql, zeiterfassung_
--   2026-06-25.sql, zeiterfassung_2026-06-26.sql, zeiterfassung_lizenzkosten.sql,
--   zeiterfassung_tokens.sql).
--
-- Reihenfolge: Kind-Tabellen werden immer vor ihren Eltern-Tabellen gelöscht,
-- unabhängig davon ob ein ON DELETE CASCADE existiert (Klarheit beim Review).
-- Zeilen, deren Fremdschlüssel per ON DELETE SET NULL definiert sind, werden
-- an den entsprechenden Stellen kommentiert.
--
-- ─── ACHTUNG seit KAN-35 (24.09.2026) ─────────────────────────────────────────
-- Migration 20260924170709_kan35_datenintegritaet:
--  • Jede Löschung und bestandsrelevante Änderung an Kellerbuch-, Lese- und
--    Verkaufstabellen (weinausbau, keller_umzuege, verschneidungen, verschneidung_
--    quellen, keller_behandlungen, fuellungen, fuellung_chargen, fuellung_bewegungen,
--    zukauf_posten, pressungen, pressung_behaelter, pressung_weingaerten,
--    ernte_parzellen, traubenverkauf, verkaufsposten, verkauf_positionen,
--    ama_erntemeldungen, ama_meldepositionen, weinjahrgaenge) landet per Trigger im
--    bestandsprotokoll – auch im SQL-Editor und bei FK-Kaskaden. Das ist gewollt.
--  • TRUNCATE ist auf diesen Tabellen gesperrt – nur zeilenweise mit DELETE löschen.
--  • Nicht mit SET session_replication_role = 'replica' arbeiten: das schaltet
--    Protokoll-Trigger, FK-Prüfungen UND FK-Kaskaden ab (ungeprotokollierte
--    Löschungen, verwaiste Zeilen z. B. in fuellung_bewegungen).
--  • Löschreihenfolge wegen der FKs ohne ON DELETE (NO ACTION): verschneidungen
--    (samt verschneidung_quellen), keller_behandlungen, keller_umzuege,
--    fuellung_chargen und pressung_behaelter VOR weinausbau; weinausbau,
--    keller_umzuege, keller_behandlungen und pressung_behaelter VOR behaelter;
--    traubenverkauf VOR weinjahrgaenge.
--  • Mengenkorrekturen nicht per UPDATE, sondern über die RPCs schwund_buchen(...)
--    (Liter einer Charge mindern, datierte Schwundzeile) bzw. fuellung_bestand_buchen(...)
--    (Flaschenbestand ±, datierte Zeile in fuellung_bewegungen) – aus dem SQL-Editor
--    mit Parameternamen aufrufbar, z. B.
--      select schwund_buchen(p_tenant_id => '…', p_weinausbau_id => '…', p_liter => 12.5,
--                            p_datum => current_date, p_notiz => 'Korrektur …');
--    Ein direktes UPDATE von menge_liter/bestand_flaschen wird zwar protokolliert,
--    hinterlässt aber keine datierte Bewegung im Bewegungsbuch.
--  • Historisches Einmal-Skript (17.07.2026) – löscht MANDANTENÜBERGREIFEND (ohne
--    WHERE tenant_id)! Im Echtbetrieb NICHT mehr ausführen; für einen einzelnen
--    Mandanten sql/cleanup_testdaten.sql als Vorlage nehmen.
-- ───────────────────────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 1: CRM Bewegungsdaten (Aktivitäten & Pipeline)
-- kontakte, firmen, kontakt_firmen, kontakt_praeferenzen, datenschutz_consents
-- bleiben unangetastet (Stammdaten) — nur die Bewegungsdaten werden gelöscht.
-- ─────────────────────────────────────────────────────────────────────────
DELETE FROM aktivitaet_dokumente;   -- Kind von aktivitaeten (cascade)
DELETE FROM pipeline_verlauf;       -- Kind von pipeline_eintraege (cascade)
DELETE FROM aktivitaeten;           -- referenziert kontakte/firmen via ON DELETE SET NULL (bleiben unberührt)
DELETE FROM pipeline_eintraege;     -- referenziert kontakte/firmen via ON DELETE SET NULL (bleiben unberührt)

-- (SECTION 2 "Zeiterfassung" entfällt bewusst — siehe Hinweis im Datei-Header:
--  zeiterfassung enthält reale Abrechnungsdaten und wird NICHT gelöscht.)

-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 3: Weinbau-Kette
-- Lese → Pressung → Kellerbuch → Verschneidung → Füllung → Verkauf →
-- Export → Zukauf → Bestellungen
-- Reihenfolge ist zwingend: pressung_behaelter, keller_umzuege,
-- verschneidung_quellen und fuellung_chargen referenzieren weinausbau OHNE
-- ON DELETE CASCADE/SET NULL (Standard NO ACTION/RESTRICT) — sie MÜSSEN vor
-- weinausbau gelöscht werden, sonst schlägt DELETE FROM weinausbau mit einem
-- FK-Verletzungsfehler fehl. Ebenso muss traubenverkauf vor weinjahrgaenge
-- gelöscht werden (jahrgang_id ohne ON DELETE-Klausel).
-- ─────────────────────────────────────────────────────────────────────────

-- Ernte / AMA
DELETE FROM ama_meldepositionen;    -- Kind von ama_erntemeldungen (cascade)
DELETE FROM ama_erntemeldungen;     -- Kind von weinjahrgaenge (cascade)

-- Verkauf, Bestellungen, Traubenverkauf, Export, Zukauf
-- (verkauf_positionen zuerst: referenziert verkaufsposten, fuellungen,
--  zukauf_posten, pressung_behaelter UND traubenverkauf)
DELETE FROM verkauf_positionen;
DELETE FROM bestellung_positionen;  -- Kind von bestellungen (cascade); referenziert weinausbau via SET NULL
DELETE FROM bestellungen;           -- referenziert kontakte/firmen via SET NULL (bleiben unberührt)
DELETE FROM traubenverkauf;         -- referenziert weinjahrgaenge (KEIN ON DELETE!), weingarten/kontakte/firmen (RESTRICT, bleiben unberührt), verkaufsposten (SET NULL)
DELETE FROM exportauftrag_positionen; -- Kind von exportauftraege (cascade); referenziert fuellungen via SET NULL
DELETE FROM export_dokumente;       -- Kind von exportauftraege (cascade)
DELETE FROM exportauftraege;        -- referenziert kontakte/firmen via SET NULL (bleiben unberührt)
DELETE FROM transportbescheinigungen; -- referenziert verkaufsposten via SET NULL
DELETE FROM pruefnummernantraege;   -- referenziert dac_antrag via SET NULL
DELETE FROM sumup_transaktionen;    -- referenziert sumup_checkouts via SET NULL
DELETE FROM sumup_checkouts;        -- referenziert verkaufsposten via SET NULL
DELETE FROM zahlungen;              -- Kind von verkaufsposten (cascade)
DELETE FROM verkaufsposten;         -- referenziert kontakte/firmen via SET NULL (bleiben unberührt)
DELETE FROM zukauf_posten;          -- referenziert kontakte/firmen via SET NULL (bleiben unberührt), weinausbau via SET NULL

-- Pressung
DELETE FROM pressung_weingaerten;   -- Kind von pressungen (cascade); referenziert weingarten/grundstuecke (bleiben unberührt)
DELETE FROM pressung_behaelter;     -- Kind von pressungen (cascade); referenziert behaelter (bleibt unberührt) und weinausbau (KEIN ON DELETE — muss vor weinausbau gelöscht sein)
DELETE FROM pressungen;             -- Kind von weinjahrgaenge (cascade)
DELETE FROM ernte_parzellen;        -- Kind von weinjahrgaenge (cascade)

-- Kellerbuch: Umzüge, Kellerbehandlungen, Verschneidung, Analysen, Füllung
DELETE FROM keller_umzuege;         -- referenziert weinausbau (KEIN ON DELETE — muss vor weinausbau gelöscht sein) und behaelter (bleibt unberührt)
DELETE FROM keller_behandlungen;    -- referenziert behaelter (cascade, bleibt unberührt), keller_behandlungstypen (SET NULL, bleibt unberührt), weinausbau (SET NULL)
DELETE FROM verschneidung_quellen;  -- Kind von verschneidungen (cascade); referenziert weinausbau (KEIN ON DELETE — muss vor weinausbau gelöscht sein)
DELETE FROM verschneidungen;        -- referenziert weinausbau (cascade)
DELETE FROM weinanalysen;           -- referenziert weinausbau via SET NULL
DELETE FROM weinausbau_weingaerten; -- Kind von weinausbau (cascade); referenziert weingarten (cascade, bleibt unberührt da weingarten nicht gelöscht wird)
DELETE FROM fuellung_chargen;       -- Kind von fuellungen (cascade); referenziert weinausbau (KEIN ON DELETE — muss vor weinausbau gelöscht sein)

-- Füllungen
-- HINWEIS (Konflikt Stammdaten/Testdaten): preislisten_positionen.fuellung_id
-- referenziert fuellungen(id) ON DELETE SET NULL. preislisten_positionen ist
-- eine Stammdaten-Tabelle (KEEP) — sie wird NICHT gelöscht, aber Postgres
-- setzt automatisch fuellung_id = NULL auf allen Preislisten-Positionen, die
-- bisher auf eine jetzt gelöschte Füllung verwiesen haben. Das ist so
-- beabsichtigt (Verweis auf gelöschten Testdaten-Datensatz "verwaist" korrekt
-- auf NULL statt auf eine Fehlermeldung zu laufen), sollte dem Nutzer aber
-- bewusst sein: evtl. verlieren manche Preislisten-Positionen ihre Verknüpfung
-- zu einem konkreten Lager-Produkt.
DELETE FROM fuellungen;             -- referenziert weinausbau (SET NULL), dac_antrag (SET NULL)

DELETE FROM weinausbau;             -- Kellerbuch-Chargen — jetzt sicher, alle Kinder oben bereits gelöscht
DELETE FROM dac_antrag;             -- referenziert nichts weiteres aus der Wipe-Liste
DELETE FROM weinjahrgaenge;         -- Wurzel der Ernte-Kette — jetzt sicher (ama_erntemeldungen, pressungen, ernte_parzellen, traubenverkauf bereits gelöscht)

-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 4: Buchhaltung (Kostenrechnung / E&A-Modul)
-- kostenarten, kostenstellen, ea_kategorien bleiben unangetastet (Stammdaten).
-- FIBU-Modul wurde vollstaendig entfernt (Migration 143).
-- ─────────────────────────────────────────────────────────────────────────
DELETE FROM kosteneintrag_weingaerten;  -- Kind von kosteneintraege (cascade)
DELETE FROM kosteneintrag_behaelter;    -- Kind von kosteneintraege (cascade)
DELETE FROM kosteneintraege;            -- referenziert kostenstellen/kostenarten via SET NULL (bleiben unberührt)
DELETE FROM ea_transaktionen;           -- referenziert ea_kategorien via SET NULL (bleibt unberührt), ea_dauerauftraege via SET NULL
DELETE FROM ea_dauerauftraege;          -- referenziert ea_kategorien via SET NULL (bleibt unberührt)
DELETE FROM ea_uva;

-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 5: Sonstiges (Feldbehandlungen / Pflanzenschutz)
-- pflanzenschutzmittel bleibt unangetastet (Stammdaten).
-- ─────────────────────────────────────────────────────────────────────────
DELETE FROM behandlung_grundstuecke;    -- Kind von behandlungen (cascade); referenziert grundstuecke (cascade, bleibt unberührt)
DELETE FROM psm_lager_bewegungen;       -- referenziert pflanzenschutzmittel (cascade, bleibt unberührt)
DELETE FROM behandlungen;               -- referenziert weingarten via SET NULL (bleibt unberührt), pflanzenschutzmittel (RESTRICT, bleibt unberührt)

-- ─────────────────────────────────────────────────────────────────────────
-- SECTION 6: Transaktions-Zähler zurücksetzen (Sonderfall)
-- ─────────────────────────────────────────────────────────────────────────
-- transaktionszaehler wird von der RPC get_next_transaktionsnr() genutzt
-- (Migration 077). Diese Funktion arbeitet mit einem echten Upsert:
--   INSERT INTO transaktionszaehler (...) VALUES (...)
--   ON CONFLICT (tenant_id, typ, jahr) DO UPDATE SET zaehler = zaehler + 1
-- D.h. fehlt eine Zeile für tenant/typ/jahr, wird sie beim nächsten Aufruf
-- automatisch mit zaehler=1 neu angelegt — ein hartes DELETE ist daher
-- sicher und ausreichend (kein manuelles UPDATE/Reset auf 0 nötig).
DELETE FROM transaktionszaehler;

-- HINWEIS zu anderen Nummernkreisen (KEINE Änderung in diesem Skript):
-- get_next_chargennummer() (Mig. 071) und get_next_liefernummer() (Mig. 111)
-- lesen/schreiben NICHT die Tabelle transaktionszaehler, sondern Zähler-
-- Spalten direkt auf tenant_einstellungen (charge_zaehler, liefernummer_zaehler)
-- — ebenso rechnungsnummer/kundennummer/exportnummer-Zähler (Mig. 026/027/043).
-- tenant_einstellungen ist eine Stammdaten-Tabelle (KEEP) und wird von
-- diesem Skript NICHT verändert. Das bedeutet: nach dem Wipe laufen diese
-- Nummernkreise NICHT bei 1 neu los, sondern setzen den aktuellen
-- (durch Testdaten ggf. schon hochgezählten) Zählerstand fort. Falls
-- gewünscht, müsste der Nutzer die betreffenden *_zaehler-Spalten in
-- tenant_einstellungen separat und bewusst zurücksetzen — das ist NICHT
-- Teil dieses Skripts, weil tenant_einstellungen laut Vorgabe unangetastet
-- bleiben soll.

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFIKATION — nach dem Commit ausführen und Ergebnis prüfen.
-- Alle "sollte 0 sein"-Zeilen müssen 0 ergeben. Die Stammdaten-Zeilen am Ende
-- sollten unverändert (i.d.R. > 0) sein, sofern vorher Daten vorhanden waren.
-- ═══════════════════════════════════════════════════════════════════════════
select * from (values
  ('aktivitaet_dokumente',        (select count(*) from aktivitaet_dokumente)),
  ('pipeline_verlauf',            (select count(*) from pipeline_verlauf)),
  ('aktivitaeten',                (select count(*) from aktivitaeten)),
  ('pipeline_eintraege',          (select count(*) from pipeline_eintraege)),
  ('ama_meldepositionen',         (select count(*) from ama_meldepositionen)),
  ('ama_erntemeldungen',          (select count(*) from ama_erntemeldungen)),
  ('verkauf_positionen',          (select count(*) from verkauf_positionen)),
  ('bestellung_positionen',       (select count(*) from bestellung_positionen)),
  ('bestellungen',                (select count(*) from bestellungen)),
  ('traubenverkauf',              (select count(*) from traubenverkauf)),
  ('exportauftrag_positionen',    (select count(*) from exportauftrag_positionen)),
  ('export_dokumente',            (select count(*) from export_dokumente)),
  ('exportauftraege',             (select count(*) from exportauftraege)),
  ('transportbescheinigungen',    (select count(*) from transportbescheinigungen)),
  ('pruefnummernantraege',        (select count(*) from pruefnummernantraege)),
  ('sumup_transaktionen',         (select count(*) from sumup_transaktionen)),
  ('sumup_checkouts',             (select count(*) from sumup_checkouts)),
  ('zahlungen',                   (select count(*) from zahlungen)),
  ('verkaufsposten',              (select count(*) from verkaufsposten)),
  ('zukauf_posten',               (select count(*) from zukauf_posten)),
  ('pressung_weingaerten',        (select count(*) from pressung_weingaerten)),
  ('pressung_behaelter',          (select count(*) from pressung_behaelter)),
  ('pressungen',                  (select count(*) from pressungen)),
  ('ernte_parzellen',             (select count(*) from ernte_parzellen)),
  ('keller_umzuege',              (select count(*) from keller_umzuege)),
  ('keller_behandlungen',         (select count(*) from keller_behandlungen)),
  ('verschneidung_quellen',       (select count(*) from verschneidung_quellen)),
  ('verschneidungen',             (select count(*) from verschneidungen)),
  ('weinanalysen',                (select count(*) from weinanalysen)),
  ('weinausbau_weingaerten',      (select count(*) from weinausbau_weingaerten)),
  ('fuellung_chargen',            (select count(*) from fuellung_chargen)),
  ('fuellungen',                  (select count(*) from fuellungen)),
  ('weinausbau',                  (select count(*) from weinausbau)),
  ('dac_antrag',                  (select count(*) from dac_antrag)),
  ('weinjahrgaenge',              (select count(*) from weinjahrgaenge)),
  ('kosteneintrag_weingaerten',   (select count(*) from kosteneintrag_weingaerten)),
  ('kosteneintrag_behaelter',     (select count(*) from kosteneintrag_behaelter)),
  ('kosteneintraege',             (select count(*) from kosteneintraege)),
  ('ea_transaktionen',            (select count(*) from ea_transaktionen)),
  ('ea_dauerauftraege',           (select count(*) from ea_dauerauftraege)),
  ('ea_uva',                      (select count(*) from ea_uva)),
  ('behandlung_grundstuecke',     (select count(*) from behandlung_grundstuecke)),
  ('psm_lager_bewegungen',        (select count(*) from psm_lager_bewegungen)),
  ('behandlungen',                (select count(*) from behandlungen)),
  ('transaktionszaehler',         (select count(*) from transaktionszaehler)),
  ('--- Stammdaten (sollten unverändert sein) ---', null),
  ('zeiterfassung',               (select count(*) from zeiterfassung)),
  ('tenants',                     (select count(*) from tenants)),
  ('weingarten',                  (select count(*) from weingarten)),
  ('grundstuecke',                (select count(*) from grundstuecke)),
  ('rebsorten',                   (select count(*) from rebsorten)),
  ('behaelter',                   (select count(*) from behaelter)),
  ('kellerplan_positionen',       (select count(*) from kellerplan_positionen)),
  ('kontakte',                    (select count(*) from kontakte)),
  ('firmen',                      (select count(*) from firmen)),
  ('preislisten',                 (select count(*) from preislisten)),
  ('preislisten_positionen',      (select count(*) from preislisten_positionen)),
  ('tenant_einstellungen',        (select count(*) from tenant_einstellungen))
) as t(tabelle, anzahl_zeilen)
order by
  case when tabelle like '---%' then 1 else 0 end,
  tabelle;
