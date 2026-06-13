-- Migration 094: Konzentration – Spaltentyp fix
-- numeric(6,4) erlaubt max 2 Stellen vor dem Komma (→ max 99.9999)
-- Konzentration als % eingegeben (0–100), daher Overflow bei 100.
-- Neu: numeric(5,2) = max 999.99 % – deckt alle realen Anwendungsfälle.

ALTER TABLE behandlungen
  ALTER COLUMN konzentration TYPE numeric(5,2);

COMMENT ON COLUMN behandlungen.konzentration IS
  'Konzentration in Prozent (0–100), z.B. 0.5 für 0,5 % oder 50 für 50 %';
