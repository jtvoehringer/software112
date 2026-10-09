-- Sweep 81 (09.10.2026): Abweichungen zwischen Produktion und Staging (= Stand der Migrationen) angleichen
--
-- Katalogvergleich (scripts/katalog-abgleich.sql) über Spalten, Indizes, Constraints, Funktionen, Policies, Trigger,
-- Tabellen-/Spaltenrechte, RLS, Views, Typen, Buckets: Policies, Trigger, Constraints und Rechte identisch. Abweichend:
--   1. handle_new_user() und create_profile_on_signup() (Trigger auf auth.users): in der Produktion von Hand
--      verbessert, nie als Migration – Staging/Neuaufbau (Alt-Migration 051) legten Profile ohne ON CONFLICT bzw. ohne
--      Fehlerfang an; ein vorhandenes Profil ließ dort das Anlegen eines Benutzers scheitern. Hier die
--      Produktionsfassung (wortgleich) – in der Produktion ohne Wirkung.
--   2. user_email_connections.m365_webhook_sub_id/_expires und idx_uec_tenant_user: aus Alt-Migration 039/040, in der
--      Produktion entfernt (Webhook-Daten liegen in tenant_einstellungen; der Index doppelt den UNIQUE-Schlüssel
--      user_email_connections_tenant_id_user_id_key). Hier IF EXISTS entfernt – in der Produktion ohne Wirkung.
-- Weitere Unterschiede ohne Handlungsbedarf: 15 Funktionen nur Leerraum/Zeilenenden, 3 nur Kommentare; die Supabase-
-- Einstellung „RLS automatisch aktivieren“ (Event-Trigger ensure_rls/rls_auto_enable) ist nur in der Produktion an –
-- Dashboard-Schalter, kein Migrationsgegenstand (DB-Test 01 prüft RLS ohnehin).
-- Rollback: Funktionen auf die Fassung aus migrations_legacy/051_profiles.sql; Spalten/Index nicht nötig (ungenutzt).

BEGIN;

-- ── 1. Profil-Anlage bei neuen Benutzern (Produktionsfassung) ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO profiles (id, display_name)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
EXCEPTION WHEN OTHERS THEN
  RETURN new;  -- Fehler nie an User-Erstellung weitergeben
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_profile_on_signup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, split_part(NEW.email, '@', 1))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END;
$function$;

-- Rechte wie bisher (Migration 182: nur postgres/service_role)
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_profile_on_signup() FROM PUBLIC, anon, authenticated;

-- ── 2. Altspalten und doppelter Index auf user_email_connections ──────────────────────────────────────────────────
DROP INDEX IF EXISTS public.idx_uec_tenant_user;
ALTER TABLE public.user_email_connections
  DROP COLUMN IF EXISTS m365_webhook_sub_id,
  DROP COLUMN IF EXISTS m365_webhook_expires;

COMMIT;
