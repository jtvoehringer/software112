-- KAN-195 (04.10.2026, KAN-159 B17): Paket-Module beim Schreiben in der Datenbank durchsetzen.
-- Entscheidung Jörgen (04.10.2026): nur die Paket-Module, die auch die App sperrt – E&A (modul_ea), Export
-- (modul_export), SumUp (modul_sumup), Kostenrechnung (modul_controlling) und Assistent (assistent_aktiv);
-- Weingarten, Kellerbuch und CRM sind in jedem Paket enthalten und bleiben frei. Ausgenommen: Plattform-Admins und
-- Service-Role (Webhooks, Cron, Wartung). Ist ein Modul aus, bleiben die Daten lesbar (Aufbewahrung, Downgrade),
-- Anlegen/Ändern/Löschen endet mit 42501.
--   * s112_paketmodul_frei(tenant, schalter): SECURITY DEFINER, für die RESTRICTIVE-Policies paketmodul_ins/_upd/_del
--     (Kindtabellen über die Elternzeile).
--   * s112_pruefe_paketmodul(tenant, schalter): für schreibende SECURITY-DEFINER-RPCs der E&A (umgehen RLS).
-- Stand Produktion 04.10.2026: kein Betrieb hat Daten in einem abgeschalteten Modul.
-- App: Maßnahmen-Formular zeigt „Kosten erfassen“ nur mit Modul Controlling (behandlungen/actions.ts überspringt sonst).
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

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
                               END
                          FROM tenant_einstellungen e WHERE e.tenant_id = p_tenant_id), false))
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_paketmodul_frei(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_paketmodul_frei(uuid, text) TO authenticated;

-- Wie s112_pruefe_schreibmodul: SECURITY INVOKER, nur aus SECURITY-DEFINER-RPCs aufgerufen
CREATE OR REPLACE FUNCTION public.s112_pruefe_paketmodul(p_tenant_id uuid, p_schalter text)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $function$
BEGIN
  IF NOT public.s112_paketmodul_frei(p_tenant_id, p_schalter) THEN
    RAISE EXCEPTION 'Das Modul ist für diesen Betrieb nicht freigeschaltet (%).', p_schalter
      USING ERRCODE = '42501', HINT = 'paketmodul_aus';
  END IF;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_pruefe_paketmodul(uuid, text) FROM PUBLIC, anon, authenticated;

-- ── RESTRICTIVE-Policies: Tabellen mit tenant_id ─────────────────────────────────────────────────────────
CREATE POLICY paketmodul_ins ON public.buchhaltung_export_protokoll AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_upd ON public.buchhaltung_export_protokoll AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_ea')) WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_del ON public.buchhaltung_export_protokoll AS RESTRICTIVE FOR DELETE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_ins ON public.buchhaltung_kontenmapping AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_upd ON public.buchhaltung_kontenmapping AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_ea')) WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_del ON public.buchhaltung_kontenmapping AS RESTRICTIVE FOR DELETE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_ins ON public.ea_anlagen AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_upd ON public.ea_anlagen AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_ea')) WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_del ON public.ea_anlagen AS RESTRICTIVE FOR DELETE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_ins ON public.ea_belege AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_upd ON public.ea_belege AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_ea')) WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_del ON public.ea_belege AS RESTRICTIVE FOR DELETE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_ins ON public.ea_dauerauftraege AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_upd ON public.ea_dauerauftraege AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_ea')) WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_del ON public.ea_dauerauftraege AS RESTRICTIVE FOR DELETE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_ins ON public.ea_kategorien AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((tenant_id IS NULL) OR public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_upd ON public.ea_kategorien AS RESTRICTIVE FOR UPDATE TO authenticated USING ((tenant_id IS NULL) OR public.s112_paketmodul_frei(tenant_id, 'modul_ea')) WITH CHECK ((tenant_id IS NULL) OR public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_del ON public.ea_kategorien AS RESTRICTIVE FOR DELETE TO authenticated USING ((tenant_id IS NULL) OR public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_ins ON public.ea_monatsabschluss AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_upd ON public.ea_monatsabschluss AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_ea')) WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_del ON public.ea_monatsabschluss AS RESTRICTIVE FOR DELETE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_ins ON public.ea_transaktionen AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_upd ON public.ea_transaktionen AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_ea')) WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_del ON public.ea_transaktionen AS RESTRICTIVE FOR DELETE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_ins ON public.ea_uva AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_upd ON public.ea_uva AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_ea')) WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_del ON public.ea_uva AS RESTRICTIVE FOR DELETE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_ins ON public.konten AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_upd ON public.konten AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_ea')) WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_del ON public.konten AS RESTRICTIVE FOR DELETE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_ins ON public.konto_umbuchungen AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_upd ON public.konto_umbuchungen AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_ea')) WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_del ON public.konto_umbuchungen AS RESTRICTIVE FOR DELETE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_ea'));
CREATE POLICY paketmodul_ins ON public.exportauftraege AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_export'));
CREATE POLICY paketmodul_upd ON public.exportauftraege AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_export')) WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_export'));
CREATE POLICY paketmodul_del ON public.exportauftraege AS RESTRICTIVE FOR DELETE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_export'));
CREATE POLICY paketmodul_ins ON public.sumup_checkouts AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_sumup'));
CREATE POLICY paketmodul_upd ON public.sumup_checkouts AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_sumup')) WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_sumup'));
CREATE POLICY paketmodul_del ON public.sumup_checkouts AS RESTRICTIVE FOR DELETE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_sumup'));
CREATE POLICY paketmodul_ins ON public.sumup_terminals AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_sumup'));
CREATE POLICY paketmodul_upd ON public.sumup_terminals AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_sumup')) WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_sumup'));
CREATE POLICY paketmodul_del ON public.sumup_terminals AS RESTRICTIVE FOR DELETE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_sumup'));
CREATE POLICY paketmodul_ins ON public.kostenarten AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_controlling'));
CREATE POLICY paketmodul_upd ON public.kostenarten AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_controlling')) WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_controlling'));
CREATE POLICY paketmodul_del ON public.kostenarten AS RESTRICTIVE FOR DELETE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_controlling'));
CREATE POLICY paketmodul_ins ON public.kosteneintraege AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_controlling'));
CREATE POLICY paketmodul_upd ON public.kosteneintraege AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_controlling')) WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_controlling'));
CREATE POLICY paketmodul_del ON public.kosteneintraege AS RESTRICTIVE FOR DELETE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_controlling'));
CREATE POLICY paketmodul_ins ON public.kostenstellen AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_controlling'));
CREATE POLICY paketmodul_upd ON public.kostenstellen AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_controlling')) WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_controlling'));
CREATE POLICY paketmodul_del ON public.kostenstellen AS RESTRICTIVE FOR DELETE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_controlling'));
CREATE POLICY paketmodul_ins ON public.assistent_korrekturen AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'assistent_aktiv'));
CREATE POLICY paketmodul_upd ON public.assistent_korrekturen AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'assistent_aktiv')) WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'assistent_aktiv'));
CREATE POLICY paketmodul_del ON public.assistent_korrekturen AS RESTRICTIVE FOR DELETE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'assistent_aktiv'));
CREATE POLICY paketmodul_ins ON public.assistent_unterhaltungen AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'assistent_aktiv'));
CREATE POLICY paketmodul_upd ON public.assistent_unterhaltungen AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'assistent_aktiv')) WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'assistent_aktiv'));
CREATE POLICY paketmodul_del ON public.assistent_unterhaltungen AS RESTRICTIVE FOR DELETE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'assistent_aktiv'));

