-- Paketmodell Basis / Standard / Premium (Rückmeldung 2.9.2026, Pakete gesetzt).
-- Fachliche Definition: src/lib/pakete.ts. Diese Migration liefert die zwei
-- DB-Bausteine, die der Code dafür braucht:
--
-- 1) tenants.max_benutzer - Benutzerlimit des gebuchten Pakets
--    (Basis 1, Standard 5, Premium NULL = unbegrenzt). Wird vom Stripe-Webhook
--    gesetzt; NULL auch für Betriebe ohne Stripe-Abo (Sandbox, manuell
--    betreute Kunden). Durchgesetzt beim Einladen (lib/pakete-server.ts).
--
-- 2) KI-Abfragen "Frag dein Weingut" neu gestaffelt (Basis 50 / Standard 100 /
--    Premium unbegrenzt statt bisher 100 / 200 / unbegrenzt) und - bisher
--    nicht geprüft - ki_abfragen_aktiv wird jetzt auch serverseitig
--    berücksichtigt (ohne Paket bzw. gekündigt: keine Abfragen).

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS max_benutzer integer;
COMMENT ON COLUMN tenants.max_benutzer IS
  'Benutzerlimit des gebuchten Pakets (Basis 1, Standard 5); NULL = unbegrenzt (Premium oder kein Stripe-Abo). Gesetzt vom Stripe-Webhook.';

CREATE OR REPLACE FUNCTION public.check_und_increment_ki_abfrage(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Muss mit kiLimit in src/lib/pakete.ts übereinstimmen.
  limit_map jsonb := '{"basic":50,"standard":100,"unlimited":9999999}'::jsonb;
  rec record;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id);

  SELECT ki_abfragen_aktiv, ki_abfragen_paket, ki_abfragen_zaehler, ki_abfragen_reset_datum
  INTO rec FROM tenant_einstellungen WHERE tenant_id = p_tenant_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('erlaubt', false, 'fehler', 'Mandant nicht gefunden');
  END IF;

  IF NOT COALESCE(rec.ki_abfragen_aktiv, false) THEN
    RETURN jsonb_build_object(
      'erlaubt', false,
      'verbraucht', COALESCE(rec.ki_abfragen_zaehler, 0),
      'limit', 0,
      'paket', COALESCE(rec.ki_abfragen_paket, 'basic'),
      'fehler', 'Frag dein Weingut ist in Ihrem Paket nicht enthalten.'
    );
  END IF;

  IF rec.ki_abfragen_reset_datum IS NULL OR rec.ki_abfragen_reset_datum < date_trunc('month', current_date) THEN
    UPDATE tenant_einstellungen
    SET ki_abfragen_zaehler = 0, ki_abfragen_reset_datum = current_date
    WHERE tenant_id = p_tenant_id;
    rec.ki_abfragen_zaehler := 0;
  END IF;

  IF COALESCE(rec.ki_abfragen_zaehler, 0) >= COALESCE((limit_map->>rec.ki_abfragen_paket)::int, 50) THEN
    RETURN jsonb_build_object(
      'erlaubt', false,
      'verbraucht', COALESCE(rec.ki_abfragen_zaehler, 0),
      'limit', COALESCE((limit_map->>rec.ki_abfragen_paket)::int, 50),
      'paket', rec.ki_abfragen_paket
    );
  END IF;

  UPDATE tenant_einstellungen
  SET ki_abfragen_zaehler = COALESCE(ki_abfragen_zaehler, 0) + 1
  WHERE tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'erlaubt', true,
    'verbraucht', COALESCE(rec.ki_abfragen_zaehler, 0) + 1,
    'limit', COALESCE((limit_map->>rec.ki_abfragen_paket)::int, 50),
    'paket', rec.ki_abfragen_paket
  );
END;
$function$;
