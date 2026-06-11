-- Migration 074: Profiles – Backfill display_name + RLS öffnen
-- Problem: Migration 051 hat falsche Spaltennamen (user_id/full_name statt id/display_name)
--          → Backfill ist fehlgeschlagen, display_name bleibt NULL
-- Fix:
--   1. Fehlende Profile anlegen (Schema 005: id = auth.users.id)
--   2. NULL display_names mit Email-Präfix befüllen
--   3. profiles_read_all Policy: alle eingeloggten User sehen alle Profile

-- 1. Fehlende Profile einfügen + vorhandene NULL-display_names aktualisieren
INSERT INTO profiles (id, display_name)
SELECT
  u.id,
  COALESCE(
    NULLIF(u.raw_user_meta_data->>'display_name', ''),
    NULLIF(u.raw_user_meta_data->>'name',         ''),
    NULLIF(u.raw_user_meta_data->>'full_name',    ''),
    split_part(u.email, '@', 1)
  )
FROM auth.users u
ON CONFLICT (id) DO UPDATE
  SET display_name = COALESCE(
    NULLIF(profiles.display_name, ''),
    NULLIF(EXCLUDED.display_name, ''),
    split_part((SELECT email FROM auth.users WHERE id = profiles.id), '@', 1)
  );

-- 2. RLS: alle eingeloggten User dürfen Profile lesen (für Klarname-Anzeige)
DROP POLICY IF EXISTS "profiles_read_all"                    ON profiles;
DROP POLICY IF EXISTS "profiles: tenant members can see each other" ON profiles;

CREATE POLICY "profiles_read_all" ON profiles
  FOR SELECT USING (auth.uid() IS NOT NULL);
