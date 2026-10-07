-- KAN-107 (07.10.2026): Besondere Konten – Stoffkonto im Kellerbuch (Saccharose, KTM, RTK, Säuerung, Entsäuerung …).
-- R11 „besondere konten: eu/kellerbuch geführt wie spritzmittelkonto“; Del. VO (EU) 2018/273, § 31 WeinG (in AP0 zu
-- verifizieren). Entscheidung Jörgen 06.10.2026: Stoffe legt der Betrieb selbst an, Einheit l oder kg.
--  1. kellermittel: Stoff je Betrieb (Name, Einheit kg|l, aktiv) – Stammdaten wie keller_behandlungstypen (Schreibrecht
--     Kellerbuch); Löschen nur ohne Buchungen (FK RESTRICT), sonst deaktivieren.
--  2. kellermittel_buchungen: Kontobewegungen – Anfangsbestand, Zugang (Lieferant, Beleg, Los), Verwendung (aus der
--     Kellerbehandlung: Charge, Behälter, Zweck), Inventur (± Differenz), Storno (Gegenbuchung). Menge mit Vorzeichen in
--     der Einheit des Stoffs. Append-only: per API nur Anlegen (Schreibrecht Kellerbuch), kein Ändern, kein Löschen –
--     Korrekturen als Inventur bzw. Storno-Gegenbuchung; Benutzer und Name stempelt der Trigger.
--  3. Fremdverweise (KAN-178) auf eigenen Betrieb (Behälter: Kellergemeinschaft).
-- Staging zuerst (sjpeghrlhsowmquacjhb), DB-Test 59, dann Produktion.

-- 1. Stoffe ───────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.kellermittel (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  einheit     text NOT NULL CHECK (einheit IN ('kg', 'l')),
  aktiv       boolean NOT NULL DEFAULT true,
  notizen     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX kellermittel_name_eindeutig ON public.kellermittel (tenant_id, lower(btrim(name)));
COMMENT ON TABLE public.kellermittel IS 'KAN-107: Stoff des Stoffkontos (besondere Konten) je Betrieb, Einheit kg oder l';

ALTER TABLE public.kellermittel ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.kellermittel FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.kellermittel FROM anon;
CREATE POLICY kellermittel_select ON public.kellermittel FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY kellermittel_write ON public.kellermittel FOR ALL TO authenticated
  USING (tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m
                        WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin', 'tenant_admin', 'winzer')))
  WITH CHECK (tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m
                        WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin', 'tenant_admin', 'winzer')));
CREATE POLICY modul_insert ON public.kellermittel AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.s112_darf_schreiben(tenant_id, 'kellerbuch'));
CREATE POLICY modul_update ON public.kellermittel AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.s112_darf_schreiben(tenant_id, 'kellerbuch')) WITH CHECK (public.s112_darf_schreiben(tenant_id, 'kellerbuch'));
CREATE POLICY modul_delete ON public.kellermittel AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.s112_darf_schreiben(tenant_id, 'kellerbuch'));
CREATE POLICY mitgliedschaft_aktiv ON public.kellermittel AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY abo_schreibsperre_ins ON public.kellermittel AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.kellermittel AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.kellermittel AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.kellermittel AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));
CREATE TRIGGER kellermittel_updated_at BEFORE UPDATE ON public.kellermittel
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 2. Buchungen ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.kellermittel_buchungen (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kellermittel_id      uuid NOT NULL REFERENCES public.kellermittel(id) ON DELETE RESTRICT,
  datum                date NOT NULL,
  art                  text NOT NULL CHECK (art IN ('anfangsbestand', 'zugang', 'verwendung', 'inventur', 'storno')),
  menge                numeric(12,3) NOT NULL CHECK (menge <> 0),
  lieferant            text,
  beleg                text,
  los                  text,
  keller_behandlung_id uuid REFERENCES public.keller_behandlungen(id) ON DELETE RESTRICT,
  weinausbau_id        uuid REFERENCES public.weinausbau(id) ON DELETE RESTRICT,
  behaelter_id         uuid REFERENCES public.behaelter(id) ON DELETE RESTRICT,
  zweck                text,
  storno_von_id        uuid REFERENCES public.kellermittel_buchungen(id) ON DELETE RESTRICT,
  notizen              text,
  erstellt_von         uuid,
  erstellt_von_name    text,
  erstellt_am          timestamptz NOT NULL DEFAULT now(),
  -- Vorzeichen je Art: Zugänge positiv, Verwendung negativ, Inventur/Storno beliebig
  CONSTRAINT kellermittel_buchungen_vorzeichen CHECK (
    (art IN ('anfangsbestand', 'zugang') AND menge > 0) OR (art = 'verwendung' AND menge < 0) OR art IN ('inventur', 'storno')),
  CONSTRAINT kellermittel_buchungen_storno CHECK ((art = 'storno') = (storno_von_id IS NOT NULL))
);
CREATE INDEX kellermittel_buchungen_konto_idx ON public.kellermittel_buchungen (kellermittel_id, datum, erstellt_am);
CREATE INDEX kellermittel_buchungen_tenant_idx ON public.kellermittel_buchungen (tenant_id, datum);
CREATE UNIQUE INDEX kellermittel_buchungen_storno_einmal ON public.kellermittel_buchungen (storno_von_id) WHERE storno_von_id IS NOT NULL;
COMMENT ON TABLE public.kellermittel_buchungen IS
  'KAN-107: Bewegungen des Stoffkontos (Anfangsbestand, Zugang, Verwendung, Inventur, Storno) – append-only, Menge mit Vorzeichen';

