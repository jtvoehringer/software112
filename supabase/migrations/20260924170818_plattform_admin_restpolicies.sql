-- Härtung (24.09.2026), Nachzug zu plattform_admin_haertung: die letzten globalen
-- Schreib-Policies, die noch tenant_memberships.role = 'system_admin' prüften, auf
-- plattform_admins umstellen. Die alte Prüfung hatte keinen Mandantenbezug – wer in
-- irgendeinem Betrieb system_admin war, durfte die module_flags ALLER Mandanten, die
-- globalen Rebsorten-Stammdaten und die Logos aller Mandanten schreiben.
-- Die App ist nicht betroffen: module_flags wird im Code nicht mehr verwendet,
-- rebsorten nur gelesen, Logos lädt sie per Service-Role hoch.

-- 1. module_flags: Anlegen/Ändern nur Plattform-Admins (Löschen war und bleibt gesperrt)
DROP POLICY IF EXISTS "module_flags: only system_admin can insert" ON public.module_flags;
DROP POLICY IF EXISTS "module_flags: only system_admin can update" ON public.module_flags;
CREATE POLICY module_flags_plattform_admin_insert ON public.module_flags
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid())));
CREATE POLICY module_flags_plattform_admin_update ON public.module_flags
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid())));

-- 2. rebsorten (globale Stammdaten): Schreiben nur Plattform-Admins, Lesen bleibt für alle.
--    Getrennt nach INSERT/UPDATE/DELETE statt FOR ALL, damit für SELECT nur
--    „rebsorten: everyone can read“ greift (keine doppelte permissive Policy).
DROP POLICY IF EXISTS "rebsorten: only system_admin can modify" ON public.rebsorten;
CREATE POLICY rebsorten_plattform_admin_insert ON public.rebsorten
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid())));
CREATE POLICY rebsorten_plattform_admin_update ON public.rebsorten
  FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid())));
CREATE POLICY rebsorten_plattform_admin_delete ON public.rebsorten
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid())));

-- 3. Storage-Bucket mandant-logos: Hochladen/Ersetzen/Löschen nur Plattform-Admins,
--    Lesen bleibt öffentlich („Alle: Logo lesen“)
DROP POLICY IF EXISTS "System-Admin: Logo hochladen" ON storage.objects;
DROP POLICY IF EXISTS "System-Admin: Logo ersetzen"  ON storage.objects;
DROP POLICY IF EXISTS "System-Admin: Logo löschen"   ON storage.objects;
CREATE POLICY "Plattform-Admin: Logo hochladen" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'mandant-logos'
              AND EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid())));
CREATE POLICY "Plattform-Admin: Logo ersetzen" ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'mandant-logos'
              AND EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid())))
  WITH CHECK (bucket_id = 'mandant-logos'
              AND EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid())));
CREATE POLICY "Plattform-Admin: Logo löschen" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'mandant-logos'
         AND EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid())));
