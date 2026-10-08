-- KAN-220 (07.10.2026): E-Label E – Bilder je Füllung (Flasche, Etikett) für das Produktdatenblatt.
--  Privater Bucket fuellung-bilder (JPEG/PNG – das PDF kann kein WebP einbetten), Ordner je Betrieb: <tenant_id>/<fuellung_id>/<flasche|etikett>.<ext>.
--  Lesen: Mitglieder des Betriebs; Hochladen/Löschen: Schreibrecht Kellerbuch oder Warenwirtschaft (wie Füllungen,
--  s112_darf_schreiben – SA/TA immer, Leser nie); kein Ändern/Verschieben (Ersetzen = Löschen + Hochladen).
--  Abo-Sperre und Zwei-Faktor gelten über die globalen RESTRICTIVE-Policies auf storage.objects.
-- Staging zuerst (sjpeghrlhsowmquacjhb), DB-Test 19, dann Produktion.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('fuellung-bilder', 'fuellung-bilder', false, 5242880, ARRAY['image/jpeg', 'image/png'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "fuellung-bilder: Lesen (Mitglieder)" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'fuellung-bilder'
         AND (storage.foldername(objects.name))[1] IN
             (SELECT m.tenant_id::text FROM public.s112_meine_tenants() AS m(tenant_id)));
CREATE POLICY "fuellung-bilder: Hochladen (Schreibrecht kellerbuch|warenwirtschaft)" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'fuellung-bilder'
              AND EXISTS (SELECT 1 FROM public.s112_meine_tenants() AS m(tenant_id)
                           WHERE m.tenant_id::text = (storage.foldername(objects.name))[1]
                             AND public.s112_darf_schreiben(m.tenant_id, VARIADIC ARRAY['kellerbuch', 'warenwirtschaft'])));
CREATE POLICY "fuellung-bilder: Löschen (Schreibrecht kellerbuch|warenwirtschaft)" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'fuellung-bilder'
         AND EXISTS (SELECT 1 FROM public.s112_meine_tenants() AS m(tenant_id)
                      WHERE m.tenant_id::text = (storage.foldername(objects.name))[1]
                        AND public.s112_darf_schreiben(m.tenant_id, VARIADIC ARRAY['kellerbuch', 'warenwirtschaft'])));
