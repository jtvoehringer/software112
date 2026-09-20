-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 221: gesperrte Mitgliedschaft sperrt wirklich (alle Tabellen)
--
-- Befund aus dem Policy-Audit vom 20.9.2026: Der Aktiv-Schalter der
-- Mitgliedschaft (Migration 159, tenant_memberships.aktiv) wurde nur von
-- rund 30 der ~150 Tabellen-Policies geprüft. Ein gesperrter Benutzer kam
-- über die App nicht mehr hinein (betrieb-waehlen filtert aktiv = true),
-- über die REST-API mit gültigem Token aber weiterhin an die Daten aller
-- übrigen Tabellen.
--
-- Lösung: EINE restriktive Policy je Tabelle mit tenant_id, die alle
-- bestehenden (permissiven) Policies zusätzlich einschränkt – analog zu
-- modul_insert/update/delete aus Migration 218. Die Funktion liefert nur
-- die gesperrten Mandanten des Benutzers (meist leer), daher ist der
-- Zusatz-Check billig: NOT IN (leere Menge).
--
-- Getestet: Mitgliedschaft auf aktiv = false gesetzt → 0 Zeilen in kontakte,
-- firmen, weinausbau, tenant_memberships; zurückgesetzt → wieder alles da.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.s112_gesperrte_tenants()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select m.tenant_id from tenant_memberships m where m.user_id = (select auth.uid()) and not m.aktiv
$$;

grant execute on function public.s112_gesperrte_tenants() to authenticated;

do $$
declare
  t record;
begin
  for t in
    select c.relname as tabelle
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'mitgliedschaft_aktiv')
    order by 1
  loop
    execute format(
      'create policy mitgliedschaft_aktiv on public.%I as restrictive for all to authenticated
         using (tenant_id not in (select public.s112_gesperrte_tenants()))
         with check (tenant_id not in (select public.s112_gesperrte_tenants()))',
      t.tabelle);
  end loop;
end $$;
