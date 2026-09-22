-- 224: Aufgabenzuweisung (verantwortlich / für alle), Benachrichtigungen (Glocke + E-Mail)
-- Übernommen aus der Hohenstein Suite (Migration 022), angepasst an s112 (tenant_id, mitgliedschaft_aktiv).
-- Angewendet: 22.09.2026

-- 1) Aktivitäten: Verantwortlicher / „für alle“
alter table aktivitaeten add column if not exists verantwortlich_id uuid references auth.users(id) on delete set null;
alter table aktivitaeten add column if not exists fuer_alle boolean not null default false;
create index if not exists idx_aktivitaeten_verantwortlich on aktivitaeten (tenant_id, verantwortlich_id) where erledigt = false;

comment on column aktivitaeten.verantwortlich_id is 'Zugewiesener Benutzer; null = Betriebsaufgabe (niemand konkret)';
comment on column aktivitaeten.fuer_alle is 'Aufgabe/Termin gilt für alle Mitglieder des Betriebs';

-- 2) Profil: E-Mail-Benachrichtigung abschaltbar
alter table profiles add column if not exists benachrichtigung_email boolean not null default true;

-- 3) Benachrichtigungen (In-App)
create table if not exists benachrichtigungen (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  empfaenger_id     uuid not null references auth.users(id) on delete cascade,
  ausgeloest_von    uuid references auth.users(id) on delete set null,
  art               text not null check (art in ('aufgabe_zugewiesen','aufgabe_alle','erwaehnung','system')),
  titel             text not null,
  text              text,
  href              text,
  quelle_typ        text,
  quelle_id         uuid,
  gelesen_am        timestamptz,
  email_gesendet_am timestamptz,
  erstellt_am       timestamptz not null default now()
);

create index if not exists idx_benachr_empfaenger_offen on benachrichtigungen (empfaenger_id, erstellt_am desc) where gelesen_am is null;

alter table benachrichtigungen enable row level security;

-- Nur der Empfänger sieht/ändert/löscht seine Benachrichtigungen; Einfügen ausschließlich über service_role (Server).
drop policy if exists benachr_select on benachrichtigungen;
create policy benachr_select on benachrichtigungen for select to authenticated
  using (empfaenger_id = (select auth.uid()));
drop policy if exists benachr_update on benachrichtigungen;
create policy benachr_update on benachrichtigungen for update to authenticated
  using (empfaenger_id = (select auth.uid())) with check (empfaenger_id = (select auth.uid()));
drop policy if exists benachr_delete on benachrichtigungen;
create policy benachr_delete on benachrichtigungen for delete to authenticated
  using (empfaenger_id = (select auth.uid()));

-- Gesperrte Mitgliedschaft sperrt auch hier (wie Migration 221)
drop policy if exists mitgliedschaft_aktiv on benachrichtigungen;
create policy mitgliedschaft_aktiv on benachrichtigungen as restrictive for all to authenticated
  using (not (tenant_id in (select s112_gesperrte_tenants())))
  with check (not (tenant_id in (select s112_gesperrte_tenants())));

-- 4) Mitglieder eines Betriebs (für Zuweisungs-Auswahl) – nur für aktive Mitglieder desselben Betriebs
create or replace function public.s112_mandant_mitglieder(p_tenant_id uuid)
returns table(user_id uuid, name text, role text)
language sql stable security definer set search_path = public as $$
  select m.user_id,
         coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.display_name), ''), split_part(u.email, '@', 1)) as name,
         m.role
  from tenant_memberships m
  join auth.users u on u.id = m.user_id
  left join profiles p on p.id = m.user_id
  where m.tenant_id = p_tenant_id and m.aktiv = true
    and exists (select 1 from tenant_memberships me where me.tenant_id = p_tenant_id and me.user_id = auth.uid() and me.aktiv = true)
$$;
revoke all on function public.s112_mandant_mitglieder(uuid) from public;
grant execute on function public.s112_mandant_mitglieder(uuid) to authenticated, service_role;

-- 5) Mitglieder mit E-Mail (nur Server/service_role – für den Versand)
create or replace function public.s112_mandant_mitglieder_mit_email(p_tenant_id uuid)
returns table(user_id uuid, name text, email text, benachrichtigung_email boolean)
language sql stable security definer set search_path = public as $$
  select m.user_id,
         coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.display_name), ''), split_part(u.email, '@', 1)) as name,
         u.email::text,
         coalesce(p.benachrichtigung_email, true)
  from tenant_memberships m
  join auth.users u on u.id = m.user_id
  left join profiles p on p.id = m.user_id
  where m.tenant_id = p_tenant_id and m.aktiv = true
$$;
revoke all on function public.s112_mandant_mitglieder_mit_email(uuid) from public;
grant execute on function public.s112_mandant_mitglieder_mit_email(uuid) to service_role;
