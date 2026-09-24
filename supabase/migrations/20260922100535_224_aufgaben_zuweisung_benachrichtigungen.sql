-- 224: Aufgaben-/Terminzuweisung, Benachrichtigungen (Glocke + E-Mail) – übernommen aus der Hohenstein Suite (Migration 022)
alter table aktivitaeten add column if not exists verantwortlich_id uuid references auth.users(id) on delete set null;
alter table aktivitaeten add column if not exists fuer_alle boolean not null default false;
comment on column aktivitaeten.verantwortlich_id is 'Zuständiger Benutzer (Aufgabe/Termin „meine“); NULL = Betrieb allgemein';
comment on column aktivitaeten.fuer_alle is 'Aufgabe/Termin für das ganze Team (Verantwortlich „Alle“); verantwortlich_id ist dann NULL';
create index if not exists idx_aktivitaeten_verantwortlich on aktivitaeten (tenant_id, verantwortlich_id) where erledigt = false;

alter table profiles add column if not exists benachrichtigung_email boolean not null default true;
comment on column profiles.benachrichtigung_email is 'E-Mail bei Zuweisung/Erwähnung (Aufgaben, Termine) – im Profil abschaltbar';

create table if not exists benachrichtigungen (
  id                uuid        primary key default gen_random_uuid(),
  tenant_id         uuid        not null references tenants(id) on delete cascade,
  empfaenger_id     uuid        not null references auth.users(id) on delete cascade,
  ausgeloest_von    uuid        references auth.users(id) on delete set null,
  art               text        not null check (art in ('aufgabe_zugewiesen', 'aufgabe_alle', 'erwaehnung', 'system')),
  titel             text        not null,
  text              text,
  href              text,
  quelle_typ        text,
  quelle_id         uuid,
  gelesen_am        timestamptz,
  email_gesendet_am timestamptz,
  erstellt_am       timestamptz not null default now()
);
comment on table benachrichtigungen is 'In-App-Benachrichtigungen (Glocke): Zuweisung, Erwähnung (@Name), Team-Aufgaben (Migration 224)';
alter table benachrichtigungen enable row level security;
-- Lesen / als gelesen markieren / löschen: nur die eigenen. Anlegen nur über den Admin-Client (Server).
drop policy if exists benachr_select on benachrichtigungen;
create policy benachr_select on benachrichtigungen for select to authenticated using (empfaenger_id = (select auth.uid()));
drop policy if exists benachr_update on benachrichtigungen;
create policy benachr_update on benachrichtigungen for update to authenticated using (empfaenger_id = (select auth.uid())) with check (empfaenger_id = (select auth.uid()));
drop policy if exists benachr_delete on benachrichtigungen;
create policy benachr_delete on benachrichtigungen for delete to authenticated using (empfaenger_id = (select auth.uid()));
drop policy if exists mitgliedschaft_aktiv on benachrichtigungen;
create policy mitgliedschaft_aktiv on benachrichtigungen as restrictive for all to authenticated
  using (tenant_id not in (select s112_gesperrte_tenants())) with check (tenant_id not in (select s112_gesperrte_tenants()));
create index if not exists idx_benachr_empfaenger_offen on benachrichtigungen (empfaenger_id, erstellt_am desc) where gelesen_am is null;

-- Mitglieder des Betriebs mit Name (für die Verantwortlich-Auswahl; jedes aktive Mitglied darf sie sehen)
create or replace function s112_mandant_mitglieder(p_tenant_id uuid)
returns table(user_id uuid, name text, role text)
language sql security definer stable set search_path = public as $$
  select m.user_id,
         coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.display_name), ''), split_part(u.email, '@', 1)) as name,
         m.role
  from tenant_memberships m
  join auth.users u on u.id = m.user_id
  left join profiles p on p.id = m.user_id
  where m.tenant_id = p_tenant_id and m.aktiv = true
    and exists (select 1 from tenant_memberships me where me.tenant_id = p_tenant_id and me.user_id = auth.uid() and me.aktiv = true)
$$;
revoke execute on function s112_mandant_mitglieder(uuid) from public, anon;
grant execute on function s112_mandant_mitglieder(uuid) to authenticated, service_role;

-- Mitglieder mit E-Mail (nur Service-Role, für den Mailversand)
create or replace function s112_mandant_mitglieder_mit_email(p_tenant_id uuid)
returns table(user_id uuid, name text, email text, benachrichtigung_email boolean)
language sql security definer stable set search_path = public as $$
  select m.user_id,
         coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.display_name), ''), split_part(u.email, '@', 1)) as name,
         u.email::text,
         coalesce(p.benachrichtigung_email, true)
  from tenant_memberships m
  join auth.users u on u.id = m.user_id
  left join profiles p on p.id = m.user_id
  where m.tenant_id = p_tenant_id and m.aktiv = true
$$;
revoke execute on function s112_mandant_mitglieder_mit_email(uuid) from public, anon, authenticated;
grant execute on function s112_mandant_mitglieder_mit_email(uuid) to service_role;;
