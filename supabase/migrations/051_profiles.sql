-- Migration 051: User-Profile
-- Klarname, Avatar, Kontaktdaten pro User (mandantenübergreifend)

CREATE TABLE IF NOT EXISTS profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name       text,
  avatar_url      text,
  telefon         text,
  erstellt_am     timestamptz DEFAULT now(),
  aktualisiert_am timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Jeder User sieht/ändert nur sein eigenes Profil
CREATE POLICY "profiles_own" ON profiles
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Alle angemeldeten User sehen Profile (für Klarname-Anzeige im Kalender etc.)
CREATE POLICY "profiles_read_all" ON profiles FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Trigger: Profil automatisch beim ersten Login anlegen
CREATE OR REPLACE FUNCTION create_profile_on_signup()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (user_id, full_name)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    )
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION create_profile_on_signup();

-- Bestehende User: Profile nachträglich anlegen
INSERT INTO profiles (user_id, full_name)
SELECT id, COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', split_part(email, '@', 1))
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;
