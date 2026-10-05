-- KAN-209 (05.10.2026): Transportbescheinigung – Status Entwurf/Ausgestellt, danach fest (Matrix KAN-85).
--  1. Spalten status ('entwurf' | 'ausgestellt', Standard entwurf), ausgestellt_am/_von/_von_name.
--  2. Trigger b_tb_stempel: beim Wechsel auf „ausgestellt“ Zeitpunkt, Benutzer und Name (wie der Storno-Schutz).
--  3. a_freeze: eine ausgestellte, nicht stornierte Bescheinigung ist fest – nur Storno (Korrektur = Storno + neue
--     Bescheinigung); auch kein Zurück auf Entwurf.
-- Die Pflichtangaben und die laufende Nummer prüft bzw. vergibt die App beim Ausstellen (tbAusstellen, lib/behoerden/tbPflicht.ts).
-- Bestehende Bescheinigungen bleiben Entwürfe.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- 1. Status
ALTER TABLE public.transportbescheinigungen
  ADD COLUMN status text NOT NULL DEFAULT 'entwurf' CONSTRAINT transportbescheinigungen_status_chk CHECK (status IN ('entwurf', 'ausgestellt')),
  ADD COLUMN ausgestellt_am timestamptz,
  ADD COLUMN ausgestellt_von uuid,
  ADD COLUMN ausgestellt_von_name text;
COMMENT ON COLUMN public.transportbescheinigungen.status IS 'KAN-209: entwurf (änderbar, Druck mit Vermerk) bzw. ausgestellt (fest, nur Storno)';

-- 2. Stempel beim Ausstellen
CREATE OR REPLACE FUNCTION public.s112_tb_stempel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_name text;
BEGIN
  IF NEW.status = 'ausgestellt' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'ausgestellt') THEN
    IF v_uid IS NOT NULL THEN
      SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.display_name), ''))
        INTO v_name FROM public.profiles p WHERE p.user_id = v_uid OR p.id = v_uid ORDER BY (p.user_id = v_uid) DESC LIMIT 1;
    END IF;
    NEW.ausgestellt_am := now();
    NEW.ausgestellt_von := v_uid;
    NEW.ausgestellt_von_name := v_name;
  ELSIF NEW.status = 'entwurf' THEN
    NEW.ausgestellt_am := NULL;
    NEW.ausgestellt_von := NULL;
    NEW.ausgestellt_von_name := NULL;
  END IF;
  RETURN NEW;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_tb_stempel() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER b_tb_stempel BEFORE INSERT OR UPDATE OF status ON public.transportbescheinigungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_tb_stempel();

-- 3. Ausgestellt = fest (nur Storno)
CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public.transportbescheinigungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_freeze('Transportbescheinigung ausgestellt',
    $$o.storniert_am IS NULL AND o.status = 'ausgestellt'$$,
    'storniert_am,storniert_von,storniert_von_name,storno_grund',
    'ausgestellt_am');
