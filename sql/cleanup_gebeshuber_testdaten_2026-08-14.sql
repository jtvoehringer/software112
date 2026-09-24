-- ═══════════════════════════════════════════════════════════════════════════════
-- software:112 – Testdaten-Cleanup für "Weingut Johannes Gebeshuber"
-- Löscht ALLE Bewegungs-/Betriebsdaten des Mandanten samt Historie.
--
-- Tenant-ID Gebeshuber: c3d357c5-239e-4eac-85b2-4774476bc435
-- (bitte kurz gegenprüfen, ob das nach wie vor die richtige ID ist)
--
-- BLEIBT bewusst unangetastet (Sonderfall "so lassen", siehe Onboarding-Konzept):
--   lagen, weingarten, grundstuecke, weingarten_rebsorten
--   behaelter (Gebinde-Stammdaten, Kapazitäten etc.)
--   tenants, tenant_einstellungen (bis auf charge_zaehler-Reset), tenant_memberships
--
-- OFFENE FRAGE, NICHT in diesem Script enthalten (bitte separat entscheiden):
--   kontakte, firmen, kontakt_firmen, kontakt_praeferenzen, weinbaugebiete_custom,
--   datenschutz_consents – das sind Stammdaten/Personendaten, nicht explizit von
--   dir bestätigt. Sag Bescheid, falls die auch weg sollen, dann schicke ich ein
--   Ergänzungs-Script.
--
-- NICHT abgedeckt (aus DB-Löschung heraus technisch nicht möglich):
--   Datei-Anhänge in Supabase Storage (z.B. zu aktivitaet_dokumente, Logos) -
--   die DB-Zeilen werden gelöscht, die zugehörigen Storage-Dateien bleiben
--   liegen. Bei Bedarf sag Bescheid, das ist ein separater Schritt im
--   Storage-Browser.
--
-- Ausführen im Supabase SQL Editor.
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
--  • Dieses Skript lief am 14.8.2026 mit session_replication_role = 'replica'; die
--    Zeile ist seit KAN-35 auskommentiert. Die Reihenfolge unten ist FK-gerecht.
--  • Historisches Einmal-Skript: der Mandant ist inzwischen im Echtbetrieb –
--    vor einer erneuten Ausführung Mandant und Umfang ausdrücklich klären.
-- ───────────────────────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════════

-- Trigger/FK-Prüfungen temporär deaktivieren (macht die Löschreihenfolge
-- unkritisch - die meisten Tabellen haben zwar schon ON DELETE CASCADE, aber
-- sicher ist sicher, gleiche Technik wie beim Sandbox-Cleanup vom 5.8.)
-- KAN-35 (24.09.2026): auskommentiert – 'replica' schaltet Protokoll-Trigger, FK-Prüfungen
-- und FK-Kaskaden ab (siehe Kopfkommentar). Nicht wieder aktivieren.
-- SET session_replication_role = 'replica';

DO $$
DECLARE
  v_tid UUID := 'c3d357c5-239e-4eac-85b2-4774476bc435';
