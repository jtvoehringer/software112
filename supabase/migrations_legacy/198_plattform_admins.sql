-- Plattform-Admins (Rückmeldung 4.9.2026): der Plattformbetreiber soll in
-- JEDEM Mandanten als system_admin dabei sein - bisher war die Rolle streng
-- pro Betrieb, das icp-Konto hatte im Musterhof gar keine Mitgliedschaft.
--
-- Lösung auf DB-Ebene, damit es für alle Anlagewege gilt (Administration →
-- Mandanten, Self-Service-Signup, künftige Importe): Tabelle plattform_admins
-- + Trigger auf tenants, der bei jedem neuen Mandanten die Mitgliedschaft
-- anlegt. Der Betriebsleiter kann diese Mitgliedschaft wie jede andere über
-- "Mein Betrieb → Benutzer" auf Inaktiv setzen (Migration 159) - dann greift
-- weder RLS noch App-Rolle (user_has_role_in_tenant prüft aktiv = true).

CREATE TABLE IF NOT EXISTS plattform_admins (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  hinweis     text,
  erstellt_am timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE plattform_admins ENABLE ROW LEVEL SECURITY;
-- keine Policies: nur Service-Role / SQL - nichts davon ist für Clients gedacht

CREATE OR REPLACE FUNCTION public.trg_tenant_plattform_admins()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO tenant_memberships (tenant_id, user_id, role, aktiv)
  SELECT NEW.id, p.user_id, 'system_admin', true
  FROM plattform_admins p
  WHERE NOT EXISTS (
    SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = NEW.id AND m.user_id = p.user_id
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tenants_plattform_admins ON tenants;
CREATE TRIGGER tenants_plattform_admins
  AFTER INSERT ON tenants
  FOR EACH ROW EXECUTE FUNCTION public.trg_tenant_plattform_admins();

-- Plattformbetreiber eintragen
INSERT INTO plattform_admins (user_id, hinweis)
SELECT id, 'Plattformbetreiber (icp-consultants)' FROM auth.users WHERE email = 'jv@icp-consultants.at'
ON CONFLICT (user_id) DO NOTHING;

-- Bestand nachziehen: in allen vorhandenen Mandanten als system_admin ergänzen
-- (bestehende Mitgliedschaften - z.B. tenant_admin - bleiben unverändert)
INSERT INTO tenant_memberships (tenant_id, user_id, role, aktiv)
SELECT t.id, p.user_id, 'system_admin', true
FROM tenants t CROSS JOIN plattform_admins p
WHERE NOT EXISTS (SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = t.id AND m.user_id = p.user_id);
