-- Migration 089: weinausbau_weingaerten
-- n:m Verknüpfung Charge ↔ Weingarten (ersetzt weingarten_id Single-FK)
-- + Retrofix pressung_behaelter.weinausbau_id für bestehende Pressungen

-- ── 1. Junction-Tabelle ──────────────────────────────────────────────────────
create table if not exists weinausbau_weingaerten (
  id             uuid primary key default uuid_generate_v4(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  weinausbau_id  uuid not null references weinausbau(id) on delete cascade,
  weingarten_id  uuid not null references weingarten(id) on delete cascade,
  created_at     timestamptz default now(),
  unique (weinausbau_id, weingarten_id)
);

create index idx_waw_weinausbau  on weinausbau_weingaerten(weinausbau_id);
create index idx_waw_weingarten  on weinausbau_weingaerten(weingarten_id);
create index idx_waw_tenant      on weinausbau_weingaerten(tenant_id);

alter table weinausbau_weingaerten enable row level security;

create policy "waw_select" on weinausbau_weingaerten
  for select using (tenant_id in (
    select tenant_id from tenant_memberships where user_id = auth.uid()
  ));
create policy "waw_insert" on weinausbau_weingaerten
  for insert with check (tenant_id in (
    select tenant_id from tenant_memberships
    where user_id = auth.uid()
      and rolle in ('system_admin','tenant_admin','winzer')
  ));
create policy "waw_update" on weinausbau_weingaerten
  for update using (tenant_id in (
    select tenant_id from tenant_memberships
    where user_id = auth.uid()
      and rolle in ('system_admin','tenant_admin','winzer')
  ));
create policy "waw_delete" on weinausbau_weingaerten
  for delete using (tenant_id in (
    select tenant_id from tenant_memberships
    where user_id = auth.uid()
      and rolle in ('system_admin','tenant_admin','winzer')
  ));

-- ── 2. Backfill: bestehende weingarten_id → Junction-Einträge ────────────────
insert into weinausbau_weingaerten (tenant_id, weinausbau_id, weingarten_id)
select w.tenant_id, w.id, w.weingarten_id
from weinausbau w
where w.weingarten_id is not null
on conflict (weinausbau_id, weingarten_id) do nothing;

-- ── 3. Retrofix pressung_behaelter.weinausbau_id ────────────────────────────
-- Für Pressungen die schon einem Behälter zugeordnet sind, aber keine
-- weinausbau_id haben: über den Behälter die Charge finden.
-- Bedingung: genau eine Charge ist in diesem Behälter (eindeutige Zuordnung).
update pressung_behaelter pb
set weinausbau_id = w.id
from weinausbau w
where pb.weinausbau_id is null
  and pb.behaelter_id is not null
  and w.behaelter_id = pb.behaelter_id
  and w.tenant_id = (
    select p.tenant_id from pressungen p where p.id = pb.pressung_id
  )
  -- nur wenn eindeutig eine Charge im Behälter
  and (
    select count(*) from weinausbau ww
    where ww.behaelter_id = pb.behaelter_id
      and ww.tenant_id = w.tenant_id
  ) = 1;

-- ── 4. Retrofix weinausbau_weingaerten via pressung_behaelter ───────────────
-- Für Chargen ohne Weingarten: über die verknüpfte Pressung → Weingarten finden
insert into weinausbau_weingaerten (tenant_id, weinausbau_id, weingarten_id)
select distinct
  w.tenant_id,
  pb.weinausbau_id,
  pw.weingarten_id
from pressung_behaelter pb
join weinausbau w on w.id = pb.weinausbau_id
join pressungen p on p.id = pb.pressung_id
join pressung_weingaerten pw on pw.pressung_id = p.id
where pb.weinausbau_id is not null
  and pw.weingarten_id is not null
  and not exists (
    select 1 from weinausbau_weingaerten x
    where x.weinausbau_id = pb.weinausbau_id
      and x.weingarten_id = pw.weingarten_id
  )
on conflict (weinausbau_id, weingarten_id) do nothing;
