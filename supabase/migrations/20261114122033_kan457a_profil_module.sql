-- KAN-457 (14.11.2026): Die Schreibmodule eines Mitarbeiters mit Profil folgen dem Profil.
--
-- Bisher erzwingt die Datenbank nur „Profil nur für Mitarbeiter“ (CHECK). Welche Module ein Mitglied mit Profil
-- schreibt, lag beim Aufrufer – ein Schreibweg, der das Profil setzt und die Module vergisst, hinterließe z. B. einen
-- „Extern“ mit allen sechs Modulen. Entscheidung Jörgen 14.11.2026 (Jira KAN-457, Frage 2 A): fest aus dem Profil.
--   vertrieb  schreibt: warenwirtschaft, crm, auswertungen
--   extern    schreibt: rieden
-- (gleich wie PROFILE in src/lib/auth/lesebereiche.ts; Test kan457-profil-vergabe vergleicht.)
-- Wechselt die Rolle eines Mitglieds mit Profil weg vom Mitarbeiter, fällt das Profil weg – sonst scheiterte der
-- Rollenwechsel am CHECK tenant_memberships_profil_rolle_chk. Ein Profil ausdrücklich an Betriebsleitung oder Leser zu
-- vergeben, bleibt ein Fehler (23514).
-- Für Mitglieder ohne Profil ändert sich nichts.

CREATE FUNCTION public.s112_mitglied_profil_module()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  -- Rollenwechsel weg vom Mitarbeiter: das bisherige Profil fällt weg (nicht, wenn es im selben Zug neu gesetzt wird)
  IF TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM 'winzer' AND OLD.role = 'winzer'
     AND NEW.profil IS NOT NULL AND NEW.profil IS NOT DISTINCT FROM OLD.profil THEN
    NEW.profil := NULL;
  END IF;
  IF NEW.profil IS NOT NULL AND NEW.role = 'winzer' THEN
    NEW.schreibmodule := CASE NEW.profil
      WHEN 'vertrieb' THEN ARRAY['warenwirtschaft', 'crm', 'auswertungen']
      WHEN 'extern'   THEN ARRAY['rieden']
      ELSE NEW.schreibmodule
    END;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_mitglied_profil_module() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.s112_mitglied_profil_module() IS
  'KAN-457: Schreibmodule eines Mitarbeiters mit Profil folgen dem Profil; Rollenwechsel weg vom Mitarbeiter leert das Profil';

-- z_…: nach tenant_memberships_schreibmodule_default (Vorgabe aller Module für neue Mitarbeiter)
CREATE TRIGGER z_profil_module BEFORE INSERT OR UPDATE ON public.tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION public.s112_mitglied_profil_module();

-- Bestand angleichen (Produktion: kein Mitglied mit Profil; Staging: die beiden Testbenutzer)
UPDATE public.tenant_memberships SET profil = profil WHERE profil IS NOT NULL;

DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.tenant_memberships m
   WHERE m.profil IS NOT NULL
     AND m.schreibmodule IS DISTINCT FROM CASE m.profil WHEN 'vertrieb' THEN ARRAY['warenwirtschaft', 'crm', 'auswertungen'] WHEN 'extern' THEN ARRAY['rieden'] END;
  IF v_n > 0 THEN RAISE EXCEPTION 'KAN-457: % Mitglieder mit Profil und abweichenden Schreibmodulen', v_n; END IF;
END $$;
