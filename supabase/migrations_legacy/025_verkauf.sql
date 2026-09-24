-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 025: Verkauf – Verkaufsposten + Positionen
-- Unterstuetzt Flaschenverkauf und Tankverkauf (Direktverkauf)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── VERKAUFSPOSTEN (Rechnungskopf) ────────────────────────────────────────────

create table verkaufsposten (
  id               uuid         primary key default uuid_generate_v4(),
  tenant_id        uuid         not null references tenants(id) on delete cascade,
  rechnungsnummer  text,                           -- freitext, z.B. "2025-0042"
  datum            date         not null default current_date,
  kontakt_id       uuid         references kontakte(id) on delete set null,
  firma_id         uuid         references firmen(id) on delete set null,
  notizen          text,
  aktiv            boolean      not null default true,
  erstellt_am      timestamptz  not null default now(),
  aktualisiert_am  timestamptz  not null default now()
);

comment on table verkaufsposten is 'Verkaufsvorgaenge (Rechnungskoepfe) im Weinhandel';
comment on column verkaufsposten.rechnungsnummer is 'Freitext-Rechnungsnummer, z.B. 2025-0042';
comment on column verkaufsposten.kontakt_id      is 'Optional: Privatkunde aus CRM';
comment on column verkaufsposten.firma_id        is 'Optional: Firma/Gastro/Export aus CRM';

create trigger verkaufsposten_updated_at
  before update on verkaufsposten
  for each row execute function update_updated_at();

create index idx_verkaufsposten_tenant  on verkaufsposten(tenant_id, aktiv);
create index idx_verkaufsposten_datum   on verkaufsposten(tenant_id, datum desc);
create index idx_verkaufsposten_kontakt on verkaufsposten(kontakt_id);
create index idx_verkaufsposten_firma   on verkaufsposten(firma_id);

-- ── VERKAUF-POSITIONEN ────────────────────────────────────────────────────────

create table verkauf_positionen (
  id                uuid          primary key default uuid_generate_v4(),
  tenant_id         uuid          not null references tenants(id) on delete cascade,
  verkaufsposten_id uuid          not null references verkaufsposten(id) on delete cascade,
  typ               text          not null default 'flasche'
                                  check (typ in ('flasche', 'tank', 'sonstiges')),
  fuellung_id       uuid          references fuellungen(id) on delete set null,
  weinausbau_id     uuid          references weinausbau(id) on delete set null,
  name              text          not null,
  menge             numeric(10,2) not null,
  einheit           text          not null default 'Stk',   -- 'Stk', 'L', 'Karton'
  preis_brutto      numeric(10,4),
  erstellt_am       timestamptz   not null default now()
);

comment on table verkauf_positionen            is 'Einzelne Zeilen eines Verkaufsvorgangs';
comment on column verkauf_positionen.typ       is 'flasche=aus Fuellung, tank=Direktverkauf aus Weinausbau-Charge';
comment on column verkauf_positionen.fuellung_id    is 'Verknuepfung Flaschenware -> reduziert bestand_flaschen';
comment on column verkauf_positionen.weinausbau_id  is 'Verknuepfung Tankware   -> reduziert menge_liter';

create index idx_verkauf_pos_posten   on verkauf_positionen(verkaufsposten_id);
create index idx_verkauf_pos_fuellung on verkauf_positionen(fuellung_id);
create index idx_verkauf_pos_wein     on verkauf_positionen(weinausbau_id);
create index idx_verkauf_pos_tenant   on verkauf_positionen(tenant_id);

-- ── RLS: VERKAUFSPOSTEN ───────────────────────────────────────────────────────

alter table verkaufsposten enable row level security;

create policy "verkaufsposten_select" on verkaufsposten for select using (
  tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())
);
create policy "verkaufsposten_insert" on verkaufsposten for insert with check (
  user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
);
create policy "verkaufsposten_update" on verkaufsposten for update using (
  user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
);
create policy "verkaufsposten_delete" on verkaufsposten for delete using (
  user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin'])
);

-- ── RLS: VERKAUF-POSITIONEN ───────────────────────────────────────────────────

alter table verkauf_positionen enable row level security;

create policy "verkauf_pos_select" on verkauf_positionen for select using (
  tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())
);
create policy "verkauf_pos_insert" on verkauf_positionen for insert with check (
  user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
);
create policy "verkauf_pos_update" on verkauf_positionen for update using (
  user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
);
create policy "verkauf_pos_delete" on verkauf_positionen for delete using (
  user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin'])
);
