-- KAN-103 Nachtrag (08.10.2026): Stornierte Rechnungen behalten ihre Beträge.
-- s112_rechnung_stornieren löst die Lieferscheine von der Rechnung (wieder „nicht berechnet“). Das Rechnungsausgangsjournal
-- holt die Positionen aber über die Lieferscheine – die stornierte Rechnung stünde dort ohne Beträge (Vorgabe: stornierte
-- Rechnungen bleiben mit ihren ursprünglichen Beträgen im Journal, Lückenlosigkeit).
--  1. rechnungen.storno_positionen: Momentaufnahme der Positionen (mit Lieferschein-Nummer/-Datum) beim Rechnungsstorno.
--  2. s112_rechnung_stornieren schreibt sie, bevor die Lieferscheine gelöst werden.
-- Staging zuerst (sjpeghrlhsowmquacjhb), DB-Test 70, dann Produktion.

ALTER TABLE public.rechnungen ADD COLUMN storno_positionen jsonb;
COMMENT ON COLUMN public.rechnungen.storno_positionen IS
  'KAN-103: Positionen der Lieferscheine zum Zeitpunkt des Rechnungsstornos (die Lieferscheine sind danach wieder nicht berechnet)';

CREATE OR REPLACE FUNCTION public.s112_rechnung_stornieren(p_tenant_id uuid, p_rechnung_id uuid, p_grund text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_r     public.rechnungen%ROWTYPE;
  v_grund text := btrim(coalesce(p_grund, ''));
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft');
  IF length(v_grund) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für den Storno angeben (mindestens 10 Zeichen).' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_r FROM public.rechnungen r WHERE r.id = p_rechnung_id AND r.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rechnung nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_r.storniert THEN
    RAISE EXCEPTION 'Die Rechnung % ist bereits storniert.', v_r.rechnungsnummer USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.zahlungen z WHERE z.rechnung_id = p_rechnung_id AND z.storniert_am IS NULL) THEN
    RAISE EXCEPTION 'Zur Rechnung % gibt es Zahlungen – bitte zuerst die Zahlungen stornieren.', v_r.rechnungsnummer
      USING ERRCODE = '22023', HINT = 'rechnung_zahlungen';
  END IF;
  IF v_r.bmd_export_id IS NOT NULL THEN
    RAISE EXCEPTION 'Die Rechnung % ist bereits an BMD übergeben – Storno bitte über die Buchhaltung.', v_r.rechnungsnummer
      USING ERRCODE = '22023', HINT = 'rechnung_bmd';
  END IF;

  UPDATE public.rechnungen
     SET storniert = true, storniert_am = now(), storniert_von = auth.uid(),
         storniert_von_name = public.s112_storno_benutzername(auth.uid()), storno_grund = v_grund, spiegel = false,
         -- Momentaufnahme der Positionen (Journal: stornierte Rechnungen mit ihren Beträgen)
         storno_positionen = (
           SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'lieferschein_id', v.id, 'lieferscheinnummer', v.lieferscheinnummer, 'lieferdatum', v.datum,
                    'typ', p.typ, 'name', p.name, 'menge', p.menge, 'einheit', p.einheit, 'preis_brutto', p.preis_brutto,
                    'rabatt_pct', p.rabatt_pct, 'sonderrabatt_pct', p.sonderrabatt_pct, 'ust_satz', p.ust_satz,
                    'traubenverkauf_id', p.traubenverkauf_id)
                  ORDER BY v.datum, v.lieferscheinnummer, p.erstellt_am, p.id), '[]'::jsonb)
             FROM public.verkaufsposten v JOIN public.verkauf_positionen p ON p.verkaufsposten_id = v.id
            WHERE v.rechnung_id = p_rechnung_id AND v.tenant_id = p_tenant_id)
   WHERE id = p_rechnung_id;
  -- Lieferscheine wieder „nicht berechnet“ (Bestand bleibt); stornierte Zahlungen bleiben an der Rechnung
  PERFORM set_config('s112.rechnung_rpc', 'an', true);
  UPDATE public.verkaufsposten SET rechnung_id = NULL, rechnungsnummer = NULL, bezahlt = false, bezahlt_am = NULL
   WHERE rechnung_id = p_rechnung_id AND tenant_id = p_tenant_id;
  PERFORM set_config('s112.rechnung_rpc', '', true);
END
$function$;
