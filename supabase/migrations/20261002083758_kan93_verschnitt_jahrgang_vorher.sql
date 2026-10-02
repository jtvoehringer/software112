-- KAN-93 (02.10.2026): Verschnitt bestimmt Rebsorte UND Jahrgang der Ziel-Charge aus den tatsächlichen Anteilen
-- (85-%-Regel). Damit der Storno den Jahrgang wiederherstellen kann, bekommt der Verschnitt – wie schon
-- ziel_qualitaet_vorher, ziel_herkunft_code_vorher, ziel_rebsorte_vorher (KAN-145) und ziel_kmw_vorher (KAN-128) –
-- eine Momentaufnahme des Jahrgangs. Ältere Verschnitte bleiben NULL (Storno lässt den Jahrgang dann unverändert;
-- ein Verschnitt gibt einer Charge ohne Jahrgang nie einen).

ALTER TABLE public.verschneidungen ADD COLUMN IF NOT EXISTS ziel_jahrgang_vorher integer;

COMMENT ON COLUMN public.verschneidungen.ziel_jahrgang_vorher IS
  'Jahrgang der Ziel-Charge VOR der Verschneidung – für den Restore beim Storno (KAN-93).';