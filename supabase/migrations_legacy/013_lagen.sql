-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 013 – Lagen-Tabelle + Grundstücke-Status
-- Eigene lagen-Tabelle statt ried-Textfeld auf weingarten
-- Grundstücke erhalten status: aktiv | brache | gerodet
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── LAGEN ───────────────────────────────────────────────────────────────────
create table lagen (
  id             uuid        primary key default uuid_generate_v4(),
  tenant_id      uuid        not null references tenants(id) on delete cascade,
  name           text        not null,
  gemeinde       text,
  weinbaugebiet  text,
  notizen        text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table  lagen              is 'Weingartenlagen / Riede je Tenant';
comment on column lagen.name        is 'Ried-Name, z.B. Wiege, Perchtoldsdorf';
comment on column lagen.gemeinde    is 'Katastralgemeinde der Lage';
comment on column lagen.weinbaugebiet is 'z.B. Thermenregion, Wachau';

create trigger lagen_updated_at
  before update on lagen
  for each row execute function update_updated_at();

create index idx_lagen_tenant on lagen(tenant_id);
create unique index idx_lagen_name_tenant on lagen(tenant_id, name);

-- ─── lage_id auf weingarten ───────────────────────────────────────────────────
alter table weingarten
  add column if not exists lage_id uuid references lagen(id) on delete set null;

create index idx_weingarten_lage on weingarten(lage_id);

-- ─── Bestehende ried-Werte migrieren ─────────────────────────────────────────
-- Erzeugt eine Lage je distinct ried+tenant_id Kombination
insert into lagen (tenant_id, name, gemeinde, weinbaugebiet)
select distinct
  w.tenant_id,
  w.ried,
  w.gemeinde,
  w.weinbaugebiet
from weingarten w
where w.ried is not null
on conflict (tenant_id, name) do nothing;

-- Verknüpft weingarten mit dem neu erzeugten lagen-Datensatz
update weingarten w
set lage_id = l.id
from lagen l
where l.name = w.ried
  and l.tenant_id = w.tenant_id;

-- ─── Grundstücke Status ───────────────────────────────────────────────────────
alter table grundstuecke
  add column if not exists status text not null default 'aktiv'
    check (status in ('aktiv', 'brache', 'gerodet'));

comment on column grundstuecke.status is 'aktiv = normal; brache = liegt brach; gerodet = dauerhaft entfernt';

-- spritzbar=false → brache (bisherige Bedeutung übernehmen)
update grundstuecke set status = 'brache' where spritzbar = false;

-- ─── RLS – lagen ──────────────────────────────────────────────────────────────
alter table lagen enable row level security;

create policy "lagen: members can select"
  on lagen for select
  using (tenant_id in (select get_user_tenant_ids()));

create policy "lagen: winzer+ can insert"
  on lagen for insert
  with check (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));

create policy "lagen: winzer+ can update"
  on lagen for update
  using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));

create policy "lagen: admin can delete"
  on lagen for delete
  using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin']));
