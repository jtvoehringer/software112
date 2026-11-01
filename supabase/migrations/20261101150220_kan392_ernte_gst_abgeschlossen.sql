-- KAN-392 (01.11.2026): „Ernte abgeschlossen“ je Grundstück und Jahrgang. Ein abgeschlossenes GST schlägt das
-- Lese-Formular nicht mehr vor (Nachlese über „anzeigen“). Wieder öffnen = Zeile löschen (keine Buchung, kein Storno).
-- Schreibrecht wie Lesen/Lesegut: Rieden oder Kellerbuch. Mit Jahrgang bzw. Grundstück fällt die Zeile weg (CASCADE).
-- Staging zuerst (sjpeghrlhsowmquacjhb), DB-Test 88, dann Produktion.

CREATE TABLE public.ernte_gst_abgeschlossen (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  jahrgang_id    uuid NOT NULL REFERENCES public.weinjahrgaenge(id) ON DELETE CASCADE,
  grundstueck_id uuid NOT NULL REFERENCES public.grundstuecke(id) ON DELETE CASCADE,
  gesetzt_am     timestamptz NOT NULL DEFAULT now(),
  gesetzt_von    uuid DEFAULT auth.uid(),
  CONSTRAINT ernte_gst_abgeschlossen_eindeutig UNIQUE (jahrgang_id, grundstueck_id)
);
CREATE INDEX ernte_gst_abgeschlossen_tenant_idx ON public.ernte_gst_abgeschlossen (tenant_id);
CREATE INDEX ernte_gst_abgeschlossen_grundstueck_idx ON public.ernte_gst_abgeschlossen (grundstueck_id);
COMMENT ON TABLE public.ernte_gst_abgeschlossen IS 'KAN-392: Ernte eines Grundstücks im Jahrgang abgeschlossen – nicht mehr im Lese-Formular vorschlagen; löschen = wieder öffnen';

ALTER TABLE public.ernte_gst_abgeschlossen ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.ernte_gst_abgeschlossen FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ernte_gst_abgeschlossen FROM anon;
CREATE POLICY ernte_gst_abgeschlossen_select ON public.ernte_gst_abgeschlossen FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY ernte_gst_abgeschlossen_insert ON public.ernte_gst_abgeschlossen FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m
                             WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin', 'tenant_admin', 'winzer')));
CREATE POLICY ernte_gst_abgeschlossen_update ON public.ernte_gst_abgeschlossen FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m
                        WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin', 'tenant_admin', 'winzer')))
  WITH CHECK (tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m
                             WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin', 'tenant_admin', 'winzer')));
CREATE POLICY ernte_gst_abgeschlossen_delete ON public.ernte_gst_abgeschlossen FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m
                        WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin', 'tenant_admin', 'winzer')));
CREATE POLICY modul_insert ON public.ernte_gst_abgeschlossen AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.s112_darf_schreiben(tenant_id, 'rieden', 'kellerbuch'));
CREATE POLICY modul_update ON public.ernte_gst_abgeschlossen AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.s112_darf_schreiben(tenant_id, 'rieden', 'kellerbuch')) WITH CHECK (public.s112_darf_schreiben(tenant_id, 'rieden', 'kellerbuch'));
CREATE POLICY modul_delete ON public.ernte_gst_abgeschlossen AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.s112_darf_schreiben(tenant_id, 'rieden', 'kellerbuch'));
CREATE POLICY mitgliedschaft_aktiv ON public.ernte_gst_abgeschlossen AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY abo_schreibsperre_ins ON public.ernte_gst_abgeschlossen AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.ernte_gst_abgeschlossen AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.ernte_gst_abgeschlossen AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.ernte_gst_abgeschlossen AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));

CREATE TRIGGER z_fremdverweis_jahrgang_id BEFORE INSERT OR UPDATE OF jahrgang_id, tenant_id ON public.ernte_gst_abgeschlossen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('jahrgang_id', 'weinjahrgaenge', '', '', '');
CREATE TRIGGER z_fremdverweis_grundstueck_id BEFORE INSERT OR UPDATE OF grundstueck_id, tenant_id ON public.ernte_gst_abgeschlossen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('grundstueck_id', 'grundstuecke', '', '', '');