BEGIN

  RAISE NOTICE '--- Starte Testdaten-Cleanup für Gebeshuber (%) ---', v_tid;

  -- ── 1. Kalender (CRM Aktivitäten/Pipeline) ─────────────────────────────────
  DELETE FROM aktivitaet_dokumente WHERE tenant_id = v_tid;
  DELETE FROM aktivitaeten WHERE tenant_id = v_tid;
  DELETE FROM pipeline_verlauf
    WHERE pipeline_id IN (SELECT id FROM pipeline_eintraege WHERE tenant_id = v_tid);
  DELETE FROM pipeline_eintraege WHERE tenant_id = v_tid;
  RAISE NOTICE 'Kalender (Aktivitäten + Pipeline) gelöscht';

  -- ── 2. Warenlager (PSM/Dünger) + Maßnahmen (treibt den Verbrauch) ──────────
  DELETE FROM behandlung_grundstuecke
    WHERE behandlung_id IN (SELECT id FROM behandlungen WHERE tenant_id = v_tid);
  DELETE FROM behandlungen WHERE tenant_id = v_tid;
  DELETE FROM psm_lager_bewegungen WHERE tenant_id = v_tid;
  DELETE FROM duengemittel_lager_bewegungen WHERE tenant_id = v_tid;
  RAISE NOTICE 'Warenlager (PSM/Dünger) + Maßnahmen gelöscht';

  -- ── 3. Verkäufe / Einkäufe / Offene Posten ─────────────────────────────────
  DELETE FROM zahlungen
    WHERE verkaufsposten_id IN (SELECT id FROM verkaufsposten WHERE tenant_id = v_tid);
  DELETE FROM transportbescheinigungen
    WHERE verkaufsposten_id IN (SELECT id FROM verkaufsposten WHERE tenant_id = v_tid);
  DELETE FROM ea_transaktionen WHERE tenant_id = v_tid;
  DELETE FROM verkauf_positionen
    WHERE verkaufsposten_id IN (SELECT id FROM verkaufsposten WHERE tenant_id = v_tid);
  DELETE FROM verkaufsposten WHERE tenant_id = v_tid;
  DELETE FROM traubenverkauf WHERE tenant_id = v_tid;
  DELETE FROM zukauf_posten WHERE tenant_id = v_tid;
  RAISE NOTICE 'Verkäufe/Einkäufe/Offene Posten gelöscht';

  -- ── 4. Kellerbuch + Chargen (Abfüllung, Ausbau, Presse, Ernte) ─────────────
  DELETE FROM fuellung_chargen
    WHERE fuellung_id IN (SELECT id FROM fuellungen WHERE tenant_id = v_tid);
  DELETE FROM fuellungen WHERE tenant_id = v_tid;
  DELETE FROM keller_behandlungen WHERE tenant_id = v_tid;
  DELETE FROM keller_umzuege WHERE tenant_id = v_tid;
  DELETE FROM verschneidung_quellen
    WHERE verschneidung_id IN (SELECT id FROM verschneidungen WHERE tenant_id = v_tid);
  DELETE FROM verschneidungen WHERE tenant_id = v_tid;
  DELETE FROM pressung_behaelter
    WHERE pressung_id IN (SELECT id FROM pressungen WHERE tenant_id = v_tid);
  DELETE FROM pressung_weingaerten
    WHERE pressung_id IN (SELECT id FROM pressungen WHERE tenant_id = v_tid);
  DELETE FROM pressungen WHERE tenant_id = v_tid;
  DELETE FROM weinausbau_weingaerten
    WHERE weinausbau_id IN (SELECT id FROM weinausbau WHERE tenant_id = v_tid);
  DELETE FROM weinausbau WHERE tenant_id = v_tid;
  DELETE FROM kellerplan_positionen WHERE tenant_id = v_tid;
  DELETE FROM kellerplaene WHERE tenant_id = v_tid;
  DELETE FROM ama_meldepositionen
    WHERE meldung_id IN (SELECT id FROM ama_erntemeldungen WHERE tenant_id = v_tid);
  DELETE FROM ama_erntemeldungen WHERE tenant_id = v_tid;
  DELETE FROM ernte_parzellen
    WHERE jahrgang_id IN (SELECT id FROM weinjahrgaenge WHERE tenant_id = v_tid);
  DELETE FROM pruefnummernantraege WHERE tenant_id = v_tid;
  DELETE FROM dac_antrag WHERE tenant_id = v_tid;
  DELETE FROM weinanalysen WHERE tenant_id = v_tid;
  DELETE FROM weinjahrgaenge WHERE tenant_id = v_tid;
  RAISE NOTICE 'Kellerbuch + Chargen (Abfüllung/Ausbau/Presse/Ernte) gelöscht';

  -- ── 5. Kostenrechnung ───────────────────────────────────────────────────────
  DELETE FROM kosteneintrag_behaelter
    WHERE kosteneintrag_id IN (SELECT id FROM kosteneintraege WHERE tenant_id = v_tid);
  DELETE FROM kosteneintrag_weingaerten
    WHERE kosteneintrag_id IN (SELECT id FROM kosteneintraege WHERE tenant_id = v_tid);
  DELETE FROM kosteneintraege WHERE tenant_id = v_tid;
  RAISE NOTICE 'Kostenrechnung gelöscht';

  -- ── 6. Sonstige Produkte (Katalog-Testeinträge) ────────────────────────────
  DELETE FROM sonstige_artikel WHERE tenant_id = v_tid;
  RAISE NOTICE 'Sonstige Produkte gelöscht';

  -- ── 7. Weiteres (SumUp, Export, Zeiterfassung, bot:112-Verlauf) ────────────
  DELETE FROM sumup_transaktionen WHERE tenant_id = v_tid;
  DELETE FROM sumup_checkouts WHERE tenant_id = v_tid;
  DELETE FROM exportauftrag_positionen
    WHERE exportauftrag_id IN (SELECT id FROM exportauftraege WHERE tenant_id = v_tid);
  DELETE FROM export_dokumente
    WHERE exportauftrag_id IN (SELECT id FROM exportauftraege WHERE tenant_id = v_tid);
  DELETE FROM exportauftraege WHERE tenant_id = v_tid;
  DELETE FROM zeiterfassung WHERE tenant_id = v_tid;
  DELETE FROM assistent_nachrichten
    WHERE unterhaltung_id IN (SELECT id FROM assistent_unterhaltungen WHERE tenant_id = v_tid);
  DELETE FROM assistent_aktionen
    WHERE unterhaltung_id IN (SELECT id FROM assistent_unterhaltungen WHERE tenant_id = v_tid);
  DELETE FROM assistent_unterhaltungen WHERE tenant_id = v_tid;
  DELETE FROM assistent_korrekturen WHERE tenant_id = v_tid;
  RAISE NOTICE 'SumUp/Export/Zeiterfassung/bot:112-Verlauf gelöscht';

  -- ── 8. Zähler zurücksetzen ──────────────────────────────────────────────────
  DELETE FROM transaktionszaehler WHERE tenant_id = v_tid;
  UPDATE tenant_einstellungen SET charge_zaehler = 1 WHERE tenant_id = v_tid;
  RAISE NOTICE 'Zähler zurückgesetzt';

  RAISE NOTICE '--- Cleanup abgeschlossen ---';
  RAISE NOTICE 'Behalten: lagen, weingarten, grundstuecke, weingarten_rebsorten, behaelter';
  RAISE NOTICE 'NICHT angefasst (offene Frage): kontakte, firmen, weinbaugebiete_custom';

