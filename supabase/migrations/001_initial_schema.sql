-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 001 – Initial Schema
-- software:112 | Datum: 2026-05-26
-- ─────────────────────────────────────────────────────────────────────────────

-- Extensions
create extension if not exists "uuid-ossp";

-- ─── TENANTS ──────────────────────────────────────────────────────────────────
-- Jeder Weinbaubetrieb ist ein Tenant
create table tenants (
  id          uuid        primary key default uuid_generate_v4(),
  name        text        not null,
  slug        text        unique not null,
  plan        text        not null default 'trial'
                          check (plan in ('trial', 'starter', 'pro', 'enterprise')),
  active      boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table tenants is 'Weinbaubetriebe als Mandanten';
comment on column tenants.slug is 'URL-freundlicher Name, z.B. weingut-muster';
comment on column tenants.plan is 'Abo-Plan: trial → starter → pro → enterprise';

-- ─── TENANT MEMBERSHIPS ───────────────────────────────────────────────────────
-- Verbindet auth.users mit Tenants + Rolle
-- Basis des gesamten Rollenmodells
create table tenant_memberships (
  id          uuid        primary key default uuid_generate_v4(),
  tenant_id   uuid        not null references tenants(id) on delete cascade,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  role        text        not null
                          check (role in ('system_admin', 'tenant_admin', 'winzer', 'leser')),
  created_at  timestamptz not null default now(),
  unique(tenant_id, user_id)
);

comment on table tenant_memberships is 'User-Tenant-Zuordnung mit Rollenmodell';
comment on column tenant_memberships.role is
  'system_admin: Plattform-Admin | tenant_admin: Betriebsleiter | winzer: Kellermeister | leser: Nur-Lesen';

-- ─── WEINGARTEN ───────────────────────────────────────────────────────────────
-- Weingartenkataster (Modul 1)
create table weingarten (
  id              uuid        primary key default uuid_generate_v4(),
  tenant_id       uuid        not null references tenants(id) on delete cascade,
  name            text        not null,
  ried            text,
  flaeche_ha      numeric(10, 4),
  rebsorte        text,
  pflanzjahr      integer     check (pflanzjahr between 1900 and 2100),
  bewirtschaftung text        check (bewirtschaftung in
                              ('konventionell', 'bio', 'in_umstellung', 'demeter')),
  notizen         text,
  aktiv           boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table weingarten is 'Weingartenkataster – Stammdaten je Betrieb';
comment on column weingarten.ried is 'Lagename / Riede';
comment on column weingarten.bewirtschaftung is
  'konventionell | bio | in_umstellung | demeter';

-- ─── TRIGGER: updated_at automatisch setzen ───────────────────────────────────
create or replace function update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tenants_updated_at
  before update on tenants
  for each row execute function update_updated_at();

create trigger weingarten_updated_at
  before update on weingarten
  for each row execute function update_updated_at();

-- ─── INDIZES ──────────────────────────────────────────────────────────────────
create index idx_tenant_memberships_user_id   on tenant_memberships(user_id);
create index idx_tenant_memberships_tenant_id on tenant_memberships(tenant_id);
create index idx_weingarten_tenant_id         on weingarten(tenant_id);
create index idx_weingarten_aktiv             on weingarten(tenant_id, aktiv);
