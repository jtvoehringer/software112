-- Migration 216 (19.9.2026): demo_musterhof_zuruecksetzen – ID-Kollisionen im Block
-- "Laufendes Jahr: erste Pressungen ab 1. September" (aktiv seit 1.9.):
--   pressung_behaelter 40,21–23 kollidierte mit den Vorjahreschargen 40,10–26 (duplicate key),
--   weinausbau 11,40–42 mit der y2-Kette (demo_musterhof_y2_kette löscht/erzeugt 11,40–42).
-- Neu: Charge 11,50–52 · pressung_behaelter 40,51–53. Quelle: Hohenstein Suite supabase/s112/demo_musterhof.sql
DO $$
DECLARE d text; n int;
BEGIN
  SELECT pg_get_functiondef('public.demo_musterhof_zuruecksetzen'::regproc) INTO d;
  n := (length(d) - length(replace(d, 'values (demo_musterhof_id(40, 20 + r.nr), demo_musterhof_id(9, 20 + r.nr)', ''))) / length('values (demo_musterhof_id(40, 20 + r.nr), demo_musterhof_id(9, 20 + r.nr)');
  IF n <> 1 THEN RAISE EXCEPTION 'Erwartete genau 1 Treffer (pressung_behaelter laufendes Jahr), gefunden %', n; END IF;
  d := replace(d, 'values (demo_musterhof_id(40, 20 + r.nr), demo_musterhof_id(9, 20 + r.nr)', 'values (demo_musterhof_id(40, 50 + r.nr), demo_musterhof_id(9, 20 + r.nr)');
  d := replace(d, '2100, 16.2, 8,  1450, ''weiss'', 40),', '2100, 16.2, 8,  1450, ''weiss'', 50),');
  d := replace(d, '1300, 15.8, 9,  900,  ''rose'',  41),', '1300, 15.8, 9,  900,  ''rose'',  51),');
  d := replace(d, '4000, 17.4, 2,  2750, ''weiss'', 42)', '4000, 17.4, 2,  2750, ''weiss'', 52)');
  IF position('''weiss'', 50),' IN d) = 0 OR position('''rose'',  51),' IN d) = 0 OR position('''weiss'', 52)' IN d) = 0 THEN
    RAISE EXCEPTION 'Chargen-IDs 50–52 nicht ersetzt';
  END IF;
  EXECUTE d;
END $$;;
