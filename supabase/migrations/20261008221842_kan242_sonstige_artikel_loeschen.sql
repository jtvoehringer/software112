-- KAN-242 (08.10.2026): Sonstige Produkte löschen
--
-- sonstige_artikel hatte keine PERMISSIVE DELETE-Policy: „Löschen“ in /weinhandel/sonstige-artikel löschte nie etwas
-- (RLS filtert still, 0 Zeilen) – die App meldete trotzdem Erfolg (behoben in der App, PR #340). Damit ein irrtümlich
-- angelegtes, nie verwendetes Produkt wirklich gelöscht werden kann: DELETE-Policy wie bei rabattgruppen
-- (aktive Mitgliedschaft als system_admin, tenant_admin oder winzer). Die RESTRICTIVE-Policies bleiben:
-- modul_delete (Freigabe Warenwirtschaft), abo_schreibsperre_del, mitgliedschaft_aktiv, zwei_faktor_aal.
-- Produkte mit Lagerbewegungen oder Verkaufspositionen sperrt weiter der FK (23503, NO ACTION) → App: „bitte deaktivieren“.

BEGIN;

CREATE POLICY sonstige_artikel_delete ON public.sonstige_artikel
  FOR DELETE TO authenticated
  USING (tenant_id IN (
    SELECT m.tenant_id FROM public.tenant_memberships m
     WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv
       AND m.role = ANY (ARRAY['system_admin', 'tenant_admin', 'winzer'])));

-- Selbstprüfung: genau eine PERMISSIVE DELETE-Policy, nur für authenticated
DO $p$
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sonstige_artikel'
        AND cmd = 'DELETE' AND permissive = 'PERMISSIVE' AND roles = '{authenticated}') <> 1 THEN
    RAISE EXCEPTION 'KAN-242: DELETE-Policy auf sonstige_artikel fehlt oder ist doppelt';
  END IF;
END $p$;

COMMIT;
