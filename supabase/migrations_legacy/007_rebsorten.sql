-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 007 – Rebsorten (österreichische Rebsortenliste)
-- Lookup-Tabelle nach Weingesetz + Zuordnung zu Weingärten
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── REBSORTEN LOOKUP (global, kein tenant_id) ───────────────────────────────
create table rebsorten (
  id              uuid        primary key default uuid_generate_v4(),
  kuerzel         text        unique not null,   -- z.B. 'GV', 'RR', 'WR'
  name_de         text        not null,          -- Grüner Veltliner
  name_synonym    text,                          -- Veltliner, Weißgipfler
  farbe           text        not null check (farbe in ('weiss', 'rot', 'rose', 'grau')),
  herkunft        text,                          -- Österreich, International
  oiv_code        text,                          -- OIV Sortenregister-Code
  at_weingesetz   boolean     not null default true,  -- nach AT Weingesetz zugelassen
  bio_geeignet    boolean     not null default false,
  aktiv           boolean     not null default true
);

comment on table rebsorten is 'Österreichische Rebsortenliste (Lookuptabelle, global)';
comment on column rebsorten.kuerzel is 'Offizielle AT-Abkürzung z.B. GV=Grüner Veltliner';

-- ─── WEINGARTEN-REBSORTEN (Zuordnung Parzelle → Sorte + Anteile) ─────────────
create table weingarten_rebsorten (
  id              uuid        primary key default uuid_generate_v4(),
  weingarten_id   uuid        not null references weingarten(id) on delete cascade,
  rebsorte_id     uuid        not null references rebsorten(id),
  anteil_pct      numeric(5,2) check (anteil_pct between 0 and 100),
  pflanzjahr      integer     check (pflanzjahr between 1900 and 2100),
  stock_anzahl    integer,
  klon            text,
  unterlage       text,       -- Pfropfrebe-Unterlage
  reihenabstand_m numeric(4,2),
  stockabstand_m  numeric(4,2),
  created_at      timestamptz not null default now()
);

comment on table weingarten_rebsorten is 'Rebsorten-Zusammensetzung je Weingarten-Parzelle';

create index idx_wg_rebsorten_weingarten on weingarten_rebsorten(weingarten_id);
create index idx_wg_rebsorten_rebsorte   on weingarten_rebsorten(rebsorte_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
-- Rebsorten-Lookup: jeder kann lesen (keine Tenant-Bindung)
alter table rebsorten enable row level security;
create policy "rebsorten: everyone can read"
  on rebsorten for select using (true);
create policy "rebsorten: only system_admin can modify"
  on rebsorten for all
  using (exists (
    select 1 from tenant_memberships
    where user_id = auth.uid() and role = 'system_admin'
  ));

-- Weingarten-Rebsorten: Tenant-RLS
alter table weingarten_rebsorten enable row level security;

create policy "wg_rebsorten: select via weingarten"
  on weingarten_rebsorten for select
  using (
    weingarten_id in (
      select id from weingarten
      where tenant_id in (select get_user_tenant_ids())
    )
  );

create policy "wg_rebsorten: winzer+ can insert"
  on weingarten_rebsorten for insert
  with check (
    weingarten_id in (
      select id from weingarten
      where user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
    )
  );

create policy "wg_rebsorten: winzer+ can update"
  on weingarten_rebsorten for update
  using (
    weingarten_id in (
      select id from weingarten
      where user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
    )
  );

create policy "wg_rebsorten: admin can delete"
  on weingarten_rebsorten for delete
  using (
    weingarten_id in (
      select id from weingarten
      where user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin'])
    )
  );

-- ─── ÖSTERREICHISCHE REBSORTEN SEED-DATEN ────────────────────────────────────
insert into rebsorten (kuerzel, name_de, name_synonym, farbe, herkunft, at_weingesetz) values
  -- Weiße Leitrebsorten AT
  ('GV',  'Grüner Veltliner',     'Veltliner, Weißgipfler',       'weiss', 'Österreich', true),
  ('WR',  'Welschriesling',       'Riesling italico',              'weiss', 'Österreich', true),
  ('RR',  'Riesling',             'Rheinriesling, Rheingold',      'weiss', 'Deutschland', true),
  ('WB',  'Weißburgunder',        'Pinot Blanc, Pinot Weiss',      'weiss', 'Frankreich', true),
  ('GB',  'Grauburgunder',        'Pinot Gris, Ruländer, Malvoisie','grau', 'Frankreich', true),
  ('SB',  'Sauvignon Blanc',      'Muskat-Silvaner',               'weiss', 'Frankreich', true),
  ('CH',  'Chardonnay',           'Morillon (Steiermark)',         'weiss', 'Frankreich', true),
  ('MU',  'Muskateller',          'Gelber Muskateller',            'weiss', 'International', true),
  ('TR',  'Traminer',             'Gewürztraminer, Roter Traminer','grau',  'Österreich', true),
  ('ZW',  'Zweigelt',             'Blauer Zweigelt, Rotburger',    'rot',   'Österreich', true),
  ('BF',  'Blaufränkisch',        'Lemberger, Kékfrankos',         'rot',   'Österreich', true),
  ('SL',  'St. Laurent',          'Sankt Laurent',                 'rot',   'Österreich', true),
  ('PB',  'Blauburgunder',        'Pinot Noir, Spätburgunder',     'rot',   'Frankreich', true),
  ('MB',  'Merlot',               null,                            'rot',   'Frankreich', true),
  ('CS',  'Cabernet Sauvignon',   null,                            'rot',   'Frankreich', true),
  ('SY',  'Syrah',                'Shiraz',                        'rot',   'Frankreich', true),
  ('BW',  'Blauweißer Muskateller',null,                           'weiss', 'Österreich', true),
  ('NB',  'Neuburger',            null,                            'weiss', 'Österreich', true),
  ('MO',  'Morillon',             'Chardonnay (Steiermark)',       'weiss', 'Steiermark', true),
  ('SF',  'Schilcher',            'Blauer Wildbacher',             'rot',   'Steiermark', true),
  ('RO',  'Roesler',              null,                            'rot',   'Österreich', true),
  ('MA',  'Marselan',             null,                            'rot',   'Frankreich', true),
  ('VE',  'Veltliner rot',        'Roter Veltliner',               'rot',   'Österreich', true),
  ('PR',  'Primitivo',            'Zinfandel',                     'rot',   'Italien', true),
  ('GS',  'Gemischter Satz',      'Wiener Gemischter Satz',        'weiss', 'Wien', true);
