-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 021: Tenant-Einstellungen (Branding, Module-Toggles, Brevo)
-- ─────────────────────────────────────────────────────────────────────────────

create table tenant_einstellungen (
  tenant_id           uuid        primary key references tenants(id) on delete cascade,

  -- ── Branding ────────────────────────────────────────────────────────────────
  anzeigename         text,                          -- z.B. "Weingut Gebeshuber"
  logo_url            text,                          -- öffentliche URL oder /logos/...
  primary_color       text        default '#2a7c6f', -- Haupt-Akzentfarbe (HEX)
  secondary_color     text        default '#f5c842', -- Sekundär-Akzentfarbe (HEX)

  -- ── Module-Toggles ──────────────────────────────────────────────────────────
  modul_newsletter    boolean     not null default false,
  modul_crm           boolean     not null default true,
  modul_kellerbuch    boolean     not null default true,
  modul_weingarten    boolean     not null default true,

  -- ── Newsletter / Brevo (per-Tenant) ─────────────────────────────────────────
  brevo_api_key       text,                          -- Supabase Vault empfohlen
  brevo_sender_mail   text,
  brevo_sender_name   text,
  brevo_list_privat   int,
  brevo_list_gastro   int,
  brevo_list_handel   int,
  brevo_list_export   int,
  brevo_list_grossh   int,

  aktualisiert_am     timestamptz not null default now()
);

comment on table tenant_einstellungen is 'Pro-Tenant: Branding, Module-Flags, Brevo-Konfiguration';

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table tenant_einstellungen enable row level security;

-- Jedes Tenant-Mitglied kann die eigenen Einstellungen lesen
create policy "einst_select" on tenant_einstellungen
  for select using (tenant_id in (
    select tenant_id from tenant_memberships where user_id = auth.uid()
  ));

-- Nur tenant_admin und system_admin dürfen schreiben
create policy "einst_upsert" on tenant_einstellungen
  for all using (
    user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin'])
  );

-- ── Standard-Einstellungen für bestehende Tenants ────────────────────────────
-- Wird per Admin-UI gesetzt; hier nur Sandbox-Defaults eintragen
insert into tenant_einstellungen (tenant_id, anzeigename, logo_url, modul_newsletter)
select id, name, null, false
from tenants
on conflict (tenant_id) do nothing;
