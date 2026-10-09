-- @bereich: Profil-Anlage bei neuen Benutzern (Sweep 81) – Trigger auf auth.users wie in der Produktion
-- @ziel: handle_new_user() (und create_profile_on_signup()) legen das Profil an, ohne das Anlegen eines Benutzers je
-- @ziel: scheitern zu lassen (ON CONFLICT + Fehlerfang); ein neuer Benutzer bekommt ein Profil mit dem Namensteil der E-Mail.
-- @mutation ohne_konflikt: handle_new_user in der alten Fassung aus Migration 051 (ohne ON CONFLICT, ohne Fehlerfang) | rot: hnu_konflikt|hnu_fehlerfang
-- @mutation profil_weg: handle_new_user legt kein Profil mehr an | rot: profil_angelegt
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 79 (Stand 09.10.2026). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '79_profil_anlage';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_src   text;
  v_uid   uuid;
  v_n     bigint;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  PERFORM pg_temp.s112_mutiere('ohne_konflikt', $m$
    CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
      SET search_path TO 'public' AS $f$
    begin
      insert into profiles (id, display_name)
      values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
      return new;
    end;
    $f$$m$);
  PERFORM pg_temp.s112_mutiere('profil_weg', $m$
    CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
      SET search_path TO 'public' AS $f$ BEGIN RETURN NEW; END; $f$$m$);

  -- ── 1. Fassung: Konflikt und Fehler dürfen das Anlegen eines Benutzers nie verhindern ─────────────────────────────
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.handle_new_user'::regproc;
  v_erg := v_erg || pg_temp.s112_erwarte('hnu_konflikt', v_src ~* 'ON CONFLICT \(id\) DO NOTHING', true);
  v_erg := v_erg || pg_temp.s112_erwarte('hnu_fehlerfang', v_src ~* 'EXCEPTION WHEN OTHERS', true);
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.create_profile_on_signup'::regproc;
  v_erg := v_erg || pg_temp.s112_erwarte('cpos_fehlerfang', v_src ~* 'ON CONFLICT DO NOTHING' AND v_src ~* 'EXCEPTION WHEN OTHERS', true);

  -- ── 2. Neuer Benutzer: Profil (profiles.id = Benutzer-ID) mit dem Namensteil der E-Mail ──────────────────────────
  --    create_profile_on_signup schreibt nur user_id ohne id (Pflichtfeld) und scheitert still – das Profil legt
  --    handle_new_user an (Produktion: alle Profile über id, user_id leer)
  v_uid := pg_temp.s112_benutzer(NULL, NULL);
  SELECT count(*) INTO v_n FROM public.profiles
   WHERE id = v_uid AND display_name = 's112test-' || v_uid;
  v_erg := v_erg || pg_temp.s112_erwarte('profil_angelegt', v_n >= 1, true);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 4);
END $test$;