-- ── RESTRICTIVE-Policies: Kindtabellen (Betrieb über die Elternzeile) ───────────────────────────────────
CREATE POLICY paketmodul_ins ON public.export_dokumente AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.exportauftraege x WHERE x.id = exportauftrag_id AND public.s112_paketmodul_frei(x.tenant_id, 'modul_export')));
CREATE POLICY paketmodul_upd ON public.export_dokumente AS RESTRICTIVE FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.exportauftraege x WHERE x.id = exportauftrag_id AND public.s112_paketmodul_frei(x.tenant_id, 'modul_export'))) WITH CHECK (EXISTS (SELECT 1 FROM public.exportauftraege x WHERE x.id = exportauftrag_id AND public.s112_paketmodul_frei(x.tenant_id, 'modul_export')));
CREATE POLICY paketmodul_del ON public.export_dokumente AS RESTRICTIVE FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.exportauftraege x WHERE x.id = exportauftrag_id AND public.s112_paketmodul_frei(x.tenant_id, 'modul_export')));
CREATE POLICY paketmodul_ins ON public.exportauftrag_positionen AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.exportauftraege x WHERE x.id = exportauftrag_id AND public.s112_paketmodul_frei(x.tenant_id, 'modul_export')));
CREATE POLICY paketmodul_upd ON public.exportauftrag_positionen AS RESTRICTIVE FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.exportauftraege x WHERE x.id = exportauftrag_id AND public.s112_paketmodul_frei(x.tenant_id, 'modul_export'))) WITH CHECK (EXISTS (SELECT 1 FROM public.exportauftraege x WHERE x.id = exportauftrag_id AND public.s112_paketmodul_frei(x.tenant_id, 'modul_export')));
CREATE POLICY paketmodul_del ON public.exportauftrag_positionen AS RESTRICTIVE FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.exportauftraege x WHERE x.id = exportauftrag_id AND public.s112_paketmodul_frei(x.tenant_id, 'modul_export')));
CREATE POLICY paketmodul_ins ON public.kosteneintrag_behaelter AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.kosteneintraege x WHERE x.id = kosteneintrag_id AND public.s112_paketmodul_frei(x.tenant_id, 'modul_controlling')));
CREATE POLICY paketmodul_upd ON public.kosteneintrag_behaelter AS RESTRICTIVE FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.kosteneintraege x WHERE x.id = kosteneintrag_id AND public.s112_paketmodul_frei(x.tenant_id, 'modul_controlling'))) WITH CHECK (EXISTS (SELECT 1 FROM public.kosteneintraege x WHERE x.id = kosteneintrag_id AND public.s112_paketmodul_frei(x.tenant_id, 'modul_controlling')));
CREATE POLICY paketmodul_del ON public.kosteneintrag_behaelter AS RESTRICTIVE FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.kosteneintraege x WHERE x.id = kosteneintrag_id AND public.s112_paketmodul_frei(x.tenant_id, 'modul_controlling')));
CREATE POLICY paketmodul_ins ON public.kosteneintrag_weingaerten AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.kosteneintraege x WHERE x.id = kosteneintrag_id AND public.s112_paketmodul_frei(x.tenant_id, 'modul_controlling')));
CREATE POLICY paketmodul_upd ON public.kosteneintrag_weingaerten AS RESTRICTIVE FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.kosteneintraege x WHERE x.id = kosteneintrag_id AND public.s112_paketmodul_frei(x.tenant_id, 'modul_controlling'))) WITH CHECK (EXISTS (SELECT 1 FROM public.kosteneintraege x WHERE x.id = kosteneintrag_id AND public.s112_paketmodul_frei(x.tenant_id, 'modul_controlling')));
CREATE POLICY paketmodul_del ON public.kosteneintrag_weingaerten AS RESTRICTIVE FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.kosteneintraege x WHERE x.id = kosteneintrag_id AND public.s112_paketmodul_frei(x.tenant_id, 'modul_controlling')));
CREATE POLICY paketmodul_ins ON public.assistent_aktionen AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.assistent_unterhaltungen x WHERE x.id = unterhaltung_id AND public.s112_paketmodul_frei(x.tenant_id, 'assistent_aktiv')));
CREATE POLICY paketmodul_upd ON public.assistent_aktionen AS RESTRICTIVE FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.assistent_unterhaltungen x WHERE x.id = unterhaltung_id AND public.s112_paketmodul_frei(x.tenant_id, 'assistent_aktiv'))) WITH CHECK (EXISTS (SELECT 1 FROM public.assistent_unterhaltungen x WHERE x.id = unterhaltung_id AND public.s112_paketmodul_frei(x.tenant_id, 'assistent_aktiv')));
CREATE POLICY paketmodul_del ON public.assistent_aktionen AS RESTRICTIVE FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.assistent_unterhaltungen x WHERE x.id = unterhaltung_id AND public.s112_paketmodul_frei(x.tenant_id, 'assistent_aktiv')));
CREATE POLICY paketmodul_ins ON public.assistent_nachrichten AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.assistent_unterhaltungen x WHERE x.id = unterhaltung_id AND public.s112_paketmodul_frei(x.tenant_id, 'assistent_aktiv')));
CREATE POLICY paketmodul_upd ON public.assistent_nachrichten AS RESTRICTIVE FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.assistent_unterhaltungen x WHERE x.id = unterhaltung_id AND public.s112_paketmodul_frei(x.tenant_id, 'assistent_aktiv'))) WITH CHECK (EXISTS (SELECT 1 FROM public.assistent_unterhaltungen x WHERE x.id = unterhaltung_id AND public.s112_paketmodul_frei(x.tenant_id, 'assistent_aktiv')));
CREATE POLICY paketmodul_del ON public.assistent_nachrichten AS RESTRICTIVE FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.assistent_unterhaltungen x WHERE x.id = unterhaltung_id AND public.s112_paketmodul_frei(x.tenant_id, 'assistent_aktiv')));

