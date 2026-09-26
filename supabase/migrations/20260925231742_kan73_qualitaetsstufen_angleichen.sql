-- ─────────────────────────────────────────────────────────────────────────────
-- kan73_qualitaetsstufen_angleichen (KAN-73, 26.09.2026)
--
-- Zweck: Qualitätsstufen der Lese und der Füllung an die Auswahllisten der App angleichen
-- (Bug: Lese scheiterte mit 23514, „Wein“ war bei Lese und Füllung nicht speicherbar).
--
--   1. ernte_parzellen_qualitaetsstufe_check – genau die Lese-Liste LESE_QUALITAETEN
--      (src/lib/wein/qualitaet.ts), einheitlich 'wein' statt 'tafelwein' (wie weinausbau,
--      fuellungen und das BKI-Kürzel WEI). Die Lese kennt nur die Mostgewichts-Stufen:
--        wein, landwein, qualitaetswein, kabinett, spaetlese, auslese, beerenauslese,
--        trockenbeerenauslese, eiswein
--      Strohwein und Ausbruch bleiben vorerst draußen (Entscheidung nach AP0/KAN-38);
--      DAC, Reserve, Erste Lage, Großes Gewächs, Sekt, Perlwein und Sonstiges sind keine
--      Lese-Stufen – sie werden bei Charge bzw. Füllung vergeben.
--   2. fuellungen_qualitaet_check – um 'wein' und 'ausbruch' ergänzt, damit dieselben
--      18 Werte wie weinausbau_qualitaetsstufe_check (FUELLUNG_QUALITAETEN = QUALITAET_OPTS);
--      vorher ließ sich eine Charge „Wein“ oder „Ausbruch“ nicht abfüllen.
--   weinausbau_qualitaetsstufe_check (Migration 065) bleibt unverändert.
--
-- Datenstand 25.09.2026 (live geprüft): 0 betroffene Zeilen – in keiner Qualitätsspalte kommt
-- 'tafelwein', 'wein' oder 'ausbruch' vor; ernte_parzellen enthält nur 'qualitaetswein'
-- (15 Zeilen), fuellungen nur qualitaetswein/dac/reserve/sekt. Die neuen CHECKs werden
-- trotzdem gegen den Bestand geprüft (kein NOT VALID).
-- NULL-Semantik wie bisher: „x IN (…)“ ist bei NULL nicht false – ernte_parzellen.qualitaetsstufe
-- bleibt optional; fuellungen.qualitaet ist unabhängig davon NOT NULL (Default 'qualitaetswein').
-- Namen wie bisher (auto-benannt aus migrations_legacy 009 bzw. 022), damit die deutschen
-- Meldungen in src/lib/fehler.ts (PRUEFREGEL_MELDUNG) weiter greifen.
-- Keine Funktionen, Policies oder Rechte betroffen.
-- Sperren: DROP/ADD CONSTRAINT holen ACCESS EXCLUSIVE auf ernte_parzellen und fuellungen (klein,
-- der Prüf-Scan ist kurz). lock_timeout wie bei KAN-5: hält eine lange Transaktion eine Sperre,
-- bricht die Migration nach 5 s ab, statt alle folgenden Zugriffe hinter sich zu stauen.
-- Rollback-Test (DO-Block mit RAISE EXCEPTION, 26.09.2026): 45 Werte gespeichert, 12 Negativtests
-- mit 23514 abgelehnt, Kette Lese → Pressung → Charge → Füllung „wein“ in der Sandbox.
-- Test: scripts/tests/qualitaet.test.mjs liest diese Datei und vergleicht mit den App-Listen.
-- Reihenfolge: erst diese Migration, dann der Code (der Code schreibt bei der Lese 'wein').
-- ─────────────────────────────────────────────────────────────────────────────

SET LOCAL lock_timeout = '5s';

-- 1. Lese (ernte_parzellen)
ALTER TABLE public.ernte_parzellen
  DROP CONSTRAINT IF EXISTS ernte_parzellen_qualitaetsstufe_check;

ALTER TABLE public.ernte_parzellen
  ADD CONSTRAINT ernte_parzellen_qualitaetsstufe_check
  CHECK (qualitaetsstufe IN (
    'wein', 'landwein', 'qualitaetswein',
    'kabinett', 'spaetlese', 'auslese', 'beerenauslese',
    'trockenbeerenauslese', 'eiswein'
  ));

COMMENT ON CONSTRAINT ernte_parzellen_qualitaetsstufe_check ON public.ernte_parzellen IS
  'KAN-73: nur Mostgewichts-Stufen der Lese (= LESE_QUALITAETEN in src/lib/wein/qualitaet.ts), wein statt tafelwein; Strohwein/Ausbruch vorerst nicht (KAN-38); NULL erlaubt';

-- 2. Füllung (fuellungen)
ALTER TABLE public.fuellungen
  DROP CONSTRAINT IF EXISTS fuellungen_qualitaet_check;

ALTER TABLE public.fuellungen
  ADD CONSTRAINT fuellungen_qualitaet_check
  CHECK (qualitaet IN (
    'wein', 'landwein', 'qualitaetswein',
    'kabinett', 'spaetlese', 'auslese', 'beerenauslese', 'ausbruch',
    'trockenbeerenauslese', 'eiswein', 'strohwein',
    'dac', 'reserve', 'erste_lage', 'grosses_gewachs',
    'sekt', 'perlwein', 'sonstiges'
  ));

COMMENT ON CONSTRAINT fuellungen_qualitaet_check ON public.fuellungen IS
  'KAN-73: alle 18 Stufen wie weinausbau_qualitaetsstufe_check (= FUELLUNG_QUALITAETEN in src/lib/wein/qualitaet.ts), jetzt inkl. wein und ausbruch';
