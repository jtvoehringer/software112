-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 002 – Row Level Security (RLS)
-- software:112 | Datum: 2026-05-26
--
-- DESIGN-PRINZIP:
-- Jeder Datenbankzugriff läuft durch RLS. Kein Code-Layer kann das umgehen.
-- Die Grundregel: Ein User sieht nur Daten seines/r Tenant(s).
-- Rollen steuern Schreib- und Löschrechte zusätzlich.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── RLS aktivieren ───────────────────────────────────────────────────────────
alter table tenants              enable row level security;
alter table tenant_memberships   enable row level security;
alter table weingarten           enable row level security;

-- ─── HELPER FUNCTIONS ─────────────────────────────────────────────────────────
-- SECURITY DEFINER: läuft mit DB-Owner-Rechten, umgeht keine RLS,
-- aber ermöglicht effiziente Subqueries ohne Rekursion.

-- Gibt alle tenant_ids zurück, zu denen der eingeloggte User gehört
create or replace function get_user_tenant_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select tenant_id
  from tenant_memberships
  where user_id = auth.uid()
$$;

-- Gibt die Rolle des Users für einen bestimmten Tenant zurück
create or replace function get_user_role_in_tenant(p_tenant_id uuid)
returns text
language sql
security definer
stable
as $$
  select role
  from tenant_memberships
  where user_id     = auth.uid()
    and tenant_id   = p_tenant_id
  limit 1
$$;

-- Prüft ob User mindestens eine bestimmte Rolle hat (für vereinfachte Policies)
create or replace function user_has_role_in_tenant(
  p_tenant_id uuid,
  p_roles     text[]
)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1
    from tenant_memberships
    where user_id   = auth.uid()
      and tenant_id = p_tenant_id
      and role      = any(p_roles)
  )
$$;

-- ─── TENANTS POLICIES ─────────────────────────────────────────────────────────
-- Jeder User darf seine eigenen Tenants lesen
create policy "tenants: user can view own tenants"
  on tenants
  for select
  using (id in (select get_user_tenant_ids()));

-- Nur system_admin darf Tenants anlegen
create policy "tenants: only system_admin can insert"
  on tenants
  for insert
  with check (
    exists (
      select 1 from tenant_memberships
      where user_id = auth.uid()
        and role    = 'system_admin'
    )
  );

-- Tenant-Admin darf den eigenen Tenant aktualisieren
create policy "tenants: tenant_admin can update own tenant"
  on tenants
  for update
  using (
    user_has_role_in_tenant(id, array['system_admin', 'tenant_admin'])
  );

-- ─── TENANT MEMBERSHIPS POLICIES ──────────────────────────────────────────────
-- User sieht nur seine eigenen Memberships
create policy "memberships: user can view own memberships"
  on tenant_memberships
  for select
  using (user_id = auth.uid());

-- tenant_admin sieht alle Memberships seines Tenants
create policy "memberships: tenant_admin can view all in tenant"
  on tenant_memberships
  for select
  using (
    user_has_role_in_tenant(tenant_id, array['system_admin', 'tenant_admin'])
  );

-- tenant_admin kann neue User zu seinem Tenant hinzufügen
create policy "memberships: tenant_admin can insert"
  on tenant_memberships
  for insert
  with check (
    user_has_role_in_tenant(tenant_id, array['system_admin', 'tenant_admin'])
  );

-- tenant_admin kann Rollen ändern (nicht seine eigene!)
create policy "memberships: tenant_admin can update roles"
  on tenant_memberships
  for update
  using (
    user_has_role_in_tenant(tenant_id, array['system_admin', 'tenant_admin'])
    and user_id != auth.uid()  -- Eigene Rolle kann man nicht selbst ändern
  );

-- tenant_admin kann User entfernen
create policy "memberships: tenant_admin can delete"
  on tenant_memberships
  for delete
  using (
    user_has_role_in_tenant(tenant_id, array['system_admin', 'tenant_admin'])
    and user_id != auth.uid()  -- Sich selbst kann man nicht entfernen
  );

-- ─── WEINGARTEN POLICIES ──────────────────────────────────────────────────────
-- Alle Mitglieder eines Tenants können Weingärten lesen
create policy "weingarten: all members can select"
  on weingarten
  for select
  using (tenant_id in (select get_user_tenant_ids()));

-- winzer, tenant_admin, system_admin können Weingärten anlegen
create policy "weingarten: winzer+ can insert"
  on weingarten
  for insert
  with check (
    user_has_role_in_tenant(tenant_id, array['system_admin', 'tenant_admin', 'winzer'])
  );

-- winzer, tenant_admin, system_admin können Weingärten aktualisieren
create policy "weingarten: winzer+ can update"
  on weingarten
  for update
  using (
    user_has_role_in_tenant(tenant_id, array['system_admin', 'tenant_admin', 'winzer'])
  );

-- Nur tenant_admin und system_admin können löschen
create policy "weingarten: admin can delete"
  on weingarten
  for delete
  using (
    user_has_role_in_tenant(tenant_id, array['system_admin', 'tenant_admin'])
  );
