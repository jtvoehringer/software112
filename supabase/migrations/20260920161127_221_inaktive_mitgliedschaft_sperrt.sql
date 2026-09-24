-- Migration 221 (20.9.2026, Sweep): Deaktivierte Mitgliedschaft sperrt auch das Lesen.
-- Befund Policy-Audit: ~120 Policies prüfen die Mitgliedschaft ohne "aktiv" – wer unter
-- Mein Betrieb › Benutzer auf Inaktiv gesetzt wurde, kam über die Oberfläche nicht mehr
-- hinein (getCurrentMembership verlangt aktiv), per direktem API-Zugriff aber schon.
-- Statt 120 Policies umzuschreiben: eine RESTRIKTIVE Policy je Tabelle mit tenant_id –
-- Zeilen eines Betriebs, in dem der Benutzer eine INAKTIVE Mitgliedschaft hat, sind tabu.
-- Betriebsübergreifende Freigaben (Kellergemeinschaft) bleiben unberührt, weil dort
-- keine (inaktive) Mitgliedschaft existiert. InitPlan-fähig (einmal je Abfrage).

CREATE OR REPLACE FUNCTION s112_gesperrte_tenants()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.tenant_id FROM tenant_memberships m WHERE m.user_id = (SELECT auth.uid()) AND NOT m.aktiv
$$;
GRANT EXECUTE ON FUNCTION s112_gesperrte_tenants() TO authenticated, service_role;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN pg_class k ON k.relname = c.table_name JOIN pg_namespace n ON n.oid = k.relnamespace AND n.nspname = 'public'
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND k.relkind = 'r' AND k.relrowsecurity
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS mitgliedschaft_aktiv ON %I', r.table_name);
    EXECUTE format('CREATE POLICY mitgliedschaft_aktiv ON %I AS RESTRICTIVE FOR ALL TO authenticated USING (tenant_id NOT IN (SELECT s112_gesperrte_tenants())) WITH CHECK (tenant_id NOT IN (SELECT s112_gesperrte_tenants()))', r.table_name);
  END LOOP;
END $$;;
