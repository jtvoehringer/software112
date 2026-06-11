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
