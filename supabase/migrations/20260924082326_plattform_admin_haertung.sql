-- Härtung (Befund 24.09.2026): Plattform-Admin-Rechte nicht mehr aus
-- tenant_memberships.role = 'system_admin' ableiten – diesen Wert konnte jeder
-- tenant_admin per API selbst vergeben (INSERT/UPDATE-Policies ohne Rollenprüfung).
-- Maßgeblich ist plattform_admins (198). Die App vergibt system_admin ausschließlich
-- über den Service-Role-Client (Signup, Einladungen, Mandantenverwaltung) und ist
-- davon nicht betroffen.

-- 1. Eigene Zeile in plattform_admins lesbar machen (für die Prüfungen unten)
DROP POLICY IF EXISTS pa_eigene_zeile ON public.plattform_admins;
CREATE POLICY pa_eigene_zeile ON public.plattform_admins
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- 2. tenant_memberships: system_admin-Zeilen nur noch durch Plattform-Admins
DROP POLICY IF EXISTS "memberships: tenant_admin can insert" ON public.tenant_memberships;
CREATE POLICY "memberships: tenant_admin can insert" ON public.tenant_memberships
  FOR INSERT
  WITH CHECK (
    public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin'])
    AND (role <> 'system_admin'
         OR EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid()))));

DROP POLICY IF EXISTS "memberships: tenant_admin can update roles" ON public.tenant_memberships;
CREATE POLICY "memberships: tenant_admin can update roles" ON public.tenant_memberships
  FOR UPDATE
  USING (
    public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin'])
    AND user_id <> (SELECT auth.uid())
    AND (role <> 'system_admin'
         OR EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid()))))
  WITH CHECK (
    public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin'])
    AND user_id <> (SELECT auth.uid())
    AND (role <> 'system_admin'
         OR EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid()))));

DROP POLICY IF EXISTS "memberships: tenant_admin can delete" ON public.tenant_memberships;
CREATE POLICY "memberships: tenant_admin can delete" ON public.tenant_memberships
  FOR DELETE
  USING (
    public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin'])
    AND user_id <> (SELECT auth.uid())
    AND (role <> 'system_admin'
         OR EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid()))));

-- 3. release_notes: Schreiben nur für Plattform-Admins; eine Lese-Policy statt zwei
--    (ersetzt rn_admin aus legacy_nachtrag_025_050_052)
DROP POLICY IF EXISTS rn_admin ON public.release_notes;
DROP POLICY IF EXISTS rn_read  ON public.release_notes;
CREATE POLICY rn_read ON public.release_notes
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL
         AND (aktiv OR EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid()))));
CREATE POLICY rn_admin_insert ON public.release_notes
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid())));
CREATE POLICY rn_admin_update ON public.release_notes
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid())));
CREATE POLICY rn_admin_delete ON public.release_notes
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid())));
