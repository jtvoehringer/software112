-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 019: CRM – Kontakte, Firmen, Segmente
-- Kundensegmente: privat | gastronomie | handel | export | grosshandel
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Segmente (Enum) ───────────────────────────────────────────────────────────
create type kundensegment as enum (
  'privat',
  'gastronomie',
  'handel',
  'export',
  'grosshandel'
);

-- ── Firmen ────────────────────────────────────────────────────────────────────
create table firmen (
  id              uuid          primary key default uuid_generate_v4(),
  tenant_id       uuid          not null references tenants(id) on delete cascade,
  name            text          not null,
  segment         kundensegment not null default 'handel',
  strasse         text,
  plz             text,
  ort             text,
  land            text          default 'AT',
  telefon         text,
  email           text,
  website         text,
  uid_nummer      text,                          -- Umsatzsteuer-ID (B2B)
  kreditlimit     numeric(10,2),                 -- für Gastronomie/Handel
  zahlungsziel_tage int         default 30,
  waehrung        text          default 'EUR',   -- für Export
  incoterms       text,                          -- für Export (z.B. DAP, CIF)
  importeur_von   text,                          -- für Export: Importeur-Kontakt
  notizen         text,
  aktiv           boolean       not null default true,
  erstellt_am     timestamptz   not null default now(),
  aktualisiert_am timestamptz   not null default now()
);
comment on table firmen is 'CRM: Unternehmen (Gastronomie, Handel, Export, Großhandel)';

-- ── Kontakte (Personen) ───────────────────────────────────────────────────────
create table kontakte (
  id              uuid          primary key default uuid_generate_v4(),
  tenant_id       uuid          not null references tenants(id) on delete cascade,
  vorname         text,
  nachname        text          not null,
  segment         kundensegment not null default 'privat',
  firma_id        uuid          references firmen(id) on delete set null,  -- Haupt-Firma
  email           text,
  telefon         text,
  mobil           text,
  strasse         text,
  plz             text,
  ort             text,
  land            text          default 'AT',
  geburtsdatum    date,
  newsletter      boolean       not null default false,
  newsletter_opt_in_am  timestamptz,             -- DSGVO: Zeitstempel Double Opt-in
  newsletter_token      text,                    -- für Double Opt-in Flow
  newsletter_bestaetigt boolean not null default false,
  sprache         text          default 'de',    -- für Export: Kommunikationssprache
  weingut_ansprechpartner text,                  -- wer bei uns ist zuständig
  stammkunde      boolean       not null default false,
  notizen         text,
  aktiv           boolean       not null default true,
  erstellt_am     timestamptz   not null default now(),
  aktualisiert_am timestamptz   not null default now()
);
comment on table kontakte is 'CRM: Personen (B2C Privatkunden + B2B Ansprechpartner)';

-- ── Kontakt ↔ Firma (m:n für Personen in mehreren Firmen) ────────────────────
create table kontakt_firmen (
  id          uuid  primary key default uuid_generate_v4(),
  kontakt_id  uuid  not null references kontakte(id) on delete cascade,
  firma_id    uuid  not null references firmen(id) on delete cascade,
  position    text,                              -- z.B. "Einkauf", "Geschäftsführer"
  hauptkontakt boolean not null default false,
  unique (kontakt_id, firma_id)
);
comment on table kontakt_firmen is 'CRM: m:n Verknüpfung Personen ↔ Firmen';

-- ── Weinpräferenzen je Kontakt ────────────────────────────────────────────────
create table kontakt_praeferenzen (
  id            uuid  primary key default uuid_generate_v4(),
  kontakt_id    uuid  not null references kontakte(id) on delete cascade,
  rebsorte      text,
  geschmack     text,  -- z.B. trocken, halbtrocken, lieblich
  preisklasse   text,  -- z.B. Einstieg, Mitte, Premium
  notizen       text
);

-- ── DSGVO Consent-Log ─────────────────────────────────────────────────────────
create table datenschutz_consents (
  id            uuid        primary key default uuid_generate_v4(),
  tenant_id     uuid        not null references tenants(id) on delete cascade,
  kontakt_id    uuid        references kontakte(id) on delete set null,
  email         text        not null,
  aktion        text        not null,  -- 'opt_in_angefragt' | 'opt_in_bestaetigt' | 'opt_out'
  ip_adresse    text,
  user_agent    text,
  quelle        text,                  -- z.B. 'website_formular' | 'manuell'
  erstellt_am   timestamptz not null default now()
);
comment on table datenschutz_consents is 'DSGVO: unveränderliches Consent-Protokoll für Newsletter';

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table firmen                 enable row level security;
alter table kontakte               enable row level security;
alter table kontakt_firmen         enable row level security;
alter table kontakt_praeferenzen   enable row level security;
alter table datenschutz_consents   enable row level security;

-- firmen
create policy "firmen_select" on firmen
  for select using (tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid()));
create policy "firmen_insert" on firmen
  for insert with check (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));
create policy "firmen_update" on firmen
  for update using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));
create policy "firmen_delete" on firmen
  for delete using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));

-- kontakte
create policy "kontakte_select" on kontakte
  for select using (tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid()));
create policy "kontakte_insert" on kontakte
  for insert with check (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));
create policy "kontakte_update" on kontakte
  for update using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));
create policy "kontakte_delete" on kontakte
  for delete using (user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer']));

-- kontakt_firmen (via kontakt tenant check)
create policy "kf_select" on kontakt_firmen
  for select using (kontakt_id in (select id from kontakte where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())));
create policy "kf_insert" on kontakt_firmen
  for insert with check (kontakt_id in (select id from kontakte where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())));
create policy "kf_update" on kontakt_firmen
  for update using (kontakt_id in (select id from kontakte where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())));
create policy "kf_delete" on kontakt_firmen
  for delete using (kontakt_id in (select id from kontakte where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())));

-- kontakt_praeferenzen
create policy "kp_select" on kontakt_praeferenzen
  for select using (kontakt_id in (select id from kontakte where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())));
create policy "kp_insert" on kontakt_praeferenzen
  for insert with check (kontakt_id in (select id from kontakte where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())));
create policy "kp_update" on kontakt_praeferenzen
  for update using (kontakt_id in (select id from kontakte where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())));
create policy "kp_delete" on kontakt_praeferenzen
  for delete using (kontakt_id in (select id from kontakte where tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid())));

-- datenschutz_consents (select für Admins, insert public via server action)
create policy "consent_select" on datenschutz_consents
  for select using (tenant_id in (select tenant_id from tenant_memberships where user_id = auth.uid()));
create policy "consent_insert" on datenschutz_consents
  for insert with check (true);  -- öffentlich (Newsletter-Formular), Server Action validiert

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index idx_firmen_tenant        on firmen(tenant_id);
create index idx_firmen_segment       on firmen(tenant_id, segment);
create index idx_kontakte_tenant      on kontakte(tenant_id);
create index idx_kontakte_segment     on kontakte(tenant_id, segment);
create index idx_kontakte_email       on kontakte(tenant_id, email);
create index idx_kontakte_newsletter  on kontakte(tenant_id, newsletter, newsletter_bestaetigt);
create index idx_kf_kontakt           on kontakt_firmen(kontakt_id);
create index idx_kf_firma             on kontakt_firmen(firma_id);
create index idx_consent_tenant       on datenschutz_consents(tenant_id, erstellt_am desc);
create index idx_consent_email        on datenschutz_consents(email, erstellt_am desc);
