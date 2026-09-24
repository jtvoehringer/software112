-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 023: Kellerplan – visuelle Grundriss-Karte für Behälter
-- Für biozertifizierte Betriebe: lückenlose Dokumentation der Kellerwirtschaft
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── KELLERPLAENE (Grundrisse) ────────────────────────────────────────────────
create table kellerplaene (
  id            uuid         primary key default uuid_generate_v4(),
  tenant_id     uuid         not null references tenants(id) on delete cascade,
  name          text         not null,            -- z.B. "Hauptkeller", "Fassraum", "Außenlager"
  breite_m      numeric(8,2) not null default 20, -- Raumbreite in Metern (horizontale Achse)
  laenge_m      numeric(8,2) not null default 10, -- Raumlänge in Metern (vertikale Achse)
  notizen       text,
  aktiv         boolean      not null default true,
  erstellt_am   timestamptz  not null default now(),
  aktualisiert_am timestamptz not null default now()
);

comment on table kellerplaene is 'Grundrisse der Lagerstätten für den Kellerplan';
comment on column kellerplaene.breite_m is 'Raumbreite in Metern – bestimmt horizontale Canvas-Achse';
comment on column kellerplaene.laenge_m is 'Raumlänge in Metern – bestimmt vertikale Canvas-Achse';

create trigger kellerplaene_updated_at
  before update on kellerplaene
  for each row execute function update_updated_at();

create index idx_kellerplaene_tenant on kellerplaene(tenant_id, aktiv);

-- ─── KELLERPLAN-POSITIONEN (Behälter auf einem Grundriss) ────────────────────
create table kellerplan_positionen (
  id               uuid         primary key default uuid_generate_v4(),
  tenant_id        uuid         not null references tenants(id) on delete cascade,
  kellerplan_id    uuid         not null references kellerplaene(id) on delete cascade,
  behaelter_id     uuid         not null references behaelter(id) on delete cascade,

  -- Position + Größe als Prozentwerte des Canvas (0–100)
  -- Ermöglicht responsive Darstellung unabhängig von Bildschirmgröße
  pos_x_pct        numeric(6,2) not null default 10,   -- Abstand von links in %
  pos_y_pct        numeric(6,2) not null default 10,   -- Abstand von oben in %
  breite_pct       numeric(6,2) not null default 12,   -- Blockbreite in % des Canvas
  hoehe_pct        numeric(6,2) not null default 14,   -- Blockhöhe in % des Canvas

  erstellt_am      timestamptz  not null default now(),
  aktualisiert_am  timestamptz  not null default now(),

  -- Ein Behälter kann pro Plan nur einmal platziert werden
  unique (kellerplan_id, behaelter_id)
);

comment on table kellerplan_positionen is 'Position jedes Behälters auf einem Kellerplan-Grundriss';
comment on column kellerplan_positionen.pos_x_pct  is 'Horizontale Position (% des Canvas, 0 = links)';
comment on column kellerplan_positionen.pos_y_pct  is 'Vertikale Position (% des Canvas, 0 = oben)';
comment on column kellerplan_positionen.breite_pct is 'Blockbreite als % der Canvas-Breite';
comment on column kellerplan_positionen.hoehe_pct  is 'Blockhöhe als % der Canvas-Höhe';

create trigger kellerplan_positionen_updated_at
  before update on kellerplan_positionen
  for each row execute function update_updated_at();

create index idx_kellerplan_pos_plan      on kellerplan_positionen(kellerplan_id);
create index idx_kellerplan_pos_behaelter on kellerplan_positionen(behaelter_id);
create index idx_kellerplan_pos_tenant    on kellerplan_positionen(tenant_id);

-- ─── RLS: KELLERPLAENE ───────────────────────────────────────────────────────
alter table kellerplaene enable row level security;

create policy "kellerplaene_select" on kellerplaene
  for select using (
    tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())
  );

create policy "kellerplaene_insert" on kellerplaene
  for insert with check (
    user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
  );

create policy "kellerplaene_update" on kellerplaene
  for update using (
    user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
  );

create policy "kellerplaene_delete" on kellerplaene
  for delete using (
    user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin'])
  );

-- ─── RLS: KELLERPLAN-POSITIONEN ──────────────────────────────────────────────
alter table kellerplan_positionen enable row level security;

create policy "kellerplan_positionen_select" on kellerplan_positionen
  for select using (
    tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())
  );

create policy "kellerplan_positionen_insert" on kellerplan_positionen
  for insert with check (
    user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
  );

create policy "kellerplan_positionen_update" on kellerplan_positionen
  for update using (
    user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
  );

create policy "kellerplan_positionen_delete" on kellerplan_positionen
  for delete using (
    user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
  );
