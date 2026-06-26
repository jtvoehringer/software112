-- Migration 129: Skonto-Felder für firmen + kontakte
-- skonto_pct und skonto_tage wurden im Code referenziert aber nie migriert

ALTER TABLE firmen
  ADD COLUMN IF NOT EXISTS skonto_pct  numeric(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skonto_tage integer       DEFAULT 10;

ALTER TABLE kontakte
  ADD COLUMN IF NOT EXISTS skonto_pct  numeric(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skonto_tage integer       DEFAULT 10;
