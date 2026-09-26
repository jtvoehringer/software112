-- ════════════════════════════════════════════════════════════════════════════════════════════
-- KAN-136 · Zwei-Faktor-Stufe (aal2) auch in der Datenbank durchsetzen
-- Eingespielt 26.09.2026 nach Probelauf (Staging + Produktion, zurückgerollt) und Jörgens Freigabe.
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- BEFUND
--   aal2 prüften bisher nur der Next-Proxy (src/proxy.ts) und pruefeZweiFaktor()
--   (src/lib/api/zweiFaktor.ts). Wer nur das Passwort kennt, holt sich per signInWithPassword mit
--   dem öffentlichen Anon-Key ein aal1-JWT und liest/schreibt per PostgREST, RPC und Storage alles,
--   was RLS erlaubt.
--
-- REGEL (identisch mit hatBestaetigtenFaktor() + currentLevel in src/proxy.ts)
--   Hat der Benutzer einen bestätigten Faktor (auth.mfa_factors.status = 'verified'), gilt seine
--   Sitzung erst ab JWT-Claim aal = 'aal2'. Benutzer ohne bestätigten Faktor: unverändert.
--   Die Zwei-Faktor-PFLICHT bleibt bewusst App-Sache: ohne Faktor kann sich ein Angreifer mit
--   aal1 selbst einen einrichten – eine DB-Sperre brächte keinen Schutz.
--
-- UMSETZUNG
--   1. public.s112_aal_ok()        – zentrale Prüfung (STABLE, SECURITY DEFINER wegen auth.mfa_factors)
--   2. Policy zwei_faktor_aal      – RESTRICTIVE, TO authenticated, auf JEDER Tabelle in public mit RLS
--   3. Policy zwei_faktor_aal      – auf storage.objects (alle Buckets)
--   4. pruefe_tenant_zugriff()     – zusätzlich aal-Prüfung (SECURITY-DEFINER-RPCs umgehen RLS)
--   5. PostgREST-Pre-Request       – public.s112_pre_request() lehnt jeden Data-API-Aufruf einer
--                                    aal1-Sitzung mit Faktor ab (HTTP 401); deckt auch RPCs mit
--                                    eigener Mitgliedsprüfung ab.
--
-- NOTFALL (Aussperren, z. B. Auth-Störung liefert kein aal2): EIN Statement schaltet 1–5 ab –
--   CREATE OR REPLACE FUNCTION public.s112_aal_ok() RETURNS boolean LANGUAGE sql STABLE
--     SECURITY DEFINER SET search_path = public AS $f$ SELECT true $f$;
--   Nur den Pre-Request abschalten:
--   ALTER ROLE authenticator RESET pgrst.db_pre_request; NOTIFY pgrst, 'reload config';
--
-- ROLLBACK (vollständig)
--   ALTER ROLE authenticator RESET pgrst.db_pre_request; NOTIFY pgrst, 'reload config';
--   DO $r$ DECLARE r record; BEGIN
--     FOR r IN SELECT schemaname, tablename FROM pg_policies WHERE policyname = 'zwei_faktor_aal' LOOP
--       EXECUTE format('DROP POLICY zwei_faktor_aal ON %I.%I', r.schemaname, r.tablename);
--     END LOOP; END $r$;
--   pruefe_tenant_zugriff ohne den KAN-136-Block neu anlegen,
--   DROP FUNCTION public.s112_pre_request(); DROP FUNCTION public.s112_aal_ok();
--
-- NEUE TABELLEN: bekommen zwei_faktor_aal wie in Abschnitt 2 (Prüfabfrage am Ende).
-- ════════════════════════════════════════════════════════════════════════════════════════════

SET LOCAL lock_timeout = '5s';


