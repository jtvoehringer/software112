-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 017: Qualitätsstufe in weinausbau + Umziehen-Protokoll
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Qualitätsstufe zur weinausbau-Tabelle hinzufügen
alter table weinausbau add column qualitaetsstufe text
  check (qualitaetsstufe in (
    'wein','landwein','qualitaetswein','kabinett',
    'spaetlese','auslese','beerenauslese','ausbruch',
    'trockenbeerenauslese','eiswein','strohwein'
  ));

comment on column weinausbau.qualitaetsstufe is
  'Weinrechtliche Qualitätsstufe: wein | landwein | qualitaetswein | kabinett | spaetlese | auslese | beerenauslese | ausbruch | trockenbeerenauslese | eiswein | strohwein';

-- 2. Umziehen-Protokoll
create table keller_umzuege (
  id                  uuid          primary key default uuid_generate_v4(),
  tenant_id           uuid          not null references tenants(id) on delete cascade,
  datum               date          not null,
  von_weinausbau_id   uuid          not null references weinausbau(id),
  nach_behaelter_id   uuid          not null references behaelter(id),
  menge_liter         numeric(10,2) not null,
  schwund_liter       numeric(10,2) not null default 0,
  verschnitt          boolean       not null default false,
  qualitaet_vorher    text,
  qualitaet_nachher   text,
  notizen             text,
  erstellt_am         timestamptz   not null default now()
);

comment on table keller_umzuege is 'Protokoll aller Umzieh-Vorgänge inkl. Verschnitt-Info';

alter table keller_umzuege enable row level security;

create policy "umzuege_select" on keller_umzuege
  for select using (
    tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())
  );

create policy "umzuege_insert" on keller_umzuege
  for insert with check (
    user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
  );

create policy "umzuege_update" on keller_umzuege
  for update using (
    user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
  );

create index idx_umzuege_tenant on keller_umzuege(tenant_id);
create index idx_umzuege_von    on keller_umzuege(von_weinausbau_id);
create index idx_umzuege_datum  on keller_umzuege(tenant_id, datum desc);
