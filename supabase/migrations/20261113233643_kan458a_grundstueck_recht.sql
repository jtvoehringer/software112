-- KAN-458 (13.11.2026): Rechtsverhältnis, Einheitswert und SVS-Zurechnung der Grundstücke in eine eigene Tabelle.
--
-- Das Profil „Extern“ liest den Bereich Rieden und damit die Tabelle grundstuecke – auch Pacht/Eigentum, Einheitswert
-- und SVS-Zurechnung. Die Tabelle zu sperren scheidet aus: Sie ist in vielen Abfragen eingebettet (Maßnahmen, Dashboard).
-- Deshalb wandern die fünf Spalten in grundstueck_recht (höchstens eine Zeile je Grundstück) im Lesebereich ea, den
-- weder „Extern“ noch „Vertrieb“ lesen. Entscheidungen Jörgen 13.11.2026 (Jira KAN-458, Fragen 1–5 jeweils A).
--
-- Schritt 1 von 2 – diese Migration legt die Tabelle NEBEN den alten Spalten an:
--   1. Tabelle samt RLS (wie grundstuecke: Lesen Mitglieder, Schreiben Betriebsleitung und Mitarbeiter mit Modul Rieden
--      oder E&A), Sperr-Policies, Fremdverweis- und Zeitstempel-Trigger, Index
--   2. Daten übernehmen (eine Zeile je Grundstück), danach erst die Protokoll-Trigger
--   3. Abgleich: Solange noch die alte App läuft bzw. die Demo-Funktionen die alten Spalten schreiben, landet jede
--      Änderung der alten Spalten auch in der neuen Tabelle (Trigger a_recht_abgleich auf grundstuecke)
-- Schritt 2 (kan458b) entfernt Abgleich und alte Spalten, sobald die App nur noch die neue Tabelle nutzt.
-- Die neue Tabelle steht bewusst NICHT in ki_erlaubte_tabellen() (Frage 4 A).

-- 1. Tabelle ──────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.grundstueck_recht (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  grundstueck_id        uuid NOT NULL UNIQUE REFERENCES public.grundstuecke(id) ON DELETE CASCADE,
  rechtsverhaeltnis     text CONSTRAINT grundstueck_recht_rechtsverhaeltnis_check
                          CHECK (rechtsverhaeltnis IS NULL OR rechtsverhaeltnis IN ('eigentum', 'pacht', 'nutzung')),
  einheitswert          numeric(12,2),
  einheitswert_bescheid date,
  einheitswert_quelle   text,
  svs_zurechnung        text NOT NULL DEFAULT 'eigen' CONSTRAINT grundstueck_recht_svs_zurechnung_check
                          CHECK (svs_zurechnung IN ('eigen', 'pacht_fremd', 'pacht_angehoerige', 'verpachtet', 'keine')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.grundstueck_recht IS
  'KAN-458: Rechtsverhältnis (Eigentum/Pacht), Einheitswert und SVS-Zurechnung je Grundstück – höchstens eine Zeile je Grundstück, Lesebereich ea (für die Profile Extern und Vertrieb gesperrt). Ohne Zeile gelten: kein Rechtsverhältnis, kein Einheitswert, Zurechnung eigen.';
CREATE INDEX idx_grundstueck_recht_tenant ON public.grundstueck_recht (tenant_id);

ALTER TABLE public.grundstueck_recht ENABLE ROW LEVEL SECURITY;

CREATE POLICY grundstueck_recht_select ON public.grundstueck_recht FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY grundstueck_recht_insert ON public.grundstueck_recht FOR INSERT TO authenticated
  WITH CHECK (public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']));
CREATE POLICY grundstueck_recht_update ON public.grundstueck_recht FOR UPDATE TO authenticated
  USING (public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']))
  WITH CHECK (public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']));
CREATE POLICY grundstueck_recht_delete ON public.grundstueck_recht FOR DELETE TO authenticated
  USING (public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin']));

CREATE POLICY mitgliedschaft_aktiv ON public.grundstueck_recht AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())))
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.grundstueck_recht AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));
CREATE POLICY lesebereich ON public.grundstueck_recht AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_lesegesperrte_tenants('ea'))));
COMMENT ON POLICY lesebereich ON public.grundstueck_recht IS 'KAN-458: Lesebereich ea – gesperrt für Profile ohne diesen Bereich';
CREATE POLICY abo_schreibsperre_ins ON public.grundstueck_recht AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.grundstueck_recht AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())))
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.grundstueck_recht AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY modul_insert ON public.grundstueck_recht AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.s112_darf_schreiben(tenant_id, VARIADIC ARRAY['rieden', 'ea']));
CREATE POLICY modul_update ON public.grundstueck_recht AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.s112_darf_schreiben(tenant_id, VARIADIC ARRAY['rieden', 'ea']))
  WITH CHECK (public.s112_darf_schreiben(tenant_id, VARIADIC ARRAY['rieden', 'ea']));
