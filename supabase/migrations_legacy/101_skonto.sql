-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 101: Skonto auf kontakte/firmen + Snapshot auf verkaufsposten
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE kontakte
  ADD COLUMN IF NOT EXISTS skonto_pct      numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skonto_tage     smallint     NOT NULL DEFAULT 10;

ALTER TABLE firmen
  ADD COLUMN IF NOT EXISTS skonto_pct      numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skonto_tage     smallint     NOT NULL DEFAULT 10;

-- Snapshot auf Rechnungsebene (wird beim Anlegen vom Kundenstamm übernommen)
ALTER TABLE verkaufsposten
  ADD COLUMN IF NOT EXISTS skonto_pct      numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skonto_tage     smallint     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skonto_aktiv    boolean      NOT NULL DEFAULT false;

COMMENT ON COLUMN kontakte.skonto_pct       IS 'Skonto in % (z. B. 2.00 für 2 %)';
COMMENT ON COLUMN kontakte.skonto_tage      IS 'Skonto-Frist in Tagen';
COMMENT ON COLUMN firmen.skonto_pct         IS 'Skonto in % (z. B. 2.00 für 2 %)';
COMMENT ON COLUMN firmen.skonto_tage        IS 'Skonto-Frist in Tagen';
COMMENT ON COLUMN verkaufsposten.skonto_pct  IS 'Skonto-Snapshot vom Kundenstamm bei Rechnungsanlage';
COMMENT ON COLUMN verkaufsposten.skonto_tage IS 'Skonto-Frist in Tagen';
COMMENT ON COLUMN verkaufsposten.skonto_aktiv IS 'Skonto auf dieser Rechnung aktiv (abwählbar)';
