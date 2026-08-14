-- Migration 160: Logo-Datei-Upload für Mandanten (Branding)
-- Ersetzt/ergänzt das bisherige reine "Logo-URL"-Textfeld um einen echten
-- Datei-Upload, damit ein Logo nicht mehr per Deploy in /public/logos/ oder
-- per extern gehosteter URL eingetragen werden muss.

-- Supabase Storage Bucket (öffentlich lesbar, da Logo z.B. auch in Etiketten/
-- PDFs und auf der Betrieb-wählen-Seite vor dem Login gerendert wird;
-- max. 2 MB pro Datei, nur Bild-Formate)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'mandant-logos',
  'mandant-logos',
  true,
  2097152,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: Schreibzugriff nur für System-Admins (Uploads laufen serverseitig
-- ohnehin über den Admin-Client mit Service-Role und sind zusätzlich in
-- src/app/(dashboard)/admin/mandanten/[id]/actions.ts per assertSystemAdmin()
-- abgesichert - diese Policies sind Verteidigung in der Tiefe für den Fall
-- eines künftigen direkten Client-Uploads).
CREATE POLICY "System-Admin: Logo hochladen" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'mandant-logos'
    AND EXISTS (
      SELECT 1 FROM tenant_memberships
      WHERE user_id = auth.uid() AND role = 'system_admin' AND aktiv = true
    )
  );

CREATE POLICY "System-Admin: Logo ersetzen" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'mandant-logos'
    AND EXISTS (
      SELECT 1 FROM tenant_memberships
      WHERE user_id = auth.uid() AND role = 'system_admin' AND aktiv = true
    )
  );

CREATE POLICY "System-Admin: Logo löschen" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'mandant-logos'
    AND EXISTS (
      SELECT 1 FROM tenant_memberships
      WHERE user_id = auth.uid() AND role = 'system_admin' AND aktiv = true
    )
  );

-- Lesen ist bei einem public-Bucket ohnehin über die öffentliche URL möglich
-- (umgeht RLS), zusätzlich eine explizite Policy für authenticated Clients:
CREATE POLICY "Alle: Logo lesen" ON storage.objects
  FOR SELECT TO authenticated, anon
  USING (bucket_id = 'mandant-logos');
