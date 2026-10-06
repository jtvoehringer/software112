-- KAN-215 (06.10.2026): Abrechnungsverbund – n Mandanten über einen Hauptmandanten abrechnen (Variante A, Entscheidungen
-- Jörgen im Kommentar KAN-215).
--  1. tenants.abrechnung_ueber: Hauptmandant, über dessen Stripe-Abo der Betrieb als „Zusatzmandant“ abgerechnet wird
--     (Rechnungsempfänger immer der Hauptmandant); tenants.zusatz_preis_cent: vereinbarter Monatspreis je Nebenmandant
--     (NULL = Standardpreis des Zusatzmandanten-Produkts in Stripe).
--  2. Keine Ketten, keine Selbstreferenz: ein Hauptmandant ist nie selbst Nebenmandant (Trigger a_abrechnungsverbund).
-- Schreiben nur Plattform-Admin bzw. Service-Role – Benutzer sperrt der bestehende Trigger a_schutz_plattformfelder
-- (Positivliste, neue Spalten automatisch gesperrt). Status, Paket und Testphase spiegelt der Stripe-Webhook in alle
-- Betriebe mit derselben stripe_customer_id; ein Austritt setzt den Nebenmandanten auf Nur-Lesen (App).
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

ALTER TABLE public.tenants
  ADD COLUMN abrechnung_ueber uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  ADD COLUMN zusatz_preis_cent integer,
  ADD CONSTRAINT tenants_abrechnung_nicht_selbst_chk CHECK (abrechnung_ueber IS NULL OR abrechnung_ueber <> id),
  ADD CONSTRAINT tenants_zusatz_preis_chk CHECK (zusatz_preis_cent IS NULL OR (zusatz_preis_cent BETWEEN 100 AND 10000000 AND abrechnung_ueber IS NOT NULL));
COMMENT ON COLUMN public.tenants.abrechnung_ueber IS 'KAN-215: Hauptmandant des Abrechnungsverbunds (Stripe-Abo des Hauptmandanten, Position Zusatzmandant); NULL = eigenes Abo';
COMMENT ON COLUMN public.tenants.zusatz_preis_cent IS 'KAN-215: vereinbarter Monatspreis (Cent, netto) als Zusatzmandant; NULL = Standardpreis';
CREATE INDEX tenants_abrechnung_ueber_idx ON public.tenants (abrechnung_ueber) WHERE abrechnung_ueber IS NOT NULL;

CREATE OR REPLACE FUNCTION public.s112_abrechnungsverbund_pruefen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.abrechnung_ueber IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.tenants h WHERE h.id = NEW.abrechnung_ueber AND h.abrechnung_ueber IS NOT NULL) THEN
      RAISE EXCEPTION 'Der Hauptmandant wird selbst über einen anderen Betrieb abgerechnet – Verbünde ohne Ketten (KAN-215).'
        USING ERRCODE = '23514', HINT = 'abrechnungsverbund';
    END IF;
    IF EXISTS (SELECT 1 FROM public.tenants n WHERE n.abrechnung_ueber = NEW.id) THEN
      RAISE EXCEPTION 'Dieser Betrieb ist Hauptmandant eines Verbunds und kann nicht selbst Nebenmandant werden (KAN-215).'
        USING ERRCODE = '23514', HINT = 'abrechnungsverbund';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_abrechnungsverbund_pruefen() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_abrechnungsverbund BEFORE INSERT OR UPDATE OF abrechnung_ueber ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.s112_abrechnungsverbund_pruefen();
