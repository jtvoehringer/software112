-- Migration 102: KMW-Grad auf Pressungen
-- Klosterneuburger Mostwaage (°KMW) zur automatischen Qualitätsableitung

ALTER TABLE pressungen
  ADD COLUMN IF NOT EXISTS kmw_grad numeric(4,1);

COMMENT ON COLUMN pressungen.kmw_grad IS
  'Klosterneuburger Mostwaage in °KMW – Basis für automatische Qualitätsableitung nach österreichischem Weingesetz';
