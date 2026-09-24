DROP POLICY IF EXISTS ke_insert ON kosteneintraege;
DROP POLICY IF EXISTS ke_update ON kosteneintraege;
DROP POLICY IF EXISTS ke_delete ON kosteneintraege;

DROP POLICY IF EXISTS rg_select     ON rabattgruppen;
DROP POLICY IF EXISTS rg_insert     ON rabattgruppen;
DROP POLICY IF EXISTS rg_update     ON rabattgruppen;
DROP POLICY IF EXISTS rg_delete     ON rabattgruppen;
DROP POLICY IF EXISTS rabattg_write ON rabattgruppen;
CREATE POLICY rabattg_insert ON rabattgruppen FOR INSERT
  WITH CHECK (tenant_id IN (SELECT m.tenant_id FROM tenant_memberships m
    WHERE m.user_id = (select auth.uid()) AND m.aktiv AND m.role = ANY (ARRAY['system_admin','tenant_admin','winzer'])));
CREATE POLICY rabattg_update ON rabattgruppen FOR UPDATE
  USING (tenant_id IN (SELECT m.tenant_id FROM tenant_memberships m
    WHERE m.user_id = (select auth.uid()) AND m.aktiv AND m.role = ANY (ARRAY['system_admin','tenant_admin','winzer'])));
CREATE POLICY rabattg_delete ON rabattgruppen FOR DELETE
  USING (tenant_id IN (SELECT m.tenant_id FROM tenant_memberships m
    WHERE m.user_id = (select auth.uid()) AND m.aktiv AND m.role = ANY (ARRAY['system_admin','tenant_admin','winzer'])));

DROP POLICY IF EXISTS "profiles: own profile select" ON profiles;
DROP POLICY IF EXISTS profiles_own ON profiles;;
