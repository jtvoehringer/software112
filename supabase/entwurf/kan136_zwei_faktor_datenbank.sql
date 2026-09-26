-- ════════════════════════════════════════════════════════════════════════════════════════════
-- KAN-136 · Zwei-Faktor-Stufe (aal2) auch in der Datenbank durchsetzen
-- ENTWURF Stand 26.09.2026 – NICHT in supabase/migrations/. Staging (sjpeghrlhsowmquacjhb) per
-- execute_sql eingespielt; Produktion erst nach Probelauf und Jörgens „OK, einspielen“ per
-- Supabase-MCP apply_migration, Name: kan136_zwei_faktor_datenbank → Version aus list_migrations →
-- supabase/migrations/<version>_kan136_zwei_faktor_datenbank.sql, danach Security Advisor.
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- BEFUND
--   aal2 prüften bisher nur der Next-Proxy (src/proxy.ts) und pruefeZweiFaktor()
--   (src/lib/api/zweiFaktor.ts). Wer nur das Passwort kennt, holt sich per signInWithPassword mit
--   dem öffentlichen Anon-Key ein aal1-JWT und liest/schreibt per PostgREST, RPC und Storage alles,
--   was RLS erlaubt – die Zwei-Faktor-Anmeldung war auf Datenebene wirkungslos.
--
-- REGEL (identisch mit hatBestaetigtenFaktor() + currentLevel in src/proxy.ts)
--   Hat der Benutzer einen bestätigten Faktor (auth.mfa_factors.status = 'verified'), gilt seine
--   Sitzung erst ab JWT-Claim aal = 'aal2'. Benutzer ohne bestätigten Faktor: unverändert.
--   Die Zwei-Faktor-PFLICHT (Super-Admin/Betriebs-Manager ab 15.10.2026, src/lib/auth/mfa.ts) wird
--   bewusst NICHT hier durchgesetzt: Wer nur das Passwort eines Kontos ohne Faktor kennt, kann mit
--   derselben aal1-Sitzung selbst einen Faktor einrichten (mfa.enroll braucht nur aal1) und hat
--   danach aal2 – eine DB-Sperre brächte keinen Schutz, nur doppelte Regeln (Datum, Rollen, aktiver
--   Betrieb aus dem Cookie). Die Pflicht bleibt App-Sache (Dashboard-Layout + pruefeZweiFaktor).
--
-- UMSETZUNG
--   1. public.s112_aal_ok()        – zentrale Prüfung (STABLE, SECURITY DEFINER wegen auth.mfa_factors)
--   2. Policy zwei_faktor_aal      – RESTRICTIVE, TO authenticated, auf JEDER Tabelle in public mit RLS
--                                    (auch Kind-, Global- und Admin-Tabellen, tenant_memberships,
--                                    plattform_admins, profiles, user_email_connections)
--   3. Policy zwei_faktor_aal      – auf storage.objects (alle Buckets)
--   4. pruefe_tenant_zugriff()     – zusätzlich aal-Prüfung (SECURITY-DEFINER-RPCs umgehen RLS)
--   5. PostgREST-Pre-Request       – public.s112_pre_request() lehnt JEDEN Data-API-Aufruf einer
--                                    aal1-Sitzung mit Faktor ab (HTTP 401). Deckt auch die
--                                    SECURITY-DEFINER-RPCs mit eigener Mitgliedsprüfung ohne
--                                    pruefe_tenant_zugriff ab (crm_dubletten, crm_filterwerte,
--                                    crm_zaehler, kontakte_zusammenfuehren, lade_behaelter,
--                                    lade_kellergemeinschaft, s112_mandant_mitglieder,
--                                    get_behandlungen_fuer_grundstuecke …) und künftige.
--
-- NOTFALL (Aussperren, z. B. Auth-Störung liefert kein aal2): EIN Statement schaltet 1–5 ab –
--   CREATE OR REPLACE FUNCTION public.s112_aal_ok() RETURNS boolean LANGUAGE sql STABLE
--     SECURITY DEFINER SET search_path = public AS $f$ SELECT true $f$;
--   Nur den Pre-Request abschalten:
--   ALTER ROLE authenticator RESET pgrst.db_pre_request; NOTIFY pgrst, 'reload config';
--   Verlorenes Handy wie bisher: Faktor in Supabase (Authentication → Users → MFA) löschen.
--
-- ROLLBACK (vollständig)
--   ALTER ROLE authenticator RESET pgrst.db_pre_request; NOTIFY pgrst, 'reload config';
--   DO $r$ DECLARE r record; BEGIN
--     FOR r IN SELECT schemaname, tablename FROM pg_policies WHERE policyname = 'zwei_faktor_aal' LOOP
--       EXECUTE format('DROP POLICY zwei_faktor_aal ON %I.%I', r.schemaname, r.tablename);
--     END LOOP; END $r$;
--   pruefe_tenant_zugriff mit dem Stand vor KAN-136 neu anlegen (Abschnitt 4 ohne den KAN-136-Block),
--   DROP FUNCTION public.s112_pre_request(); DROP FUNCTION public.s112_aal_ok();
--
-- NEUE TABELLEN: bekommen zwei_faktor_aal wie in Abschnitt 2 (Prüfabfrage am Ende).
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- CREATE POLICY braucht ACCESS EXCLUSIVE auf ~110 Tabellen: lieber sauber abbrechen und später
-- erneut einspielen, als laufende App-Abfragen zu blockieren (wie KAN-5).
SET LOCAL lock_timeout = '5s';


