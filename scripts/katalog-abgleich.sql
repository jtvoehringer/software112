-- Katalog-Abgleich Produktion ↔ Staging (Sweep 81, 09.10.2026) – nur lesend.
-- Auf BEIDEN Datenbanken ausführen (SQL-Editor oder MCP execute_sql) und die Ergebnisse vergleichen: je Objektart Anzahl
-- und Fingerabdruck (md5 über Name = md5(Definition)). Gleiche Zeilen = gleicher Katalog. Weicht eine Art ab, am Ende
-- „WHERE art = '<art>'“ in die Detailabfrage (unten auskommentiert) einsetzen und die Listen vergleichen.
-- Funktionen: Quelltext auf einheitlichen Leerraum und ohne Kommentare normalisiert (sonst meldet jede über den
-- SQL-Editor mit CRLF eingespielte Funktion eine Abweichung); search_path, SECURITY DEFINER, Rechte und Volatilität zählen.
-- Befund 09.10.2026: handle_new_user/create_profile_on_signup in Produktion von Hand geändert, idx_ernte_parzellen_gst
-- nur in Produktion, Altspalten auf user_email_connections nur auf Staging – angeglichen in sweep80/sweep81.
-- Bekannt und gewollt: Event-Trigger ensure_rls (Supabase-Schalter „RLS automatisch aktivieren“) nur in Produktion.
with objekte(art, name, def) as (
  select 'spalte', c.table_name || '.' || c.column_name,
         c.data_type || '|' || c.is_nullable || '|' || coalesce(c.column_default, '')
    from information_schema.columns c where c.table_schema = 'public'
  union all
  select 'index', indexname, indexdef from pg_indexes where schemaname = 'public'
  union all
  select 'constraint', conrelid::regclass::text || '.' || conname, pg_get_constraintdef(c.oid)
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public' and conrelid <> 0
  union all
  select 'funktion', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         md5(btrim(regexp_replace(regexp_replace(replace(p.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))) || '|' ||
         coalesce(array_to_string(p.proconfig, ','), '') || '|' || p.prosecdef::text || '|' ||
         coalesce(array_to_string(p.proacl, ','), '') || '|' || p.provolatile::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  union all
  select 'policy', schemaname || '.' || tablename || '.' || policyname,
         permissive || '|' || array_to_string(roles, ',') || '|' || cmd || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
    from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'trigger', tgrelid::regclass::text || '.' || tgname, pg_get_triggerdef(t.oid) || '|' || t.tgenabled::text
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
   where not t.tgisinternal and n.nspname in ('public', 'auth', 'storage')
  union all
  select 'tabellenrecht', table_name || '.' || grantee, string_agg(privilege_type, ',' order by privilege_type)
    from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
   group by table_name, grantee
  union all
  select 'spaltenrecht', table_name || '.' || column_name || '.' || grantee, string_agg(privilege_type, ',' order by privilege_type)
    from information_schema.column_privileges where table_schema = 'public' and grantee in ('anon', 'authenticated')
   group by table_name, column_name, grantee
  union all
  select 'rls', c.relname, c.relrowsecurity::text || '|' || c.relforcerowsecurity::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'
  union all
  select 'view', viewname, md5(definition) from pg_views where schemaname = 'public'
  union all
  select 'typ', t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder)
    from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public'
   group by t.typname
  union all
  select 'extension', extname, extversion from pg_extension
  union all
  select 'event_trigger', evtname, evtevent || '|' || evtenabled::text || '|' || evtfoid::regproc::text from pg_event_trigger
  union all
  select 'bucket', id, public::text || '|' || coalesce(file_size_limit::text, '') || '|' || coalesce(array_to_string(allowed_mime_types, ','), '')
    from storage.buckets
)
select art, count(*) as anzahl, md5(string_agg(name || '=' || md5(def), '|' order by name)) as fingerabdruck
  from objekte
 group by art
 order by art;
-- Detail einer Art (statt der Zusammenfassung oben):
-- select name, left(md5(def), 8) from objekte where art = 'funktion' order by name;
