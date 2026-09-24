-- Rückmeldung 24.8.2026: zusätzliche Nutzart "LSE - LSE Bäume / Büsche"
-- (Landschaftselement) für Grundstücke, inkl. zusätzlichem Stückzahl-Feld
-- (Anzahl Bäume/Büsche), das nur bei dieser Nutzart im Formular erscheint.

ALTER TABLE grundstuecke ADD COLUMN IF NOT EXISTS lse_stueckzahl INTEGER;

ALTER TABLE grundstuecke
  DROP CONSTRAINT IF EXISTS grundstuecke_nutzart_check;

ALTER TABLE grundstuecke
  ADD CONSTRAINT grundstuecke_nutzart_check
    CHECK (nutzart IS NULL OR nutzart IN ('A', 'G', 'WI', 'GL1', 'GL2', 'GL3', 'LSE'));
