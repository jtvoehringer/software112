-- Rückmeldung 24.8.2026: drei zusätzliche Nutzarten für Grundstücke (GLÖZ =
-- Grundlegende Landwirtschaftliche und Ökologische Zustands-Anforderungen
-- lt. GAP-Konditionalität):
--   GL1 - GLÖZ Rain / Böschung / Trockensteinmauer
--   GL2 - GLÖZ Hecke / Ufergehölz
--   GL3 - GLÖZ Feldgehölz / Baum- / Gebüschgruppe
--
-- Erweitert den CHECK-Constraint aus Migration 170_ried_ama_codes_gst_nutzart.sql
-- (bisher nur 'A' | 'G' | 'WI') um die drei neuen Werte.

ALTER TABLE grundstuecke
  DROP CONSTRAINT IF EXISTS grundstuecke_nutzart_check;

ALTER TABLE grundstuecke
  ADD CONSTRAINT grundstuecke_nutzart_check
    CHECK (nutzart IS NULL OR nutzart IN ('A', 'G', 'WI', 'GL1', 'GL2', 'GL3'));
