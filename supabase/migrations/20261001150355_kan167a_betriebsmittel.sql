-- KAN-167, Etappe 1: Betriebsmittel „Weinbehandlungsmittel“ und „Produktionsmittel“ – Stammdaten, Lager, Einkauf mit
-- Pflicht-E/A-Ausgabe, Verbrauch aus Maßnahmen (Entscheidungen Jörgen 01.10.2026)
--
--  1. betriebsmittel (Stammdaten je Betrieb): gruppe 'weinbehandlung' | 'produktion', name, einheit (kg, g, l, ml, stk, m),
--     preis_pro_einheit, ea_kategorie_id (Vorbelegung der Ausgabe), notizen, aktiv. Löschen nur ohne Bezug
--     (a_stammdaten_loeschsperre), sonst deaktivieren; Protokoll für Löschen und aktiv.
--  2. betriebsmittel_lager_bewegungen: anfangsbestand | einkauf | korrektur (Menge mit Vorzeichen wie PSM/Dünger); beim
--     Einkauf betrag_netto, ust_satz, lieferant_firma_id und ea_transaktion_id (E/A-Ausgabe). Storno statt Löschen
--     (Storno-Spalten, a_storno_schutz, a_loeschsperre, keine_direktloeschung); endgültig löschen über
--     s112_storniert_loeschen. Einkäufe entstehen NUR über s112_betriebsmittel_einkauf (RLS: Benutzer legen
--     keinen Einkauf direkt an und ändern keinen) – so gibt es keinen Einkauf ohne Ausgabe.
--  3. s112_betriebsmittel_einkauf(...): legt in EINER Transaktion die E/A-Ausgabe (import_quelle 'betriebsmittel') und
--     die Lagerbuchung an. Voraussetzungen: SA/TA/winzer, Abo, Schreibmodule rieden UND ea, E&A-Modul aktiv mit
--     Buchhaltungsart 'ea', Zeitraum offen, Mittel/Lieferant/Kategorie des Betriebs.
--  4. s112_betriebsmittel_stornieren(...): storniert eine Lagerbuchung; bei einem Einkauf zusätzlich die Ausgabe
--     (Gegenbuchung über s112_ea_stornieren, prüft Schreibmodul ea und Zeitraum).
--  5. behandlungen.betriebsmittel_id (statt eines PSM/Düngers, bei „Sonstiges“ und „Laubarbeit“); Einheiten Stk und m
--     für Aufwand (stk_ha, m_ha, stk, m) und Menge; Protokoll überwacht betriebsmittel_id.
--  6. ea_transaktionen.import_quelle += 'betriebsmittel'; Bezugsliste, Lösch-RPC um die neuen Tabellen ergänzt.
-- RLS TO authenticated, mitgliedschaft_aktiv, abo_schreibsperre, modul_* (rieden), zwei_faktor_aal; kein TRUNCATE.
-- Kein session_replication_role (KAN-124). Keine Altdaten betroffen.

