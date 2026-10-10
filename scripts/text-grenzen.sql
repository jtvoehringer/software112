-- Textspalten mit Längengrenze (Sweep 98, 10.10.2026) – Abgleich mit scripts/text-grenzen.json.
-- Gegen Supabase ausführen (SQL-Editor oder MCP); jede Zeile muss in text-grenzen.json unter "spalten" (mit Formularfeld)
-- oder "ohne_formular" (mit Grund) stehen. Storno-Gründe (Mindestlänge) und reine Mindestlängen fehlen hier bewusst.
select tabelle || '.' || spalte as spalte, max
from (
  select c.table_name as tabelle, c.column_name as spalte, c.character_maximum_length as max
  from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
  where c.table_schema = 'public' and c.data_type = 'character varying' and c.character_maximum_length is not null
  union all
  select conrelid::regclass::text, (regexp_match(pg_get_constraintdef(oid), 'length\((?:btrim\()?"?([a-z_]+)"?\)*\s*<=\s*(\d+)'))[1],
         ((regexp_match(pg_get_constraintdef(oid), 'length\((?:btrim\()?"?([a-z_]+)"?\)*\s*<=\s*(\d+)'))[2])::int
  from pg_constraint
  where contype = 'c' and connamespace = 'public'::regnamespace and pg_get_constraintdef(oid) ~ 'length\([^)]*\)*\s*<=\s*\d+'
) g
where max < 1000
order by 1;
