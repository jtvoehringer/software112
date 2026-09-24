-- Migration 215 (19.9.2026): demo_musterhof_zuruecksetzen verwendete noch
-- tenant_einstellungen.kunden_zaehler (seit Migration 187 account_zaehler) –
-- der nächtliche Demo-Reset (Hohenstein Suite, 03:00 UTC) scheiterte deshalb.
DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef('public.demo_musterhof_zuruecksetzen'::regproc) INTO d;
  d := replace(d, 'kunden_zaehler', 'account_zaehler');
  EXECUTE d;
END $$;;
