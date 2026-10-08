-- KAN-105 Teil A (08.10.2026): Zahlungen gehören zur Rechnung (KAN-102) – Grundlage für Sammelrechnungen (KAN-104).
--  1. zahlungen.rechnung_id: setzt der Trigger a_zahlung_rechnung aus dem Lieferschein (verkaufsposten.rechnung_id), die App
--     bucht weiter mit verkaufsposten_id; per API weder abweichend setzbar noch änderbar. Altzahlungen nachgetragen.
--  2. bezahlt je Rechnung: sync_verkaufsposten_bezahlt rechnet Gesamtbetrag (alle Lieferscheine der Rechnung) gegen die nicht
--     stornierten Zahlungen der Rechnung und setzt bezahlt/bezahlt_am an der Rechnung und an allen ihren Lieferscheinen.
--     Lieferscheine ohne Rechnung wie bisher je Lieferschein. Bei einer Rechnung je Lieferschein ändert sich nichts.
-- Staging zuerst (sjpeghrlhsowmquacjhb), DB-Test 69, dann Produktion.

-- 1. Zahlung → Rechnung ──────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.zahlungen ADD COLUMN rechnung_id uuid REFERENCES public.rechnungen(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.zahlungen.rechnung_id IS 'KAN-105: Rechnung der Zahlung (aus dem Lieferschein, setzt das System)';
CREATE INDEX zahlungen_rechnung_idx ON public.zahlungen (rechnung_id) WHERE rechnung_id IS NOT NULL;
CREATE TRIGGER z_fremdverweis_rechnung_id BEFORE INSERT OR UPDATE OF rechnung_id, tenant_id ON public.zahlungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('rechnung_id', 'rechnungen', '', '', '');

CREATE FUNCTION public.s112_zahlung_rechnung()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_api boolean := coalesce(auth.role(), '') IN ('authenticated', 'anon');
  v_re  uuid;
BEGIN
  IF NEW.verkaufsposten_id IS NOT NULL THEN
    SELECT v.rechnung_id INTO v_re FROM public.verkaufsposten v WHERE v.id = NEW.verkaufsposten_id;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.verkaufsposten_id IS NOT DISTINCT FROM OLD.verkaufsposten_id
     AND NEW.rechnung_id IS NOT DISTINCT FROM OLD.rechnung_id THEN
    RETURN NEW;   -- nichts an der Zuordnung geändert
  END IF;
  IF v_api AND NEW.rechnung_id IS NOT NULL AND NEW.rechnung_id IS DISTINCT FROM v_re THEN
    RAISE EXCEPTION 'Die Rechnung einer Zahlung setzt das System (aus dem Lieferschein).' USING ERRCODE = '42501', HINT = 'rechnung_id';
  END IF;
  IF v_re IS NOT NULL OR v_api THEN
    NEW.rechnung_id := v_re;
  END IF;
  RETURN NEW;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_zahlung_rechnung() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_zahlung_rechnung BEFORE INSERT OR UPDATE OF verkaufsposten_id, rechnung_id ON public.zahlungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_zahlung_rechnung();

-- Periodensperre (KAN-149 D3): die Zuordnung zur Rechnung ändert keinen Betrag und kein Datum – frei wie „abgeglichen“
DROP TRIGGER a_ea_periodensperre ON public.zahlungen;
CREATE TRIGGER a_ea_periodensperre BEFORE INSERT OR DELETE OR UPDATE ON public.zahlungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_ea_periodensperre('abgeglichen,storniert_am,storniert_von,storniert_von_name,storno_grund,rechnung_id', '');

-- Altzahlungen: Rechnung des Lieferscheins (direkt, ohne Umweg über die Trigger-Logik)
UPDATE public.zahlungen z
   SET rechnung_id = v.rechnung_id
  FROM public.verkaufsposten v
 WHERE v.id = z.verkaufsposten_id AND z.rechnung_id IS NULL AND v.rechnung_id IS NOT NULL;

-- 2. bezahlt je Rechnung ─────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_verkaufsposten_bezahlt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id       uuid;
  v_tenant   uuid;
  v_re       uuid;
  v_gesamt   numeric(10,2);
  v_gezahlt  numeric(10,2);
  v_bezahlt  boolean;
BEGIN
  IF TG_OP <> 'DELETE' AND NEW.verkaufsposten_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM verkaufsposten v WHERE v.id = NEW.verkaufsposten_id AND v.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Der Verkaufsposten gehört nicht zu diesem Betrieb.' USING ERRCODE = '42501';
  END IF;

  FOR v_id, v_tenant IN
    SELECT DISTINCT x.id, x.tenant_id
      FROM (VALUES (CASE WHEN TG_OP <> 'INSERT' THEN OLD.verkaufsposten_id END, CASE WHEN TG_OP <> 'INSERT' THEN OLD.tenant_id END),
                   (CASE WHEN TG_OP <> 'DELETE' THEN NEW.verkaufsposten_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.tenant_id END)) AS x (id, tenant_id)
     WHERE x.id IS NOT NULL
  LOOP
    SELECT v.rechnung_id INTO v_re FROM verkaufsposten v WHERE v.id = v_id AND v.tenant_id = v_tenant;

    IF v_re IS NULL THEN
      -- Lieferschein ohne Rechnung: wie bisher je Lieferschein
      SELECT COALESCE(SUM(ROUND(vp.menge * COALESCE(vp.preis_brutto, 0)
               * (1 - COALESCE(vp.rabatt_pct, 0) / 100) * (1 - COALESCE(vp.sonderrabatt_pct, 0) / 100), 2)), 0)
        INTO v_gesamt FROM verkauf_positionen vp WHERE vp.verkaufsposten_id = v_id;
      -- KAN-149 D2: stornierte Zahlungen zählen nicht
      SELECT COALESCE(SUM(betrag), 0) INTO v_gezahlt
        FROM zahlungen WHERE verkaufsposten_id = v_id AND tenant_id = v_tenant AND storniert_am IS NULL;
      v_bezahlt := v_gezahlt >= v_gesamt AND v_gesamt > 0;
      UPDATE verkaufsposten
         SET bezahlt = v_bezahlt, bezahlt_am = CASE WHEN v_bezahlt THEN now() ELSE NULL END
       WHERE id = v_id AND tenant_id = v_tenant;
    ELSE
      -- KAN-105: Rechnung = alle ihre Lieferscheine; Zahlungen der Rechnung
      SELECT COALESCE(SUM(ROUND(vp.menge * COALESCE(vp.preis_brutto, 0)
               * (1 - COALESCE(vp.rabatt_pct, 0) / 100) * (1 - COALESCE(vp.sonderrabatt_pct, 0) / 100), 2)), 0)
        INTO v_gesamt
        FROM verkauf_positionen vp JOIN verkaufsposten v ON v.id = vp.verkaufsposten_id
       WHERE v.rechnung_id = v_re AND v.tenant_id = v_tenant;
      SELECT COALESCE(SUM(betrag), 0) INTO v_gezahlt
        FROM zahlungen WHERE rechnung_id = v_re AND tenant_id = v_tenant AND storniert_am IS NULL;
      v_bezahlt := v_gezahlt >= v_gesamt AND v_gesamt > 0;
      UPDATE rechnungen
         SET bezahlt = v_bezahlt, bezahlt_am = CASE WHEN v_bezahlt THEN now() ELSE NULL END
       WHERE id = v_re AND tenant_id = v_tenant;
      UPDATE verkaufsposten
         SET bezahlt = v_bezahlt, bezahlt_am = CASE WHEN v_bezahlt THEN now() ELSE NULL END
       WHERE rechnung_id = v_re AND tenant_id = v_tenant;
    END IF;
  END LOOP;

  RETURN NULL;   -- AFTER-Trigger: Rückgabewert wird ignoriert
END;
$function$;

-- Selbstprüfung: jede Zahlung eines berechneten Lieferscheins hängt an dessen Rechnung; bezahlt an Rechnung = Lieferschein
DO $pruefung$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.zahlungen z JOIN public.verkaufsposten v ON v.id = z.verkaufsposten_id
   WHERE z.rechnung_id IS DISTINCT FROM v.rechnung_id;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'KAN-105: % Zahlung(en) ohne passende Rechnung', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.verkaufsposten v JOIN public.rechnungen r ON r.id = v.rechnung_id WHERE r.bezahlt <> v.bezahlt;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'KAN-105: % Lieferschein(e) mit anderem bezahlt-Stand als die Rechnung', v_n;
  END IF;
END
$pruefung$;
