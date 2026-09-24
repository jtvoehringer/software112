-- Nachschliff zu paketfelder_schutz (Nachprüfung 24.09.2026)

-- 1. schutz_plattformfelder(): fail-closed, falls ein Trigger ohne Argumente angelegt wird
--    (TG_ARGV ist dann NULL, `= ANY (NULL)` ließ jede Änderung durch); OLD nur einmal
--    in jsonb umwandeln (vorher je Spalte, rund 8 ms statt 0,25 ms pro Zeile)
CREATE OR REPLACE FUNCTION public.schutz_plattformfelder()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_alt       jsonb;
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

  v_alt := to_jsonb(OLD);
  SELECT string_agg(n.key, ', ' ORDER BY n.key) INTO v_geaendert
  FROM jsonb_each(to_jsonb(NEW)) AS n
  WHERE n.key <> ALL (COALESCE(TG_ARGV, '{}'::text[]))
    AND n.value IS DISTINCT FROM v_alt -> n.key;

  IF v_geaendert IS NOT NULL THEN
    RAISE EXCEPTION 'Keine Berechtigung, diese Felder in % zu ändern: %', TG_TABLE_NAME, v_geaendert
      USING ERRCODE = '42501',
            HINT = 'Paket-, Abrechnungs- und Systemfelder ändert nur die Plattform (Service-Role).';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.schutz_plattformfelder() FROM PUBLIC, anon, authenticated;

-- 2. tenant_einstellungen: aktualisiert_am von der Positivliste (kein App-Pfad setzt es
--    als Benutzer; frei wählbar war es als Änderungsnachweis wertlos)
DROP TRIGGER IF EXISTS a_schutz_plattformfelder ON public.tenant_einstellungen;
CREATE TRIGGER a_schutz_plattformfelder
  BEFORE INSERT OR UPDATE ON public.tenant_einstellungen
  FOR EACH ROW EXECUTE FUNCTION public.schutz_plattformfelder(
    'svs_option', 'svs_option_seit', 'svs_einkuenfte_manuell', 'svs_kv_angehoerige');

-- 3. Benutzerlimit des Pakets (tenants.max_benutzer) war per API umgehbar: ein tenant_admin
--    konnte Mitgliedschaften direkt anlegen oder reaktivieren. Die App schreibt Mitgliedschaften
--    ausschließlich per Service-Role (Einladen, Rolle, Module, aktiv – mit Limitprüfung);
--    als Benutzer nur das Entfernen (removeMember, Policy „tenant_admin can delete“ bleibt).
DROP POLICY IF EXISTS "memberships: tenant_admin can insert" ON public.tenant_memberships;
DROP POLICY IF EXISTS "memberships: nur Plattform-Admins legen an" ON public.tenant_memberships;
CREATE POLICY "memberships: nur Plattform-Admins legen an" ON public.tenant_memberships
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "memberships: tenant_admin can update roles" ON public.tenant_memberships;
DROP POLICY IF EXISTS "memberships: nur Plattform-Admins ändern" ON public.tenant_memberships;
CREATE POLICY "memberships: nur Plattform-Admins ändern" ON public.tenant_memberships
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid())));

-- 4. TRUNCATE umgeht RLS und Zeilen-Trigger; TRIGGER/REFERENCES braucht die Data API nicht
REVOKE TRUNCATE, TRIGGER, REFERENCES
  ON public.tenants, public.tenant_einstellungen, public.tenant_memberships, public.plattform_admins
  FROM anon, authenticated;
