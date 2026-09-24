CREATE TABLE IF NOT EXISTS buchhaltung_kontenmapping (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  schluessel  text NOT NULL,
  wert        text NOT NULL,
  aktualisiert_am timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, schluessel)
);
ALTER TABLE buchhaltung_kontenmapping ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bkm_select ON buchhaltung_kontenmapping;
CREATE POLICY bkm_select ON buchhaltung_kontenmapping FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS bkm_write ON buchhaltung_kontenmapping;
CREATE POLICY bkm_write ON buchhaltung_kontenmapping FOR ALL
  USING (user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin']))
  WITH CHECK (user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin']));

CREATE TABLE IF NOT EXISTS buchhaltung_export_protokoll (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  art           text NOT NULL CHECK (art IN ('ausgangsrechnungen','eingangsbelege','stammdaten')),
  zeitraum_von  date,
  zeitraum_bis  date,
  anzahl        integer NOT NULL DEFAULT 0,
  summe_brutto  numeric(14,2),
  dateiname     text NOT NULL,
  nur_neue      boolean NOT NULL DEFAULT true,
  erstellt_von  uuid,
  erstellt_am   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bep_tenant ON buchhaltung_export_protokoll(tenant_id, erstellt_am DESC);
ALTER TABLE buchhaltung_export_protokoll ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bep_select ON buchhaltung_export_protokoll;
CREATE POLICY bep_select ON buchhaltung_export_protokoll FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM tenant_memberships WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS bep_insert ON buchhaltung_export_protokoll;
CREATE POLICY bep_insert ON buchhaltung_export_protokoll FOR INSERT
  WITH CHECK (user_has_role_in_tenant(tenant_id, ARRAY['system_admin','tenant_admin','winzer']));

ALTER TABLE verkaufsposten   ADD COLUMN IF NOT EXISTS bmd_export_id uuid REFERENCES buchhaltung_export_protokoll(id) ON DELETE SET NULL;
ALTER TABLE ea_transaktionen ADD COLUMN IF NOT EXISTS bmd_export_id uuid REFERENCES buchhaltung_export_protokoll(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_vp_bmd_export ON verkaufsposten(tenant_id, bmd_export_id);
CREATE INDEX IF NOT EXISTS idx_eat_bmd_export ON ea_transaktionen(tenant_id, bmd_export_id);

ALTER TABLE kontakte ADD COLUMN IF NOT EXISTS debitor_nr text;
ALTER TABLE firmen   ADD COLUMN IF NOT EXISTS kreditor_nr text;
COMMENT ON COLUMN kontakte.debitor_nr IS 'BMD-Debitorenkonto (Personenkonto) - bei der ersten Übergabe automatisch vergeben';
COMMENT ON COLUMN firmen.kreditor_nr  IS 'BMD-Kreditorenkonto (Personenkonto) - bei der ersten Übergabe automatisch vergeben';

ALTER TABLE tenant_einstellungen
  ADD COLUMN IF NOT EXISTS bmd_debitor_zaehler  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bmd_kreditor_zaehler integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.get_next_personenkonto(p_tenant_id uuid, p_art text, p_basis integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_zaehler integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin','winzer']);
  IF p_art = 'debitor' THEN
    UPDATE tenant_einstellungen SET bmd_debitor_zaehler = bmd_debitor_zaehler + 1
    WHERE tenant_id = p_tenant_id RETURNING bmd_debitor_zaehler INTO v_zaehler;
  ELSIF p_art = 'kreditor' THEN
    UPDATE tenant_einstellungen SET bmd_kreditor_zaehler = bmd_kreditor_zaehler + 1
    WHERE tenant_id = p_tenant_id RETURNING bmd_kreditor_zaehler INTO v_zaehler;
  ELSE
    RAISE EXCEPTION 'Unbekannte Kontoart %', p_art;
  END IF;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN (p_basis + v_zaehler)::text;
END;
$function$;;
