-- ─────────────────────────────────────────────────────────────────────────────
-- Storage Buckets – software:112
-- Im Supabase Dashboard: Storage → New Bucket
-- ODER direkt per SQL im SQL-Editor ausführen
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── BUCKET: analysen (Weinanalyse-PDFs) ─────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'analysen',
  'analysen',
  false,           -- privat
  10485760,        -- 10 MB
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
) on conflict (id) do nothing;

-- ─── BUCKET: etiketten (Etiketten-PDFs & Vorlagen) ───────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'etiketten',
  'etiketten',
  false,
  20971520,        -- 20 MB
  array['application/pdf', 'image/jpeg', 'image/png', 'image/svg+xml', 'application/illustrator']
) on conflict (id) do nothing;

-- ─── BUCKET: dokumente (Behördenmeldungen, AMA-Bestätigungen) ────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dokumente',
  'dokumente',
  false,
  10485760,        -- 10 MB
  array['application/pdf', 'application/xml', 'text/xml']
) on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- Storage RLS Policies
-- Ordnerstruktur: <bucket>/<tenant_id>/<dateiname>
-- ─────────────────────────────────────────────────────────────────────────────

-- ── ANALYSEN: Lesen ──────────────────────────────────────────────────────────
create policy "analysen: tenant members can read"
  on storage.objects for select
  using (
    bucket_id = 'analysen'
    and (storage.foldername(name))[1] in (
      select tm.tenant_id::text
      from tenant_memberships tm
      where tm.user_id = auth.uid()
    )
  );

-- ── ANALYSEN: Hochladen ───────────────────────────────────────────────────────
create policy "analysen: winzer+ can upload"
  on storage.objects for insert
  with check (
    bucket_id = 'analysen'
    and (storage.foldername(name))[1] in (
      select tm.tenant_id::text
      from tenant_memberships tm
      where tm.user_id = auth.uid()
        and tm.role in ('system_admin', 'tenant_admin', 'winzer')
    )
  );

-- ── ANALYSEN: Löschen ────────────────────────────────────────────────────────
create policy "analysen: admin can delete"
  on storage.objects for delete
  using (
    bucket_id = 'analysen'
    and (storage.foldername(name))[1] in (
      select tm.tenant_id::text
      from tenant_memberships tm
      where tm.user_id = auth.uid()
        and tm.role in ('system_admin', 'tenant_admin')
    )
  );

-- ── ETIKETTEN: gleiche Struktur ───────────────────────────────────────────────
create policy "etiketten: tenant members can read"
  on storage.objects for select
  using (
    bucket_id = 'etiketten'
    and (storage.foldername(name))[1] in (
      select tm.tenant_id::text from tenant_memberships tm where tm.user_id = auth.uid()
    )
  );

create policy "etiketten: admin+ can upload"
  on storage.objects for insert
  with check (
    bucket_id = 'etiketten'
    and (storage.foldername(name))[1] in (
      select tm.tenant_id::text from tenant_memberships tm
      where tm.user_id = auth.uid()
        and tm.role in ('system_admin', 'tenant_admin')
    )
  );

-- ── DOKUMENTE: gleiche Struktur ───────────────────────────────────────────────
create policy "dokumente: tenant members can read"
  on storage.objects for select
  using (
    bucket_id = 'dokumente'
    and (storage.foldername(name))[1] in (
      select tm.tenant_id::text from tenant_memberships tm where tm.user_id = auth.uid()
    )
  );

create policy "dokumente: winzer+ can upload"
  on storage.objects for insert
  with check (
    bucket_id = 'dokumente'
    and (storage.foldername(name))[1] in (
      select tm.tenant_id::text from tenant_memberships tm
      where tm.user_id = auth.uid()
        and tm.role in ('system_admin', 'tenant_admin', 'winzer')
    )
  );
