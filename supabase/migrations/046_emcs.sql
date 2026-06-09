-- Migration 046: EMCS – Tracking von ARC-Nummern und e-AD Status
-- Minimale Integration: Datenerfassung + XML-Export (keine direkte API-Anbindung)

ALTER TABLE exportauftraege
  ADD COLUMN IF NOT EXISTS emcs_arc_nummer  text,        -- Administrative Reference Code
  ADD COLUMN IF NOT EXISTS emcs_status      varchar(20), -- draft/submitted/accepted/cancelled
  ADD COLUMN IF NOT EXISTS emcs_datum       date;        -- Datum der EMCS-Übermittlung
