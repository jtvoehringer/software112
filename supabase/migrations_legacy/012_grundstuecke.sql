-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 012 – Grundstücke & Weingarten-Erweiterungen
-- Kataster-Grundstücke (GST-Nummern) je Weingarten-Parzelle
-- Ergänzt weingarten-Tabelle um fs_nr (Flächenstücknummer)
-- ─────────────────────────────────────────────────────────────────────────────

-- Flächenstücknummer zu bestehender weingarten-Tabelle hinzufügen
alter table weingarten
  add column if not exists fs_nr       text,     -- z.B. 'fs 2', 'fs 13/14/15'
  add column if not exists gemeinde    text,     -- z.B. 'Gumpoldskirchen'
  add column if not exists weinbaugebiet text;   -- z.B. 'Thermenregion', 'Wachau'

comment on column weingarten.fs_nr is 'Flächenstücknummer aus Weinbaukataster';
comment on column weingarten.gemeinde is 'Katastral­gemeinde';

-- ─── GRUNDSTÜCKE (GST-Nummern je Weingarten) ─────────────────────────────────
create table grundstuecke (
  id              uuid        primary key default uuid_generate_v4(),
  tenant_id       uuid        not null references tenants(id) on delete cascade,
  weingarten_id   uuid        not null references weingarten(id) on delete cascade,

  -- Kataster
  gst_nr          text        not null,       -- z.B. '1411/1', '2128/83'
  katastralgemeinde text,
  einlagezahl     text,

  -- Bepflanzung
  rebsorte        text,                       -- Freitext (aus Kataster)
  rebsorte_id     uuid        references rebsorten(id),
  pflanzjahr      integer     check (pflanzjahr between 1900 and 2100),
  flaeche_ha      numeric(10,4),

  -- Bewirtschaftung
  spritzbar       boolean     not null default true,  -- false für Brache, Gerodet
  notizen         text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table grundstuecke is 'Kataster-Grundstücke je Weingarten-Parzelle';
comment on column grundstuecke.gst_nr is 'GST-Nummer aus Grundstückskataster';
comment on column grundstuecke.spritzbar is 'false = Brache/Gerodet, nicht in Spritzplan aufnehmen';

create trigger grundstuecke_updated_at
  before update on grundstuecke
  for each row execute function update_updated_at();

create index idx_grundstuecke_tenant     on grundstuecke(tenant_id);
create index idx_grundstuecke_weingarten on grundstuecke(weingarten_id);
create index idx_grundstuecke_rebsorte   on grundstuecke(rebsorte_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
alter table grundstuecke enable row level security;

create policy "grundstuecke: members can select"
  on grundstuecke for select
  using (tenant_id in (select get_user_tenant_ids()));

create policy "grundstuecke: winzer+ can insert"
  on grundstuecke for insert
  with check (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));

create policy "grundstuecke: winzer+ can update"
  on grundstuecke for update
  using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));

create policy "grundstuecke: admin can delete"
  on grundstuecke for delete
  using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin']));
