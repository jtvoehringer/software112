-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 072: Pressung Weingärten – Lese-Datum + KMW
-- Ergänzt pressung_weingaerten um Erntedatum und KMW (Klosterneuburger Mostwaage)
-- KMW = österreichischer Standard (nicht Oechsle = DE)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE pressung_weingaerten
  ADD COLUMN IF NOT EXISTS ernte_datum DATE,
  ADD COLUMN IF NOT EXISTS kmw         NUMERIC(5,2);  -- Klosterneuburger Mostwaage (°KMW)

COMMENT ON COLUMN pressung_weingaerten.ernte_datum IS 'Lesedatum für diesen Weingarten/diese Parzelle';
COMMENT ON COLUMN pressung_weingaerten.kmw         IS 'Mostgewicht in °KMW (Klosterneuburger Mostwaage)';
