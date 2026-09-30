-- ═══════════════════════════════════════════════════════════════════════════════
-- KOMPLETTER RESET: Mandant "Weingut Johannes Gebeshuber" wird vollständig
-- gelöscht (inkl. aller Bewegungs- UND Stammdaten, Mitgliedschaften,
-- Einstellungen). Danach über die UI einen neuen leeren Mandanten anlegen
-- und die zuvor exportierten Rieden/Grundstücke-CSVs importieren.
--
-- ⚠️  NUR AUSFÜHREN, WENN export-gebeshuber-rieden-grundstuecke.sql bereits
--     erfolgreich als CSV heruntergeladen wurde! Dieser Schritt ist NICHT
--     rückgängig zu machen.
--
-- Tenant-ID Gebeshuber: c3d357c5-239e-4eac-85b2-4774476bc435
--
-- Warum ein einzelnes DELETE FROM tenants nicht reicht:
-- Fast jede Tabelle im Schema hat tenant_id mit "ON DELETE CASCADE" auf
-- tenants(id) - das räumt beim Löschen des Mandanten automatisch überall
-- auf (Kellerbuch, Verkäufe, Kalender, CRM, Warenlager, Kosten, Chargen, ...).
-- Fünf Tabellen sind aber eine Ausnahme: sie haben tenant_id nur als lose
-- UUID-Spalte OHNE Fremdschlüssel-Bezug zu tenants (Isolation läuft dort
-- rein über RLS) - die müssen daher VORHER explizit gelöscht werden, sonst
-- blieben sie als verwaiste Zeilen mit toter tenant_id zurück:
--   exportauftraege, sonstige_artikel, zukauf_posten, pruefnummernantraege,
--   weinbaugebiete_custom
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
--    traubenverkauf VOR weinjahrgaenge. lesen (KAN-129) hängen per FK an Betrieb und Jahrgang (CASCADE);
--    der Lösch-Trigger lässt die Kaskade zu, ein direktes DELETE auf lesen nicht.
--  • Mengenkorrekturen nicht per UPDATE, sondern über die RPCs schwund_buchen(...)
--    (Liter einer Charge mindern, datierte Schwundzeile) bzw. fuellung_bestand_buchen(...)
--    (Flaschenbestand ±, datierte Zeile in fuellung_bewegungen) – aus dem SQL-Editor
--    mit Parameternamen aufrufbar, z. B.
--      select schwund_buchen(p_tenant_id => '…', p_weinausbau_id => '…', p_liter => 12.5,
--                            p_datum => current_date, p_notiz => 'Korrektur …');
--    Ein direktes UPDATE von menge_liter/bestand_flaschen wird zwar protokolliert,
--    hinterlässt aber keine datierte Bewegung im Bewegungsbuch.
--  • DELETE FROM tenants: alle Kaskaden werden protokolliert; die Protokollzeilen
--    bleiben nach dem Löschen des Mandanten stehen (tenant_id ohne FK) und werden
--    erst nach Ablauf der Aufbewahrungsfrist per
--      select bestandsprotokoll_mandant_loeschen('<tenant_id>');  -- nur Service-Role/SQL-Editor
--    entfernt. Mandanten mit Pressungen oder Verschnitten sind per DELETE FROM
--    tenants voraussichtlich nicht löschbar (pressung_behaelter/verschneidung_
--    quellen → NO ACTION, werden vor der Kaskade geprüft), ebenso Mandanten, in
--    deren Gebinden Chargen eines Partnerbetriebs liegen (Kellergemeinschaft).
--    Dann vorher explizit in der Reihenfolge oben löschen.
-- ───────────────────────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_tid UUID := 'c3d357c5-239e-4eac-85b2-4774476bc435';
BEGIN
  -- KAN-145 B4 (30.09.2026): Löschsperre im Kellerbuch – Wartung nur mit transaktionslokalem Flag für diesen Betrieb
  PERFORM set_config('s112.loeschen_erlaubt', v_tid::text, true);

  -- Sicherheitscheck: nur fortfahren, wenn der Name noch stimmt (verhindert
  -- versehentliches Löschen des falschen Mandanten, falls sich die ID mal
  -- geändert haben sollte)
  IF NOT EXISTS (
    SELECT 1 FROM tenants WHERE id = v_tid AND name = 'Weingut Johannes Gebeshuber'
  ) THEN
    RAISE EXCEPTION 'Sicherheitscheck fehlgeschlagen: Mandant % heißt nicht mehr "Weingut Johannes Gebeshuber" (oder existiert nicht mehr) - Abbruch, nichts wurde gelöscht.', v_tid;
  END IF;

  RAISE NOTICE '--- Kompletter Reset für Gebeshuber (%) ---', v_tid;

  -- ── 1. Tabellen ohne FK-Bezug zu tenants(id) - müssen VORHER weg ──────────
  DELETE FROM exportauftrag_positionen
    WHERE exportauftrag_id IN (SELECT id FROM exportauftraege WHERE tenant_id = v_tid);
  DELETE FROM export_dokumente
    WHERE exportauftrag_id IN (SELECT id FROM exportauftraege WHERE tenant_id = v_tid);
  DELETE FROM exportauftraege      WHERE tenant_id = v_tid;
  DELETE FROM sonstige_artikel     WHERE tenant_id = v_tid;
  DELETE FROM zukauf_posten        WHERE tenant_id = v_tid;
  DELETE FROM pruefnummernantraege WHERE tenant_id = v_tid;
  DELETE FROM weinbaugebiete_custom WHERE tenant_id = v_tid;
  RAISE NOTICE 'Tabellen ohne Tenant-FK bereinigt (Export, Sonstige Produkte, Zukauf, Prüfnummernanträge, eigene Weinbaugebiete)';

  -- ── 2. Der eigentliche Reset: Mandant löschen, Rest kaskadiert automatisch ─
  DELETE FROM tenants WHERE id = v_tid;
  RAISE NOTICE '--- Mandant komplett gelöscht (inkl. aller kaskadierten Daten: Kellerbuch, Chargen, Kalender, Warenlager, Verkäufe, Kosten, Kontakte/Firmen, Mitgliedschaften, Einstellungen, Rieden/Weingärten/Grundstücke) ---';

END $$;

-- ── Kontrolle: Mandant sollte weg sein, keine Zeile mehr ─────────────────────
SELECT COUNT(*) AS sollte_0_sein FROM tenants WHERE id = 'c3d357c5-239e-4eac-85b2-4774476bc435';