-- ── 1. Zentrale Prüfung ─────────────────────────────────────────────────────────────────────
-- CASE statt OR: garantiert, dass aal2-Sitzungen (Normalfall) auth.mfa_factors nie lesen.
CREATE OR REPLACE FUNCTION public.s112_aal_ok()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN coalesce((SELECT auth.jwt()) ->> 'aal', 'aal1') = 'aal2' THEN true
    WHEN (SELECT auth.uid()) IS NULL THEN true
    ELSE NOT EXISTS (
      SELECT 1 FROM auth.mfa_factors f
       WHERE f.user_id = (SELECT auth.uid())
         AND f.status = 'verified'
    )
  END
$$;
COMMENT ON FUNCTION public.s112_aal_ok() IS
  'KAN-136: false, wenn der Benutzer einen bestätigten Zwei-Faktor hat, die Sitzung aber nur aal1 ist. Grundlage der Policies zwei_faktor_aal, von pruefe_tenant_zugriff und s112_pre_request.';
REVOKE EXECUTE ON FUNCTION public.s112_aal_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_aal_ok() TO authenticated, service_role;


-- ── 2. RESTRICTIVE Policy auf allen Tabellen in public mit RLS ─────────────────────────────
DO $$
DECLARE
  r        record;
  v_anzahl int := 0;
  v_fehlt  text;
BEGIN
  FOR r IN
    SELECT c.relname::text AS t
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND c.relrowsecurity
     ORDER BY 1
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS zwei_faktor_aal ON public.%I', r.t);
    EXECUTE format(
      'CREATE POLICY zwei_faktor_aal ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      'USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()))', r.t);
    v_anzahl := v_anzahl + 1;
  END LOOP;

  SELECT string_agg(c.relname::text, ', ') INTO v_fehlt
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND c.relrowsecurity
     AND NOT EXISTS (SELECT 1 FROM pg_policies p
                      WHERE p.schemaname = 'public' AND p.tablename = c.relname
                        AND p.policyname = 'zwei_faktor_aal' AND p.permissive = 'RESTRICTIVE'
                        AND p.roles = '{authenticated}' AND p.cmd = 'ALL');
  IF v_fehlt IS NOT NULL THEN
    RAISE EXCEPTION 'KAN-136: zwei_faktor_aal fehlt auf: %', v_fehlt;
  END IF;
  RAISE NOTICE 'KAN-136: zwei_faktor_aal auf % Tabellen', v_anzahl;
END
$$;


-- ── 3. Storage ──────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS zwei_faktor_aal ON storage.objects;
CREATE POLICY zwei_faktor_aal ON storage.objects
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok()))
  WITH CHECK ((SELECT public.s112_aal_ok()));


-- ── 4. pruefe_tenant_zugriff: aal-Prüfung für SECURITY-DEFINER-RPCs ────────────────────────
-- Nur ersetzen, wenn der Rumpf dem geprüften Stand entspricht (Staging LF / Produktion CRLF).
DO $$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pruefe_tenant_zugriff'
     AND pg_get_function_identity_arguments(p.oid) = 'p_tenant_id uuid, p_rollen text[]';
  IF v_md5 IS NULL THEN
    RAISE EXCEPTION 'KAN-136: pruefe_tenant_zugriff(uuid, text[]) nicht gefunden';
  ELSIF v_md5 IN ('7e7fa6786e3ae7995a85fe9e3012aa11', '328248aae50aa3f01a6b4588e7488a1b') THEN
    NULL;                                   -- Stand vor KAN-136 → wird unten ersetzt
  ELSIF position('KAN-136' IN (SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                                WHERE n.nspname = 'public' AND p.proname = 'pruefe_tenant_zugriff')) > 0 THEN
    NULL;                                   -- bereits eingespielt (idempotent)
  ELSE
    RAISE EXCEPTION 'KAN-136: pruefe_tenant_zugriff weicht vom geprüften Stand ab (md5 %) – Rumpf vergleichen', v_md5;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.pruefe_tenant_zugriff(p_tenant_id uuid, p_rollen text[] DEFAULT NULL::text[])
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.ist_service_kontext() THEN
    RETURN;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nicht angemeldet' USING ERRCODE = '42501';
  END IF;

  IF p_tenant_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM tenant_memberships
    WHERE user_id   = auth.uid()
      AND tenant_id = p_tenant_id
      AND aktiv     = true
      AND (p_rollen IS NULL OR role = ANY(p_rollen))
  ) THEN
    RAISE EXCEPTION 'Kein Zugriff auf diesen Betrieb' USING ERRCODE = '42501';
  END IF;

  -- KAN-136: Faktor eingerichtet, Sitzung aber nur aal1 → kein Zugriff
  IF NOT public.s112_aal_ok() THEN
    RAISE EXCEPTION 'Zwei-Faktor-Anmeldung erforderlich' USING ERRCODE = '42501';
  END IF;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.pruefe_tenant_zugriff(uuid, text[]) FROM PUBLIC, anon;


