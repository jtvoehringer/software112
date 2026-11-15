-- KAN-461 (15.11.2026, Weinshop S1b): Zuordnung Füllung ↔ WooCommerce-Produkt.
--
-- Je Shop-Produkt legt die Betriebsleitung fest, welche Füllung dahintersteht (Grundlage für Weindaten und Bestand,
-- KAN-462/KAN-463). Entscheidungen Jörgen 15.11.2026 (Plan KAN-461):
--   * je Betrieb ein Produkt ↔ höchstens eine Füllung UND eine Füllung ↔ höchstens ein Produkt (sonst würde der
--     Bestand später doppelt gemeldet); Jahrgangswechsel = Zuordnung auf die neue Füllung umhängen;
--   * Schreiben nur durch die Betriebsleitung (system_admin, tenant_admin), lesen im Lesebereich „lager“;
--   * Verweis auf die Füllung mit ON DELETE CASCADE: Füllungen löscht im Betrieb niemand (Löschsperre), wohl aber der
--     Demo-Reset, das Pilot-Abräumen und das Löschen eines Betriebs – ohne Kaskade bräche der Musterhof-Reset (KAN-380);
--   * Name und SKU des Produkts als Momentaufnahme (die Seite zeigt sie auch, wenn der Shop gerade nicht antwortet).
-- Paket-Modul modul_shop (KAN-195/KAN-460): ohne Modul lehnt die Datenbank das Schreiben ab, Lesen bleibt.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

CREATE TABLE public.shop_zuordnungen (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  fuellung_id        uuid NOT NULL REFERENCES public.fuellungen(id) ON DELETE CASCADE,
  woo_produkt_id     bigint NOT NULL CONSTRAINT shop_zuordnungen_woo_produkt_id_chk CHECK (woo_produkt_id > 0),
  woo_name           text CONSTRAINT shop_zuordnungen_woo_name_chk CHECK (woo_name IS NULL OR char_length(woo_name) BETWEEN 1 AND 300),
  woo_sku            text CONSTRAINT shop_zuordnungen_woo_sku_chk CHECK (woo_sku IS NULL OR char_length(woo_sku) BETWEEN 1 AND 100),
  -- gesetzt, wenn software:112 die SKU selbst in den Shop geschrieben hat (sonst war sie schon da bzw. steht noch aus)
  sku_geschrieben_am timestamptz,
  erstellt_am        timestamptz NOT NULL DEFAULT now(),
  erstellt_von       uuid DEFAULT auth.uid(),
  aktualisiert_am    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shop_zuordnungen_produkt_key UNIQUE (tenant_id, woo_produkt_id),
  CONSTRAINT shop_zuordnungen_fuellung_key UNIQUE (tenant_id, fuellung_id)
);
-- tenant_id führt beide UNIQUE-Indizes an; der Verweis auf die Füllung bekommt einen eigenen Index (Kaskade, DB-Test 78)
CREATE INDEX shop_zuordnungen_fuellung_idx ON public.shop_zuordnungen (fuellung_id);
COMMENT ON TABLE public.shop_zuordnungen IS
  'KAN-461: Zuordnung Füllung ↔ WooCommerce-Produkt je Betrieb (1:1). Schreiben nur Betriebsleitung, Paket-Modul modul_shop; Name/SKU des Produkts als Momentaufnahme.';

ALTER TABLE public.shop_zuordnungen ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.shop_zuordnungen FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.shop_zuordnungen FROM anon;

CREATE POLICY shop_zuordnungen_select ON public.shop_zuordnungen FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY shop_zuordnungen_insert ON public.shop_zuordnungen FOR INSERT TO authenticated
  WITH CHECK (public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin']));
CREATE POLICY shop_zuordnungen_update ON public.shop_zuordnungen FOR UPDATE TO authenticated
  USING (public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin']))
  WITH CHECK (public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin']));
CREATE POLICY shop_zuordnungen_delete ON public.shop_zuordnungen FOR DELETE TO authenticated
  USING (public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin']));

CREATE POLICY mitgliedschaft_aktiv ON public.shop_zuordnungen AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())))
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.shop_zuordnungen AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));
-- KAN-454/KAN-459: Lesebereich „lager“ – für alle Befehle
CREATE POLICY lesebereich ON public.shop_zuordnungen AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_lesegesperrte_tenants('lager'))))
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_lesegesperrte_tenants('lager'))));
COMMENT ON POLICY lesebereich ON public.shop_zuordnungen IS 'KAN-461: Lesebereich lager – gesperrt für Profile ohne diesen Bereich (alle Befehle, KAN-459)';
CREATE POLICY abo_schreibsperre_ins ON public.shop_zuordnungen AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.shop_zuordnungen AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())))
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.shop_zuordnungen AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
-- KAN-195: Paket-Modul Weinshop-Anbindung
CREATE POLICY paketmodul_ins ON public.shop_zuordnungen AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_shop'));
CREATE POLICY paketmodul_upd ON public.shop_zuordnungen AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_shop')) WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_shop'));
CREATE POLICY paketmodul_del ON public.shop_zuordnungen AS RESTRICTIVE FOR DELETE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_shop'));

-- KAN-178: Verweis nur in den eigenen Betrieb
CREATE TRIGGER z_fremdverweis_fuellung_id BEFORE INSERT OR UPDATE OF fuellung_id, tenant_id ON public.shop_zuordnungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('fuellung_id', 'fuellungen', '', '', '');

NOTIFY pgrst, 'reload schema';
