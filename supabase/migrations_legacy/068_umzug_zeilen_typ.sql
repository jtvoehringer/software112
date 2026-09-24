-- Migration 068: Umzug n:n – zeilen_typ für Quelle/Ziel-Unterscheidung
-- 'transfer' = altes Format (1:n, rückwärtskompatibel)
-- 'quelle'   = neues Format Quell-Zeile  (von_weinausbau_id, von_behaelter_id, brutto_liter)
-- 'ziel'     = neues Format Ziel-Zeile   (nach_behaelter_id, nach_weinausbau_id, menge_liter)

ALTER TABLE keller_umzuege
  ADD COLUMN IF NOT EXISTS zeilen_typ TEXT DEFAULT 'transfer';

-- Bestehende Zeilen als 'transfer' kennzeichnen
UPDATE keller_umzuege SET zeilen_typ = 'transfer' WHERE zeilen_typ IS NULL;

-- nach_behaelter_id und von_weinausbau_id müssen nullable sein
-- (quelle-Zeilen haben kein nach_behaelter, ziel-Zeilen haben kein von_weinausbau)
ALTER TABLE keller_umzuege ALTER COLUMN nach_behaelter_id DROP NOT NULL;
ALTER TABLE keller_umzuege ALTER COLUMN von_weinausbau_id DROP NOT NULL;
