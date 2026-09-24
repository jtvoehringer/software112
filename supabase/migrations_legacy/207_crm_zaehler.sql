-- CRM-Listen serverseitig (17.9.2026): Kontakte/Firmen werden nicht mehr komplett
-- in den Browser geladen, sondern gefiltert und seitenweise. Die Filterleisten
-- brauchen dafür die Zähler je Segment / Lead-Status - eine RPC statt 2×17
-- Count-Abfragen. SECURITY DEFINER mit Mitgliedschaftsprüfung wie lade_behaelter.
CREATE OR REPLACE FUNCTION crm_zaehler(p_tenant_id uuid)
RETURNS TABLE (art text, segment text, is_lead boolean, ist_kunde boolean, ist_lieferant boolean, anzahl bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ok AS (
    SELECT session_user = 'postgres'
        OR COALESCE(auth.jwt() ->> 'role', '') = 'service_role'
        OR EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = p_tenant_id AND m.user_id = auth.uid() AND m.aktiv) AS darf
  )
  SELECT 'kontakt', k.segment::text, COALESCE(k.is_lead, false), true, false, COUNT(*)
    FROM kontakte k, ok WHERE ok.darf AND k.tenant_id = p_tenant_id AND k.aktiv
   GROUP BY k.segment, COALESCE(k.is_lead, false)
  UNION ALL
  SELECT 'firma', f.segment::text, COALESCE(f.is_lead, false), COALESCE(f.ist_kunde, true), COALESCE(f.ist_lieferant, false), COUNT(*)
    FROM firmen f, ok WHERE ok.darf AND f.tenant_id = p_tenant_id AND f.aktiv
   GROUP BY f.segment, COALESCE(f.is_lead, false), COALESCE(f.ist_kunde, true), COALESCE(f.ist_lieferant, false)
$$;
GRANT EXECUTE ON FUNCTION crm_zaehler(uuid) TO authenticated, service_role;
