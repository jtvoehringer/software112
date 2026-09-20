-- Schema-Export für scripts/check-schema.js (20.9.2026)
-- Gegen Supabase ausführen (SQL-Editor oder MCP) und das Ergebnis der einzigen
-- Zeile/Spalte als scripts/schema.json speichern – nach jeder Migration, die
-- Tabellen oder Spalten anlegt, umbenennt oder entfernt.
select json_object_agg(t.table_name, t.spalten order by t.table_name) as schema
from (
  select c.table_name, json_agg(c.column_name order by c.ordinal_position) as spalten
  from information_schema.columns c
  join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
  where c.table_schema = 'public' and tb.table_type in ('BASE TABLE', 'VIEW')
  group by c.table_name
) t;