END $$;

-- Trigger wieder aktivieren
-- SET session_replication_role = 'origin';   -- KAN-35: siehe oben

-- ── Kontrolle: Was ist noch da? (sollte überall 0 sein, außer den "bleibt"-Zeilen) ──
SELECT 'aktivitaeten',        COUNT(*) FROM aktivitaeten        WHERE tenant_id = 'c3d357c5-239e-4eac-85b2-4774476bc435'
UNION ALL SELECT 'pipeline_eintraege', COUNT(*) FROM pipeline_eintraege WHERE tenant_id = 'c3d357c5-239e-4eac-85b2-4774476bc435'
UNION ALL SELECT 'behandlungen',       COUNT(*) FROM behandlungen       WHERE tenant_id = 'c3d357c5-239e-4eac-85b2-4774476bc435'
UNION ALL SELECT 'psm_lager_bewegungen', COUNT(*) FROM psm_lager_bewegungen WHERE tenant_id = 'c3d357c5-239e-4eac-85b2-4774476bc435'
UNION ALL SELECT 'duengemittel_lager_bewegungen', COUNT(*) FROM duengemittel_lager_bewegungen WHERE tenant_id = 'c3d357c5-239e-4eac-85b2-4774476bc435'
UNION ALL SELECT 'verkaufsposten',     COUNT(*) FROM verkaufsposten     WHERE tenant_id = 'c3d357c5-239e-4eac-85b2-4774476bc435'
UNION ALL SELECT 'zahlungen (Offene Posten)', COUNT(*) FROM zahlungen ez JOIN verkaufsposten v ON v.id = ez.verkaufsposten_id WHERE v.tenant_id = 'c3d357c5-239e-4eac-85b2-4774476bc435'
UNION ALL SELECT 'zukauf_posten',      COUNT(*) FROM zukauf_posten      WHERE tenant_id = 'c3d357c5-239e-4eac-85b2-4774476bc435'
UNION ALL SELECT 'fuellungen',         COUNT(*) FROM fuellungen         WHERE tenant_id = 'c3d357c5-239e-4eac-85b2-4774476bc435'
UNION ALL SELECT 'weinausbau',         COUNT(*) FROM weinausbau         WHERE tenant_id = 'c3d357c5-239e-4eac-85b2-4774476bc435'
UNION ALL SELECT 'pressungen',         COUNT(*) FROM pressungen         WHERE tenant_id = 'c3d357c5-239e-4eac-85b2-4774476bc435'
UNION ALL SELECT 'keller_umzuege',     COUNT(*) FROM keller_umzuege     WHERE tenant_id = 'c3d357c5-239e-4eac-85b2-4774476bc435'
UNION ALL SELECT 'sonstige_artikel',   COUNT(*) FROM sonstige_artikel   WHERE tenant_id = 'c3d357c5-239e-4eac-85b2-4774476bc435'
UNION ALL SELECT 'weingarten (bleibt)', COUNT(*) FROM weingarten        WHERE tenant_id = 'c3d357c5-239e-4eac-85b2-4774476bc435'
UNION ALL SELECT 'grundstuecke (bleibt)', COUNT(*) FROM grundstuecke    WHERE tenant_id = 'c3d357c5-239e-4eac-85b2-4774476bc435'
UNION ALL SELECT 'behaelter (bleibt)', COUNT(*) FROM behaelter          WHERE tenant_id = 'c3d357c5-239e-4eac-85b2-4774476bc435'
ORDER BY 1;
