-- Migration 220 (20.9.2026): plpgsql_check – statische Prüfung aller plpgsql-Funktionen
-- gegen das aktuelle Schema (hätte den Demo-Reset-Bruch nach Migration 187 sofort gezeigt).
-- Abfrage für den Sweep / nach jeder Migration:
--   select p.proname, c.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--   join pg_language l on l.oid=p.prolang, lateral plpgsql_check_function_tb(p.oid) c
--   where n.nspname='public' and l.lanname='plpgsql';
CREATE EXTENSION IF NOT EXISTS plpgsql_check WITH SCHEMA extensions;;
