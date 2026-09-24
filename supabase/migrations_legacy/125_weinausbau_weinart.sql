-- Migration 125: Weinart auf weinausbau
-- rot | weiss | rose | unbekannt
-- Wird bei Pressung automatisch aus den verknüpften Weingärten abgeleitet.

ALTER TABLE weinausbau
  ADD COLUMN IF NOT EXISTS weinart text
    CHECK (weinart IN ('rot', 'weiss', 'rose', 'unbekannt'))
    DEFAULT 'unbekannt';

COMMENT ON COLUMN weinausbau.weinart IS 'Weinfarbe: rot | weiss | rose | unbekannt';

-- Bestehende Chargen: Weinart aus verknüpftem Weingarten ableiten (weinausbau.weingarten_id)
UPDATE weinausbau wa
SET    weinart = wg.weinart
FROM   weingarten wg
WHERE  wa.weingarten_id = wg.id
  AND  wg.weinart IS NOT NULL
  AND  wg.weinart != 'unbekannt';