-- ── Schreibende E&A-RPCs (SECURITY DEFINER, umgehen RLS) ───────────────────────────────────────────────
-- Rumpf unverändert bis auf die Zeile „KAN-195“ (Stand Produktion 04.10.2026)

CREATE OR REPLACE FUNCTION public.s112_betriebsmittel_einkauf(p_tenant_id uuid, p_betriebsmittel_id uuid, p_datum date, p_menge numeric, p_einheit text, p_betrag_netto numeric, p_ust_satz numeric, p_lieferant_firma_id uuid, p_ea_kategorie_id uuid, p_notizen text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mittel record;
  v_kat    record;
  v_grund  text;
  v_ea     uuid;
  v_id     uuid;
  v_einh   constant jsonb := '{"kg": "kg", "g": "g", "l": "l", "ml": "ml", "stk": "Stk", "m": "m"}';
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_paketmodul(p_tenant_id, 'modul_ea');   -- KAN-195
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'rieden');
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'ea');
  IF NOT EXISTS (SELECT 1 FROM public.tenant_einstellungen te
                  WHERE te.tenant_id = p_tenant_id AND te.modul_ea AND te.buchhaltungsart = 'ea') THEN
    RAISE EXCEPTION 'Einkäufe mit Ausgabe gibt es nur mit aktiver E&A-Rechnung – bitte Anfangsbestand bzw. Inventurkorrektur verwenden.'
      USING ERRCODE = '42501';
  END IF;

  SELECT b.id, b.name, b.aktiv INTO v_mittel FROM public.betriebsmittel b
   WHERE b.id = p_betriebsmittel_id AND b.tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Betriebsmittel nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_mittel.aktiv THEN
    RAISE EXCEPTION 'Das Betriebsmittel „%“ ist deaktiviert.', v_mittel.name USING ERRCODE = '22023';
  END IF;
  IF p_datum IS NULL OR p_menge IS NULL OR p_menge <= 0 OR p_betrag_netto IS NULL OR p_betrag_netto < 0 THEN
    RAISE EXCEPTION 'Bitte Datum, Menge (> 0) und Netto-Betrag angeben.' USING ERRCODE = '22023';
  END IF;
  IF p_einheit IS NULL OR NOT (v_einh ? p_einheit) THEN
    RAISE EXCEPTION 'Unbekannte Einheit „%“.', coalesce(p_einheit, '–') USING ERRCODE = '22023';
  END IF;
  IF p_ust_satz IS NULL OR p_ust_satz NOT IN (0, 10, 13, 20) THEN
    RAISE EXCEPTION 'Bitte einen USt-Satz (0, 10, 13 oder 20 %%) wählen.' USING ERRCODE = '22023';
  END IF;
  IF p_lieferant_firma_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.firmen f WHERE f.id = p_lieferant_firma_id AND f.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Lieferant nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  SELECT k.id, k.typ, k.abzugsfaehig_pct INTO v_kat FROM public.ea_kategorien k
   WHERE k.id = p_ea_kategorie_id AND (k.tenant_id IS NULL OR k.tenant_id = p_tenant_id) AND k.aktiv;
  IF NOT FOUND OR v_kat.typ <> 'ausgabe' THEN
    RAISE EXCEPTION 'Bitte eine Ausgaben-Kategorie der E&A-Rechnung wählen.' USING ERRCODE = '22023';
  END IF;
  v_grund := public.s112_ea_zeitraum_sperrgrund(p_tenant_id, p_datum);
  IF v_grund IS NOT NULL THEN
    RAISE EXCEPTION '%', v_grund USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.ea_transaktionen (tenant_id, typ, datum, beschreibung, kategorie_id, betrag_netto, ust_satz, firma_id,
                                       abzugsfaehig_pct, import_quelle, notizen)
  VALUES (p_tenant_id, 'ausgabe', p_datum,
          format('Einkauf %s (%s %s)', v_mittel.name, trim(to_char(p_menge, 'FM999999990.###')), v_einh ->> p_einheit),
          p_ea_kategorie_id, round(p_betrag_netto, 2), p_ust_satz, p_lieferant_firma_id,
          coalesce(v_kat.abzugsfaehig_pct, 100), 'betriebsmittel', NULLIF(btrim(p_notizen), ''))
  RETURNING id INTO v_ea;

  INSERT INTO public.betriebsmittel_lager_bewegungen (tenant_id, betriebsmittel_id, datum, typ, menge, einheit, betrag_netto,
                                                      ust_satz, lieferant_firma_id, ea_transaktion_id, notizen)
  VALUES (p_tenant_id, p_betriebsmittel_id, p_datum, 'einkauf', p_menge, p_einheit, round(p_betrag_netto, 2), p_ust_satz,
          p_lieferant_firma_id, v_ea, NULLIF(btrim(p_notizen), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.s112_ea_stornieren(p_tenant_id uuid, p_id uuid, p_grund text, p_datum date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_paketmodul(p_tenant_id, 'modul_ea');   -- KAN-195
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'ea');
  IF length(btrim(COALESCE(p_grund, ''))) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für den Storno angeben (mindestens 10 Zeichen).' USING ERRCODE = '23514';
  END IF;
  RETURN public.s112_ea_gegenbuchung(p_tenant_id, p_id, p_grund, p_datum);
END;
$function$;

CREATE OR REPLACE FUNCTION public.s112_umbuchung_stornieren(p_tenant_id uuid, p_id uuid, p_grund text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_u record;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_paketmodul(p_tenant_id, 'modul_ea');   -- KAN-195
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'ea');
  IF length(btrim(COALESCE(p_grund, ''))) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für den Storno angeben (mindestens 10 Zeichen).' USING ERRCODE = '23514';
  END IF;
  SELECT k.* INTO v_u FROM public.konto_umbuchungen k WHERE k.id = p_id AND k.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Umbuchung nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_u.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Die Umbuchung ist bereits storniert.' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('s112.ea_storno_rpc', 'an', true);
  UPDATE public.konto_umbuchungen
     SET storniert_am = now(), storniert_von = auth.uid(), storniert_von_name = public.s112_storno_benutzername(auth.uid()),
         storno_grund = btrim(p_grund)
   WHERE id = p_id;
  PERFORM set_config('s112.ea_storno_rpc', '', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.sperre_ea_monat(p_tenant_id uuid, p_jahr smallint, p_monat smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_von date;
  v_bis date;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);   -- KAN-5 Nur-Lesen-Modus
  PERFORM public.s112_pruefe_paketmodul(p_tenant_id, 'modul_ea');   -- KAN-195

  v_von := make_date(p_jahr, p_monat, 1);
  v_bis := (v_von + INTERVAL '1 month' - INTERVAL '1 day')::date;

  UPDATE ea_transaktionen
  SET is_locked = true
  WHERE tenant_id = p_tenant_id
    AND datum BETWEEN v_von AND v_bis;

  INSERT INTO ea_monatsabschluss (tenant_id, jahr, monat)
  VALUES (p_tenant_id, p_jahr, p_monat)
  ON CONFLICT (tenant_id, jahr, monat) DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sperre_ea_uva(p_tenant_id uuid, p_jahr smallint, p_zeitraum text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_von      date;
  v_bis      date;
  v_monate   smallint[];
  v_monat    smallint;
  v_fehlende smallint[] := '{}';
  v_beginn   date;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);   -- KAN-5 Nur-Lesen-Modus
  PERFORM public.s112_pruefe_paketmodul(p_tenant_id, 'modul_ea');   -- KAN-195

  SELECT ea_betriebsbeginn INTO v_beginn
  FROM tenant_einstellungen WHERE tenant_id = p_tenant_id;

  IF p_zeitraum IN ('Q1','Q2','Q3','Q4') THEN
    v_von := make_date(p_jahr, (CASE p_zeitraum WHEN 'Q1' THEN 1 WHEN 'Q2' THEN 4 WHEN 'Q3' THEN 7 ELSE 10 END), 1);
    v_bis := (v_von + INTERVAL '3 months' - INTERVAL '1 day')::date;
    v_monate := ARRAY[
      EXTRACT(MONTH FROM v_von)::smallint,
      EXTRACT(MONTH FROM v_von + INTERVAL '1 month')::smallint,
      EXTRACT(MONTH FROM v_von + INTERVAL '2 months')::smallint
    ];
  ELSE
    v_von := make_date(p_jahr, p_zeitraum::smallint, 1);
    v_bis := (v_von + INTERVAL '1 month' - INTERVAL '1 day')::date;
    v_monate := ARRAY[p_zeitraum::smallint];
  END IF;

  FOREACH v_monat IN ARRAY v_monate LOOP
    -- Migration 180: Monate, die vollständig vor dem Betriebsbeginn enden, brauchen keinen Abschluss
    IF v_beginn IS NOT NULL
       AND (make_date(p_jahr, v_monat, 1) + INTERVAL '1 month' - INTERVAL '1 day')::date < v_beginn THEN
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM ea_monatsabschluss
      WHERE tenant_id = p_tenant_id AND jahr = p_jahr AND monat = v_monat
    ) THEN
      v_fehlende := array_append(v_fehlende, v_monat);
    END IF;
  END LOOP;

  IF array_length(v_fehlende, 1) > 0 THEN
    RAISE EXCEPTION
      'Monatsabschluss fehlt für Monat(e) % / % – die UVA kann erst übermittelt werden, wenn alle Monate dieser Periode abgeschlossen sind.',
      array_to_string(v_fehlende, ', '), p_jahr;
  END IF;

  UPDATE ea_transaktionen
  SET is_locked = true
  WHERE tenant_id = p_tenant_id
    AND datum BETWEEN v_von AND v_bis;

  -- KAN-149 D3: der Schutz-Trigger an ea_uva lässt das Sperren nur mit diesem Flag zu
  PERFORM set_config('s112.ea_sperre', 'an', true);
  UPDATE ea_uva
  SET gesperrt = true, gesperrt_am = now()
  WHERE tenant_id = p_tenant_id AND jahr = p_jahr AND zeitraum = p_zeitraum AND NOT gesperrt;
  PERFORM set_config('s112.ea_sperre', '', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.setze_kontobewegung_abgeglichen(p_tenant_id uuid, p_quelle text, p_id uuid, p_abgeglichen boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin','winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);   -- KAN-5 Nur-Lesen-Modus
  -- KAN-159 B9: Modul wie die RLS der jeweiligen Tabelle
  IF p_quelle = 'zahlung' THEN
    PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft', 'ea');
  ELSE
    PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'ea');
    PERFORM public.s112_pruefe_paketmodul(p_tenant_id, 'modul_ea');   -- KAN-195 (Bank/Kassa gehört zur E&A)
  END IF;

  IF p_quelle = 'zahlung' THEN
    UPDATE zahlungen SET abgeglichen = p_abgeglichen
    WHERE id = p_id AND tenant_id = p_tenant_id;
  ELSIF p_quelle = 'ea_transaktion' THEN
    -- bewusst unabhängig von is_locked: Abgleich bleibt nach Monatsabschluss/UVA möglich (konten/actions.ts)
    UPDATE ea_transaktionen SET abgeglichen = p_abgeglichen
    WHERE id = p_id AND tenant_id = p_tenant_id;
  ELSIF p_quelle = 'umbuchung_von' THEN
    UPDATE konto_umbuchungen SET von_abgeglichen = p_abgeglichen
    WHERE id = p_id AND tenant_id = p_tenant_id;
  ELSIF p_quelle = 'umbuchung_nach' THEN
    UPDATE konto_umbuchungen SET nach_abgeglichen = p_abgeglichen
    WHERE id = p_id AND tenant_id = p_tenant_id;
  ELSE
    RAISE EXCEPTION 'Unbekannte Quelle: %', p_quelle;
  END IF;
END;
$function$;