-- ── 1. Zentrale Prüfung ─────────────────────────────────────────────────────────────────────
-- true  = Sitzung darf auf Daten zugreifen (aal2, oder kein bestätigter Faktor)
-- false = bestätigter Faktor vorhanden, Sitzung aber nur aal1
-- CASE statt OR: garantiert, dass aal2-Sitzungen (Normalfall) auth.mfa_factors nie lesen.
-- Der aal-Claim stammt aus dem von PostgREST/Storage geprüften, signierten JWT.
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
-- Bewusst ALLE (106 auf Staging): auch Kindtabellen ohne tenant_id (deren Policies hängen teils an
-- SECURITY-DEFINER-Helfern wie get_user_tenant_ids()), tenants, tenant_memberships (kein
-- legitimer aal1-Pfad mit Faktor liest sie – Proxy leitet vorher auf /zwei-faktor), plattform_admins
-- (sperrt damit auch alle globalen Admin-Schreibrechte, die an plattform_admins hängen) und
-- user_email_connections (M365-Tokens). Andere Policies (mitgliedschaft_aktiv, modul_*,
-- abo_schreibsperre_* aus KAN-5 …) bleiben unberührt; RESTRICTIVE wird mit ihnen UND-verknüpft.
-- (SELECT …) → InitPlan: einmal je Abfrage und Tabelle ausgewertet, nicht je Zeile.
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

  -- Selbstprüfung: keine RLS-Tabelle in public ohne die Policy
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
-- Alle Buckets. mandant-logos ist öffentlich: Logo-URLs (/object/public/…) prüfen kein RLS und
-- funktionieren weiter; nur authentifizierte API-Zugriffe einer aal1-Sitzung mit Faktor enden.
DROP POLICY IF EXISTS zwei_faktor_aal ON storage.objects;
CREATE POLICY zwei_faktor_aal ON storage.objects
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok()))
  WITH CHECK ((SELECT public.s112_aal_ok()));


-- ── 4. pruefe_tenant_zugriff: aal-Prüfung für SECURITY-DEFINER-RPCs ────────────────────────
-- Die RPCs laufen als postgres (BYPASSRLS) – die Policies oben greifen dort nicht.
-- Schutz vor Überschreiben eines abweichenden Stands (Produktion hat KAN-5-Unterschiede):
-- nur ersetzen, wenn der Funktionsrumpf exakt dem geprüften Stand entspricht.
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
  ELSIF v_md5 = '7e7fa6786e3ae7995a85fe9e3012aa11' THEN
    NULL;                                   -- Stand vor KAN-136 → wird unten ersetzt
  ELSIF position('KAN-136' IN (SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                                WHERE n.nspname = 'public' AND p.proname = 'pruefe_tenant_zugriff')) > 0 THEN
    NULL;                                   -- bereits eingespielt (idempotent)
  ELSE
    RAISE EXCEPTION 'KAN-136: pruefe_tenant_zugriff weicht vom geprüften Stand ab (md5 %) – Rumpf vergleichen und Abschnitt 4 anpassen', v_md5;
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
-- ACL bleibt bei CREATE OR REPLACE erhalten; zur Sicherheit wie Konvention:
REVOKE EXECUTE ON FUNCTION public.pruefe_tenant_zugriff(uuid, text[]) FROM PUBLIC, anon;


-- ── 5. PostgREST-Pre-Request ────────────────────────────────────────────────────────────────
-- PostgREST ruft die Funktion vor JEDER Data-API-Anfrage (Tabellen, RPCs, GraphQL) in der Rolle
-- des Aufrufers auf. SECURITY INVOKER und für anon ausführbar – sonst scheitern alle anonymen
-- Anfragen; sie liest selbst nichts, nur s112_aal_ok() (nur für authenticated). SQLSTATE PT401 →
-- HTTP 401. service_role und anon laufen ungeprüft durch.
CREATE OR REPLACE FUNCTION public.s112_pre_request()
RETURNS void
LANGUAGE plpgsql
VOLATILE          -- nie wegoptimieren (PostgREST ruft SELECT public.s112_pre_request())
SET search_path = public
AS $$
BEGIN
  -- Verschachtelt statt AND: Postgres garantiert keinen Kurzschluss, anon darf s112_aal_ok()
  -- nicht ausführen (im Probelauf gefunden: 42501 für jede anonyme Anfrage).
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
  -- Kein fremdes Pre-Request überschreiben
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
-- c) Security Advisor: s112_aal_ok erscheint wie die übrigen Helfer unter Lint 0029 (authenticated
--    darf SECURITY DEFINER ausführen) – gewollt, Policies brauchen es.
