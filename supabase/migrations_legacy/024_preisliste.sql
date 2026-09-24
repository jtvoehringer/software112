-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 024: Preislisten für den Weinhandel (ersetzt 020-Schema)
-- Die einfachen CRM-Preislisten aus Migration 020 werden durch ein vollwertiges
-- Preislisten-Modul ersetzt: mehrere gleichzeitig aktiv (Privat/Gastro/Export),
-- Gültigkeitszeitraum, Verknüpfung mit Füllungen, Druckfunktion.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Alte Tabellen aus 020 entfernen (waren nie in Benutzung) ─────────────────

drop policy if exists "plpos_select"  on preislisten_positionen;
drop policy if exists "plpos_insert"  on preislisten_positionen;
drop policy if exists "plpos_update"  on preislisten_positionen;
drop policy if exists "plpos_delete"  on preislisten_positionen;

drop policy if exists "pl_select" on preislisten;
drop policy if exists "pl_insert" on preislisten;
drop policy if exists "pl_update" on preislisten;
drop policy if exists "pl_delete" on preislisten;

drop index if exists idx_pl_tenant;

drop table if exists preislisten_positionen;
drop table if exists preislisten;

-- ── PREISLISTEN (Kopf) ────────────────────────────────────────────────────────

create table preislisten (
  id              uuid         primary key default uuid_generate_v4(),
  tenant_id       uuid         not null references tenants(id) on delete cascade,
  name            text         not null,
  beschreibung    text,
  gueltig_von     date,
  gueltig_bis     date,
  aktiv           boolean      not null default true,
  erstellt_am     timestamptz  not null default now(),
  aktualisiert_am timestamptz  not null default now()
);

comment on table preislisten is 'Preislisten mit Gueltigkeitszeitraum – mehrere gleichzeitig aktiv moeglich';
comment on column preislisten.name         is 'Bezeichnung z.B. Privatkunden, Gastronomie, Export';
comment on column preislisten.gueltig_von  is 'Preisliste gueltig ab diesem Datum (optional)';
comment on column preislisten.gueltig_bis  is 'Preisliste gueltig bis zu diesem Datum (optional)';

create trigger preislisten_updated_at
  before update on preislisten
  for each row execute function update_updated_at();

create index idx_preislisten_tenant on preislisten(tenant_id, aktiv);

-- ── PREISLISTEN-POSITIONEN ────────────────────────────────────────────────────

create table preislisten_positionen (
  id                 uuid         primary key default uuid_generate_v4(),
  tenant_id          uuid         not null references tenants(id) on delete cascade,
  preisliste_id      uuid         not null references preislisten(id) on delete cascade,
  fuellung_id        uuid         references fuellungen(id) on delete set null,
  name               text         not null,
  jahrgang           int,
  rebsorte           text,
  flaschengroesse_ml int,
  einheit            text         not null default 'Flasche',
  preis_brutto       numeric(10,4),
  sort_order         int          not null default 0,
  aktiv              boolean      not null default true,
  erstellt_am        timestamptz  not null default now(),
  aktualisiert_am    timestamptz  not null default now()
);

comment on table preislisten_positionen is 'Einzelne Produkte mit Preisen in einer Preisliste';
comment on column preislisten_positionen.fuellung_id is 'Optional: Verknuepfung mit abgefuelltem Produkt aus dem Lager';

create trigger preislisten_positionen_updated_at
  before update on preislisten_positionen
  for each row execute function update_updated_at();

create index idx_preislisten_pos_liste    on preislisten_positionen(preisliste_id);
create index idx_preislisten_pos_tenant   on preislisten_positionen(tenant_id);
create index idx_preislisten_pos_fuellung on preislisten_positionen(fuellung_id);

-- ── RLS: PREISLISTEN ──────────────────────────────────────────────────────────

alter table preislisten enable row level security;

create policy "preislisten_select" on preislisten for select using (
  tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())
);
create policy "preislisten_insert" on preislisten for insert with check (
  user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
);
create policy "preislisten_update" on preislisten for update using (
  user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
);
create policy "preislisten_delete" on preislisten for delete using (
  user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin'])
);

-- ── RLS: PREISLISTEN-POSITIONEN ───────────────────────────────────────────────

alter table preislisten_positionen enable row level security;

create policy "preislisten_pos_select" on preislisten_positionen for select using (
  tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())
);
create policy "preislisten_pos_insert" on preislisten_positionen for insert with check (
  user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
);
create policy "preislisten_pos_update" on preislisten_positionen for update using (
  user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
);
create policy "preislisten_pos_delete" on preislisten_positionen for delete using (
  user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
);
