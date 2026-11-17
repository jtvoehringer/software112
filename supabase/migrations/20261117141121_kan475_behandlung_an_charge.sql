-- KAN-475: Kellerbehandlungen gehören zur Charge, nicht zum Gebinde (BKI-Sitzung 16.11.2026)
--
-- Bisher war das Gebinde Pflicht (behaelter_id NOT NULL) und die Charge freiwillig – fachlich ist es umgekehrt: Behandelt
-- wird der Wein (die Charge); das Gebinde ist nur die Angabe „lag damals in …“. Ohne Charge sind am Gebinde nur noch
-- Einträge der Gebindepflege möglich (Reinigen, Konservieren, Umbenennung, Notiz) – dafür ein Kennzeichen am Typ.
--
--   1. keller_behandlungstypen.gebindepflege (Standard false); die Typen „Umbenennung“ und „Notiz“ (legt die App selbst
--      an) sowie Reinigung/Konservierung werden gekennzeichnet.
--   2. keller_behandlungen.behaelter_id darf fehlen (Charge ohne Gebinde); Trigger a_charge_pflicht:
--        · ohne Charge nur mit Gebinde UND einem Typ der Gebindepflege, sonst 23514 mit HINT behandlung_charge;
--        · mit Charge ohne Gebinde wird beim Anlegen das Gebinde der Charge übernommen („lag damals in …“).
--      Bestand: In der Produktion hat jede Behandlung eine Charge (16.11.2026: 0 ohne) – geprüft wird nur bei INSERT und
--      bei Änderung von Charge, Gebinde oder Typ, bestehende Zeilen bleiben unberührt.
--      Wartung (s112.loeschen_erlaubt) und das Entfernen der Charge durch den Fremdschlüssel (ON DELETE SET NULL, die
--      Charge gibt es dann nicht mehr) passieren die Regel.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- ── 1. Kennzeichen Gebindepflege am Behandlungstyp ──────────────────────────────────────────────────────────────────
ALTER TABLE public.keller_behandlungstypen ADD COLUMN gebindepflege boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.keller_behandlungstypen.gebindepflege IS
  'KAN-475: Arbeit am Gebinde ohne Charge (Reinigen, Konservieren, Umbenennung, Notiz) – nur solche Typen sind ohne Charge erlaubt.';

UPDATE public.keller_behandlungstypen
   SET gebindepflege = true
 WHERE lower(btrim(name)) IN ('umbenennung', 'notiz') OR name ~* '(reinig|konservier)';

-- ── 2. Charge ist Pflicht, das Gebinde nur noch Angabe ──────────────────────────────────────────────────────────────
ALTER TABLE public.keller_behandlungen ALTER COLUMN behaelter_id DROP NOT NULL;
COMMENT ON COLUMN public.keller_behandlungen.behaelter_id IS
  'KAN-475: Gebinde, in dem die Charge am Tag der Behandlung lag (Angabe); bei Gebindepflege ohne Charge das gepflegte Gebinde.';

CREATE FUNCTION public.s112_behandlung_an_charge() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_pflege boolean;
BEGIN
  IF NEW.weinausbau_id IS NULL THEN
    -- Wartung (Demo-Reset, Mandant löschen) und das Leeren der Charge durch den Fremdschlüssel (Charge gelöscht)
    IF coalesce(current_setting('s112.loeschen_erlaubt', true), '') <> '' THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND OLD.weinausbau_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.weinausbau w WHERE w.id = OLD.weinausbau_id) THEN
      RETURN NEW;
    END IF;
    IF NEW.behaelter_id IS NULL THEN
      RAISE EXCEPTION 'Eine Kellerbehandlung braucht eine Charge.' USING ERRCODE = '23514', HINT = 'behandlung_charge';
    END IF;
    SELECT t.gebindepflege INTO v_pflege FROM public.keller_behandlungstypen t WHERE t.id = NEW.typ_id;
    IF NOT coalesce(v_pflege, false) THEN
      RAISE EXCEPTION 'Kellerbehandlungen werden an der Charge erfasst. Ohne Charge ist am Gebinde nur Gebindepflege möglich (Reinigen, Konservieren, Umbenennung, Notiz).'
        USING ERRCODE = '23514', HINT = 'behandlung_charge';
    END IF;
  ELSIF TG_OP = 'INSERT' AND NEW.behaelter_id IS NULL THEN
    -- „lag damals in …“: Gebinde der Charge zum Zeitpunkt der Erfassung
    SELECT w.behaelter_id INTO NEW.behaelter_id FROM public.weinausbau w WHERE w.id = NEW.weinausbau_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.s112_behandlung_an_charge() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.s112_behandlung_an_charge() IS
  'KAN-475: Kellerbehandlung braucht eine Charge; ohne Charge nur Gebindepflege am Gebinde. Übernimmt beim Anlegen das Gebinde der Charge.';

CREATE TRIGGER a_charge_pflicht BEFORE INSERT OR UPDATE OF weinausbau_id, behaelter_id, typ_id ON public.keller_behandlungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_behandlung_an_charge();

-- ── 3. Selbstprüfung ────────────────────────────────────────────────────────────────────────────────────────────────
DO $pruef$
BEGIN
  IF (SELECT is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'keller_behandlungen' AND column_name = 'behaelter_id') <> 'YES' THEN
    RAISE EXCEPTION 'KAN-475: keller_behandlungen.behaelter_id ist noch Pflicht';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.keller_behandlungen'::regclass AND tgname = 'a_charge_pflicht' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'KAN-475: Trigger a_charge_pflicht fehlt';
  END IF;
  IF has_function_privilege('authenticated', 'public.s112_behandlung_an_charge()', 'EXECUTE') THEN
    RAISE EXCEPTION 'KAN-475: Triggerfunktion ist für authenticated ausführbar';
  END IF;
END $pruef$;
