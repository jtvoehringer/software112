-- Migration 219 (20.9.2026): Policies mit "tenant_id = (SELECT … LIMIT 1)" ersetzen.
-- Vorfall: Jörgen + Paul buchten PSM-Anfangsbestände bei Gebeshuber – alle
-- INSERTs scheiterten mit "new row violates row-level security policy"
-- (psm_lager_bewegungen). Ursache: die Policy nahm die ERSTE Mitgliedschaft
-- des Benutzers ohne ORDER BY - bei Mitgliedern mehrerer Betriebe (Jörgen,
-- Hannes) ist das zufällig ein anderer Betrieb als der aktive. Gleiches Muster
-- auf duengemittel_lager_bewegungen, fuellung_chargen, verschneidungen,
-- verschneidung_quellen, zeiterfassung (auch SELECT → leere Listen!).
-- Neu: Standardmuster "tenant_id IN (alle aktiven Mitgliedschaften)"; die
-- Schreibrechte je Rolle/Modul regeln seit Migration 218 die restriktiven
-- modul_*-Policies.

CREATE OR REPLACE FUNCTION s112_meine_tenants()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.tenant_id FROM tenant_memberships m WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv
$$;
GRANT EXECUTE ON FUNCTION s112_meine_tenants() TO authenticated, service_role;

-- psm_lager_bewegungen
DROP POLICY IF EXISTS psm_lager_tenant_select ON psm_lager_bewegungen;
DROP POLICY IF EXISTS psm_lager_tenant_insert ON psm_lager_bewegungen;
DROP POLICY IF EXISTS psm_lager_tenant_update ON psm_lager_bewegungen;
DROP POLICY IF EXISTS psm_lager_tenant_delete ON psm_lager_bewegungen;
CREATE POLICY psm_lager_select ON psm_lager_bewegungen FOR SELECT USING (tenant_id IN (SELECT s112_meine_tenants()));
CREATE POLICY psm_lager_insert ON psm_lager_bewegungen FOR INSERT WITH CHECK (tenant_id IN (SELECT s112_meine_tenants()));
CREATE POLICY psm_lager_update ON psm_lager_bewegungen FOR UPDATE USING (tenant_id IN (SELECT s112_meine_tenants())) WITH CHECK (tenant_id IN (SELECT s112_meine_tenants()));
CREATE POLICY psm_lager_delete ON psm_lager_bewegungen FOR DELETE USING (tenant_id IN (SELECT s112_meine_tenants()));

-- duengemittel_lager_bewegungen
DROP POLICY IF EXISTS duengemittel_lager_tenant_select ON duengemittel_lager_bewegungen;
DROP POLICY IF EXISTS duengemittel_lager_tenant_insert ON duengemittel_lager_bewegungen;
DROP POLICY IF EXISTS duengemittel_lager_tenant_update ON duengemittel_lager_bewegungen;
DROP POLICY IF EXISTS duengemittel_lager_tenant_delete ON duengemittel_lager_bewegungen;
CREATE POLICY dm_lager_select ON duengemittel_lager_bewegungen FOR SELECT USING (tenant_id IN (SELECT s112_meine_tenants()));
CREATE POLICY dm_lager_insert ON duengemittel_lager_bewegungen FOR INSERT WITH CHECK (tenant_id IN (SELECT s112_meine_tenants()));
CREATE POLICY dm_lager_update ON duengemittel_lager_bewegungen FOR UPDATE USING (tenant_id IN (SELECT s112_meine_tenants())) WITH CHECK (tenant_id IN (SELECT s112_meine_tenants()));
CREATE POLICY dm_lager_delete ON duengemittel_lager_bewegungen FOR DELETE USING (tenant_id IN (SELECT s112_meine_tenants()));

-- fuellung_chargen, verschneidungen, verschneidung_quellen
DROP POLICY IF EXISTS tenant_isolation ON fuellung_chargen;
CREATE POLICY tenant_isolation ON fuellung_chargen FOR ALL USING (tenant_id IN (SELECT s112_meine_tenants())) WITH CHECK (tenant_id IN (SELECT s112_meine_tenants()));
DROP POLICY IF EXISTS tenant_isolation ON verschneidungen;
CREATE POLICY tenant_isolation ON verschneidungen FOR ALL USING (tenant_id IN (SELECT s112_meine_tenants())) WITH CHECK (tenant_id IN (SELECT s112_meine_tenants()));
DROP POLICY IF EXISTS tenant_isolation ON verschneidung_quellen;
CREATE POLICY tenant_isolation ON verschneidung_quellen FOR ALL
  USING (verschneidung_id IN (SELECT v.id FROM verschneidungen v WHERE v.tenant_id IN (SELECT s112_meine_tenants())))
  WITH CHECK (verschneidung_id IN (SELECT v.id FROM verschneidungen v WHERE v.tenant_id IN (SELECT s112_meine_tenants())));

-- zeiterfassung: Betriebsleiter/Admin des jeweiligen Betriebs
DROP POLICY IF EXISTS zeiterfassung_tenant_admin ON zeiterfassung;
CREATE POLICY zeiterfassung_tenant_admin ON zeiterfassung FOR ALL
  USING (tenant_id IN (SELECT m.tenant_id FROM tenant_memberships m WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin','tenant_admin')))
  WITH CHECK (tenant_id IN (SELECT m.tenant_id FROM tenant_memberships m WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin','tenant_admin')));
