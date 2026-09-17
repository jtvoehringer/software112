-- Migration 210 (17.9.2026): Filterwerte (Orte, Länder) für die Verkaufs-
-- statistik unter Controlling › Auswertungen. Vorher lud die Seite dafür alle
-- Kontakte und Firmen (Gebeshuber: 13.000 Zeilen) - zusammen mit zwölf
-- nacheinander laufenden Monatsabfragen der Grund für ~4 s Ladezeit beim
-- Klick auf "Controlling".
CREATE OR REPLACE FUNCTION crm_filterwerte(p_tenant_id uuid)
RETURNS TABLE (art text, wert text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ok AS (
    SELECT session_user = 'postgres'
        OR COALESCE(auth.jwt() ->> 'role','') = 'service_role'
        OR EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = p_tenant_id AND m.user_id = auth.uid() AND m.aktiv) AS darf
  ),
  werte AS (
    SELECT 'ort' AS art, k.ort AS wert FROM kontakte k, ok WHERE ok.darf AND k.tenant_id = p_tenant_id AND k.aktiv AND k.ort IS NOT NULL AND k.ort <> ''
    UNION
    SELECT 'ort', f.ort FROM firmen f, ok WHERE ok.darf AND f.tenant_id = p_tenant_id AND f.aktiv AND f.ort IS NOT NULL AND f.ort <> ''
    UNION
    SELECT 'land', k.land FROM kontakte k, ok WHERE ok.darf AND k.tenant_id = p_tenant_id AND k.aktiv AND k.land IS NOT NULL AND k.land <> ''
    UNION
    SELECT 'land', f.land FROM firmen f, ok WHERE ok.darf AND f.tenant_id = p_tenant_id AND f.aktiv AND f.land IS NOT NULL AND f.land <> ''
  )
  SELECT art, wert FROM werte ORDER BY art, wert
$$;
GRANT EXECUTE ON FUNCTION crm_filterwerte(uuid) TO authenticated, service_role;
