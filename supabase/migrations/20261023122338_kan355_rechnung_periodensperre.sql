-- KAN-355 (23.10.2026, UAT Musterhof): Periodensperre auch für Rechnungen
--
-- Befund: RE-0039 entstand am 23.10.2026 mit Rechnungsdatum 16.03.2026 (Verkauf mit „Rechnung sofort“, Lieferschein
-- LS-2026-0041, Trigger b_rechnung_anlegen), obwohl 01/2025–08/2026 abgeschlossen (ea_monatsabschluss) und die UVA 2026 Q1
-- übermittelt (ea_uva.gesperrt) sind – ohne Meldung. Die Periodensperre aus KAN-149 D3 (a_ea_periodensperre) galt nur für
-- ea_transaktionen, zahlungen und konto_umbuchungen. Bei Doppik rechnet die UVA aber nach Rechnungsdatum (KAN-105 Teil B,
-- berechne_ea_uva: aktive, nicht stornierte Rechnungen mit den Positionen ihrer Lieferscheine) – eine Rechnung im
-- abgeschlossenen Zeitraum ändert also einen gesperrten Zeitraum.
--
--  1. rechnungen: Trigger a_ea_periodensperre (BEFORE INSERT, UPDATE OF datum/tenant_id/storniert/aktiv, DELETE) mit
--     eigener Funktion s112_rechnung_periodensperre(). Gleiche Regel wie bei Zahlungen (s112_ea_zeitraum_sperrgrund:
--     abgeschlossener Monat oder per UVA übermittelter Monat/Quartal), gleiche Meldungsart, 42501, HINT 'periodensperre'.
--     Geprüft werden das Rechnungsdatum (neu anlegen, Datum verschieben – alt und neu –, löschen) und – Entscheidung Jörgen
--     23.10.2026, vorläufig bis KAN-379 – der Storno bzw. das Deaktivieren einer Rechnung im gesperrten Zeitraum (er nähme
--     sie rückwirkend aus der Doppik-UVA dieses Zeitraums; HINT 'periodensperre_storno'). Das gilt für
--     s112_rechnung_stornieren wie für den Verkaufsstorno (Spiegel z_rechnung_spiegeln). Bezahlt, Versand, BMD-Export und
--     der Spiegel ohne Datums- bzw. Stornoänderung bleiben frei. Deshalb nicht s112_ea_periodensperre mit Positivliste:
--     dort wäre jede künftige Spalte gesperrt, und der Spiegel (setzt datum immer mit) bräche jede Änderung am Lieferschein.
--     Lieferscheine ohne Rechnung („Rechnung später“) sind nicht betroffen.
--  2. verkauf_positionen (Rechnungspositionen über die Elternzeile): Trigger a_rechnung_periodensperre (BEFORE INSERT,
--     UPDATE OF menge/preis_brutto/rabatt_pct/sonderrabatt_pct/ust_satz/verkaufsposten_id, DELETE) – gehört der
--     Lieferschein zu einer aktiven, nicht stornierten Rechnung in einem gesperrten Zeitraum, lehnt er Betrags-
--     änderungen ab (genau die Spalten, die berechne_ea_uva liest). s112_rechnung_erstellen setzt die Preise, bevor die
--     Lieferscheine an der Rechnung hängen – dort greift die Sperre über das Rechnungsdatum (1).
--  Ausgenommen: Wartung (s112_wartung_frei – Service-Role/SQL-Editor mit s112.loeschen_erlaubt bzw. Demo-Reset), wie bei
--  der bestehenden Sperre. Sonst gilt sie für alle Rollen, auch für die Service-Role.
--  Storno im offenen Zeitraum unverändert; die Gegenbuchung im offenen Zeitraum für gesperrte Rechnungen folgt mit KAN-379.
-- Keine Datenänderung (RE-0039 bleibt, Korrektur gesondert). Kein session_replication_role (KAN-124).
-- Staging zuerst (sjpeghrlhsowmquacjhb), DB-Test 83, dann Produktion.

