-- @bereich: Indizes auf tenant_id und Fremdschlüsseln (Sweep 80) – jede Mandantentabelle filterbar, jeder Fremdverweis suchbar
-- @ziel: Jede Tabelle in public mit Spalte tenant_id hat einen Index, der mit tenant_id beginnt; jeder Fremdschlüssel in public
-- @ziel: hat einen abdeckenden Index (Spalten des FK als Präfix), außer Verweisen auf auth.users und auf Kataloge kat_*.
-- @mutation tenant_index_weg: Index zeiterfassung_tenant_id_idx entfernt | rot: tenant_id_ohne_index
-- @mutation fk_index_weg: Index transportbescheinigungen_verkaufsposten_id_idx entfernt | rot: fk_ohne_index
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 78 (Stand 09.10.2026). Alles zurückgerollt.

DO $test$
DECLARE
  c_datei constant text := '78_indizes';
  v_t0    timestamptz;
  v_erg   text[] := '{}';
  v_txt   text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  PERFORM pg_temp.s112_mutiere('tenant_index_weg', $m$DROP INDEX public.zeiterfassung_tenant_id_idx$m$);
  PERFORM pg_temp.s112_mutiere('fk_index_weg', $m$DROP INDEX public.transportbescheinigungen_verkaufsposten_id_idx$m$);

  -- ── 1. tenant_id: Index mit tenant_id als erster Spalte ─────────────────────────────────────────────────────────
  SELECT coalesce(string_agg(c.relname, ', ' ORDER BY c.relname), '–') INTO v_txt
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indkey[0] = a.attnum);
  v_erg := v_erg || pg_temp.s112_erwarte('tenant_id_ohne_index', v_txt, '–');

  -- ── 2. Fremdschlüssel: Spalten des FK als Präfix eines Index (Ziel weder auth.users noch kat_*) ─────────────────
  SELECT coalesce(string_agg(x.tab || '(' || x.spalten || ')', ', ' ORDER BY x.tab, x.spalten), '–') INTO v_txt
    FROM (
      SELECT c.conrelid::regclass::text AS tab,
             (SELECT string_agg(a.attname, ',' ORDER BY k.o) FROM unnest(c.conkey) WITH ORDINALITY k(n, o)
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n) AS spalten
        FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
       WHERE c.contype = 'f' AND n.nspname = 'public'
         AND c.confrelid::regclass::text <> 'auth.users' AND c.confrelid::regclass::text NOT LIKE 'kat\_%'
         AND NOT EXISTS (SELECT 1 FROM pg_index i
                          WHERE i.indrelid = c.conrelid AND (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey)
    ) x;
  v_erg := v_erg || pg_temp.s112_erwarte('fk_ohne_index', v_txt, '–');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 2);
END $test$;
