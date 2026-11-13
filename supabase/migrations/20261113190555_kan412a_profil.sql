-- KAN-412 R1 (13.11.2026): Profile „Vertrieb“ und „Extern“ – Grundlage, noch ohne Wirkung.
--
-- Bisher liest jedes aktive Mitglied alles im Betrieb; nur das Schreiben ist je Modul geregelt. Entscheidungen Jörgen
-- (Jira KAN-412, 11.11. und 13.11.2026, Fragen 1–8 jeweils A): zwei feste Profile für Mitarbeiter, die auch das Lesen
-- beschränken; ohne Profil bleibt alles wie bisher (Betriebsleitung, Leser, bestehende Mitarbeiter).
--   vertrieb  liest: allgemein, crm, verkauf, lager, controlling, ki, betrieb
--   extern    liest: allgemein, rieden, massnahmen
-- Diese Migration legt nur die Spalte und die Funktionen an. Es gibt noch KEINE Policy, die sie verwendet (R2,
-- KAN-454), und die App vergibt noch kein Profil (R5, KAN-457) – für bestehende Benutzer ändert sich nichts.
-- Welche Tabelle zu welchem Bereich gehört: scripts/lesebereiche.json (Wächter check-lesebereiche).

-- 1. Profil an der Mitgliedschaft ─────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tenant_memberships
  ADD COLUMN profil text,
  ADD CONSTRAINT tenant_memberships_profil_chk CHECK (profil IS NULL OR profil IN ('vertrieb', 'extern')),
  ADD CONSTRAINT tenant_memberships_profil_rolle_chk CHECK (profil IS NULL OR role = 'winzer');
COMMENT ON COLUMN public.tenant_memberships.profil IS
  'KAN-412: Profil eines Mitarbeiters (vertrieb | extern) – beschränkt das Lesen auf die Bereiche des Profils; NULL = liest alles wie bisher';

-- 2. Bereiche je Profil (eine Stelle in der Datenbank; gleich wie src/lib/auth/lesebereiche.ts) ────────────────────
CREATE FUNCTION public.s112_profil_bereiche(p_profil text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT CASE p_profil
    WHEN 'vertrieb' THEN ARRAY['allgemein', 'crm', 'verkauf', 'lager', 'controlling', 'ki', 'betrieb']
    WHEN 'extern'   THEN ARRAY['allgemein', 'rieden', 'massnahmen']
    ELSE NULL::text[]
  END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_profil_bereiche(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_profil_bereiche(text) TO authenticated;
COMMENT ON FUNCTION public.s112_profil_bereiche(text) IS
  'KAN-412: Lesebereiche eines Profils; NULL = kein Profil (liest alles)';

-- 3. Betriebe, in denen ein Bereich für den angemeldeten Benutzer gesperrt ist ─────────────────────────────────────
--    Für die Sperr-Policies (R2): NOT (tenant_id IN (SELECT public.s112_lesegesperrte_tenants('<bereich>'))) – eine
--    Auswertung je Abfrage, nicht je Zeile (wie s112_gesperrte_tenants). Ohne Profil ist nichts gesperrt.
CREATE FUNCTION public.s112_lesegesperrte_tenants(p_bereich text)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT m.tenant_id
    FROM public.tenant_memberships m
   WHERE m.user_id = (SELECT auth.uid())
     AND m.profil IS NOT NULL
     AND NOT (p_bereich = ANY (public.s112_profil_bereiche(m.profil)))
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_lesegesperrte_tenants(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_lesegesperrte_tenants(text) TO authenticated;
COMMENT ON FUNCTION public.s112_lesegesperrte_tenants(text) IS
  'KAN-412: Betriebe, in denen der angemeldete Benutzer den Lesebereich wegen seines Profils nicht lesen darf (für RESTRICTIVE-Policies)';

-- 4. Einzelprüfung für Funktionen, die Daten liefern (R3) ─────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_darf_lesen(p_tenant_id uuid, p_bereich text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT public.ist_service_kontext()
      OR NOT EXISTS (SELECT 1 FROM public.s112_lesegesperrte_tenants(p_bereich) AS t(id) WHERE t.id = p_tenant_id)
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_darf_lesen(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_darf_lesen(uuid, text) TO authenticated;
COMMENT ON FUNCTION public.s112_darf_lesen(uuid, text) IS
  'KAN-412: Darf der angemeldete Benutzer den Lesebereich im Betrieb lesen? (prüft nur das Profil – die Mitgliedschaft prüft pruefe_tenant_zugriff)';
