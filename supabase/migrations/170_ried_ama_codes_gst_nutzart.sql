-- Migration 170: Ried-Stammdaten erweitern (AMA-Feldstücknr., Codes) + GST-Nutzart
--
-- 1) weingarten (Ried): neue Felder "AMA-Feldstücknr." und "Codes" (z.B.
--    "EOP,PSMBIO" - Auflagencodes lt. AMA Mehrfachantrag, EOP = Einsatz von
--    Organismen und Pheromonen, PSMBIO = Einsatz von Pflanzenschutzmitteln
--    laut Bio-Verordnung), analog zum bereits bestehenden ama_feldnummer auf
--    grundstuecke, jetzt aber auf Ried-Ebene erfassbar.
--
-- 2) grundstuecke: neues Feld "nutzart" (AMA-Nutzungsart je Grundstück:
--    A = Grünbrache, G = Grünlandbrache, WI = Wein). Bewusst NULLABLE
--    (kein NOT NULL) statt hartem DB-Constraint, da es sich um ein komplett
--    neues Feld ohne Bestandsdaten handelt und es keine sinnvolle 1:1-
--    Ableitung aus dem bestehenden "status"-Feld gibt (status steuert
--    weiterhin Ernte-/Behandlungs-/Zukauf-Logik, siehe grundstueckStatus.tsx
--    und die zahlreichen .eq('status','aktiv')-Stellen im Code - NICHT
--    angetastet). "Nutzart" ist im UI als Pflichtfeld (required) für neue
--    bzw. bearbeitete Grundstücke umgesetzt; bestehende Grundstücke bleiben
--    bis zur manuellen Nacherfassung mit nutzart = NULL.

ALTER TABLE weingarten
  ADD COLUMN IF NOT EXISTS ama_feldnummer text,
  ADD COLUMN IF NOT EXISTS codes text;

ALTER TABLE grundstuecke
  ADD COLUMN IF NOT EXISTS nutzart text;

ALTER TABLE grundstuecke
  DROP CONSTRAINT IF EXISTS grundstuecke_nutzart_check;

ALTER TABLE grundstuecke
  ADD CONSTRAINT grundstuecke_nutzart_check
    CHECK (nutzart IS NULL OR nutzart IN ('A', 'G', 'WI'));
