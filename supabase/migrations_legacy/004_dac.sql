-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 004: DAC & Prüfnummern
-- Österreichisches Weinrecht: DAC-Anträge und Prüfnummer-Verwaltung
-- ─────────────────────────────────────────────────────────────────────────────

create table dac_antrag (
  id              uuid        primary key default uuid_generate_v4(),
  tenant_id       uuid        not null references tenants(id) on delete cascade,
  weinausbau_id   uuid        references weinausbau(id) on delete set null,

  -- Weinbeschreibung für den Antrag
  bezeichnung     text        not null,
  dac_region      text        not null
                              check (dac_region in (
                                'weinviertel','kamptal','kremstal','wachau','wagram',
                                'traisental','carnuntum','leithaberg','neusiedlersee',
                                'mittelburgenland','eisenberg','rosalia','wiener_gemischter_satz',
                                'sonstiges'
                              )),
  jahrgang        integer     check (jahrgang between 1900 and 2100),
  rebsorte        text,
  menge_liter     numeric(10,2),
  alkohol_prozent numeric(4,2),

  -- Antragsstatus
  status          text        not null default 'entwurf'
                              check (status in (
                                'entwurf','eingereicht','in_pruefung','genehmigt','abgelehnt'
                              )),

  -- Ergebnis
  pruefnummer     text,       -- wird nach Genehmigung eingetragen
  eingereicht_am  date,
  bescheid_am     date,

  notizen         text,
  aktiv           boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table dac_antrag is 'DAC-Anträge und Prüfnummern nach österreichischem Weinrecht';
comment on column dac_antrag.pruefnummer is 'Offizielle Prüfnummer nach Genehmigung durch die Bundeskellereiinspektion';

create trigger dac_antrag_updated_at
  before update on dac_antrag
  for each row execute function update_updated_at();

create index idx_dac_antrag_tenant_id    on dac_antrag(tenant_id);
create index idx_dac_antrag_status       on dac_antrag(tenant_id, status);
create index idx_dac_antrag_weinausbau   on dac_antrag(weinausbau_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
alter table dac_antrag enable row level security;

create policy "dac_antrag_select" on dac_antrag
  for select using (
    tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())
  );

create policy "dac_antrag_insert" on dac_antrag
  for insert with check (
    user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
  );

create policy "dac_antrag_update" on dac_antrag
  for update using (
    user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
  );

create policy "dac_antrag_delete" on dac_antrag
  for delete using (
    user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin'])
  );
