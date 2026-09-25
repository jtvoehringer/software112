-- FK-Waisen (KAN-124, 25.9.2026) – verwaiste Zeilen je Fremdschlüssel im Schema public.
-- Nur lesend. Als postgres ausführen (SQL-Editor oder MCP execute_sql), sonst blendet RLS Zeilen aus.
-- Erwartung: 0 Zeilen. Jede Zeile ist ein Fremdschlüssel, dessen Verweis ins Leere zeigt –
-- entsteht nur, wenn FK-Prüfungen und FK-Kaskaden umgangen wurden (session_replication_role =
-- 'replica', DISABLE TRIGGER). Nach jeder Datenkorrektur bzw. jedem Cleanup-Skript ausführen.
-- Zählweise wie Postgres (MATCH SIMPLE): Zeilen mit NULL in einer FK-Spalte gelten nicht als Waise.
with fks as (
  select c.conname,
         c.conrelid::regclass as tabelle,
         c.confrelid::regclass as ziel,
         c.convalidated,
         array_agg(a.attname order by k.ord) as spalten,
         array_agg(z.attname order by k.ord) as zielspalten
  from pg_constraint c
  join pg_namespace n on n.oid = c.connamespace
  cross join lateral unnest(c.conkey, c.confkey) with ordinality as k(spalte, zielspalte, ord)
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.spalte
  join pg_attribute z on z.attrelid = c.confrelid and z.attnum = k.zielspalte
  where c.contype = 'f' and n.nspname = 'public'
  group by c.oid, c.conname, c.conrelid, c.confrelid, c.convalidated
),
zaehlung as (
  select f.*,
         (xpath('/row/n/text()', query_to_xml(format(
            'select count(*) as n from %s t where %s and not exists (select 1 from %s z where %s)',
            f.tabelle,
            (select string_agg(format('t.%I is not null', s), ' and ') from unnest(f.spalten) as s),
            f.ziel,
            (select string_agg(format('z.%I = t.%I', zs, s), ' and ') from unnest(f.spalten, f.zielspalten) as x(s, zs))
          ), false, true, '')))[1]::text::bigint as waisen
  from fks f
)
select conname as fremdschluessel,
       tabelle::text as tabelle,
       array_to_string(spalten, ', ') as spalten,
       ziel::text || ' (' || array_to_string(zielspalten, ', ') || ')' as verweist_auf,
       convalidated as validiert,
       waisen
from zaehlung
where waisen > 0
order by waisen desc, 1;
