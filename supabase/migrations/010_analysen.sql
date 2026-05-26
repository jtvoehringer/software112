-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 010 – Weinanalysen
-- Laboranalysen je Charge/Weinausbau, Storage Bucket "analysen"
-- ─────────────────────────────────────────────────────────────────────────────

create table weinanalysen (
  id                  uuid        primary key default uuid_generate_v4(),
  tenant_id           uuid        not null references tenants(id) on delete cascade,
  weinausbau_id       uuid        references weinausbau(id) on delete set null,

  -- Zeitpunkt & Labor
  analyse_datum       date        not null,
  labor               text,       -- z.B. 'Eigenlabor', 'BOKU Wien', 'Staatliches Labor'
  probe_nr            text,       -- interne Probennummer

  -- Chemische Parameter (österr. Weinrecht)
  alkohol_vol         numeric(5,2),   -- % vol
  gesamtalkohol_vol   numeric(5,2),   -- inkl. gebundener Alkohol
  restzucker_gl       numeric(8,3),   -- g/l
  gesamtsaeure_gl     numeric(6,3),   -- g/l (als Weinsäure)
  flüchtige_saeure_gl numeric(6,3),   -- g/l (als Essigsäure)
  ph_wert             numeric(4,2),
  freie_so2_mgl       numeric(6,2),   -- mg/l freies SO2
  gesamt_so2_mgl      numeric(6,2),   -- mg/l Gesamt-SO2
  weinsaeure_gl       numeric(6,3),   -- g/l
  apfelsaeure_gl      numeric(6,3),   -- g/l
  milchsaeure_gl      numeric(6,3),   -- g/l

  -- Physikalisch
  dichte              numeric(8,5),   -- g/cm³
  extrakt_gl          numeric(8,3),   -- g/l (zuckerfreier Extrakt)

  -- Bewertung & Dokument
  bewertung           text,       -- Freitext-Kommentar
  datei_url           text,       -- Storage-URL zum Analyse-PDF
  datei_name          text,

  notizen             text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table weinanalysen is 'Laboranalysen je Weinausbau-Charge';
comment on column weinanalysen.datei_url is 'Storage Bucket: analysen/<tenant_id>/<dateiname>';

create trigger weinanalysen_updated_at
  before update on weinanalysen
  for each row execute function update_updated_at();

create index idx_analysen_tenant     on weinanalysen(tenant_id);
create index idx_analysen_weinausbau on weinanalysen(weinausbau_id);
create index idx_analysen_datum      on weinanalysen(tenant_id, analyse_datum);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
alter table weinanalysen enable row level security;

create policy "analysen: members can select"
  on weinanalysen for select
  using (tenant_id in (select get_user_tenant_ids()));

create policy "analysen: winzer+ can insert"
  on weinanalysen for insert
  with check (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));

create policy "analysen: winzer+ can update"
  on weinanalysen for update
  using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));

create policy "analysen: admin can delete"
  on weinanalysen for delete
  using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin']));

-- ─── STORAGE BUCKET: analysen ─────────────────────────────────────────────────
-- Im Supabase Dashboard: Storage → New Bucket → "analysen" (private)
-- ODER per SQL (Supabase API):
--
-- insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- values (
--   'analysen', 'analysen', false,
--   10485760,  -- 10 MB
--   array['application/pdf', 'image/jpeg', 'image/png']
-- );
--
-- Storage RLS Policies (im Dashboard unter Storage → Policies):
-- Policy: "Eigene Tenant-Dateien lesen"
--   USING: (storage.foldername(name))[1] in (
--     select tm.tenant_id::text from tenant_memberships tm where tm.user_id = auth.uid()
--   )
-- Policy: "winzer+ kann hochladen"
--   WITH CHECK: (storage.foldername(name))[1] in (
--     select tm.tenant_id::text from tenant_memberships tm
--     where tm.user_id = auth.uid() and tm.role in ('system_admin','tenant_admin','winzer')
--   )
