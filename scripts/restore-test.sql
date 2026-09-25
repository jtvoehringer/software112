-- Wiederherstellungstest O5 (23.9.2026) – Kennzahlen für den Abgleich Produktion ↔ wiederhergestelltes Projekt.
-- Auf BEIDEN Projekten ausführen (SQL-Editor oder MCP) und die Ergebnisse vergleichen.
-- Abweichungen sind nur bei Tabellen zu erwarten, die seit dem Sicherungszeitpunkt geändert wurden.
with tabellen as (
  select table_name
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
),
fks as (
  -- Fremdschlüssel in public samt Spalten – wie scripts/fk-waisen.sql (KAN-124)
  select c.conrelid::regclass as tabelle,
         c.confrelid::regclass as ziel,
         array_agg(a.attname order by k.ord) as spalten,
         array_agg(z.attname order by k.ord) as zielspalten
  from pg_constraint c
  join pg_namespace n on n.oid = c.connamespace
  cross join lateral unnest(c.conkey, c.confkey) with ordinality as k(spalte, zielspalte, ord)
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.spalte
  join pg_attribute z on z.attrelid = c.confrelid and z.attnum = k.zielspalte
  where c.contype = 'f' and n.nspname = 'public'
  group by c.oid, c.conrelid, c.confrelid
)
select 'public.' || table_name as objekt,
       (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', table_name), false, true, '')))[1]::text::bigint as anzahl
from tabellen
union all select 'auth.users',            count(*) from auth.users
union all select 'auth.mfa_factors',      count(*) from auth.mfa_factors
union all select 'storage.objects (nur Metadaten!)', count(*) from storage.objects
union all select 'Migration (höchste Version)', max(version)::bigint from supabase_migrations.schema_migrations
union all select 'verschlüsselte Werte v2 (tenant_einstellungen)',
  count(*) filter (where email_smtp_pass_enc like 'v2:%' or email_imap_pass_enc like 'v2:%' or m365_client_secret_enc like 'v2:%'
                   or m365_access_token_enc like 'v2:%' or m365_refresh_token_enc like 'v2:%')
  from public.tenant_einstellungen
union all select 'FK-Waisen gesamt (erwartet 0; je FK: scripts/fk-waisen.sql)',
  coalesce(sum((xpath('/row/n/text()', query_to_xml(format(
    'select count(*) as n from %s t where %s and not exists (select 1 from %s z where %s)',
    tabelle,
    (select string_agg(format('t.%I is not null', s), ' and ') from unnest(spalten) as s),
    ziel,
    (select string_agg(format('z.%I = t.%I', zs, s), ' and ') from unnest(spalten, zielspalten) as x(s, zs))
  ), false, true, '')))[1]::text::bigint), 0)::bigint
  from fks
order by 1;