CREATE POLICY modul_delete ON public.grundstueck_recht AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.s112_darf_schreiben(tenant_id, VARIADIC ARRAY['rieden', 'ea']));

CREATE TRIGGER grundstueck_recht_updated_at BEFORE UPDATE ON public.grundstueck_recht
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER z_fremdverweis_grundstueck_id BEFORE INSERT OR UPDATE OF grundstueck_id, tenant_id ON public.grundstueck_recht
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('grundstueck_id', 'grundstuecke', '', '', '');

-- 2. Abgleich alte Spalten → neue Tabelle (bis kan458b) ───────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_grundstueck_recht_abgleich()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.grundstueck_recht (tenant_id, grundstueck_id, rechtsverhaeltnis, einheitswert, einheitswert_bescheid, einheitswert_quelle, svs_zurechnung)
  VALUES (NEW.tenant_id, NEW.id, NEW.rechtsverhaeltnis, NEW.einheitswert, NEW.einheitswert_bescheid, NEW.einheitswert_quelle, coalesce(NEW.svs_zurechnung, 'eigen'))
  ON CONFLICT (grundstueck_id) DO UPDATE
    SET rechtsverhaeltnis = EXCLUDED.rechtsverhaeltnis, einheitswert = EXCLUDED.einheitswert, einheitswert_bescheid = EXCLUDED.einheitswert_bescheid,
        einheitswert_quelle = EXCLUDED.einheitswert_quelle, svs_zurechnung = EXCLUDED.svs_zurechnung, tenant_id = EXCLUDED.tenant_id;
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_grundstueck_recht_abgleich() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.s112_grundstueck_recht_abgleich() IS
  'KAN-458 (Übergang bis kan458b): übernimmt Änderungen der alten Spalten von grundstuecke nach grundstueck_recht';

-- 3. Daten übernehmen – VOR den Protokoll-Triggern: Die Übernahme ist keine fachliche Änderung und soll das
--    Änderungsprotokoll der Betriebe nicht mit einer Zeile je Grundstück füllen ─────────────────────────────────────
INSERT INTO public.grundstueck_recht (tenant_id, grundstueck_id, rechtsverhaeltnis, einheitswert, einheitswert_bescheid, einheitswert_quelle, svs_zurechnung)
SELECT g.tenant_id, g.id, g.rechtsverhaeltnis, g.einheitswert, g.einheitswert_bescheid, g.einheitswert_quelle, g.svs_zurechnung
  FROM public.grundstuecke g;

-- 4. Änderungsprotokoll ab jetzt (anlegen, ändern der Werte, löschen) ─────────────────────────────────────────────
CREATE TRIGGER z_protokoll_anlegen AFTER INSERT ON public.grundstueck_recht
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben();
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF rechtsverhaeltnis, einheitswert, einheitswert_bescheid, svs_zurechnung, grundstueck_id, tenant_id ON public.grundstueck_recht
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('rechtsverhaeltnis', 'einheitswert', 'einheitswert_bescheid', 'svs_zurechnung', 'grundstueck_id', 'tenant_id');
CREATE TRIGGER z_protokoll_loeschen AFTER DELETE ON public.grundstueck_recht
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben();
CREATE TRIGGER z_protokoll_truncate BEFORE TRUNCATE ON public.grundstueck_recht
  FOR EACH STATEMENT EXECUTE FUNCTION public.bestandsprotokoll_schreiben();

-- 5. Abgleich einschalten ────────────────────────────────────────────────────────────────────────────────────────
-- nur wenn sich eine der alten Spalten ändert – die neue App schreibt sie nicht mehr und wird nicht überschrieben
CREATE TRIGGER a_recht_abgleich AFTER INSERT OR UPDATE OF rechtsverhaeltnis, einheitswert, einheitswert_bescheid, einheitswert_quelle, svs_zurechnung
  ON public.grundstuecke FOR EACH ROW EXECUTE FUNCTION public.s112_grundstueck_recht_abgleich();

-- Selbstprüfung: jede Zeile übernommen, Werte gleich
DO $pruefung$
DECLARE v_n bigint;
BEGIN
  SELECT count(*) INTO v_n
    FROM public.grundstuecke g LEFT JOIN public.grundstueck_recht r ON r.grundstueck_id = g.id
   WHERE r.id IS NULL OR r.tenant_id <> g.tenant_id
      OR r.rechtsverhaeltnis IS DISTINCT FROM g.rechtsverhaeltnis OR r.einheitswert IS DISTINCT FROM g.einheitswert
      OR r.einheitswert_bescheid IS DISTINCT FROM g.einheitswert_bescheid OR r.einheitswert_quelle IS DISTINCT FROM g.einheitswert_quelle
      OR r.svs_zurechnung IS DISTINCT FROM g.svs_zurechnung;
  IF v_n > 0 THEN RAISE EXCEPTION 'KAN-458: % Grundstücke weichen in grundstueck_recht ab', v_n; END IF;
END
$pruefung$;
