-- Wiederherstellungstest O5 (23.9.2026) – Kennzahlen für den Abgleich Produktion ↔ wiederhergestelltes Projekt.
-- Auf BEIDEN Projekten ausführen (SQL-Editor oder MCP) und die Ergebnisse vergleichen.
-- Abweichungen sind nur bei Tabellen zu erwarten, die seit dem Sicherungszeitpunkt geändert wurden.
with tabellen as (
  select table_name
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
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
order by 1;
