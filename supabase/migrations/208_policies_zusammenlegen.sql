-- Migration 208 (17.9.2026): mehrfache permissive Policies zusammenlegen
-- (Supabase-Advisor "multiple_permissive_policies", Performance-Doc 17.9.).
-- Bei mehreren permissiven Policies je Befehl prüft Postgres jede einzeln
-- (OR) - bei rabattgruppen z.B. fünf Policies je SELECT.
--
-- Ergebnis je Tabelle - Semantik unverändert bzw. auf das Standardmuster
-- (lesen: jedes Mitglied, schreiben: system_admin/tenant_admin/winzer)
-- gebracht:
--   kosteneintraege: ke_tenant (ALL) deckte ke_insert/ke_update/ke_delete
--                    vollständig ab → die drei fallen weg.
--   rabattgruppen:   rg_select + rabattg_select identisch; rg_insert/update/
--                    delete (jedes Mitglied, auch 'leser') + rabattg_write
--                    (ALL, tenant_admin/winzer, system_admin fehlte) →
--                    ein SELECT + drei Schreib-Policies im Standardmuster.
--   profiles:        "own profile select" ⊂ profiles_read_all; profiles_own
--                    prüft user_id = auth.uid(), user_id ist in allen Zeilen
--                    NULL (Spalte ungenutzt, Schlüssel ist id) → nie wirksam.
--
-- ACHTUNG beim Einspielen über execute_sql: NICHT mit begin/rollback in
-- einem Batch kombinieren (siehe Vorfall Migration 206).

-- kosteneintraege ---------------------------------------------------------
DROP POLICY IF EXISTS ke_insert ON kosteneintraege;
DROP POLICY IF EXISTS ke_update ON kosteneintraege;
DROP POLICY IF EXISTS ke_delete ON kosteneintraege;

-- rabattgruppen -----------------------------------------------------------
DROP POLICY IF EXISTS rg_select     ON rabattgruppen;
DROP POLICY IF EXISTS rg_insert     ON rabattgruppen;
DROP POLICY IF EXISTS rg_update     ON rabattgruppen;
DROP POLICY IF EXISTS rg_delete     ON rabattgruppen;
DROP POLICY IF EXISTS rabattg_write ON rabattgruppen;
-- rabattg_select bleibt (jedes Mitglied liest)
CREATE POLICY rabattg_insert ON rabattgruppen FOR INSERT
  WITH CHECK (tenant_id IN (SELECT m.tenant_id FROM tenant_memberships m
    WHERE m.user_id = (select auth.uid()) AND m.aktiv AND m.role = ANY (ARRAY['system_admin','tenant_admin','winzer'])));
CREATE POLICY rabattg_update ON rabattgruppen FOR UPDATE
  USING (tenant_id IN (SELECT m.tenant_id FROM tenant_memberships m
    WHERE m.user_id = (select auth.uid()) AND m.aktiv AND m.role = ANY (ARRAY['system_admin','tenant_admin','winzer'])));
CREATE POLICY rabattg_delete ON rabattgruppen FOR DELETE
  USING (tenant_id IN (SELECT m.tenant_id FROM tenant_memberships m
    WHERE m.user_id = (select auth.uid()) AND m.aktiv AND m.role = ANY (ARRAY['system_admin','tenant_admin','winzer'])));

-- profiles ----------------------------------------------------------------
DROP POLICY IF EXISTS "profiles: own profile select" ON profiles;
DROP POLICY IF EXISTS profiles_own ON profiles;
