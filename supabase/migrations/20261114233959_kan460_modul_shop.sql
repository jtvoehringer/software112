-- KAN-460 (15.11.2026, Weinshop S1a): Paket-Modul modul_shop und Einstellungen der WooCommerce-Anbindung.
-- Entscheidungen Jörgen (KAN-407, 15.11.2026): Zusatzmodul wie SumUp, bei allen Betrieben aus; Bestand wird nur nach
-- ausdrücklichem Einschalten je Betrieb übertragen (shop_bestand_uebertragen, Standard aus); software:112 überschreibt
-- im Shop nur eigene Felder. Dieser Teil schreibt noch nichts in den Shop (nur Verbindungstest).
--   * tenant_einstellungen: modul_shop, shop_url, shop_bestandsreserve, shop_bestand_uebertragen (lesbar wie alle
--     Nicht-Geheimnisse) sowie shop_woo_api_key und shop_woo_secret (Geheimnisse nach KAN-135: kein GRANT, nur
--     Service-Role, verschlüsselt gespeichert). Schreiben nur per Service-Role (Trigger a_schutz_plattformfelder).
--   * s112_paketmodul_frei kennt den Schalter 'modul_shop' (für die Policies der Shop-Tabellen ab KAN-461).
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

ALTER TABLE public.tenant_einstellungen
  ADD COLUMN modul_shop               boolean NOT NULL DEFAULT false,
  ADD COLUMN shop_url                 text    CONSTRAINT tenant_einstellungen_shop_url_chk CHECK (shop_url IS NULL OR (shop_url ~ '^https://[^[:space:]]+$' AND length(shop_url) <= 300)),
  ADD COLUMN shop_bestandsreserve     integer NOT NULL DEFAULT 0 CONSTRAINT tenant_einstellungen_shop_bestandsreserve_chk CHECK (shop_bestandsreserve BETWEEN 0 AND 100000),
  ADD COLUMN shop_bestand_uebertragen boolean NOT NULL DEFAULT false,
  ADD COLUMN shop_woo_api_key         text,
  ADD COLUMN shop_woo_secret          text;

COMMENT ON COLUMN public.tenant_einstellungen.modul_shop IS 'KAN-460: Zusatzmodul Weinshop-Anbindung (WooCommerce); schaltet nur der Plattform-Admin';
COMMENT ON COLUMN public.tenant_einstellungen.shop_url IS 'KAN-460: Adresse des WooCommerce-Shops (nur https)';
COMMENT ON COLUMN public.tenant_einstellungen.shop_bestandsreserve IS 'KAN-460: Flaschen je Füllung, die dem Shop nicht gemeldet werden (Reserve für den Ab-Hof-Verkauf)';
COMMENT ON COLUMN public.tenant_einstellungen.shop_bestand_uebertragen IS 'KAN-460: Bestand an den Shop übertragen (Standard aus – nur Weindaten)';
COMMENT ON COLUMN public.tenant_einstellungen.shop_woo_api_key IS 'KAN-460: WooCommerce Consumer Key, verschlüsselt (Geheimnis: nur Service-Role)';
COMMENT ON COLUMN public.tenant_einstellungen.shop_woo_secret IS 'KAN-460: WooCommerce Consumer Secret, verschlüsselt (Geheimnis: nur Service-Role)';

-- Nicht-Geheimnisse lesbar (Regel KAN-135: neue Spalten brauchen einen ausdrücklichen GRANT); die zwei Geheimnisse nicht
GRANT SELECT (modul_shop, shop_url, shop_bestandsreserve, shop_bestand_uebertragen) ON public.tenant_einstellungen TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.s112_paketmodul_frei(p_tenant_id uuid, p_schalter text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT public.ist_service_kontext()
      OR EXISTS (SELECT 1 FROM plattform_admins p WHERE p.user_id = (SELECT auth.uid()))
      OR (p_tenant_id IN (SELECT public.s112_meine_tenants())
          AND coalesce((SELECT CASE p_schalter
                                 WHEN 'modul_ea'          THEN e.modul_ea
                                 WHEN 'modul_export'      THEN e.modul_export
                                 WHEN 'modul_sumup'       THEN e.modul_sumup
                                 WHEN 'modul_controlling' THEN e.modul_controlling
                                 WHEN 'assistent_aktiv'   THEN e.assistent_aktiv
                                 WHEN 'modul_shop'        THEN e.modul_shop
                               END
                          FROM tenant_einstellungen e WHERE e.tenant_id = p_tenant_id), false))
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_paketmodul_frei(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_paketmodul_frei(uuid, text) TO authenticated;

-- Selbstprüfung: Geheimnisse für anon/authenticated unlesbar und unschreibbar, die übrigen Spalten lesbar
DO $$
DECLARE
  v_fehler text := '';
  r record;
BEGIN
  FOR r IN
    SELECT c.col, g.rolle, p.recht
      FROM unnest(ARRAY['shop_woo_api_key', 'shop_woo_secret']) AS c(col)
     CROSS JOIN (VALUES ('anon'), ('authenticated')) AS g(rolle)
     CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE')) AS p(recht)
     WHERE has_column_privilege(g.rolle, 'public.tenant_einstellungen', c.col, p.recht)
  LOOP
    v_fehler := v_fehler || format('%s %s %s; ', r.col, r.rolle, r.recht);
  END LOOP;
  FOR r IN
    SELECT c.col, g.rolle
      FROM unnest(ARRAY['modul_shop', 'shop_url', 'shop_bestandsreserve', 'shop_bestand_uebertragen']) AS c(col)
     CROSS JOIN (VALUES ('anon'), ('authenticated')) AS g(rolle)
     WHERE NOT has_column_privilege(g.rolle, 'public.tenant_einstellungen', c.col, 'SELECT')
  LOOP
    v_fehler := v_fehler || format('%s für %s nicht lesbar; ', r.col, r.rolle);
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.tenant_einstellungen WHERE modul_shop) THEN
    v_fehler := v_fehler || 'modul_shop ist bei einem Betrieb an; ';
  END IF;
  IF v_fehler <> '' THEN
    RAISE EXCEPTION 'KAN-460 Selbstprüfung fehlgeschlagen: %', v_fehler;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
