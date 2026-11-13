-- KAN-437 Teil 2 (13.11.2026): Weinexport F – Export-Registrierungen des Betriebs mit Ablaufdatum.
--
-- Bisher kannte der Betrieb für den Export nur EORI und REX-Nummer (Betriebseinstellungen, ohne Ablaufdatum). Manche
-- Zielländer verlangen eine Registrierung des Herstellers, die abläuft: FDA Food Facility Registration mit US-Agent
-- (USA, Erneuerung alle zwei Jahre), GACC (China), MFDS (Südkorea); dazu die Bewilligung als Ermächtigter Ausführer.
-- Entscheidung Jörgen 13.11.2026 (Frage 2A): eigene Liste je Betrieb, mehrere Einträge möglich; EORI und REX-Nummer
-- bleiben in den Betriebseinstellungen (die Dokumente lesen sie dort). Erinnerung 90 Tage vor Ablauf im Dashboard und
-- als Hinweis am Exportauftrag (Frage 3A) – das rechnet die App (src/lib/export/registrierungen.ts).
-- Schreiben: Schreibrecht Warenwirtschaft und Paket-Modul Exportaufträge; lesen: jedes Mitglied des Betriebs.

CREATE TABLE public.export_registrierungen (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  art             text NOT NULL CONSTRAINT export_registrierungen_art_chk
                    CHECK (art IN ('fda', 'gacc', 'mfds', 'ermaechtigter_ausfuehrer', 'sonstige')),
  bezeichnung     text CONSTRAINT export_registrierungen_bezeichnung_chk CHECK (bezeichnung IS NULL OR char_length(bezeichnung) BETWEEN 1 AND 120),
  nummer          text NOT NULL CONSTRAINT export_registrierungen_nummer_chk CHECK (char_length(nummer) BETWEEN 1 AND 60),
  gueltig_bis     date,
  -- z. B. der US-Agent der FDA-Registrierung
  zusatz          text CONSTRAINT export_registrierungen_zusatz_chk CHECK (zusatz IS NULL OR char_length(zusatz) <= 200),
  notiz           text CONSTRAINT export_registrierungen_notiz_chk CHECK (notiz IS NULL OR char_length(notiz) <= 400),
  erstellt_am     timestamptz NOT NULL DEFAULT now(),
  aktualisiert_am timestamptz NOT NULL DEFAULT now(),
  -- „sonstige“ braucht eine Bezeichnung (sonst ist nicht erkennbar, worum es geht)
  CONSTRAINT export_registrierungen_sonstige_chk CHECK (art <> 'sonstige' OR bezeichnung IS NOT NULL)
);
CREATE INDEX export_registrierungen_tenant_idx ON public.export_registrierungen (tenant_id, gueltig_bis);
COMMENT ON TABLE public.export_registrierungen IS
  'KAN-437: Export-Registrierungen des Betriebs (FDA mit US-Agent, GACC, MFDS, Ermächtigter Ausführer, sonstige) mit Nummer und Ablaufdatum. Erinnerung vor Ablauf im Dashboard und am Exportauftrag.';

ALTER TABLE public.export_registrierungen ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.export_registrierungen FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.export_registrierungen FROM anon;
CREATE POLICY export_registrierungen_select ON public.export_registrierungen FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY export_registrierungen_insert ON public.export_registrierungen FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m
                             WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin', 'tenant_admin', 'winzer')));
CREATE POLICY export_registrierungen_update ON public.export_registrierungen FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m
                        WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin', 'tenant_admin', 'winzer')))
  WITH CHECK (tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m
                             WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin', 'tenant_admin', 'winzer')));
CREATE POLICY export_registrierungen_delete ON public.export_registrierungen FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m
                        WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin', 'tenant_admin', 'winzer')));
CREATE POLICY modul_insert ON public.export_registrierungen AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.s112_darf_schreiben(tenant_id, 'warenwirtschaft'));
CREATE POLICY modul_update ON public.export_registrierungen AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.s112_darf_schreiben(tenant_id, 'warenwirtschaft')) WITH CHECK (public.s112_darf_schreiben(tenant_id, 'warenwirtschaft'));
CREATE POLICY modul_delete ON public.export_registrierungen AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.s112_darf_schreiben(tenant_id, 'warenwirtschaft'));
CREATE POLICY mitgliedschaft_aktiv ON public.export_registrierungen AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY abo_schreibsperre_ins ON public.export_registrierungen AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.export_registrierungen AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.export_registrierungen AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.export_registrierungen AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));
-- KAN-195: Paket-Modul Exportaufträge
CREATE POLICY paketmodul_ins ON public.export_registrierungen AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_export'));
CREATE POLICY paketmodul_upd ON public.export_registrierungen AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_export')) WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_export'));
CREATE POLICY paketmodul_del ON public.export_registrierungen AS RESTRICTIVE FOR DELETE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_export'));
