-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 005 – Benutzerprofile
-- Erweitert auth.users um Anzeigenamen und Avatar (optional)
-- ─────────────────────────────────────────────────────────────────────────────

create table profiles (
  id            uuid        primary key references auth.users(id) on delete cascade,
  display_name  text,
  avatar_url    text,
  telefon       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table profiles is 'Erweiterte Benutzerprofile (1:1 zu auth.users)';

create trigger profiles_updated_at
  before update on profiles
  for each row execute function update_updated_at();

-- Automatisch Profil anlegen wenn neuer User registriert wird
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ─── RLS ──────────────────────────────────────────────────────────────────────
alter table profiles enable row level security;

-- Jeder sieht sein eigenes Profil
create policy "profiles: own profile select"
  on profiles for select
  using (id = auth.uid());

-- Tenant-Mitglieder sehen Profile ihrer Kollegen
create policy "profiles: tenant members can see each other"
  on profiles for select
  using (
    id in (
      select user_id from tenant_memberships
      where tenant_id in (select get_user_tenant_ids())
    )
  );

-- Nur eigenes Profil bearbeiten
create policy "profiles: update own"
  on profiles for update
  using (id = auth.uid());
