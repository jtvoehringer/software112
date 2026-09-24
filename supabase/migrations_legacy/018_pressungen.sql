-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 018: Pressungen (Lese → Most → Behälter)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Pressung (Pressvorgang) ───────────────────────────────────────────────────
create table pressungen (
  id                 uuid          primary key default uuid_generate_v4(),
  tenant_id          uuid          not null references tenants(id) on delete cascade,
  jahrgang_id        uuid          not null references weinjahrgaenge(id) on delete cascade,
  datum              date          not null,
  most_liter_gesamt  numeric(10,2),   -- tatsächliche Mostausbeute (Liter)
  notizen            text,
  erstellt_am        timestamptz   not null default now()
);
comment on table pressungen is 'Pressvorgänge: welche Weingärten wurden gepresst, Mostausbeute, Tankbefüllung';

-- ── Gelesene Weingärten je Pressung (m:n) ────────────────────────────────────
create table pressung_weingaerten (
  id            uuid          primary key default uuid_generate_v4(),
  pressung_id   uuid          not null references pressungen(id) on delete cascade,
  weingarten_id uuid          not null references weingarten(id),
  trauben_kg    numeric(10,3) not null,
  rebsorte      text,          -- optional, überschreibt WG-Standard
  notizen       text
);

-- ── Befüllte Behälter/Chargen je Pressung ────────────────────────────────────
create table pressung_behaelter (
  id             uuid          primary key default uuid_generate_v4(),
  pressung_id    uuid          not null references pressungen(id) on delete cascade,
  behaelter_id   uuid          references behaelter(id),
  weinausbau_id  uuid          references weinausbau(id),   -- optionale Verknüpfung zur Charge
  menge_liter    numeric(10,2),
  notizen        text
);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table pressungen          enable row level security;
alter table pressung_weingaerten enable row level security;
alter table pressung_behaelter  enable row level security;

create policy "pressungen_select" on pressungen
  for select using (tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid()));
create policy "pressungen_insert" on pressungen
  for insert with check (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));
create policy "pressungen_update" on pressungen
  for update using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));
create policy "pressungen_delete" on pressungen
  for delete using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));

create policy "pressung_wg_select" on pressung_weingaerten
  for select using (pressung_id in (select id from pressungen where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())));
create policy "pressung_wg_insert" on pressung_weingaerten
  for insert with check (pressung_id in (select id from pressungen where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())));
create policy "pressung_wg_update" on pressung_weingaerten
  for update using (pressung_id in (select id from pressungen where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())));
create policy "pressung_wg_delete" on pressung_weingaerten
  for delete using (pressung_id in (select id from pressungen where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())));

create policy "pressung_beh_select" on pressung_behaelter
  for select using (pressung_id in (select id from pressungen where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())));
create policy "pressung_beh_insert" on pressung_behaelter
  for insert with check (pressung_id in (select id from pressungen where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())));
create policy "pressung_beh_update" on pressung_behaelter
  for update using (pressung_id in (select id from pressungen where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())));
create policy "pressung_beh_delete" on pressung_behaelter
  for delete using (pressung_id in (select id from pressungen where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())));

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index idx_pressungen_tenant    on pressungen(tenant_id);
create index idx_pressungen_jahrgang  on pressungen(jahrgang_id);
create index idx_pressungen_datum     on pressungen(jahrgang_id, datum desc);
create index idx_pres_wg_pressung     on pressung_weingaerten(pressung_id);
create index idx_pres_beh_pressung    on pressung_behaelter(pressung_id);
