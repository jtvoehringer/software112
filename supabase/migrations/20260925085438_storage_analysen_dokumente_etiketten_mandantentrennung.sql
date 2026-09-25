-- Härtung (25.09.2026): Storage-Buckets 'analysen', 'dokumente' und 'etiketten' nur noch für
-- angemeldete, aktive Mitglieder des Betriebs im ersten Pfadordner (<tenant_id>/…).
--
-- Befund: Die sieben Policies dieser drei privaten Buckets stammen aus der Anfangszeit (im
-- Dashboard angelegt, in keiner Migration) und galten „to public“ – also auch für anon, entgegen
-- der Konvention seit 24.09.2026. Sie lasen tenant_memberships direkt, ohne „aktiv“: Deaktivierte
-- Mitglieder konnten weiter lesen und hochladen, in 'analysen' als Admin auch löschen. Die
-- Modulmatrix (Migration 218) galt hier nicht.
--
-- Neu (Muster wie bei ea-belege/aktivitaet-dokumente):
--   * nur „authenticated“; der Mandant ist der erste Pfadordner und wird als Text verglichen –
--     kein ::uuid-Cast, ein ungültiger Pfad ergibt „kein Zugriff“ statt Fehler 22P02
--   * Lesen: aktive Mitglieder (s112_meine_tenants)
--   * analysen:  Hochladen, wer im Modul kellerbuch schreiben darf (wie Tabelle weinanalysen);
--                Löschen wie bisher nur system_admin/tenant_admin
--   * dokumente: Hochladen wie bisher system_admin/tenant_admin/winzer (keinem Fachmodul
--                zugeordnet → 'betrieb' = jeder aktive Mitarbeiter, kein Leser)
--   * etiketten: Hochladen wie bisher nur system_admin/tenant_admin
--   * Löschen in dokumente/etiketten und Überschreiben (UPDATE/upsert) in allen drei Buckets:
--     gab es bisher nicht und gibt es weiterhin nicht
--
-- Die App nutzt die drei Buckets derzeit nicht (Stand 25.09.2026: kein Aufruf in src/, 0 Objekte).

DROP POLICY IF EXISTS "analysen: tenant members can read"  ON storage.objects;
DROP POLICY IF EXISTS "analysen: winzer+ can upload"       ON storage.objects;
DROP POLICY IF EXISTS "analysen: admin can delete"         ON storage.objects;
DROP POLICY IF EXISTS "dokumente: tenant members can read" ON storage.objects;
DROP POLICY IF EXISTS "dokumente: winzer+ can upload"      ON storage.objects;
DROP POLICY IF EXISTS "etiketten: tenant members can read" ON storage.objects;
DROP POLICY IF EXISTS "etiketten: admin+ can upload"       ON storage.objects;

-- analysen (Laborbefunde zu weinanalysen, Modul kellerbuch)
CREATE POLICY "analysen: Mitglieder lesen" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'analysen'
         AND (storage.foldername(objects.name))[1] IN (SELECT m.tenant_id::text FROM public.s112_meine_tenants() AS m(tenant_id)));
CREATE POLICY "analysen: Kellerbuch hochladen" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'analysen'
              AND EXISTS (SELECT 1 FROM public.s112_meine_tenants() AS m(tenant_id)
                           WHERE m.tenant_id::text = (storage.foldername(objects.name))[1]
                             AND public.s112_darf_schreiben(m.tenant_id, VARIADIC ARRAY['kellerbuch'])));
CREATE POLICY "analysen: Admins löschen" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'analysen'
         AND EXISTS (SELECT 1 FROM public.s112_meine_tenants() AS m(tenant_id)
                      WHERE m.tenant_id::text = (storage.foldername(objects.name))[1]
                        AND public.user_has_role_in_tenant(m.tenant_id, ARRAY['system_admin','tenant_admin'])));

-- dokumente (PDF/XML, noch keinem Modul zugeordnet)
CREATE POLICY "dokumente: Mitglieder lesen" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'dokumente'
         AND (storage.foldername(objects.name))[1] IN (SELECT m.tenant_id::text FROM public.s112_meine_tenants() AS m(tenant_id)));
CREATE POLICY "dokumente: Mitarbeiter hochladen" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'dokumente'
              AND EXISTS (SELECT 1 FROM public.s112_meine_tenants() AS m(tenant_id)
                           WHERE m.tenant_id::text = (storage.foldername(objects.name))[1]
                             AND public.s112_darf_schreiben(m.tenant_id, VARIADIC ARRAY['betrieb'])));

-- etiketten (Etikettengrafiken)
CREATE POLICY "etiketten: Mitglieder lesen" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'etiketten'
         AND (storage.foldername(objects.name))[1] IN (SELECT m.tenant_id::text FROM public.s112_meine_tenants() AS m(tenant_id)));
CREATE POLICY "etiketten: Admins hochladen" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'etiketten'
              AND EXISTS (SELECT 1 FROM public.s112_meine_tenants() AS m(tenant_id)
                           WHERE m.tenant_id::text = (storage.foldername(objects.name))[1]
                             AND public.user_has_role_in_tenant(m.tenant_id, ARRAY['system_admin','tenant_admin'])));
