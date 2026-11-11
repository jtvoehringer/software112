-- KAN-411 Teil 2 (11.11.2026): „Bestellung erkennen“ – gelernte Begriffe der Kunden.
-- Entscheidung Jörgen (11.11.2026, Kommentar im Ticket): „mitlernend“ = Variante A – Korrekturen merken: Bestellt ein
-- Kunde „GV Klassik“ und der Benutzer wählt dazu die Füllung X, gilt das beim nächsten Mal (je Kunde, als Hinweis auch
-- für die anderen Kunden des Betriebs). Die KI schlägt nur vor; gespeichert wird der Verkauf weiter durch den Benutzer.
--
-- verkauf_ki_begriffe: je Betrieb, Kunde (Kontakt oder Firma) und Begriff die zuletzt gewählte Füllung. Geschrieben wird
-- beim Speichern eines Verkaufs aus einer E-Mail (Server Action, Schreibrecht Warenwirtschaft), gelesen von der KI-Route.
-- Kein Bericht, keine Buchung – Zeilen dürfen gelöscht werden (Kaskade mit Kunde bzw. Füllung).
-- Staging zuerst (sjpeghrlhsowmquacjhb), DB-Test 93, dann Produktion. Erst danach die App (PR KAN-411 Teil 2) mergen.

CREATE TABLE public.verkauf_ki_begriffe (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kontakt_id   uuid REFERENCES public.kontakte(id) ON DELETE CASCADE,
  firma_id     uuid REFERENCES public.firmen(id) ON DELETE CASCADE,
  begriff      text NOT NULL CONSTRAINT verkauf_ki_begriffe_begriff_chk CHECK (char_length(begriff) BETWEEN 2 AND 120),
  fuellung_id  uuid NOT NULL REFERENCES public.fuellungen(id) ON DELETE CASCADE,
  anzahl       integer NOT NULL DEFAULT 1 CONSTRAINT verkauf_ki_begriffe_anzahl_chk CHECK (anzahl >= 1),
  zuletzt_am   timestamptz NOT NULL DEFAULT now(),
  erstellt_von uuid DEFAULT auth.uid(),
  CONSTRAINT verkauf_ki_begriffe_ein_kunde CHECK (kontakt_id IS NULL OR firma_id IS NULL)
);
CREATE INDEX verkauf_ki_begriffe_tenant_idx ON public.verkauf_ki_begriffe (tenant_id, zuletzt_am DESC);
CREATE INDEX verkauf_ki_begriffe_kontakt_idx ON public.verkauf_ki_begriffe (kontakt_id) WHERE kontakt_id IS NOT NULL;
CREATE INDEX verkauf_ki_begriffe_firma_idx ON public.verkauf_ki_begriffe (firma_id) WHERE firma_id IS NOT NULL;
CREATE INDEX verkauf_ki_begriffe_fuellung_idx ON public.verkauf_ki_begriffe (fuellung_id);
COMMENT ON TABLE public.verkauf_ki_begriffe IS
  'KAN-411: gelernte Begriffe aus Bestell-Mails – Kunde nennt „begriff“, gewählt wurde fuellung_id (Hinweis für „Bestellung erkennen“)';

ALTER TABLE public.verkauf_ki_begriffe ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.verkauf_ki_begriffe FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.verkauf_ki_begriffe FROM anon;
CREATE POLICY verkauf_ki_begriffe_select ON public.verkauf_ki_begriffe FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY verkauf_ki_begriffe_insert ON public.verkauf_ki_begriffe FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m
                             WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin', 'tenant_admin', 'winzer')));
CREATE POLICY verkauf_ki_begriffe_update ON public.verkauf_ki_begriffe FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m
                        WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin', 'tenant_admin', 'winzer')))
  WITH CHECK (tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m
                             WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin', 'tenant_admin', 'winzer')));
CREATE POLICY verkauf_ki_begriffe_delete ON public.verkauf_ki_begriffe FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m
                        WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin', 'tenant_admin', 'winzer')));
CREATE POLICY modul_insert ON public.verkauf_ki_begriffe AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.s112_darf_schreiben(tenant_id, 'warenwirtschaft'));
CREATE POLICY modul_update ON public.verkauf_ki_begriffe AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.s112_darf_schreiben(tenant_id, 'warenwirtschaft')) WITH CHECK (public.s112_darf_schreiben(tenant_id, 'warenwirtschaft'));
CREATE POLICY modul_delete ON public.verkauf_ki_begriffe AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.s112_darf_schreiben(tenant_id, 'warenwirtschaft'));
CREATE POLICY mitgliedschaft_aktiv ON public.verkauf_ki_begriffe AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY abo_schreibsperre_ins ON public.verkauf_ki_begriffe AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.verkauf_ki_begriffe AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.verkauf_ki_begriffe AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.verkauf_ki_begriffe AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));

-- KAN-178: Verweise nur in den eigenen Betrieb
CREATE TRIGGER z_fremdverweis_kontakt_id BEFORE INSERT OR UPDATE OF kontakt_id, tenant_id ON public.verkauf_ki_begriffe
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('kontakt_id', 'kontakte', '', '', '');
CREATE TRIGGER z_fremdverweis_firma_id BEFORE INSERT OR UPDATE OF firma_id, tenant_id ON public.verkauf_ki_begriffe
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('firma_id', 'firmen', '', '', '');
CREATE TRIGGER z_fremdverweis_fuellung_id BEFORE INSERT OR UPDATE OF fuellung_id, tenant_id ON public.verkauf_ki_begriffe
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('fuellung_id', 'fuellungen', '', '', '');
