-- Härtung (25.09.2026): Mandantentrennung in den privaten Storage-Buckets 'ea-belege'
-- und 'aktivitaet-dokumente'. Die bisherigen Policies (Legacy 104 und 166) prüften nur
-- bucket_id – jeder angemeldete Benutzer irgendeines Betriebs konnte über die Storage-API
-- mit seinem JWT Belege und CRM-Anhänge fremder Betriebe lesen, hochladen und löschen.
--
-- Neu: der erste Ordner des Pfads muss die tenant_id einer aktiven eigenen Mitgliedschaft
-- sein. So legt die App ab (User-Client, keine Service-Role):
--   ea-belege             <tenant_id>/<zeitstempel>-<datei>                 (api/buchhaltung/belege)
--   aktivitaet-dokumente  <tenant_id>/<aktivitaet_id>/<zeitstempel>-<datei> (api/crm/aktivitaet/[id]/dokument)
-- Rechte wie die Tabellen-Policies von ea_belege bzw. aktivitaet_dokumente:
--   Lesen      jedes aktive Mitglied (auch Leser; die App erzeugt Signed URLs mit dem User-Client)
--   Hochladen  s112_darf_schreiben(<tenant>, Modul) – Admins immer, Mitarbeiter mit Modul
--              ea bzw. crm/warenwirtschaft (wie die restriktiven modul_*-Policies der Tabellen)
--   Löschen    wie Hochladen – die App entfernt Dateien beim Verwerfen eines Belegs, beim
--              Löschen eines Anhangs und als Rollback nach gescheitertem Insert, jeweils als
--              Mitarbeiter; nur Admins hieße dort verwaiste Dateien (remove() meldet keinen Fehler)
-- Ändern/Verschieben (UPDATE) bleibt ohne Policy gesperrt; die App lädt mit upsert: false.
-- Plattform-Admins bekommen hier keinen Sonderweg – die Tabellenzeilen dazu sind ebenfalls
-- nur über die Mitgliedschaft sichtbar.
--
-- Die tenant_id wird nicht per ::uuid aus dem Pfad gecastet (ein Ordnername, der keine UUID
-- ist, bräche sonst mit 22P02 ab, beim Auflisten für alle), sondern per Textvergleich gegen
-- s112_meine_tenants() gefunden; s112_darf_schreiben bekommt die uuid von dort.

DROP POLICY IF EXISTS "Auth: Beleg hochladen" ON storage.objects;
DROP POLICY IF EXISTS "Auth: Beleg lesen"     ON storage.objects;
DROP POLICY IF EXISTS "Auth: Beleg löschen"   ON storage.objects;
DROP POLICY IF EXISTS "Auth: Upload in eigenen Tenant-Ordner"   ON storage.objects;
DROP POLICY IF EXISTS "Auth: Lesen aus eigenem Tenant-Ordner"   ON storage.objects;
DROP POLICY IF EXISTS "Auth: Löschen aus eigenem Tenant-Ordner" ON storage.objects;

-- 1. ea-belege (Modul ea)
CREATE POLICY "ea-belege: Lesen (Mitglieder)" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'ea-belege'
         AND (storage.foldername(objects.name))[1] IN
             (SELECT m.tenant_id::text FROM public.s112_meine_tenants() AS m(tenant_id)));
CREATE POLICY "ea-belege: Hochladen (Schreibrecht ea)" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ea-belege'
              AND EXISTS (SELECT 1 FROM public.s112_meine_tenants() AS m(tenant_id)
                           WHERE m.tenant_id::text = (storage.foldername(objects.name))[1]
                             AND public.s112_darf_schreiben(m.tenant_id, VARIADIC ARRAY['ea'])));
CREATE POLICY "ea-belege: Löschen (Schreibrecht ea)" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'ea-belege'
         AND EXISTS (SELECT 1 FROM public.s112_meine_tenants() AS m(tenant_id)
                      WHERE m.tenant_id::text = (storage.foldername(objects.name))[1]
                        AND public.s112_darf_schreiben(m.tenant_id, VARIADIC ARRAY['ea'])));

-- 2. aktivitaet-dokumente (Modul crm oder warenwirtschaft)
CREATE POLICY "aktivitaet-dokumente: Lesen (Mitglieder)" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'aktivitaet-dokumente'
         AND (storage.foldername(objects.name))[1] IN
             (SELECT m.tenant_id::text FROM public.s112_meine_tenants() AS m(tenant_id)));
CREATE POLICY "aktivitaet-dokumente: Hochladen (crm/warenwirtschaft)" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'aktivitaet-dokumente'
              AND EXISTS (SELECT 1 FROM public.s112_meine_tenants() AS m(tenant_id)
                           WHERE m.tenant_id::text = (storage.foldername(objects.name))[1]
                             AND public.s112_darf_schreiben(m.tenant_id, VARIADIC ARRAY['crm', 'warenwirtschaft'])));
CREATE POLICY "aktivitaet-dokumente: Löschen (crm/warenwirtschaft)" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'aktivitaet-dokumente'
         AND EXISTS (SELECT 1 FROM public.s112_meine_tenants() AS m(tenant_id)
                      WHERE m.tenant_id::text = (storage.foldername(objects.name))[1]
                        AND public.s112_darf_schreiben(m.tenant_id, VARIADIC ARRAY['crm', 'warenwirtschaft'])));