ALTER TABLE public.kellermittel_buchungen ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.kellermittel_buchungen FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.kellermittel_buchungen FROM anon;
REVOKE UPDATE, DELETE ON public.kellermittel_buchungen FROM authenticated;
CREATE POLICY kellermittel_buchungen_select ON public.kellermittel_buchungen FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY kellermittel_buchungen_insert ON public.kellermittel_buchungen FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m
                             WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin', 'tenant_admin', 'winzer')));
CREATE POLICY modul_insert ON public.kellermittel_buchungen AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.s112_darf_schreiben(tenant_id, 'kellerbuch'));
CREATE POLICY mitgliedschaft_aktiv ON public.kellermittel_buchungen AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY abo_schreibsperre_ins ON public.kellermittel_buchungen AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.kellermittel_buchungen AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.kellermittel_buchungen AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.kellermittel_buchungen AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));

-- Benutzer stempeln (nicht vom Client übernehmen)
CREATE FUNCTION public.s112_kellermittel_buchung_stempel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF current_setting('role', true) IN ('authenticated', 'anon') THEN
    NEW.erstellt_von := auth.uid();
    NEW.erstellt_von_name := public.s112_storno_benutzername(auth.uid());
    NEW.erstellt_am := now();
  END IF;
  RETURN NEW;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_kellermittel_buchung_stempel() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_stempel BEFORE INSERT ON public.kellermittel_buchungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_kellermittel_buchung_stempel();

-- 3. Fremdverweise (KAN-178) ─────────────────────────────────────────────────────────────────────────────────
CREATE TRIGGER z_fremdverweis_kellermittel_id BEFORE INSERT OR UPDATE OF kellermittel_id, tenant_id ON public.kellermittel_buchungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('kellermittel_id', 'kellermittel', '', '', '');
CREATE TRIGGER z_fremdverweis_keller_behandlung_id BEFORE INSERT OR UPDATE OF keller_behandlung_id, tenant_id ON public.kellermittel_buchungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('keller_behandlung_id', 'keller_behandlungen', '', '', '');
CREATE TRIGGER z_fremdverweis_weinausbau_id BEFORE INSERT OR UPDATE OF weinausbau_id, tenant_id ON public.kellermittel_buchungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weinausbau_id', 'weinausbau', '', '', '');
CREATE TRIGGER z_fremdverweis_behaelter_id BEFORE INSERT OR UPDATE OF behaelter_id, tenant_id ON public.kellermittel_buchungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('behaelter_id', 'behaelter', 'keller', '', '');
CREATE TRIGGER z_fremdverweis_storno_von_id BEFORE INSERT OR UPDATE OF storno_von_id, tenant_id ON public.kellermittel_buchungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('storno_von_id', 'kellermittel_buchungen', '', '', '');
