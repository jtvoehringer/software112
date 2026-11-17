-- KAN-475 Nachtrag: Prüfung „Kellerbehandlung braucht eine Charge“ erst NACH der Rechteprüfung (Befund DB-Test 11, 16.11.2026)
--
-- Der Trigger a_charge_pflicht (BEFORE) lief vor der Row-Level-Security: Ein Mitglied eines fremden Betriebs bekam bei einem
-- INSERT in keller_behandlungen die fachliche Meldung (23514) statt der Rechte-Ablehnung – DB-Test 11 verlangt für fremde
-- Schreibversuche eine Ablehnung durch die Rechte. Die Prüfung läuft deshalb als AFTER-Trigger (nach RLS und
-- Fremdverweis-Prüfungen); vor dem Schreiben bleibt nur das Übernehmen des Gebindes von der Charge.
--   · a_gebinde_von_charge (BEFORE INSERT): Gebinde der Charge übernehmen, wenn keines angegeben ist – wirft nie.
--   · z_charge_pflicht (AFTER INSERT OR UPDATE OF weinausbau_id, behaelter_id, typ_id): die Regel selbst, unverändert.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

DROP TRIGGER a_charge_pflicht ON public.keller_behandlungen;

CREATE FUNCTION public.s112_behandlung_gebinde_von_charge() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.weinausbau_id IS NOT NULL AND NEW.behaelter_id IS NULL THEN
    -- „lag damals in …“: Gebinde der Charge zum Zeitpunkt der Erfassung (unter den Rechten des Benutzers gelesen)
    SELECT w.behaelter_id INTO NEW.behaelter_id FROM public.weinausbau w WHERE w.id = NEW.weinausbau_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.s112_behandlung_gebinde_von_charge() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.s112_behandlung_gebinde_von_charge() IS
  'KAN-475: übernimmt beim Anlegen einer Kellerbehandlung das Gebinde der Charge, wenn keines angegeben ist.';

CREATE OR REPLACE FUNCTION public.s112_behandlung_an_charge() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_pflege boolean;
BEGIN
  IF NEW.weinausbau_id IS NULL THEN
    -- Wartung (Demo-Reset, Mandant löschen) und das Leeren der Charge durch den Fremdschlüssel (Charge gelöscht)
    IF coalesce(current_setting('s112.loeschen_erlaubt', true), '') <> '' THEN RETURN NULL; END IF;
    IF TG_OP = 'UPDATE' AND OLD.weinausbau_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.weinausbau w WHERE w.id = OLD.weinausbau_id) THEN
      RETURN NULL;
    END IF;
    IF NEW.behaelter_id IS NULL THEN
      RAISE EXCEPTION 'Eine Kellerbehandlung braucht eine Charge.' USING ERRCODE = '23514', HINT = 'behandlung_charge';
    END IF;
    SELECT t.gebindepflege INTO v_pflege FROM public.keller_behandlungstypen t WHERE t.id = NEW.typ_id;
    IF NOT coalesce(v_pflege, false) THEN
      RAISE EXCEPTION 'Kellerbehandlungen werden an der Charge erfasst. Ohne Charge ist am Gebinde nur Gebindepflege möglich (Reinigen, Konservieren, Umbenennung, Notiz).'
        USING ERRCODE = '23514', HINT = 'behandlung_charge';
    END IF;
  END IF;
  RETURN NULL;
END $$;
COMMENT ON FUNCTION public.s112_behandlung_an_charge() IS
  'KAN-475: Kellerbehandlung braucht eine Charge; ohne Charge nur Gebindepflege am Gebinde (AFTER-Trigger z_charge_pflicht, nach der Rechteprüfung).';

CREATE TRIGGER a_gebinde_von_charge BEFORE INSERT ON public.keller_behandlungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_behandlung_gebinde_von_charge();
CREATE TRIGGER z_charge_pflicht AFTER INSERT OR UPDATE OF weinausbau_id, behaelter_id, typ_id ON public.keller_behandlungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_behandlung_an_charge();

DO $pruef$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.keller_behandlungen'::regclass AND tgname = 'a_charge_pflicht') THEN
    RAISE EXCEPTION 'KAN-475: alter BEFORE-Trigger a_charge_pflicht ist noch da';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.keller_behandlungen'::regclass AND tgname IN ('a_gebinde_von_charge', 'z_charge_pflicht') AND NOT tgisinternal) <> 2 THEN
    RAISE EXCEPTION 'KAN-475: Trigger a_gebinde_von_charge / z_charge_pflicht fehlen';
  END IF;
  IF has_function_privilege('authenticated', 'public.s112_behandlung_gebinde_von_charge()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.s112_behandlung_an_charge()', 'EXECUTE') THEN
    RAISE EXCEPTION 'KAN-475: Triggerfunktion ist für authenticated ausführbar';
  END IF;
END $pruef$;
