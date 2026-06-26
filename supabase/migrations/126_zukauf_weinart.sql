-- Migration 126: weinart in zukauf_posten
ALTER TABLE zukauf_posten
  ADD COLUMN IF NOT EXISTS weinart text
    CHECK (weinart IN ('rot', 'weiss', 'rose', 'unbekannt'))
    DEFAULT 'unbekannt';

-- Backfill: weinart von verknüpfter weinausbau-Charge übernehmen
UPDATE zukauf_posten zp
SET    weinart = wa.weinart
FROM   weinausbau wa
WHERE  zp.ziel_weinausbau_id = wa.id
  AND  wa.weinart IS NOT NULL
  AND  wa.weinart != 'unbekannt';
