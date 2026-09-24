-- Migration 104: Dokumente an Aktivitäten
-- Datei-Anhänge zu CRM-Aktivitäten (Angebote, Verträge, Fotos, …)

CREATE TABLE IF NOT EXISTS aktivitaet_dokumente (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenant_einstellungen(tenant_id) ON DELETE CASCADE,
  aktivitaet_id   UUID NOT NULL REFERENCES aktivitaeten(id) ON DELETE CASCADE,
  dateiname       TEXT NOT NULL,
  dateityp        TEXT NOT NULL,           -- MIME-Type
  groesse_bytes   INTEGER,
  storage_pfad    TEXT NOT NULL,           -- Supabase Storage path
  erstellt_von    UUID REFERENCES auth.users(id),
  erstellt_am     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aktivitaet_dokumente_aktivitaet ON aktivitaet_dokumente(aktivitaet_id);
CREATE INDEX IF NOT EXISTS idx_aktivitaet_dokumente_tenant ON aktivitaet_dokumente(tenant_id);

ALTER TABLE aktivitaet_dokumente ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant-Member können Dokumente lesen" ON aktivitaet_dokumente
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "Winzer können Dokumente anlegen" ON aktivitaet_dokumente
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid())
  );

CREATE POLICY "Winzer können eigene Dokumente löschen" ON aktivitaet_dokumente
  FOR DELETE USING (
    tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid())
  );

-- Supabase Storage Bucket (private, max 15 MB pro Datei)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'aktivitaet-dokumente',
  'aktivitaet-dokumente',
  false,
  15728640,
  ARRAY[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS
CREATE POLICY "Auth: Upload in eigenen Tenant-Ordner" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'aktivitaet-dokumente');

CREATE POLICY "Auth: Lesen aus eigenem Tenant-Ordner" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'aktivitaet-dokumente');

CREATE POLICY "Auth: Löschen aus eigenem Tenant-Ordner" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'aktivitaet-dokumente');
