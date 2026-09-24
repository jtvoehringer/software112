-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 020: CRM – Aktivitäten, Pipeline, Preislisten, Bestellungen
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Aktivitäten (Kommunikations-Log) ─────────────────────────────────────────
create table aktivitaeten (
  id              uuid        primary key default uuid_generate_v4(),
  tenant_id       uuid        not null references tenants(id) on delete cascade,
  kontakt_id      uuid        references kontakte(id) on delete set null,
  firma_id        uuid        references firmen(id) on delete set null,
  art             text        not null check (art in ('notiz','anruf','email','verkostung','messe','besuch','angebot','sonstiges')),
  betreff         text,
  beschreibung    text,
  datum           date        not null default current_date,
  erledigt        boolean     not null default true,
  faellig_am      date,
  erstellt_von    uuid        references auth.users(id),
  erstellt_am     timestamptz not null default now()
);
comment on table aktivitaeten is 'CRM: Kommunikations- und Aktivitäts-Log je Kontakt/Firma';

-- ── Verkaufs-Pipeline ────────────────────────────────────────────────────────
create type pipeline_stufe as enum (
  'interessent',
  'kontaktiert',
  'verkostung',
  'angebot',
  'verhandlung',
  'abschluss',
  'stammkunde',
  'verloren'
);

create table pipeline_eintraege (
  id              uuid          primary key default uuid_generate_v4(),
  tenant_id       uuid          not null references tenants(id) on delete cascade,
  kontakt_id      uuid          references kontakte(id) on delete set null,
  firma_id        uuid          references firmen(id) on delete set null,
  stufe           pipeline_stufe not null default 'interessent',
  titel           text          not null,
  wert_euro       numeric(10,2),                 -- geschätztes Auftragsvolumen
  wahrscheinlichkeit int        check (wahrscheinlichkeit between 0 and 100),
  erwartetes_datum date,
  notizen         text,
  erstellt_am     timestamptz   not null default now(),
  aktualisiert_am timestamptz   not null default now()
);
comment on table pipeline_eintraege is 'CRM: Verkaufschancen nach Stufen (Kanban-ähnlich)';

-- ── Pipeline-Verlauf (Stufenwechsel protokollieren) ──────────────────────────
create table pipeline_verlauf (
  id              uuid          primary key default uuid_generate_v4(),
  pipeline_id     uuid          not null references pipeline_eintraege(id) on delete cascade,
  stufe_von       pipeline_stufe,
  stufe_nach      pipeline_stufe not null,
  notizen         text,
  geaendert_von   uuid          references auth.users(id),
  geaendert_am    timestamptz   not null default now()
);

-- ── Preislisten je Segment ────────────────────────────────────────────────────
create table preislisten (
  id              uuid          primary key default uuid_generate_v4(),
  tenant_id       uuid          not null references tenants(id) on delete cascade,
  name            text          not null,
  segment         kundensegment not null,
  gueltig_ab      date          not null default current_date,
  gueltig_bis     date,
  aktiv           boolean       not null default true,
  erstellt_am     timestamptz   not null default now()
);

create table preislisten_positionen (
  id              uuid          primary key default uuid_generate_v4(),
  preisliste_id   uuid          not null references preislisten(id) on delete cascade,
  weinausbau_id   uuid          references weinausbau(id) on delete set null,
  bezeichnung     text          not null,  -- z.B. "Grüner Veltliner 2023 0,75l"
  einheit         text          not null default 'Flasche',
  preis_netto     numeric(8,2)  not null,
  mwst_pct        numeric(4,2)  not null default 20,
  rabatt_ab_menge int,          -- Mengenrabatt ab X Einheiten
  rabatt_pct      numeric(4,2)
);

-- ── Bestellungen ──────────────────────────────────────────────────────────────
create table bestellungen (
  id              uuid          primary key default uuid_generate_v4(),
  tenant_id       uuid          not null references tenants(id) on delete cascade,
  kontakt_id      uuid          references kontakte(id) on delete set null,
  firma_id        uuid          references firmen(id) on delete set null,
  bestellnummer   text,         -- wird per trigger befüllt
  status          text          not null default 'offen'
                  check (status in ('offen','bestaetigt','versandt','geliefert','storniert','bezahlt')),
  datum           date          not null default current_date,
  lieferdatum     date,
  gesamtbetrag    numeric(10,2),
  waehrung        text          default 'EUR',
  notizen         text,
  erstellt_am     timestamptz   not null default now(),
  aktualisiert_am timestamptz   not null default now()
);

