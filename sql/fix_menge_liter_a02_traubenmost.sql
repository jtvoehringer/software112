-- ═══════════════════════════════════════════════════════════════════════════════
-- software:112 – Gezielter Menge-Fix
-- A02 Zierfandler 2024 + Traubenmost Immervoll 002
--
-- Diagnose-Ergebnis vom 2026-06-11:
--   0d7481ae  Zierfandler A02       ist=7960   soll laut Bewegungen=9960
--   cbd39208  Traubenmost Imm.002   ist=900    soll laut Formel    = 890
--
-- Ursache A02: fix_umzug_c03d3c6b.sql hat nach_weinausbau_id nachträglich
--   eingetragen → Reconciliation-Formel zählt +4200 L doppelt.
--   Bewegungen-Page (per-Behälter) zeigt 9960 – das ist der korrekte Wert.
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
--  • Historischer Einzel-Fix (11.06.2026). Heute: Minderung über schwund_buchen(...),
--    nicht per UPDATE.
-- ───────────────────────────────────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Schritt 1: Vorher-Werte prüfen ──────────────────────────────────────────
SELECT
  id,
  name,
  jahrgang,
  behaelter_id,
  menge_liter AS menge_liter_vorher
FROM weinausbau
WHERE id IN (
  '0d7481ae-0fe6-4fdd-85d2-0ec7aee78255',   -- Zierfandler A02
  'cbd39208-bbc3-4d28-a116-cc48689bad29'    -- Traubenmost Immervoll 002
);


-- ── Schritt 2: UPDATE (auskommentiert – erst nach Sicht-Prüfung ausführen) ──

/*

UPDATE weinausbau
SET menge_liter = CASE
  WHEN id = '0d7481ae-0fe6-4fdd-85d2-0ec7aee78255' THEN 9960.00   -- A02 Zierfandler: Bewegungen-Page Wert
  WHEN id = 'cbd39208-bbc3-4d28-a116-cc48689bad29' THEN  890.00   -- Traubenmost: Formel-Wert
END
WHERE id IN (
  '0d7481ae-0fe6-4fdd-85d2-0ec7aee78255',
  'cbd39208-bbc3-4d28-a116-cc48689bad29'
)
  AND tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471';

*/


-- ── Schritt 3: Nachher-Werte prüfen (nach dem UPDATE ausführen) ─────────────
/*

SELECT
  id,
  name,
  jahrgang,
  menge_liter AS menge_liter_nachher
FROM weinausbau
WHERE id IN (
  '0d7481ae-0fe6-4fdd-85d2-0ec7aee78255',
  'cbd39208-bbc3-4d28-a116-cc48689bad29'
);

*/
