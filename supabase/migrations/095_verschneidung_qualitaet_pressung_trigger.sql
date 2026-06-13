-- Migration 095
-- 1. Qualitätsstufe der Ziel-Charge vor Verschneidung speichern → Storno-Restore
-- 2. Trigger: Weingärten aus Pressung → weinausbau_weingaerten (automatisch)

-- ── 1. Qualität-Vorher in verschneidungen ────────────────────────────────────
ALTER TABLE verschneidungen
  ADD COLUMN IF NOT EXISTS ziel_qualitaet_vorher TEXT;

COMMENT ON COLUMN verschneidungen.ziel_qualitaet_vorher IS
  'Qualitätsstufe der Ziel-Charge VOR der Verschneidung – für automatischen Restore beim Storno';

-- ── 2. Trigger: pressung_behaelter.weinausbau_id → weinausbau_weingaerten ───
CREATE OR REPLACE FUNCTION fn_sync_pressung_wg_to_weinausbau()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.weinausbau_id IS NOT NULL AND
     (OLD IS NULL OR OLD.weinausbau_id IS DISTINCT FROM NEW.weinausbau_id) THEN
    INSERT INTO weinausbau_weingaerten (tenant_id, weinausbau_id, weingarten_id)
    SELECT p.tenant_id, NEW.weinausbau_id, pw.weingarten_id
    FROM   pressungen p
    JOIN   pressung_weingaerten pw ON pw.pressung_id = p.id
    WHERE  p.id = NEW.pressung_id
      AND  pw.weingarten_id IS NOT NULL
    ON CONFLICT (weinausbau_id, weingarten_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pressung_weinausbau_weingaerten ON pressung_behaelter;
CREATE TRIGGER trg_pressung_weinausbau_weingaerten
  AFTER INSERT OR UPDATE OF weinausbau_id ON pressung_behaelter
  FOR EACH ROW EXECUTE FUNCTION fn_sync_pressung_wg_to_weinausbau();

-- Backfill: bestehende pressung_behaelter-Verknüpfungen die noch keine waw-Einträge haben
INSERT INTO weinausbau_weingaerten (tenant_id, weinausbau_id, weingarten_id)
SELECT DISTINCT p.tenant_id, pb.weinausbau_id, pw.weingarten_id
FROM   pressung_behaelter pb
JOIN   pressungen p          ON p.id  = pb.pressung_id
JOIN   pressung_weingaerten pw ON pw.pressung_id = p.id
WHERE  pb.weinausbau_id IS NOT NULL
  AND  pw.weingarten_id IS NOT NULL
  AND  NOT EXISTS (
    SELECT 1 FROM weinausbau_weingaerten x
    WHERE  x.weinausbau_id  = pb.weinausbau_id
      AND  x.weingarten_id  = pw.weingarten_id
  )
ON CONFLICT (weinausbau_id, weingarten_id) DO NOTHING;