create table bestellung_positionen (
  id              uuid          primary key default uuid_generate_v4(),
  bestellung_id   uuid          not null references bestellungen(id) on delete cascade,
  weinausbau_id   uuid          references weinausbau(id) on delete set null,
  bezeichnung     text          not null,
  menge           numeric(10,3) not null,
  einheit         text          not null default 'Flasche',
  preis_netto     numeric(8,2)  not null,
  mwst_pct        numeric(4,2)  not null default 20,
  rabatt_pct      numeric(4,2)  default 0
);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table aktivitaeten          enable row level security;
alter table pipeline_eintraege    enable row level security;
alter table pipeline_verlauf      enable row level security;
alter table preislisten           enable row level security;
alter table preislisten_positionen enable row level security;
alter table bestellungen          enable row level security;
alter table bestellung_positionen enable row level security;

-- aktivitaeten
create policy "akt_select" on aktivitaeten
  for select using (tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid()));
create policy "akt_insert" on aktivitaeten
  for insert with check (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));
create policy "akt_update" on aktivitaeten
  for update using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));
create policy "akt_delete" on aktivitaeten
  for delete using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));

-- pipeline
create policy "pipe_select" on pipeline_eintraege
  for select using (tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid()));
create policy "pipe_insert" on pipeline_eintraege
  for insert with check (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));
create policy "pipe_update" on pipeline_eintraege
  for update using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));
create policy "pipe_delete" on pipeline_eintraege
  for delete using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));

create policy "pipeverlauf_select" on pipeline_verlauf
  for select using (pipeline_id in (select id from pipeline_eintraege where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())));
create policy "pipeverlauf_insert" on pipeline_verlauf
  for insert with check (pipeline_id in (select id from pipeline_eintraege where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())));

-- preislisten
create policy "pl_select" on preislisten
  for select using (tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid()));
create policy "pl_insert" on preislisten
  for insert with check (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));
create policy "pl_update" on preislisten
  for update using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));
create policy "pl_delete" on preislisten
  for delete using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));

create policy "plpos_select" on preislisten_positionen
  for select using (preisliste_id in (select id from preislisten where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())));
create policy "plpos_insert" on preislisten_positionen
  for insert with check (preisliste_id in (select id from preislisten where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())));
create policy "plpos_update" on preislisten_positionen
  for update using (preisliste_id in (select id from preislisten where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())));
create policy "plpos_delete" on preislisten_positionen
  for delete using (preisliste_id in (select id from preislisten where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())));

-- bestellungen
create policy "best_select" on bestellungen
  for select using (tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid()));
create policy "best_insert" on bestellungen
  for insert with check (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));
create policy "best_update" on bestellungen
  for update using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));
create policy "best_delete" on bestellungen
  for delete using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));

create policy "bestpos_select" on bestellung_positionen
  for select using (bestellung_id in (select id from bestellungen where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())));
create policy "bestpos_insert" on bestellung_positionen
  for insert with check (bestellung_id in (select id from bestellungen where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())));
create policy "bestpos_update" on bestellung_positionen
  for update using (bestellung_id in (select id from bestellungen where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())));
create policy "bestpos_delete" on bestellung_positionen
  for delete using (bestellung_id in (select id from bestellungen where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())));

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index idx_akt_tenant         on aktivitaeten(tenant_id, datum desc);
create index idx_akt_kontakt        on aktivitaeten(kontakt_id);
create index idx_akt_firma          on aktivitaeten(firma_id);
create index idx_pipe_tenant        on pipeline_eintraege(tenant_id, stufe);
create index idx_pipe_kontakt       on pipeline_eintraege(kontakt_id);
create index idx_pipe_firma         on pipeline_eintraege(firma_id);
create index idx_pl_tenant          on preislisten(tenant_id, segment, aktiv);
create index idx_best_tenant        on bestellungen(tenant_id, datum desc);
create index idx_best_kontakt       on bestellungen(kontakt_id);
create index idx_best_firma         on bestellungen(firma_id);
