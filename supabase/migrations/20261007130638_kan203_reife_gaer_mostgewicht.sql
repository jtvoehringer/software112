-- KAN-203 (07.10.2026): Mostgewicht Teil D – Reife- und Gärmessungen mit Einheit (°KMW/°Oe).
-- Entscheidung Jörgen 06.10.2026 („Vorschlag passt“):
--  1. reifemessungen: Reife-Messung je Ried (Datum, Mostgewicht wie alle anderen über MostgewichtEingabe – Messwert
--     und Einheit, beide Werte gespeichert, KAN-128 –, optional Gesamtsäure und pH, Notiz). Stammdaten-nah, nicht
--     berichtsrelevant (keine Behördenmeldung) → Anlegen, Ändern, Löschen mit Schreibrecht Rieden.
--  2. weinanalysen (Gärkontrolle) += kmw, oechsle, mostgewicht_einheit – optionales Mostgewicht im Gärverlauf.
--  Beide Tabellen bekommen den Abgleich-Trigger b_mostgewicht (s112_mostgewicht_abgleichen, KAN-128) mit den
--  Bereichs-CHECKs wie die sechs bestehenden Tabellen.
-- Staging zuerst (sjpeghrlhsowmquacjhb), DB-Test 60, dann Produktion.

-- 1. Reife-Messungen je Ried ──────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.reifemessungen (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  weingarten_id       uuid NOT NULL REFERENCES public.weingarten(id) ON DELETE CASCADE,
  datum               date NOT NULL,
  kmw                 numeric(5,2),
  oechsle             numeric(5,1),
  mostgewicht_einheit text NOT NULL DEFAULT 'kmw',
  gesamtsaeure_gl     numeric(5,2) CHECK (gesamtsaeure_gl IS NULL OR gesamtsaeure_gl BETWEEN 0 AND 50),
  ph_wert             numeric(4,2) CHECK (ph_wert IS NULL OR ph_wert BETWEEN 0 AND 14),
  notizen             text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reifemessungen_kmw_bereich_check CHECK (kmw IS NULL OR kmw BETWEEN 0 AND 60),
  CONSTRAINT reifemessungen_mostgewicht_einheit_check CHECK (mostgewicht_einheit IN ('kmw', 'oechsle')),
  CONSTRAINT reifemessungen_oechsle_bereich_check
    CHECK (oechsle IS NULL OR oechsle BETWEEN 0 AND CASE WHEN mostgewicht_einheit = 'oechsle' THEN 350 ELSE 351.6 END),
  -- eine Reife-Messung ohne Mostgewicht ist keine
  CONSTRAINT reifemessungen_mostgewicht_pflicht CHECK (kmw IS NOT NULL AND oechsle IS NOT NULL)
);
CREATE INDEX reifemessungen_weingarten_idx ON public.reifemessungen (weingarten_id, datum);
CREATE INDEX reifemessungen_tenant_idx ON public.reifemessungen (tenant_id, datum);
COMMENT ON TABLE public.reifemessungen IS
  'KAN-203: Reife-Messung je Ried – Mostgewicht als Messwert mit Einheit (°KMW/°Oe, beide gespeichert, Abgleich b_mostgewicht), optional Säure und pH';

ALTER TABLE public.reifemessungen ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.reifemessungen FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.reifemessungen FROM anon;
CREATE POLICY reifemessungen_select ON public.reifemessungen FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY reifemessungen_write ON public.reifemessungen FOR ALL TO authenticated
  USING (tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m
                        WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin', 'tenant_admin', 'winzer')))
  WITH CHECK (tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m
                        WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin', 'tenant_admin', 'winzer')));
CREATE POLICY modul_insert ON public.reifemessungen AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.s112_darf_schreiben(tenant_id, 'rieden'));
CREATE POLICY modul_update ON public.reifemessungen AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.s112_darf_schreiben(tenant_id, 'rieden')) WITH CHECK (public.s112_darf_schreiben(tenant_id, 'rieden'));
CREATE POLICY modul_delete ON public.reifemessungen AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.s112_darf_schreiben(tenant_id, 'rieden'));
CREATE POLICY mitgliedschaft_aktiv ON public.reifemessungen AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY abo_schreibsperre_ins ON public.reifemessungen AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.reifemessungen AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.reifemessungen AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.reifemessungen AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));

CREATE TRIGGER reifemessungen_updated_at BEFORE UPDATE ON public.reifemessungen
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
-- BEFORE-Trigger feuern in Namensreihenfolge: b_mostgewicht vor reifemessungen_updated_at und den
-- z_fremdverweis-Triggern; der Pflicht-CHECK sieht die abgeglichenen Werte.
CREATE TRIGGER b_mostgewicht
  BEFORE INSERT OR UPDATE OF kmw, oechsle, mostgewicht_einheit ON public.reifemessungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_mostgewicht_abgleichen('kmw', 'oechsle', 'mostgewicht_einheit');
CREATE TRIGGER z_fremdverweis_weingarten_id BEFORE INSERT OR UPDATE OF weingarten_id, tenant_id ON public.reifemessungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weingarten_id', 'weingarten', '', '', '');

-- 2. Gärkontrolle: Mostgewicht an der Laboranalyse ──────────────────────────────────────────────────────────
ALTER TABLE public.weinanalysen
  ADD COLUMN kmw                 numeric(5,2),
  ADD COLUMN oechsle             numeric(5,1),
  ADD COLUMN mostgewicht_einheit text NOT NULL DEFAULT 'kmw';
ALTER TABLE public.weinanalysen ADD CONSTRAINT weinanalysen_kmw_bereich_check
  CHECK (kmw IS NULL OR kmw BETWEEN 0 AND 60);
ALTER TABLE public.weinanalysen ADD CONSTRAINT weinanalysen_mostgewicht_einheit_check
  CHECK (mostgewicht_einheit IN ('kmw', 'oechsle'));
ALTER TABLE public.weinanalysen ADD CONSTRAINT weinanalysen_oechsle_bereich_check
  CHECK (oechsle IS NULL OR oechsle BETWEEN 0 AND CASE WHEN mostgewicht_einheit = 'oechsle' THEN 350 ELSE 351.6 END);
COMMENT ON COLUMN public.weinanalysen.kmw IS 'KAN-203: Mostgewicht im Gärverlauf in °KMW (optional; Abgleich b_mostgewicht)';
CREATE TRIGGER b_mostgewicht
  BEFORE INSERT OR UPDATE OF kmw, oechsle, mostgewicht_einheit ON public.weinanalysen
  FOR EACH ROW EXECUTE FUNCTION public.s112_mostgewicht_abgleichen('kmw', 'oechsle', 'mostgewicht_einheit');
