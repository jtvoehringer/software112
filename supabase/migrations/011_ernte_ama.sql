-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 011 – AMA Erntemeldung
-- Strukturierte Erntemeldung nach AMA-Förderrichtlinien (Agrarmarkt Austria)
-- Grundlage für n8n AMA-Workflow
-- ─────────────────────────────────────────────────────────────────────────────

create table ama_erntemeldungen (
  id                  uuid        primary key default uuid_generate_v4(),
  tenant_id           uuid        not null references tenants(id) on delete cascade,
  jahrgang_id         uuid        not null references weinjahrgaenge(id) on delete cascade,

  -- Betriebsdaten (aus Tenant)
  betriebsnummer      text,       -- AMA-Betriebsnummer
  weinbaugebiet       text,       -- z.B. 'Weinviertel', 'Wachau'

  -- Meldestatus
  status              text        not null default 'entwurf'
                                  check (status in (
                                    'entwurf', 'bereit', 'eingereicht', 'bestaetigt', 'abgelehnt'
                                  )),
  eingereicht_am      timestamptz,
  bestaetigt_am       timestamptz,
  ama_referenznr      text,       -- AMA-Referenznummer nach Einreichung

  -- Gesamtmengen (automatisch aus ernte_parzellen aggregiert)
  gesamtmenge_kg      numeric(14,2),
  gesamtmenge_hl      numeric(14,2),

  -- n8n Workflow-Tracking
  n8n_execution_id    text,       -- n8n Execution-ID für Audit-Trail
  n8n_status          text,       -- 'pending' | 'running' | 'success' | 'error'
  n8n_fehler          text,       -- Fehlermeldung wenn n8n_status = 'error'
  n8n_letzte_aktion   timestamptz,

  notizen             text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique(tenant_id, jahrgang_id)  -- Eine Meldung pro Betrieb pro Jahrgang
);

comment on table ama_erntemeldungen is 'AMA Erntemeldungen nach Agrarmarkt Austria Richtlinien';
comment on column ama_erntemeldungen.n8n_execution_id is 'Rückverweis auf n8n Workflow-Ausführung';

create trigger ama_erntemeldungen_updated_at
  before update on ama_erntemeldungen
  for each row execute function update_updated_at();

create index idx_ama_tenant   on ama_erntemeldungen(tenant_id);
create index idx_ama_jahrgang on ama_erntemeldungen(jahrgang_id);
create index idx_ama_status   on ama_erntemeldungen(tenant_id, status);

-- ─── ERNTE-MELDEPOSITIONEN (Detaildaten je Rebsorte für AMA) ─────────────────
create table ama_meldepositionen (
  id                  uuid        primary key default uuid_generate_v4(),
  meldung_id          uuid        not null references ama_erntemeldungen(id) on delete cascade,
  rebsorte_id         uuid        references rebsorten(id),
  rebsorte_name       text        not null,  -- Denormalisiert für AMA-Meldung
  weingarten_name     text,
  flaeche_ha          numeric(10,4),
  menge_kg            numeric(12,2),
  menge_hl            numeric(12,2),
  qualitaetsstufe     text,
  oechsle             numeric(5,1)
);

create index idx_ama_positionen_meldung on ama_meldepositionen(meldung_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
alter table ama_erntemeldungen enable row level security;

create policy "ama: members can select"
  on ama_erntemeldungen for select
  using (tenant_id in (select get_user_tenant_ids()));

create policy "ama: winzer+ can insert"
  on ama_erntemeldungen for insert
  with check (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));

create policy "ama: winzer+ can update (nur Entwurf)"
  on ama_erntemeldungen for update
  using (
    user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
    and status in ('entwurf', 'bereit')
  );

create policy "ama: admin can delete"
  on ama_erntemeldungen for delete
  using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin']));

alter table ama_meldepositionen enable row level security;

create policy "ama_positionen: select via meldung"
  on ama_meldepositionen for select
  using (
    meldung_id in (
      select id from ama_erntemeldungen
      where tenant_id in (select get_user_tenant_ids())
    )
  );

create policy "ama_positionen: winzer+ can write"
  on ama_meldepositionen for insert
  with check (
    meldung_id in (
      select id from ama_erntemeldungen m
      where user_has_role_in_tenant(m.tenant_id, array['system_admin','tenant_admin','winzer'])
        and m.status in ('entwurf','bereit')
    )
  );

create policy "ama_positionen: winzer+ can update"
  on ama_meldepositionen for update
  using (
    meldung_id in (
      select id from ama_erntemeldungen m
      where user_has_role_in_tenant(m.tenant_id, array['system_admin','tenant_admin','winzer'])
        and m.status in ('entwurf','bereit')
    )
  );
