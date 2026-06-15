-- Migration 103: Zolltarifnummer (KN-Code) auf Füllungen
-- Interne Metadaten für Weinexport – wird nicht gedruckt

ALTER TABLE fuellungen
  ADD COLUMN IF NOT EXISTS zolltarifnummer varchar(20);

COMMENT ON COLUMN fuellungen.zolltarifnummer IS
  'KN-Code (Kombinierte Nomenklatur) für den Weinexport, z.B. 22042179. Quelle: Punkt 5.3 ÖWM-Begleitdokumente. Nur intern – wird nicht auf Dokumenten aufgedruckt.';
