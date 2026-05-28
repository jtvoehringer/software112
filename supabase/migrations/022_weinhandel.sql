-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 022: Weinhandel – Füllungen / Weinlager
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── FÜLLUNGEN (Abfüllungsereignisse = Weinhandel-Artikel) ───────────────────
create table fuellungen (
  id                    uuid         primary key default uuid_generate_v4(),
  tenant_id             uuid         not null references tenants(id) on delete cascade,
  weinausbau_id         uuid         references weinausbau(id) on delete set null,

  -- Produktbezeichnung
  name                  text         not null,
  jahrgang              integer      check (jahrgang between 1900 and 2100),
  rebsorte              text,
  qualitaet             text         not null default 'qualitaetswein'
                                     check (qualitaet in (
                                       'qualitaetswein',   -- Österreichischer Qualitätswein
                                       'kabinett',          -- Kabinett
                                       'spaetlese',         -- Spätlese
                                       'auslese',           -- Auslese
                                       'beerenauslese',     -- Beerenauslese
                                       'trockenbeerenauslese',
                                       'eiswein',           -- Eiswein
                                       'strohwein',         -- Strohwein / Schilfwein
                                       'dac',               -- DAC (Districtus Austriae Controllatus)
                                       'reserve',           -- Reservé / Reserve
                                       'erste_lage',        -- Erste Lage (ÖTW)
                                       'grosses_gewachs',   -- Großes Gewächs
                                       'landwein',          -- Landwein / Wein ohne Herkunftsangabe
                                       'sekt',              -- Sekt b.A.
                                       'perlwein',          -- Perlwein
                                       'sonstiges'
                                     )),
  anbaugebiet           text,                               -- z.B. "Traisental", "Wachau", …
  bezeichnung           text,                               -- optionaler Subname, z.B. "Ried Hohenberg"

  -- Abfüllung
  datum                 date         not null default current_date,
  flaschengroesse_ml    integer      not null default 750
                                     check (flaschengroesse_ml in (187,375,500,750,1000,1500,3000,6000)),
  anzahl_flaschen       integer      not null check (anzahl_flaschen > 0),
  bestand_flaschen      integer      not null check (bestand_flaschen >= 0),
  menge_liter_gefuellt  numeric(10,2),                      -- tatsächlich abgefüllte Liter

  -- Preis (österreichische Weinsteuer: 13% MwSt.)
  vk_preis_brutto       numeric(10,2),
  mwst_pct              numeric(5,2) not null default 13,

  -- Sonstiges
  notizen               text,
  aktiv                 boolean      not null default true,
  erstellt_am           timestamptz  not null default now(),
  aktualisiert_am       timestamptz  not null default now()
);

comment on table fuellungen is 'Abfüllungsereignisse: Kellerbuch-Charge → Weinhandel-Artikel';
comment on column fuellungen.bestand_flaschen is 'Aktueller Lagerbestand (wird durch Verkäufe dekrementiert)';
comment on column fuellungen.anzahl_flaschen  is 'Ursprüngliche Flaschenzahl bei der Abfüllung';

create trigger fuellungen_updated_at
  before update on fuellungen
  for each row execute function update_updated_at();

create index idx_fuellungen_tenant_id     on fuellungen(tenant_id);
create index idx_fuellungen_weinausbau_id on fuellungen(weinausbau_id);
create index idx_fuellungen_aktiv         on fuellungen(tenant_id, aktiv);
create index idx_fuellungen_datum         on fuellungen(tenant_id, datum desc);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table fuellungen enable row level security;

create policy "fuellungen_select" on fuellungen
  for select using (
    tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())
  );

create policy "fuellungen_insert" on fuellungen
  for insert with check (
    user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
  );

create policy "fuellungen_update" on fuellungen
  for update using (
    user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
  );

create policy "fuellungen_delete" on fuellungen
  for delete using (
    user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin'])
  );
