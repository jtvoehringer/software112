-- Schutz der Paket-, Abrechnungs- und Systemfelder (Befund 24.09.2026): Ein tenant_admin
-- konnte per API (PostgREST mit eigenem JWT) jede Spalte seines Betriebs ändern – z. B.
-- tenants.plan, stripe_*, max_benutzer, active, name ('Sandbox' hebt die Abo-Sperre auf)
-- und tenant_einstellungen.modul_*, ki_abfragen_*, Nummernkreis-Zähler – sowie die eigene
-- tenant_einstellungen-Zeile löschen und mit beliebigen Werten neu anlegen.
--
-- Die App schreibt beide Tabellen fast ausschließlich über die Service-Role bzw. über
-- SECURITY-DEFINER-Funktionen (Nummernkreise, KI-Zähler, Kundennummer); als Benutzer
-- (authenticated) schreibt nur speichereSvsOption die vier svs_*-Felder. Deshalb gilt für
-- direkte Benutzerzugriffe eine Positivliste; neue Spalten sind automatisch geschützt.

-- 1. Generische Trigger-Funktion; erlaubte Spalten kommen als Trigger-Argumente.
--    SECURITY INVOKER, damit current_user den Aufrufweg zeigt: PostgREST mit Benutzer-JWT
--    = authenticated/anon; Service-Role = service_role; SQL-Editor und SECURITY-DEFINER-
--    Funktionen = postgres (dort steht im JWT weiter 'authenticated', daher nicht über
--    die Claims entscheiden).
CREATE OR REPLACE FUNCTION public.schutz_plattformfelder()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_geaendert text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- Plattform-Admins dürfen alles (Policy pa_eigene_zeile macht die eigene Zeile lesbar)
  IF EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid())) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Keine Berechtigung, in % neue Zeilen anzulegen', TG_TABLE_NAME
      USING ERRCODE = '42501',
            HINT = 'Betriebe und ihre Einstellungen legt nur die Plattform an.';
  END IF;

  SELECT string_agg(n.key, ', ' ORDER BY n.key) INTO v_geaendert
  FROM jsonb_each(to_jsonb(NEW)) AS n
  WHERE NOT (n.key = ANY (TG_ARGV))
    AND n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key);

  IF v_geaendert IS NOT NULL THEN
    RAISE EXCEPTION 'Keine Berechtigung, diese Felder in % zu ändern: %', TG_TABLE_NAME, v_geaendert
      USING ERRCODE = '42501',
            HINT = 'Paket-, Abrechnungs- und Systemfelder ändert nur die Plattform (Service-Role).';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.schutz_plattformfelder() FROM PUBLIC, anon, authenticated;

-- 2. Trigger – Name mit a_ feuert vor den übrigen BEFORE-Triggern (alphabetisch)
DROP TRIGGER IF EXISTS a_schutz_plattformfelder ON public.tenants;
CREATE TRIGGER a_schutz_plattformfelder
  BEFORE INSERT OR UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.schutz_plattformfelder('bio_status', 'updated_at');

DROP TRIGGER IF EXISTS a_schutz_plattformfelder ON public.tenant_einstellungen;
CREATE TRIGGER a_schutz_plattformfelder
  BEFORE INSERT OR UPDATE ON public.tenant_einstellungen
  FOR EACH ROW EXECUTE FUNCTION public.schutz_plattformfelder(
    'svs_option', 'svs_option_seit', 'svs_einkuenfte_manuell', 'svs_kv_angehoerige', 'aktualisiert_am');

-- 3. tenant_einstellungen: Betriebsleiter dürfen ihre Zeile nur noch ändern, nicht mehr
--    anlegen oder löschen (einst_upsert galt FOR ALL; DELETE + INSERT setzte Nummernkreise
--    zurück und erlaubte beliebige modul_*-Werte). Kein App-Pfad nutzt INSERT/DELETE als Benutzer.
DROP POLICY IF EXISTS einst_upsert ON public.tenant_einstellungen;
DROP POLICY IF EXISTS einst_update ON public.tenant_einstellungen;
CREATE POLICY einst_update ON public.tenant_einstellungen
  FOR UPDATE
  USING (tenant_id IN (
    SELECT m.tenant_id FROM public.tenant_memberships m
     WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role = ANY (ARRAY['system_admin', 'tenant_admin'])))
  WITH CHECK (tenant_id IN (
    SELECT m.tenant_id FROM public.tenant_memberships m
     WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role = ANY (ARRAY['system_admin', 'tenant_admin'])));

-- 4. tenants: Anlegen per API nur für Plattform-Admins (bisher genügte irgendeine
--    system_admin-Mitgliedschaft); die App legt Betriebe per Service-Role an.
DROP POLICY IF EXISTS "tenants: only system_admin can insert" ON public.tenants;
DROP POLICY IF EXISTS "tenants: nur Plattform-Admins legen an" ON public.tenants;
CREATE POLICY "tenants: nur Plattform-Admins legen an" ON public.tenants
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid())));
