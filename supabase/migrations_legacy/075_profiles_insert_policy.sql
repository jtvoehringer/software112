-- Migration 075: profiles – INSERT-Policy + eigene Update-Policy ergänzen
-- Problem: Migration 005 hat SELECT + UPDATE, aber keine INSERT-Policy
--          → upsert schlägt lautlos fehl wenn kein Profil-Zeile existiert

-- INSERT: User darf eigenes Profil anlegen (id = auth.users.id)
DROP POLICY IF EXISTS "profiles: insert own" ON profiles;
CREATE POLICY "profiles: insert own"
  ON profiles FOR INSERT
  WITH CHECK (id = auth.uid());

-- UPDATE: WITH CHECK ergänzen (war vorher nur USING)
DROP POLICY IF EXISTS "profiles: update own" ON profiles;
CREATE POLICY "profiles: update own"
  ON profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Fehlende Profile für bestehende User anlegen (Fallback falls 074 nicht lief)
INSERT INTO profiles (id, display_name)
SELECT
  u.id,
  COALESCE(
    NULLIF(u.raw_user_meta_data->>'display_name', ''),
    NULLIF(u.raw_user_meta_data->>'name', ''),
    split_part(u.email, '@', 1)
  )
FROM auth.users u
ON CONFLICT (id) DO UPDATE
  SET display_name = COALESCE(
    NULLIF(profiles.display_name, ''),
    NULLIF(EXCLUDED.display_name, '')
  );
