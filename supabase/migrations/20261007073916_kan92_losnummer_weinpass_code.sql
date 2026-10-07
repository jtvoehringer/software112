-- KAN-92 (07.10.2026): Los-/Chargennummer der Füllung eindeutig je Betrieb, Weinpass mandantensicher.
--
-- Entscheidung Jörgen (06.10.2026, Kommentar): Jede Füllung trägt eine Losnummer (= Chargennummer der Füllung); die
-- Prüfnummer ist die Klammer, ein Wein kann über mehrere Lose gefüllt werden – auf den Belegen stehen PN, Los und Datum.
--  1. UNIQUE (tenant_id, chargennummer) – Stand Produktion 07.10.2026: keine Duplikate je Betrieb (CH-2026-004 gibt es
--     in zwei Betrieben, das bleibt erlaubt). Füllungen ohne Nummer (Sandbox-Eröffnungsbestand) bleiben ohne.
--     Unveränderlich ist die Nummer schon durch die Freeze-Sperre a_freeze (KAN-101, Positivliste ohne chargennummer).
--  2. fuellungen.weinpass_code: global eindeutiger, zufälliger Code (12 Hex-Zeichen) für die öffentliche Weinpass-URL
--     /w/<weinpass_code>; Bestand wird beim Anlegen der Spalte befüllt (volatiler Default je Zeile). Durch die
--     Positivliste von a_freeze ist auch der Code nach dem Speichern unveränderlich.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- 1. Los-/Chargennummer eindeutig je Betrieb ─────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX fuellungen_chargennummer_eindeutig ON public.fuellungen (tenant_id, chargennummer)
  WHERE chargennummer IS NOT NULL;
COMMENT ON INDEX public.fuellungen_chargennummer_eindeutig IS
  'KAN-92: Los-/Chargennummer der Füllung je Betrieb eindeutig (Loskennzeichnung RL 2011/91/EU)';

-- 2. Weinpass-Code ───────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.fuellungen
  ADD COLUMN weinpass_code text NOT NULL DEFAULT lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
    CHECK (weinpass_code ~ '^[0-9a-f]{12}$');
ALTER TABLE public.fuellungen ADD CONSTRAINT fuellungen_weinpass_code_eindeutig UNIQUE (weinpass_code);
COMMENT ON COLUMN public.fuellungen.weinpass_code IS
  'KAN-92: zufälliger, global eindeutiger Code der öffentlichen Weinpass-URL /w/<weinpass_code> (statt der nur je Betrieb eindeutigen Chargennummer)';