-- 1. Stammdaten ───────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.betriebsmittel (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  gruppe            text NOT NULL CHECK (gruppe IN ('weinbehandlung', 'produktion')),
  name              text NOT NULL CHECK (length(btrim(name)) > 0),
  einheit           text NOT NULL DEFAULT 'stk' CHECK (einheit IN ('kg', 'g', 'l', 'ml', 'stk', 'm')),
  preis_pro_einheit numeric(12,4) CHECK (preis_pro_einheit IS NULL OR preis_pro_einheit >= 0),
  ea_kategorie_id   uuid REFERENCES public.ea_kategorien(id) ON DELETE SET NULL,
  notizen           text,
  aktiv             boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS betriebsmittel_tenant_gruppe_idx ON public.betriebsmittel (tenant_id, gruppe);
COMMENT ON TABLE public.betriebsmittel IS 'KAN-167: Weinbehandlungs- und Produktionsmittel (Stammdaten je Betrieb)';

-- 2. Lagerbuchungen ───────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.betriebsmittel_lager_bewegungen (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  betriebsmittel_id   uuid NOT NULL REFERENCES public.betriebsmittel(id) ON DELETE CASCADE,
  datum               date NOT NULL,
  typ                 text NOT NULL CHECK (typ IN ('anfangsbestand', 'einkauf', 'korrektur')),
  menge               numeric(12,3) NOT NULL CHECK (menge <> 0),
  einheit             text NOT NULL CHECK (einheit IN ('kg', 'g', 'l', 'ml', 'stk', 'm')),
  betrag_netto        numeric(12,2) CHECK (betrag_netto IS NULL OR betrag_netto >= 0),
  ust_satz            numeric(4,1) CHECK (ust_satz IS NULL OR ust_satz IN (0, 10, 13, 20)),
  lieferant_firma_id  uuid REFERENCES public.firmen(id) ON DELETE SET NULL,
  ea_transaktion_id   uuid UNIQUE REFERENCES public.ea_transaktionen(id) ON DELETE SET NULL,
  notizen             text,
  erstellt_am         timestamptz NOT NULL DEFAULT now(),
  storniert_am        timestamptz,
  storniert_von       uuid,
  storniert_von_name  text,
  storno_grund        text,
  CONSTRAINT betriebsmittel_lager_einkauf_chk CHECK (typ <> 'einkauf' OR (menge > 0 AND betrag_netto IS NOT NULL AND ust_satz IS NOT NULL)),
  CONSTRAINT betriebsmittel_lager_bewegungen_storno_chk CHECK (
    (storniert_am IS NULL AND storniert_von IS NULL AND storniert_von_name IS NULL AND storno_grund IS NULL)
    OR (storniert_am IS NOT NULL AND length(btrim(coalesce(storno_grund, ''))) >= 10))
);
CREATE INDEX IF NOT EXISTS betriebsmittel_lager_mittel_idx ON public.betriebsmittel_lager_bewegungen (betriebsmittel_id, datum);
CREATE INDEX IF NOT EXISTS betriebsmittel_lager_tenant_idx ON public.betriebsmittel_lager_bewegungen (tenant_id);
COMMENT ON TABLE public.betriebsmittel_lager_bewegungen IS
  'KAN-167: Anfangsbestand, Einkauf (nur über s112_betriebsmittel_einkauf, mit E/A-Ausgabe) und Inventurkorrektur – storniert statt gelöscht';

-- 3. RLS ──────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.betriebsmittel ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.betriebsmittel_lager_bewegungen ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.betriebsmittel, public.betriebsmittel_lager_bewegungen FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.betriebsmittel, public.betriebsmittel_lager_bewegungen FROM anon;

CREATE POLICY bm_select ON public.betriebsmittel FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY bm_insert ON public.betriebsmittel FOR INSERT TO authenticated
  WITH CHECK (public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']));
CREATE POLICY bm_update ON public.betriebsmittel FOR UPDATE TO authenticated
  USING (public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']))
  WITH CHECK (public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']));
CREATE POLICY bm_delete ON public.betriebsmittel FOR DELETE TO authenticated
  USING (public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin']));

CREATE POLICY bml_select ON public.betriebsmittel_lager_bewegungen FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
-- Einkäufe nur über s112_betriebsmittel_einkauf (SECURITY DEFINER) – direkt nur Anfangsbestand und Korrektur
CREATE POLICY bml_insert ON public.betriebsmittel_lager_bewegungen FOR INSERT TO authenticated
  WITH CHECK (typ <> 'einkauf' AND ea_transaktion_id IS NULL
              AND public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']));
-- Einkäufe hängen an der Buchhaltung: nicht bearbeitbar (stornieren über s112_betriebsmittel_stornieren)
CREATE POLICY bml_update ON public.betriebsmittel_lager_bewegungen FOR UPDATE TO authenticated
  USING (typ <> 'einkauf' AND public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']))
  WITH CHECK (typ <> 'einkauf' AND ea_transaktion_id IS NULL
              AND public.user_has_role_in_tenant(tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['betriebsmittel', 'betriebsmittel_lager_bewegungen'] LOOP
    EXECUTE format('CREATE POLICY mitgliedschaft_aktiv ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
      USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())))', t);
    EXECUTE format('CREATE POLICY abo_schreibsperre_ins ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())))', t);
    EXECUTE format('CREATE POLICY abo_schreibsperre_upd ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())))', t);
    EXECUTE format('CREATE POLICY abo_schreibsperre_del ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated
      USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())))', t);
    EXECUTE format('CREATE POLICY modul_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated
      WITH CHECK (public.s112_darf_schreiben(tenant_id, VARIADIC ARRAY[''rieden'']))', t);
    EXECUTE format('CREATE POLICY modul_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated
      USING (public.s112_darf_schreiben(tenant_id, VARIADIC ARRAY[''rieden''])) WITH CHECK (public.s112_darf_schreiben(tenant_id, VARIADIC ARRAY[''rieden'']))', t);
    EXECUTE format('CREATE POLICY modul_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated
      USING (public.s112_darf_schreiben(tenant_id, VARIADIC ARRAY[''rieden'']))', t);
    EXECUTE format('CREATE POLICY zwei_faktor_aal ON public.%I AS RESTRICTIVE FOR ALL TO authenticated
      USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()))', t);
  END LOOP;
END $$;
CREATE POLICY keine_direktloeschung ON public.betriebsmittel_lager_bewegungen AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

-- 4. Trigger ──────────────────────────────────────────────────────────────────────────────────────────────
CREATE TRIGGER betriebsmittel_updated_at BEFORE UPDATE ON public.betriebsmittel
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER a_stammdaten_loeschsperre BEFORE DELETE ON public.betriebsmittel
  FOR EACH ROW EXECUTE FUNCTION public.s112_stammdaten_loeschsperre();
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF aktiv, tenant_id ON public.betriebsmittel
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('aktiv', 'tenant_id');
CREATE TRIGGER a_storno_schutz BEFORE INSERT OR UPDATE ON public.betriebsmittel_lager_bewegungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_storno_schutz();
CREATE TRIGGER a_loeschsperre BEFORE DELETE ON public.betriebsmittel_lager_bewegungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_loeschsperre('storno');
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF betriebsmittel_id, datum, typ, menge, einheit, betrag_netto, ust_satz,
  lieferant_firma_id, tenant_id, storniert_am, storno_grund ON public.betriebsmittel_lager_bewegungen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('betriebsmittel_id', 'datum', 'typ', 'menge', 'einheit',
  'betrag_netto', 'ust_satz', 'lieferant_firma_id', 'tenant_id', 'storniert_am', 'storno_grund');
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['betriebsmittel', 'betriebsmittel_lager_bewegungen'] LOOP
    EXECUTE format('CREATE TRIGGER z_protokoll_loeschen AFTER DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben()', t);
    EXECUTE format('CREATE TRIGGER z_protokoll_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.bestandsprotokoll_schreiben()', t);
  END LOOP;
END $$;

-- 5. Maßnahmen ────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.behandlungen ADD COLUMN IF NOT EXISTS betriebsmittel_id uuid REFERENCES public.betriebsmittel(id);
CREATE INDEX IF NOT EXISTS behandlungen_betriebsmittel_idx ON public.behandlungen (betriebsmittel_id) WHERE betriebsmittel_id IS NOT NULL;
ALTER TABLE public.behandlungen DROP CONSTRAINT IF EXISTS behandlungen_betriebsmittel_allein_chk;
ALTER TABLE public.behandlungen ADD CONSTRAINT behandlungen_betriebsmittel_allein_chk
  CHECK (betriebsmittel_id IS NULL OR (psm_id IS NULL AND duengemittel_id IS NULL));
ALTER TABLE public.behandlungen DROP CONSTRAINT IF EXISTS behandlungen_aufwandmenge_einheit_check;
ALTER TABLE public.behandlungen ADD CONSTRAINT behandlungen_aufwandmenge_einheit_check
  CHECK (aufwandmenge_einheit = ANY (ARRAY['kg_ha', 'l_ha', 'g_hl', 'ml_hl', 'kg', 'l', 'stk_ha', 'm_ha', 'stk', 'm']));
ALTER TABLE public.behandlungen DROP CONSTRAINT IF EXISTS behandlungen_menge_einheit_check;
ALTER TABLE public.behandlungen ADD CONSTRAINT behandlungen_menge_einheit_check
  CHECK (menge_einheit = ANY (ARRAY['kg', 'l', 'g', 'ml', 'stk', 'm']));
DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.behandlungen;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF art, datum, datum_bis, psm_id, duengemittel_id, betriebsmittel_id, aufwandmenge,
  aufwandmenge_einheit, menge_gesamt, menge_einheit, konzentration, wasseraufwand_l_ha, ernte_fruehesteins, weingarten_id, tenant_id
  ON public.behandlungen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('art', 'datum', 'datum_bis', 'psm_id', 'duengemittel_id',
  'betriebsmittel_id', 'aufwandmenge', 'aufwandmenge_einheit', 'menge_gesamt', 'menge_einheit', 'konzentration', 'wasseraufwand_l_ha',
  'ernte_fruehesteins', 'weingarten_id', 'tenant_id');

-- 6. E/A: Herkunft der Ausgabe ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.ea_transaktionen DROP CONSTRAINT IF EXISTS ea_transaktionen_import_quelle_check;
ALTER TABLE public.ea_transaktionen ADD CONSTRAINT ea_transaktionen_import_quelle_check
  CHECK (import_quelle = ANY (ARRAY['manuell', 'camt053', 'csv', 'verkauf', 'betriebsmittel']));

-- 7. Einkauf mit Ausgabe ──────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_betriebsmittel_einkauf(p_tenant_id uuid, p_betriebsmittel_id uuid, p_datum date,
  p_menge numeric, p_einheit text, p_betrag_netto numeric, p_ust_satz numeric, p_lieferant_firma_id uuid,
  p_ea_kategorie_id uuid, p_notizen text DEFAULT NULL)
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
REVOKE EXECUTE ON FUNCTION public.s112_betriebsmittel_einkauf(uuid, uuid, date, numeric, text, numeric, numeric, uuid, uuid, text) FROM PUBLIC, anon;

-- 8. Storno einer Lagerbuchung (Einkauf: samt Ausgabe) ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_betriebsmittel_stornieren(p_tenant_id uuid, p_id uuid, p_grund text, p_datum date DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_b record;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'rieden');
  IF length(btrim(coalesce(p_grund, ''))) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für den Storno angeben (mindestens 10 Zeichen).' USING ERRCODE = '23514';
  END IF;
  SELECT l.id, l.typ, l.ea_transaktion_id, l.storniert_am INTO v_b FROM public.betriebsmittel_lager_bewegungen l
   WHERE l.id = p_id AND l.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Buchung nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_b.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Die Buchung ist bereits storniert.' USING ERRCODE = '42501';
  END IF;
  -- Einkauf: zuerst die Ausgabe (Gegenbuchung; prüft Schreibmodul ea und Zeitraum), dann die Lagerbuchung
  IF v_b.ea_transaktion_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.ea_transaktionen e
       WHERE e.id = v_b.ea_transaktion_id AND e.tenant_id = p_tenant_id AND e.storniert_am IS NULL) THEN
    PERFORM public.s112_ea_stornieren(p_tenant_id, v_b.ea_transaktion_id, btrim(p_grund), p_datum);
  END IF;
  UPDATE public.betriebsmittel_lager_bewegungen
     SET storniert_am = now(), storno_grund = btrim(p_grund)
   WHERE id = p_id AND tenant_id = p_tenant_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_betriebsmittel_stornieren(uuid, uuid, text, date) FROM PUBLIC, anon;

-- 9. Bezugsliste (Stammdaten-Löschsperre) und Lösch-RPC um die neuen Tabellen ergänzt ─────────────────────
CREATE OR REPLACE FUNCTION public.s112_stammdaten_bezuege_intern(p_tabelle text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
BEGIN
  CASE p_tabelle
    WHEN 'weingarten' THEN
      v := jsonb_build_object(
        'Maßnahmen', (SELECT count(*) FROM (
            SELECT b.id FROM public.behandlungen b WHERE b.weingarten_id = p_id
            UNION SELECT bg.behandlung_id FROM public.behandlung_grundstuecke bg
                    JOIN public.grundstuecke g ON g.id = bg.grundstueck_id WHERE g.weingarten_id = p_id) x),
        'Lese-Einträge', (SELECT count(*) FROM public.ernte_parzellen e
            WHERE e.weingarten_id = p_id OR e.grundstueck_id IN (SELECT g.id FROM public.grundstuecke g WHERE g.weingarten_id = p_id)),
        'Chargen', (SELECT count(*) FROM (
            SELECT w.id FROM public.weinausbau w WHERE w.weingarten_id = p_id
            UNION SELECT ww.weinausbau_id FROM public.weinausbau_weingaerten ww WHERE ww.weingarten_id = p_id) x),
        'Pressungen', (SELECT count(DISTINCT pw.pressung_id) FROM public.pressung_weingaerten pw
            WHERE pw.weingarten_id = p_id OR pw.grundstueck_id IN (SELECT g.id FROM public.grundstuecke g WHERE g.weingarten_id = p_id)),
        'Traubenverkäufe', (SELECT count(*) FROM public.traubenverkauf t
            WHERE t.weingarten_id = p_id OR t.grundstueck_id IN (SELECT g.id FROM public.grundstuecke g WHERE g.weingarten_id = p_id)));
    WHEN 'grundstuecke' THEN
      v := jsonb_build_object(
        'Maßnahmen', (SELECT count(DISTINCT bg.behandlung_id) FROM public.behandlung_grundstuecke bg WHERE bg.grundstueck_id = p_id),
        'Lese-Einträge', (SELECT count(*) FROM public.ernte_parzellen e WHERE e.grundstueck_id = p_id),
        'Pressungen', (SELECT count(DISTINCT pw.pressung_id) FROM public.pressung_weingaerten pw WHERE pw.grundstueck_id = p_id),
        'Traubenverkäufe', (SELECT count(*) FROM public.traubenverkauf t WHERE t.grundstueck_id = p_id));
    WHEN 'kontakte' THEN
      v := jsonb_build_object(
        'Verkäufe', (SELECT count(*) FROM public.verkaufsposten vp WHERE vp.kontakt_id = p_id OR vp.zh_kontakt_id = p_id),
        'Zukäufe', (SELECT count(*) FROM public.zukauf_posten z WHERE z.lieferant_kontakt_id = p_id OR z.zh_kontakt_id = p_id),
        'Exportaufträge', (SELECT count(*) FROM public.exportauftraege x WHERE x.kontakt_id = p_id),
        'Traubenverkäufe', (SELECT count(*) FROM public.traubenverkauf t WHERE t.kontakt_id = p_id));
    WHEN 'firmen' THEN
      v := jsonb_build_object(
        'Verkäufe', (SELECT count(*) FROM public.verkaufsposten vp WHERE vp.firma_id = p_id),
        'Zukäufe', (SELECT count(*) FROM public.zukauf_posten z WHERE z.lieferant_firma_id = p_id),
        'Exportaufträge', (SELECT count(*) FROM public.exportauftraege x WHERE x.firma_id = p_id),
        'E/A-Buchungen', (SELECT count(*) FROM public.ea_transaktionen e WHERE e.firma_id = p_id),
        'Traubenverkäufe', (SELECT count(*) FROM public.traubenverkauf t WHERE t.firma_id = p_id));
    WHEN 'pflanzenschutzmittel' THEN
      v := jsonb_build_object(
        'Maßnahmen', (SELECT count(*) FROM public.behandlungen b WHERE b.psm_id = p_id),
        'Lagerbuchungen', (SELECT count(*) FROM public.psm_lager_bewegungen l WHERE l.psm_id = p_id));
    WHEN 'duengemittel' THEN
      v := jsonb_build_object(
        'Maßnahmen', (SELECT count(*) FROM public.behandlungen b WHERE b.duengemittel_id = p_id),
        'Lagerbuchungen', (SELECT count(*) FROM public.duengemittel_lager_bewegungen l WHERE l.duengemittel_id = p_id));
    WHEN 'betriebsmittel' THEN
      v := jsonb_build_object(
        'Maßnahmen', (SELECT count(*) FROM public.behandlungen b WHERE b.betriebsmittel_id = p_id),
        'Lagerbuchungen', (SELECT count(*) FROM public.betriebsmittel_lager_bewegungen l WHERE l.betriebsmittel_id = p_id));
    WHEN 'ea_kategorien' THEN
      v := jsonb_build_object(
        'E/A-Buchungen', (SELECT count(*) FROM public.ea_transaktionen e WHERE e.kategorie_id = p_id),
        'Daueraufträge', (SELECT count(*) FROM public.ea_dauerauftraege d WHERE d.kategorie_id = p_id));
    WHEN 'ea_dauerauftraege' THEN
      v := jsonb_build_object(
        'E/A-Buchungen', (SELECT count(*) FROM public.ea_transaktionen e WHERE e.dauerauftrag_id = p_id),
        'Ausführungen', (SELECT count(*) FROM public.ea_dauerauftrag_log l WHERE l.dauerauftrag_id = p_id));
    WHEN 'keller_behandlungstypen' THEN
      v := jsonb_build_object(
        'Kellerbehandlungen', (SELECT count(*) FROM public.keller_behandlungen k WHERE k.typ_id = p_id));
    ELSE
      RAISE EXCEPTION 'Für „%“ gibt es keine Bezugsliste.', coalesce(p_tabelle, '–') USING ERRCODE = '22023';
  END CASE;
  RETURN COALESCE((SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(v) e WHERE (e.value)::bigint > 0), '{}'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.s112_stammdaten_bezuege(p_tenant_id uuid, p_tabelle text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_da boolean;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, NULL);
  IF p_tabelle IS NULL OR NOT (p_tabelle = ANY (ARRAY['weingarten', 'grundstuecke', 'kontakte', 'firmen', 'pflanzenschutzmittel',
       'duengemittel', 'ea_kategorien', 'ea_dauerauftraege', 'keller_behandlungstypen', 'betriebsmittel'])) THEN
    RAISE EXCEPTION 'Für „%“ gibt es keine Bezugsliste.', coalesce(p_tabelle, '–') USING ERRCODE = '22023';
  END IF;
  -- nur Zeilen des eigenen Betriebs (keine fremden IDs abfragen)
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id = $1 AND tenant_id = $2)', p_tabelle) INTO v_da USING p_id, p_tenant_id;
  IF NOT v_da THEN
    RAISE EXCEPTION 'Datensatz nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.s112_stammdaten_bezuege_intern(p_tabelle, p_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.s112_storniert_loeschen(p_tenant_id uuid, p_tabelle text, p_id uuid, p_grund text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Tabellen mit Storno und ihre Schreibmodule (wie die RESTRICTIVE-Policies modul_delete)
  c_tabellen constant text[] := ARRAY['verschneidungen', 'keller_umzuege', 'keller_behandlungen', 'fuellungen', 'zukauf_posten',
                                      'pressungen', 'ernte_parzellen', 'traubenverkauf',
                                      'dac_antrag', 'weinanalysen', 'pruefnummernantraege', 'transportbescheinigungen', 'exportauftraege',
                                      'betriebsmittel_lager_bewegungen'];
  v_module    text[];
  v_storniert boolean;
  v_entwurf   boolean := false;
  v_status    text;
  v_jahrgang  uuid;
  v_chargen   uuid[] := '{}';
  v_c         uuid;
  v_n         integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF p_tabelle IS NULL OR NOT (p_tabelle = ANY (c_tabellen)) THEN
    RAISE EXCEPTION 'Endgültig löschen ist für „%“ nicht vorgesehen.', coalesce(p_tabelle, '–') USING ERRCODE = '22023';
  END IF;
  v_module := CASE p_tabelle
    WHEN 'verschneidungen'          THEN ARRAY['kellerbuch']
    WHEN 'keller_behandlungen'      THEN ARRAY['kellerbuch']
    WHEN 'keller_umzuege'           THEN ARRAY['kellerbuch', 'warenwirtschaft']
    WHEN 'fuellungen'               THEN ARRAY['kellerbuch', 'warenwirtschaft']
    WHEN 'zukauf_posten'            THEN ARRAY['warenwirtschaft']
    WHEN 'pressungen'               THEN ARRAY['kellerbuch', 'rieden']
    WHEN 'ernte_parzellen'          THEN ARRAY['rieden', 'kellerbuch']
    WHEN 'traubenverkauf'           THEN ARRAY['rieden', 'warenwirtschaft']
    WHEN 'dac_antrag'               THEN ARRAY['kellerbuch']
    WHEN 'weinanalysen'             THEN ARRAY['kellerbuch']
    WHEN 'pruefnummernantraege'     THEN ARRAY['kellerbuch']
    WHEN 'transportbescheinigungen' THEN ARRAY['kellerbuch', 'warenwirtschaft']
    WHEN 'exportauftraege'          THEN ARRAY['warenwirtschaft']
    WHEN 'betriebsmittel_lager_bewegungen' THEN ARRAY['rieden']
  END;
  IF NOT public.s112_darf_schreiben(p_tenant_id, VARIADIC v_module) THEN
    RAISE EXCEPTION 'Für das endgültige Löschen fehlt das Schreibrecht (Modul %).', array_to_string(v_module, ' bzw. ') USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = p_tabelle AND column_name = 'storniert_am') THEN
    RAISE EXCEPTION '„%“ wird noch nicht storniert – endgültig löschen ist dort noch nicht möglich.', p_tabelle USING ERRCODE = '22023';
  END IF;
  IF length(btrim(coalesce(p_grund, ''))) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund angeben (mindestens 10 Zeichen).' USING ERRCODE = '22023';
  END IF;

  -- Zeile sperren; ernte_parzellen hat keine tenant_id (Betrieb über den Jahrgang)
  IF p_tabelle = 'ernte_parzellen' THEN
    SELECT e.storniert_am IS NOT NULL, e.jahrgang_id INTO v_storniert, v_jahrgang
      FROM public.ernte_parzellen e JOIN public.weinjahrgaenge j ON j.id = e.jahrgang_id
     WHERE e.id = p_id AND j.tenant_id = p_tenant_id
       FOR UPDATE OF e;
  ELSE
    EXECUTE format('SELECT storniert_am IS NOT NULL FROM public.%I WHERE id = $1 AND tenant_id = $2 FOR UPDATE', p_tabelle)
      INTO v_storniert USING p_id, p_tenant_id;
    IF p_tabelle IN ('pressungen', 'traubenverkauf') THEN
      EXECUTE format('SELECT jahrgang_id FROM public.%I WHERE id = $1', p_tabelle) INTO v_jahrgang USING p_id;
    END IF;
    IF p_tabelle IN ('dac_antrag', 'exportauftraege') THEN
      EXECUTE format('SELECT status FROM public.%I WHERE id = $1', p_tabelle) INTO v_status USING p_id;
    END IF;
  END IF;
  IF v_storniert IS NULL THEN
    RAISE EXCEPTION 'Buchung nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;

  -- KAN-150 F2 (Frage 8): DAC- und Export-Entwurf ohne Bezug auch ohne Storno – nur Betriebsleitung
  IF NOT v_storniert AND p_tabelle IN ('dac_antrag', 'exportauftraege') AND v_status = 'entwurf' THEN
    IF NOT public.user_has_role_in_tenant(p_tenant_id, ARRAY['system_admin', 'tenant_admin'])
       AND COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text) IN ('authenticated', 'anon') THEN
      RAISE EXCEPTION 'Einen Entwurf löscht nur die Betriebsleitung – bitte stornieren.' USING ERRCODE = '42501';
    END IF;
    v_entwurf := true;
  END IF;
  IF NOT v_storniert AND NOT v_entwurf THEN
    RAISE EXCEPTION 'Endgültig löschen lassen sich nur stornierte Buchungen – bitte zuerst stornieren.' USING ERRCODE = '42501';
  END IF;

  -- KAN-148 Frage 6: nie nach einer eingereichten Erntemeldung des Jahrgangs
  IF v_jahrgang IS NOT NULL AND EXISTS (SELECT 1 FROM public.ama_erntemeldungen a
       WHERE a.jahrgang_id = v_jahrgang AND a.tenant_id = p_tenant_id AND a.status IN ('eingereicht', 'bestaetigt', 'abgelehnt')) THEN
    RAISE EXCEPTION 'Für diesen Jahrgang ist die Erntemeldung bereits eingereicht – stornierte Einträge bleiben als Nachweis stehen.' USING ERRCODE = '42501';
  END IF;
  -- Traubenverkauf: nicht, solange eine Rechnungsposition auf ihn verweist (sonst SET NULL, KAN-145 Soll 5)
  IF p_tabelle = 'traubenverkauf' AND EXISTS (SELECT 1 FROM public.verkauf_positionen vp
       WHERE vp.traubenverkauf_id = p_id AND vp.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Der Traubenverkauf gehört zu einer Rechnung – er bleibt als storniert stehen.' USING ERRCODE = '42501';
  END IF;
  -- KAN-150 F2: Füllung nicht mit Exportposition (sonst SET NULL auf fullung_id)
  IF p_tabelle = 'fuellungen' AND EXISTS (SELECT 1 FROM public.exportauftrag_positionen ep
       JOIN public.exportauftraege a ON a.id = ep.exportauftrag_id
       WHERE ep.fullung_id = p_id AND a.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Die Füllung steht in einem Exportauftrag – sie bleibt als storniert stehen.' USING ERRCODE = '42501';
  END IF;
  -- KAN-150 F2: DAC-Antrag nicht mit Füllungen oder Prüfnummernantrag (auch stornierten; sonst SET NULL)
  IF p_tabelle = 'dac_antrag' AND (
       EXISTS (SELECT 1 FROM public.fuellungen f WHERE f.dac_antrag_id = p_id AND f.tenant_id = p_tenant_id)
       OR EXISTS (SELECT 1 FROM public.pruefnummernantraege pn WHERE pn.dac_antrag_id = p_id AND pn.tenant_id = p_tenant_id)) THEN
    RAISE EXCEPTION 'Am DAC-Antrag hängen Füllungen oder ein Prüfnummernantrag – er bleibt als storniert stehen.' USING ERRCODE = '42501';
  END IF;
  -- KAN-150 F2 (Frage 8): Export-Entwurf nur ohne ausgestelltes Dokument und ohne ARC
  IF p_tabelle = 'exportauftraege' AND v_entwurf AND (
       EXISTS (SELECT 1 FROM public.export_dokumente d WHERE d.exportauftrag_id = p_id AND d.status = 'ausgestellt')
       OR EXISTS (SELECT 1 FROM public.exportauftraege a WHERE a.id = p_id AND NULLIF(btrim(a.emcs_arc_nummer), '') IS NOT NULL)) THEN
    RAISE EXCEPTION 'Der Exportauftrag hat ausgestellte Dokumente oder eine ARC-Nummer – bitte stornieren.' USING ERRCODE = '42501';
  END IF;
  -- Pressung: Chargen gehen mit – nur ohne jeden weiteren Bezug
  IF p_tabelle = 'pressungen' THEN
    IF EXISTS (SELECT 1 FROM public.verkauf_positionen vp JOIN public.pressung_behaelter pb ON pb.id = vp.pressung_behaelter_id
                WHERE pb.pressung_id = p_id AND vp.tenant_id = p_tenant_id) THEN
      RAISE EXCEPTION 'Aus der Pressung wurde direkt verkauft – sie bleibt als storniert stehen.' USING ERRCODE = '42501';
    END IF;
    SELECT coalesce(array_agg(DISTINCT pb.weinausbau_id), '{}') INTO v_chargen
      FROM public.pressung_behaelter pb WHERE pb.pressung_id = p_id AND pb.weinausbau_id IS NOT NULL;
    IF EXISTS (SELECT 1 FROM public.weinausbau w WHERE w.id = ANY (v_chargen) AND w.storniert_am IS NULL)
       OR EXISTS (SELECT 1 FROM public.pressung_behaelter pb WHERE pb.weinausbau_id = ANY (v_chargen) AND pb.pressung_id <> p_id)
       OR EXISTS (SELECT 1 FROM public.keller_umzuege x WHERE x.von_weinausbau_id = ANY (v_chargen) OR x.nach_weinausbau_id = ANY (v_chargen))
       OR EXISTS (SELECT 1 FROM public.verschneidungen x WHERE x.ziel_weinausbau_id = ANY (v_chargen))
       OR EXISTS (SELECT 1 FROM public.verschneidung_quellen x WHERE x.quell_weinausbau_id = ANY (v_chargen))
       OR EXISTS (SELECT 1 FROM public.fuellungen x WHERE x.weinausbau_id = ANY (v_chargen))
       OR EXISTS (SELECT 1 FROM public.fuellung_chargen x WHERE x.weinausbau_id = ANY (v_chargen))
       OR EXISTS (SELECT 1 FROM public.verkauf_positionen x WHERE x.weinausbau_id = ANY (v_chargen))
       OR EXISTS (SELECT 1 FROM public.zukauf_posten x WHERE x.ziel_weinausbau_id = ANY (v_chargen))
       OR EXISTS (SELECT 1 FROM public.keller_behandlungen x WHERE x.weinausbau_id = ANY (v_chargen))
       OR EXISTS (SELECT 1 FROM public.weinanalysen x WHERE x.weinausbau_id = ANY (v_chargen))
       OR EXISTS (SELECT 1 FROM public.dac_antrag x WHERE x.weinausbau_id = ANY (v_chargen))
       OR EXISTS (SELECT 1 FROM public.bestellung_positionen x WHERE x.weinausbau_id = ANY (v_chargen)) THEN
      RAISE EXCEPTION 'An einer Charge der Pressung hängen noch (auch stornierte) Buchungen, Analysen oder Anträge – die Pressung bleibt als storniert stehen.' USING ERRCODE = '42501';
    END IF;
  END IF;

  PERFORM set_config('s112.storno_loeschen', p_id::text, true);
  PERFORM set_config('s112.loesch_grund', btrim(p_grund), true);
  IF v_entwurf THEN
    PERFORM set_config('s112.entwurf_loeschen', p_id::text, true);
  END IF;
  IF p_tabelle = 'ernte_parzellen' THEN
    DELETE FROM public.ernte_parzellen WHERE id = p_id AND jahrgang_id = v_jahrgang;
  ELSE
    EXECUTE format('DELETE FROM public.%I WHERE id = $1 AND tenant_id = $2', p_tabelle) USING p_id, p_tenant_id;
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Buchung konnte nicht gelöscht werden (% Zeilen).', v_n USING ERRCODE = 'P0002';
  END IF;
  -- Chargen der Pressung (Behälterzeilen sind per CASCADE schon weg)
  FOREACH v_c IN ARRAY v_chargen LOOP
    PERFORM set_config('s112.storno_loeschen', v_c::text, true);
    DELETE FROM public.weinausbau WHERE id = v_c AND tenant_id = p_tenant_id;
  END LOOP;
  PERFORM set_config('s112.storno_loeschen', '', true);
  PERFORM set_config('s112.entwurf_loeschen', '', true);
  PERFORM set_config('s112.loesch_grund', '', true);
END;
$function$;

-- Selbstprüfung ───────────────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('betriebsmittel', 'betriebsmittel_lager_bewegungen') AND NOT ('authenticated' = ANY (roles))) > 0 THEN
    RAISE EXCEPTION 'KAN-167: Policy ohne TO authenticated';
  END IF;
  IF has_table_privilege('authenticated', 'public.betriebsmittel_lager_bewegungen', 'TRUNCATE') THEN
    RAISE EXCEPTION 'KAN-167: TRUNCATE-Recht';
  END IF;
  IF public.s112_stammdaten_bezuege_intern('betriebsmittel', gen_random_uuid()) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'KAN-167: Bezugsliste';
  END IF;
END $$;