-- 1. Rechnungen ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_rechnung_periodensperre()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_grund text;
BEGIN
  IF public.s112_wartung_frei(CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_grund := public.s112_ea_zeitraum_sperrgrund(NEW.tenant_id, NEW.datum);
    IF v_grund IS NOT NULL THEN
      RAISE EXCEPTION 'Rechnung mit Datum % nicht möglich: % Bitte ein Rechnungsdatum im offenen Zeitraum wählen.',
        to_char(NEW.datum, 'DD.MM.YYYY'), v_grund USING ERRCODE = '42501', HINT = 'periodensperre';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_grund := public.s112_ea_zeitraum_sperrgrund(OLD.tenant_id, OLD.datum);
    IF v_grund IS NOT NULL THEN
      RAISE EXCEPTION 'Die Rechnung % vom % lässt sich nicht löschen: % Berichtigungen bitte stornieren.',
        OLD.rechnungsnummer, to_char(OLD.datum, 'DD.MM.YYYY'), v_grund USING ERRCODE = '42501', HINT = 'periodensperre';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: Storno/Deaktivieren im gesperrten Zeitraum vorläufig gesperrt (bis KAN-379: Gegenbuchung im offenen Zeitraum)
  IF (NEW.storniert AND NOT OLD.storniert) OR (OLD.aktiv AND NOT NEW.aktiv) THEN
    v_grund := public.s112_ea_zeitraum_sperrgrund(OLD.tenant_id, OLD.datum);
    IF v_grund IS NOT NULL THEN
      RAISE EXCEPTION 'Storno nicht möglich: Die Rechnung % liegt im abgeschlossenen Zeitraum %. Die Gegenbuchung im offenen Zeitraum folgt mit KAN-379.',
        OLD.rechnungsnummer, to_char(OLD.datum, 'MM/YYYY') USING ERRCODE = '42501', HINT = 'periodensperre_storno',
        DETAIL = v_grund;
    END IF;
  END IF;
  -- sonst zählen nur das Rechnungsdatum (und der Betrieb) – bezahlt, Versand, BMD bleiben frei
  IF NEW.datum IS NOT DISTINCT FROM OLD.datum AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id THEN
    RETURN NEW;
  END IF;
  v_grund := public.s112_ea_zeitraum_sperrgrund(OLD.tenant_id, OLD.datum);
  IF v_grund IS NOT NULL THEN
    RAISE EXCEPTION 'Das Datum der Rechnung % (%) lässt sich nicht ändern: % Berichtigungen bitte stornieren.',
      OLD.rechnungsnummer, to_char(OLD.datum, 'DD.MM.YYYY'), v_grund USING ERRCODE = '42501', HINT = 'periodensperre';
  END IF;
  v_grund := public.s112_ea_zeitraum_sperrgrund(NEW.tenant_id, NEW.datum);
  IF v_grund IS NOT NULL THEN
    RAISE EXCEPTION 'Rechnung mit Datum % nicht möglich: % Bitte ein Rechnungsdatum im offenen Zeitraum wählen.',
      to_char(NEW.datum, 'DD.MM.YYYY'), v_grund USING ERRCODE = '42501', HINT = 'periodensperre';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_rechnung_periodensperre() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.s112_rechnung_periodensperre() IS
  'KAN-355: Periodensperre für Rechnungen (Rechnungsdatum in abgeschlossenem Monat bzw. per UVA übermitteltem Zeitraum) – Trigger a_ea_periodensperre';

DROP TRIGGER IF EXISTS a_ea_periodensperre ON public.rechnungen;
CREATE TRIGGER a_ea_periodensperre BEFORE INSERT OR UPDATE OF datum, tenant_id, storniert, aktiv OR DELETE ON public.rechnungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_rechnung_periodensperre();

-- 2. Rechnungspositionen (verkauf_positionen über Lieferschein → Rechnung) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_rechnung_positionen_periodensperre()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_tenant uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
  v_vp     uuid;
  v_r      record;
  v_grund  text;
BEGIN
  IF public.s112_wartung_frei(v_tenant) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  -- nur Betragsänderungen (die Spalten, die berechne_ea_uva liest) – Name, Verweise usw. bleiben frei
  IF TG_OP = 'UPDATE'
     AND (NEW.menge, NEW.preis_brutto, NEW.rabatt_pct, NEW.sonderrabatt_pct, NEW.ust_satz, NEW.verkaufsposten_id)
         IS NOT DISTINCT FROM (OLD.menge, OLD.preis_brutto, OLD.rabatt_pct, OLD.sonderrabatt_pct, OLD.ust_satz, OLD.verkaufsposten_id) THEN
    RETURN NEW;
  END IF;

  FOREACH v_vp IN ARRAY ARRAY[CASE WHEN TG_OP <> 'INSERT' THEN OLD.verkaufsposten_id END,
                              CASE WHEN TG_OP <> 'DELETE' THEN NEW.verkaufsposten_id END] LOOP
    CONTINUE WHEN v_vp IS NULL;
    SELECT r.rechnungsnummer, r.datum, r.tenant_id INTO v_r
      FROM public.verkaufsposten v JOIN public.rechnungen r ON r.id = v.rechnung_id AND r.tenant_id = v.tenant_id
     WHERE v.id = v_vp AND r.aktiv AND NOT r.storniert;
    CONTINUE WHEN NOT FOUND;
    v_grund := public.s112_ea_zeitraum_sperrgrund(v_r.tenant_id, v_r.datum);
    IF v_grund IS NOT NULL THEN
      RAISE EXCEPTION 'Die Positionen der Rechnung % vom % lassen sich nicht ändern: % Berichtigungen bitte über einen Storno der Rechnung.',
        v_r.rechnungsnummer, to_char(v_r.datum, 'DD.MM.YYYY'), v_grund USING ERRCODE = '42501', HINT = 'periodensperre';
    END IF;
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_rechnung_positionen_periodensperre() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.s112_rechnung_positionen_periodensperre() IS
  'KAN-355: Beträge der Positionen einer Rechnung im gesperrten Zeitraum unveränderlich – Trigger a_rechnung_periodensperre an verkauf_positionen';

DROP TRIGGER IF EXISTS a_rechnung_periodensperre ON public.verkauf_positionen;
CREATE TRIGGER a_rechnung_periodensperre
  BEFORE INSERT OR UPDATE OF menge, preis_brutto, rabatt_pct, sonderrabatt_pct, ust_satz, verkaufsposten_id OR DELETE
  ON public.verkauf_positionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_rechnung_positionen_periodensperre();

-- 3. Selbstprüfung ─────────────────────────────────────────────────────────────────────────────────────────────
DO $pruef$
DECLARE
  v_fn text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'a_ea_periodensperre' AND tgrelid = 'public.rechnungen'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'KAN-355: Trigger a_ea_periodensperre an rechnungen fehlt';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'a_rechnung_periodensperre' AND tgrelid = 'public.verkauf_positionen'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'KAN-355: Trigger a_rechnung_periodensperre an verkauf_positionen fehlt';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY['public.s112_rechnung_periodensperre()', 'public.s112_rechnung_positionen_periodensperre()'] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'KAN-355: % ist für anon/authenticated ausführbar', v_fn;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_fn::regprocedure AND prosecdef
                     AND proconfig @> ARRAY['search_path=public']) THEN
      RAISE EXCEPTION 'KAN-355: % ohne SECURITY DEFINER bzw. search_path', v_fn;
    END IF;
  END LOOP;
END
$pruef$;
