-- Migration 217 (19.9.2026): demo_musterhof_zuruecksetzen – Spalte kundennummer heißt seit
-- Migration 187 accountnummer (kontakte, firmen). Danach läuft der Demo-Reset wieder durch
-- (geprüft: Reset + demo_musterhof_y2_kette, 16 Chargen, 3 in Gärung, 17 Pressungen).
DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef('public.demo_musterhof_zuruecksetzen'::regproc) INTO d;
  d := replace(d, 'aktiv, kundennummer,', 'aktiv, accountnummer,');
  IF position('kundennummer' IN d) > 0 THEN RAISE EXCEPTION 'kundennummer noch vorhanden'; END IF;
  EXECUTE d;
END $$;
