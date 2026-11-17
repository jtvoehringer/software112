-- KAN-481 (S3): Maßnahmen an der Maische, anteilig in die Chargen übernommen (BKI-Sitzung 16.11.2026)
--
-- Vorgabe: Während des Maischens vorgenommene Maßnahmen (SO₂, Enzyme, Hefe, Anreicherung …) werden in die Chargen
-- mitgenommen und dort dargestellt – anteilig nach Litern, wenn aus der Maische n Chargen entstehen.
--
-- Umsetzung ohne neue Tabelle: Eine Maßnahme an der Maische ist eine Kellerbehandlung (keller_behandlungen) mit
-- pressung_id = Maische (KAN-480) statt einer Charge; das Gebinde ist das der Maische. Dieselben Behandlungstypen,
-- dasselbe Stoffkonto (kellermittel_buchungen.keller_behandlung_id), Storno und Protokoll wie jede Kellerbehandlung.
-- Die Anteile je Charge werden gerechnet (Liter der Mostzeile ÷ Liter aller Mostzeilen der Pressung) – wie die
-- Ernte-Anteile aus KAN-477, nicht gespeichert. Wird die Pressung bzw. eine Mostzeile storniert, ändern sich die
-- Anteile von selbst; die Maßnahme an der Maische bleibt.
--
-- Regeln (nach der Rechteprüfung, AFTER-Trigger z_charge_pflicht wie seit KAN-475):
--   - entweder Charge oder Maische, nie beides (CHECK);
--   - die Maische gehört zum Betrieb (z_fremdverweis_pressung_id), ist eine Maische und nicht storniert;
--   - das Datum liegt nicht vor dem Beginn der Maische und – ist sie abgepresst – nicht nach dem Pressdatum.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

