-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 006 – Modul-Flags (Feature-Flags je Mandant)
-- Steuert welche Module ein Tenant freigeschaltet hat
-- ─────────────────────────────────────────────────────────────────────────────

create table module_flags (
  id          uuid        primary key default uuid_generate_v4(),
  tenant_id   uuid        not null references tenants(id) on delete cascade,
  module      text        not null
                          check (module in (
                            'weingarten', 'kellerbuch', 'dac',
                            'pflanzenschutz', 'analysen', 'ernte',
                            'weinhandel', 'rechnungen', 'emcs', 'reports'
                          )),
  aktiv       boolean     not null default true,
  freigeschaltet_am timestamptz not null default now(),
  unique(tenant_id, module)
);

comment on table module_flags is 'Freigeschaltete Module je Mandant (Feature-Flags)';
comment on column module_flags.module is
  'weingarten | kellerbuch | dac | pflanzenschutz | analysen | ernte | weinhandel | rechnungen | emcs | reports';

create index idx_module_flags_tenant on module_flags(tenant_id);

-- Helper: Ist ein Modul für den aktuellen User aktiv?
create or replace function tenant_has_module(p_module text)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from module_flags mf
    join tenant_memberships tm on tm.tenant_id = mf.tenant_id
    where tm.user_id  = auth.uid()
      and mf.module   = p_module
      and mf.aktiv    = true
  )
$$;

-- ─── RLS ──────────────────────────────────────────────────────────────────────
alter table module_flags enable row level security;

create policy "module_flags: members can view own tenant"
  on module_flags for select
  using (tenant_id in (select get_user_tenant_ids()));

create policy "module_flags: only system_admin can insert"
  on module_flags for insert
  with check (
    exists (
      select 1 from tenant_memberships
      where user_id = auth.uid() and role = 'system_admin'
    )
  );

create policy "module_flags: only system_admin can update"
  on module_flags for update
  using (
    exists (
      select 1 from tenant_memberships
      where user_id = auth.uid() and role = 'system_admin'
    )
  );

-- ─── Standard-Module für alle neuen Tenants (muss nach Tenant-Anlage aufgerufen werden) ─
-- Beispiel:
-- INSERT INTO module_flags (tenant_id, module) VALUES
--   ('<tenant_id>', 'weingarten'),
--   ('<tenant_id>', 'kellerbuch'),
--   ('<tenant_id>', 'dac'),
--   ('<tenant_id>', 'pflanzenschutz');