-- ── 5. PostgREST-Pre-Request ────────────────────────────────────────────────────────────────
-- SECURITY INVOKER, für anon ausführbar (sonst scheitern alle anonymen Anfragen); PT401 → HTTP 401.
CREATE OR REPLACE FUNCTION public.s112_pre_request()
RETURNS void
LANGUAGE plpgsql
VOLATILE          -- nie wegoptimieren (PostgREST ruft SELECT public.s112_pre_request())
SET search_path = public
AS $$
BEGIN
  -- Verschachtelt statt AND: kein garantierter Kurzschluss, anon darf s112_aal_ok() nicht ausführen.
  IF current_user = 'authenticated' THEN
    IF NOT public.s112_aal_ok() THEN
      RAISE EXCEPTION 'Zwei-Faktor-Anmeldung erforderlich'
        USING ERRCODE = 'PT401',
              HINT = 'Bitte zuerst den Code aus der Authenticator-App eingeben (Sitzungsstufe aal2).';
    END IF;
  END IF;
END;
$$;
COMMENT ON FUNCTION public.s112_pre_request() IS
  'KAN-136: PostgREST db_pre_request – lehnt Data-API-Anfragen von aal1-Sitzungen mit bestätigtem Faktor ab (HTTP 401).';
REVOKE EXECUTE ON FUNCTION public.s112_pre_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.s112_pre_request() TO anon, authenticated, service_role;

DO $$
DECLARE
  v_alt text;
BEGIN
  SELECT substr(c, length('pgrst.db_pre_request=') + 1) INTO v_alt
    FROM pg_roles r, unnest(r.rolconfig) c
   WHERE r.rolname = 'authenticator' AND c LIKE 'pgrst.db_pre_request=%';
  IF v_alt IS NOT NULL AND v_alt NOT IN ('public.s112_pre_request', 's112_pre_request') THEN
    RAISE EXCEPTION 'KAN-136: authenticator hat bereits pgrst.db_pre_request = % – zuerst klären', v_alt;
  END IF;

  -- Selbsttest in allen drei API-Rollen (ohne Faktor-Sitzung darf nichts scheitern)
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;          PERFORM public.s112_pre_request(); RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SET LOCAL ROLE service_role;  PERFORM public.s112_pre_request(); RESET ROLE;
  PERFORM set_config('request.jwt.claims',
    '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000136","aal":"aal1"}', true);
  SET LOCAL ROLE authenticated; PERFORM public.s112_pre_request(); RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
END
$$;

ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.s112_pre_request';
NOTIFY pgrst, 'reload config';


-- ── Prüfabfragen nach dem Einspielen ────────────────────────────────────────────────────────
-- a) RLS-Tabellen ohne zwei_faktor_aal (muss leer sein):
--    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--     WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND c.relrowsecurity
--       AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public'
--                        AND p.tablename = c.relname AND p.policyname = 'zwei_faktor_aal');
-- b) SELECT rolconfig FROM pg_roles WHERE rolname = 'authenticator';  → enthält pgrst.db_pre_request
-- c) Security Advisor: s112_aal_ok erscheint unter Lint 0029 wie die übrigen Helfer – gewollt.