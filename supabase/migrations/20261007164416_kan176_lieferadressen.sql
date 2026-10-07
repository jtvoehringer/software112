-- KAN-176 (07.10.2026): Accounts (Kontakte, Firmen) mit mehreren Lieferadressen; Verkauf mit abweichender Lieferadresse.
--  1. lieferadressen: je Kontakt ODER Firma beliebig viele (Bezeichnung, Empfänger, Straße, PLZ, Ort, Land ISO, aktiv).
--     Pflege im CRM (Schreibrecht CRM) und beim Verkauf („für die Zukunft speichern“, Schreibrecht Warenwirtschaft).
--     Gelöscht wird nicht, nur deaktiviert (Verkäufe verweisen darauf); mit Kontakt/Firma fallen sie weg (CASCADE).
--  2. verkaufsposten += lieferadresse (Momentaufnahme jsonb: bezeichnung, empfaenger, strasse, plz, ort, land; NULL =
--     Rechnungsadresse) und lieferadresse_id (Herkunft, SET NULL). Die Momentaufnahme bleibt, auch wenn die Adresse
--     später geändert wird – Rechnung, Lieferschein und Transportbescheinigung (Ort der Einlagerung) lesen sie.
-- Staging zuerst (sjpeghrlhsowmquacjhb), DB-Test 64, dann Produktion.

-- 1. Lieferadressen ──────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.lieferadressen (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kontakt_id      uuid REFERENCES public.kontakte(id) ON DELETE CASCADE,
  firma_id        uuid REFERENCES public.firmen(id) ON DELETE CASCADE,
  bezeichnung     text CHECK (bezeichnung IS NULL OR length(btrim(bezeichnung)) <= 80),
  empfaenger      text CHECK (empfaenger IS NULL OR length(btrim(empfaenger)) <= 120),
  strasse         text NOT NULL CHECK (length(btrim(strasse)) BETWEEN 1 AND 120),
  plz             text NOT NULL CHECK (length(btrim(plz)) BETWEEN 1 AND 12),
  ort             text NOT NULL CHECK (length(btrim(ort)) BETWEEN 1 AND 80),
  land            text NOT NULL DEFAULT 'AT' CHECK (land ~ '^[A-Z]{2}$'),
  notizen         text,
  aktiv           boolean NOT NULL DEFAULT true,
  erstellt_am     timestamptz NOT NULL DEFAULT now(),
  aktualisiert_am timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lieferadressen_ein_partner CHECK (num_nonnulls(kontakt_id, firma_id) = 1)
);
CREATE INDEX lieferadressen_kontakt_idx ON public.lieferadressen (kontakt_id) WHERE kontakt_id IS NOT NULL;
CREATE INDEX lieferadressen_firma_idx ON public.lieferadressen (firma_id) WHERE firma_id IS NOT NULL;
CREATE INDEX lieferadressen_tenant_idx ON public.lieferadressen (tenant_id);
COMMENT ON TABLE public.lieferadressen IS 'KAN-176: weitere Lieferadressen je Kontakt bzw. Firma (Auswahl beim Verkauf); nur deaktivieren, nicht löschen';

ALTER TABLE public.lieferadressen ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.lieferadressen FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.lieferadressen FROM anon;
REVOKE DELETE ON public.lieferadressen FROM authenticated;
CREATE POLICY lieferadressen_select ON public.lieferadressen FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY lieferadressen_insert ON public.lieferadressen FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m
                             WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin', 'tenant_admin', 'winzer')));
CREATE POLICY lieferadressen_update ON public.lieferadressen FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m
                        WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin', 'tenant_admin', 'winzer')))
  WITH CHECK (tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m
                             WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin', 'tenant_admin', 'winzer')));
CREATE POLICY modul_insert ON public.lieferadressen AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.s112_darf_schreiben(tenant_id, 'crm', 'warenwirtschaft'));
CREATE POLICY modul_update ON public.lieferadressen AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.s112_darf_schreiben(tenant_id, 'crm', 'warenwirtschaft')) WITH CHECK (public.s112_darf_schreiben(tenant_id, 'crm', 'warenwirtschaft'));
CREATE POLICY mitgliedschaft_aktiv ON public.lieferadressen AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY abo_schreibsperre_ins ON public.lieferadressen AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.lieferadressen AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.lieferadressen AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.lieferadressen AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));

CREATE TRIGGER lieferadressen_aktualisiert BEFORE UPDATE ON public.lieferadressen
  FOR EACH ROW EXECUTE FUNCTION public.update_aktualisiert_am();
CREATE TRIGGER z_fremdverweis_kontakt_id BEFORE INSERT OR UPDATE OF kontakt_id, tenant_id ON public.lieferadressen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('kontakt_id', 'kontakte', '', '', '');
CREATE TRIGGER z_fremdverweis_firma_id BEFORE INSERT OR UPDATE OF firma_id, tenant_id ON public.lieferadressen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('firma_id', 'firmen', '', '', '');

-- 2. Verkauf ─────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.verkaufsposten
  ADD COLUMN lieferadresse    jsonb CHECK (lieferadresse IS NULL OR (jsonb_typeof(lieferadresse) = 'object'
                                AND coalesce(lieferadresse ->> 'strasse', '') <> '' AND coalesce(lieferadresse ->> 'ort', '') <> '')),
  ADD COLUMN lieferadresse_id uuid REFERENCES public.lieferadressen(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.verkaufsposten.lieferadresse IS 'KAN-176: abweichende Lieferadresse als Momentaufnahme (bezeichnung, empfaenger, strasse, plz, ort, land); NULL = Rechnungsadresse';
CREATE TRIGGER z_fremdverweis_lieferadresse_id BEFORE INSERT OR UPDATE OF lieferadresse_id, tenant_id ON public.verkaufsposten
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('lieferadresse_id', 'lieferadressen', '', '', '');