ALTER TABLE public.keller_behandlungen
  ADD COLUMN pressung_id uuid REFERENCES public.pressungen(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.keller_behandlungen.pressung_id IS
  'KAN-481: Maische (Pressung mit maische_beginn), an der die Maßnahme vorgenommen wurde – statt einer Charge. Die Chargen der Pressung übernehmen sie anteilig nach Litern (gerechnet).';

ALTER TABLE public.keller_behandlungen
  ADD CONSTRAINT keller_behandlungen_charge_oder_maische_chk CHECK (pressung_id IS NULL OR weinausbau_id IS NULL);

CREATE INDEX keller_behandlungen_pressung_id ON public.keller_behandlungen (pressung_id);

CREATE TRIGGER z_fremdverweis_pressung_id BEFORE INSERT OR UPDATE OF pressung_id, tenant_id ON public.keller_behandlungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('pressung_id', 'pressungen', '', '', '');

-- Gebinde der Maßnahme: bei einer Charge deren Gebinde (KAN-475), bei einer Maische das Gebinde der Maische
CREATE OR REPLACE FUNCTION public.s112_behandlung_gebinde_von_charge()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.weinausbau_id IS NOT NULL AND NEW.behaelter_id IS NULL THEN
    -- „lag damals in …“: Gebinde der Charge zum Zeitpunkt der Erfassung (unter den Rechten des Benutzers gelesen)
    SELECT w.behaelter_id INTO NEW.behaelter_id FROM public.weinausbau w WHERE w.id = NEW.weinausbau_id;
  ELSIF NEW.weinausbau_id IS NULL AND NEW.pressung_id IS NOT NULL THEN
    -- KAN-481: Maßnahme an der Maische – immer das Gebinde der Maische, was immer der Aufrufer schickt
    SELECT p.maische_behaelter_id INTO NEW.behaelter_id FROM public.pressungen p WHERE p.id = NEW.pressung_id;
  END IF;
  RETURN NEW;
END $function$;
REVOKE EXECUTE ON FUNCTION public.s112_behandlung_gebinde_von_charge() FROM PUBLIC, anon, authenticated;

-- Regel „Kellerbehandlung braucht eine Charge“ (KAN-475) – erweitert um die Maische
CREATE OR REPLACE FUNCTION public.s112_behandlung_an_charge()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pflege boolean;
  v_m      record;
BEGIN
  IF NEW.weinausbau_id IS NULL THEN
    -- Wartung (Demo-Reset, Mandant löschen) und das Leeren der Charge durch den Fremdschlüssel (Charge gelöscht)
    IF coalesce(current_setting('s112.loeschen_erlaubt', true), '') <> '' THEN RETURN NULL; END IF;
    IF TG_OP = 'UPDATE' AND OLD.weinausbau_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.weinausbau w WHERE w.id = OLD.weinausbau_id) THEN
      RETURN NULL;
    END IF;
    -- KAN-481: das Leeren der Maische durch den Fremdschlüssel (stornierte Pressung endgültig gelöscht)
    IF TG_OP = 'UPDATE' AND NEW.pressung_id IS NULL AND OLD.pressung_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.pressungen p WHERE p.id = OLD.pressung_id) THEN
      RETURN NULL;
    END IF;
    -- KAN-481: Maßnahme an der Maische statt an einer Charge
    IF NEW.pressung_id IS NOT NULL THEN
      SELECT p.maische_beginn, p.maische_offen, p.datum, p.storniert_am INTO v_m FROM public.pressungen p WHERE p.id = NEW.pressung_id;
      IF NOT FOUND OR v_m.maische_beginn IS NULL THEN
        RAISE EXCEPTION 'Die gewählte Pressung ist keine Maische. Maßnahmen ohne Charge sind nur an einer Maische möglich.'
          USING ERRCODE = '23514', HINT = 'behandlung_maische';
      END IF;
      -- eine stornierte Behandlung bleibt, wie sie ist; neu erfasst bzw. geändert wird nur an einer gültigen Maische
      IF NEW.storniert_am IS NULL AND (TG_OP = 'INSERT' OR NEW.pressung_id IS DISTINCT FROM OLD.pressung_id OR NEW.datum IS DISTINCT FROM OLD.datum) THEN
        IF v_m.storniert_am IS NOT NULL THEN
          RAISE EXCEPTION 'Die Maische ist storniert – an ihr lässt sich keine Maßnahme mehr erfassen.'
            USING ERRCODE = '23514', HINT = 'behandlung_maische';
        END IF;
        IF NEW.datum < v_m.maische_beginn OR (NOT v_m.maische_offen AND NEW.datum > v_m.datum) THEN
          RAISE EXCEPTION 'Das Datum der Maßnahme liegt außerhalb der Maischezeit (% bis %).',
            to_char(v_m.maische_beginn, 'DD.MM.YYYY'), CASE WHEN v_m.maische_offen THEN 'heute' ELSE to_char(v_m.datum, 'DD.MM.YYYY') END
            USING ERRCODE = '23514', HINT = 'behandlung_maische';
        END IF;
      END IF;
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
END $function$;
REVOKE EXECUTE ON FUNCTION public.s112_behandlung_an_charge() FROM PUBLIC, anon, authenticated;

-- der Trigger achtet zusätzlich auf Maische und Datum
DROP TRIGGER z_charge_pflicht ON public.keller_behandlungen;
CREATE TRIGGER z_charge_pflicht AFTER INSERT OR UPDATE OF weinausbau_id, behaelter_id, typ_id, pressung_id, datum ON public.keller_behandlungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_behandlung_an_charge();

-- Protokoll: Änderung der Maische-Zuordnung mitschreiben (wie Charge und Gebinde)
DROP TRIGGER z_protokoll_aendern ON public.keller_behandlungen;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF datum, menge, einheit, volumen_liter_ist, typ_id, weinausbau_id, behaelter_id, pressung_id, tenant_id, storniert_am, storno_grund, notizen ON public.keller_behandlungen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('datum', 'menge', 'einheit', 'volumen_liter_ist', 'typ_id', 'weinausbau_id', 'behaelter_id', 'pressung_id', 'tenant_id', 'storniert_am', 'storno_grund', 'notizen');
