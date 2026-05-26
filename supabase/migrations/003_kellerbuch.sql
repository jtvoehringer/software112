-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 003: Kellerbuch & Vinifizierung
-- Tabellen: behaelter, weinausbau
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── BEHÄLTER (Tanks, Fässer, etc.) ──────────────────────────────────────────
create table behaelter (
  id              uuid        primary key default uuid_generate_v4(),
  tenant_id       uuid        not null references tenants(id) on delete cascade,
  name            text        not null,
  typ             text        check (typ in ('stahltank','holzfass','betonei','amphore','sonstiges')),
  volumen_liter   numeric(10,2),
  standort        text,
  aktiv           boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table behaelter is 'Kellerbehälter: Stahltanks, Holzfässer, Betoneier etc.';
comment on column behaelter.typ is 'stahltank | holzfass | betonei | amphore | sonstiges';

create trigger behaelter_updated_at
  before update on behaelter
  for each row execute function update_updated_at();

create index idx_behaelter_tenant_id on behaelter(tenant_id);
create index idx_behaelter_aktiv     on behaelter(tenant_id, aktiv);

-- ─── WEINAUSBAU (Chargen / Lots) ──────────────────────────────────────────────
create table weinausbau (
  id              uuid        primary key default uuid_generate_v4(),
  tenant_id       uuid        not null references tenants(id) on delete cascade,
  name            text        not null,
  jahrgang        integer     check (jahrgang between 1900 and 2100),
  rebsorte        text,
  weingarten_id   uuid        references weingarten(id) on delete set null,
  behaelter_id    uuid        references behaelter(id) on delete set null,
  menge_liter     numeric(10,2),
  status          text        not null default 'ernte'
                              check (status in ('ernte','gaerung','ausbau','abfuellung','abgeschlossen')),
  notizen         text,
  aktiv           boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table weinausbau is 'Weinausbau-Chargen: von der Ernte bis zur Abfüllung';
comment on column weinausbau.status is 'ernte | gaerung | ausbau | abfuellung | abgeschlossen';

create trigger weinausbau_updated_at
  before update on weinausbau
  for each row execute function update_updated_at();

create index idx_weinausbau_tenant_id    on weinausbau(tenant_id);
create index idx_weinausbau_weingarten   on weinausbau(weingarten_id);
create index idx_weinausbau_behaelter    on weinausbau(behaelter_id);
create index idx_weinausbau_status       on weinausbau(tenant_id, status);

-- ─── RLS: BEHÄLTER ────────────────────────────────────────────────────────────
alter table behaelter enable row level security;

create policy "behaelter_select" on behaelter
  for select using (
    tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())
  );

create policy "behaelter_insert" on behaelter
  for insert with check (
    user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
  );

create policy "behaelter_update" on behaelter
  for update using (
    user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
  );

create policy "behaelter_delete" on behaelter
  for delete using (
    user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin'])
  );

-- ─── RLS: WEINAUSBAU ──────────────────────────────────────────────────────────
alter table weinausbau enable row level security;

create policy "weinausbau_select" on weinausbau
  for select using (
    tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())
  );

create policy "weinausbau_insert" on weinausbau
  for insert with check (
    user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
  );

create policy "weinausbau_update" on weinausbau
  for update using (
    user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
  );

create policy "weinausbau_delete" on weinausbau
  for delete using (
    user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin'])
  );
