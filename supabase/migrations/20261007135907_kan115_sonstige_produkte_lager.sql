-- KAN-115 (07.10.2026): Traubensaft, Essig, Destillat als nicht bestandsrelevante Sonstige Produkte mit Lagerstand;
-- Vorgang „Zu Traubensaft verarbeiten“. R10 der BKI-Sitzung 24.09.2026 („traubensaft unter sonstige produkte, nicht
-- bestandsrelevant“), § 1 Abs. 1 Z 1 WeinG. Entscheidungen Jörgen 06.10.2026: keine gesonderte Ausweisung in Ernte- oder
-- Erzeugungsmeldung; Essig und Destillat wie Traubensaft.
--  1. sonstige_artikel += art (traubensaft|essig|destillat|sonstiges), bestand_fuehren, liter_je_stk.
--  2. sonstige_artikel_bewegungen: Lager außerhalb von Weinbuch und BSM – Anfangsbestand, Zugang, Verarbeitung (aus der
--     Charge), Verkauf, Inventur (± Differenz), Storno. Menge in der Einheit des Produkts mit Vorzeichen. Append-only und
--     nur per RPC (kein Schreibrecht per API); Benutzer stempelt die RPC.
--  3. verkauf_positionen += sonstige_artikel_id – eine Position „Sonstiges“ mit Lagerstand mindert den Bestand.
--  4. RPCs: s112_artikel_buchen (Anfangsbestand/Zugang/Inventur), s112_artikel_bewegung_stornieren,
--     s112_artikel_verkauf_buchen / _verkauf_stornieren (je Verkaufsposten, aus createVerkauf/verkaufspostenStornieren),
--     s112_verarbeitung_buchen += p_artikel_id, p_stueck (Zugang beim Produkt in derselben Transaktion),
--     s112_verarbeitung_stornieren nimmt den Zugang mit zurück (abgelehnt, wenn schon verkauft).
-- FK auf das Produkt ohne ON DELETE (NO ACTION): Löschen eines Produkts mit Bewegungen scheitert (App: deaktivieren). Bezüge
-- auf Verarbeitung und Verkauf ON DELETE SET NULL: die Bewegung bleibt, wenn eine stornierte Verarbeitung bzw. ein Beleg
-- endgültig gelöscht wird (s112_storniert_loeschen) oder s112_mandant_loeschen sie vor tenants abräumt (DB-Test 61).
--  5. Nachbesserung KAN-107: kellermittel_buchungen → keller_behandlungen/weinausbau/behaelter ON DELETE SET NULL statt
--     RESTRICT – sonst scheitern s112_mandant_loeschen und das endgültige Löschen einer stornierten Kellerbehandlung (23503).
-- Staging zuerst (sjpeghrlhsowmquacjhb), DB-Test 61, dann Produktion.

-- 1. Produkte ─────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.sonstige_artikel
  ADD COLUMN art            text CHECK (art IS NULL OR art IN ('traubensaft', 'essig', 'destillat', 'sonstiges')),
  ADD COLUMN bestand_fuehren boolean NOT NULL DEFAULT false,
  ADD COLUMN liter_je_stk   numeric(8,3) CHECK (liter_je_stk IS NULL OR liter_je_stk > 0);
COMMENT ON COLUMN public.sonstige_artikel.art IS 'KAN-115: Traubensaft, Essig, Destillat (Zweck der Verarbeitung) oder Sonstiges – nie Wein, nicht BSM-relevant';
COMMENT ON COLUMN public.sonstige_artikel.bestand_fuehren IS 'KAN-115: Lagerstand führen (Bewegungen in sonstige_artikel_bewegungen, Verkauf mindert)';

-- 2. Bewegungen ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.sonstige_artikel_bewegungen (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  artikel_id             uuid NOT NULL REFERENCES public.sonstige_artikel(id),
  datum                  date NOT NULL,
  art                    text NOT NULL CHECK (art IN ('anfangsbestand', 'zugang', 'verarbeitung', 'verkauf', 'inventur', 'storno')),
  menge                  numeric(12,3) NOT NULL CHECK (menge <> 0),
  keller_verarbeitung_id uuid REFERENCES public.keller_verarbeitungen(id) ON DELETE SET NULL,
  verkauf_position_id    uuid REFERENCES public.verkauf_positionen(id) ON DELETE SET NULL,
  verkaufsposten_id      uuid REFERENCES public.verkaufsposten(id) ON DELETE SET NULL,
  storno_von_id          uuid REFERENCES public.sonstige_artikel_bewegungen(id),
  notizen                text,
  erstellt_von           uuid,
  erstellt_von_name      text,
  erstellt_am            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sonstige_artikel_bewegungen_vorzeichen CHECK (
    (art IN ('anfangsbestand', 'zugang', 'verarbeitung') AND menge > 0) OR (art = 'verkauf' AND menge < 0) OR art IN ('inventur', 'storno')),
  CONSTRAINT sonstige_artikel_bewegungen_storno CHECK ((art = 'storno') = (storno_von_id IS NOT NULL))
);
CREATE INDEX sonstige_artikel_bewegungen_artikel_idx ON public.sonstige_artikel_bewegungen (artikel_id, datum, erstellt_am);
CREATE INDEX sonstige_artikel_bewegungen_tenant_idx ON public.sonstige_artikel_bewegungen (tenant_id, datum);
CREATE INDEX sonstige_artikel_bewegungen_verarbeitung_idx ON public.sonstige_artikel_bewegungen (keller_verarbeitung_id) WHERE keller_verarbeitung_id IS NOT NULL;
CREATE INDEX sonstige_artikel_bewegungen_posten_idx ON public.sonstige_artikel_bewegungen (verkaufsposten_id) WHERE verkaufsposten_id IS NOT NULL;
CREATE UNIQUE INDEX sonstige_artikel_bewegungen_storno_einmal ON public.sonstige_artikel_bewegungen (storno_von_id) WHERE storno_von_id IS NOT NULL;
CREATE UNIQUE INDEX sonstige_artikel_bewegungen_verkauf_einmal ON public.sonstige_artikel_bewegungen (verkauf_position_id) WHERE art = 'verkauf';
CREATE UNIQUE INDEX sonstige_artikel_bewegungen_verarbeitung_einmal ON public.sonstige_artikel_bewegungen (keller_verarbeitung_id) WHERE art = 'verarbeitung';
COMMENT ON TABLE public.sonstige_artikel_bewegungen IS
  'KAN-115: Lagerbewegungen Sonstiger Produkte (Traubensaft, Essig, Destillat …) – außerhalb von Weinbuch und BSM; append-only, nur per RPC';

ALTER TABLE public.sonstige_artikel_bewegungen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sonstige_artikel_bewegungen FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.sonstige_artikel_bewegungen FROM authenticated;
CREATE POLICY sonstige_artikel_bewegungen_select ON public.sonstige_artikel_bewegungen FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY mitgliedschaft_aktiv ON public.sonstige_artikel_bewegungen AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY abo_schreibsperre_ins ON public.sonstige_artikel_bewegungen AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.sonstige_artikel_bewegungen AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.sonstige_artikel_bewegungen AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.sonstige_artikel_bewegungen AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));

CREATE TRIGGER z_fremdverweis_artikel_id BEFORE INSERT OR UPDATE OF artikel_id, tenant_id ON public.sonstige_artikel_bewegungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('artikel_id', 'sonstige_artikel', '', '', '');
CREATE TRIGGER z_fremdverweis_keller_verarbeitung_id BEFORE INSERT OR UPDATE OF keller_verarbeitung_id, tenant_id ON public.sonstige_artikel_bewegungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('keller_verarbeitung_id', 'keller_verarbeitungen', '', '', '');
CREATE TRIGGER z_fremdverweis_verkauf_position_id BEFORE INSERT OR UPDATE OF verkauf_position_id, tenant_id ON public.sonstige_artikel_bewegungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('verkauf_position_id', 'verkauf_positionen', '', '', '');
CREATE TRIGGER z_fremdverweis_verkaufsposten_id BEFORE INSERT OR UPDATE OF verkaufsposten_id, tenant_id ON public.sonstige_artikel_bewegungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('verkaufsposten_id', 'verkaufsposten', '', '', '');
CREATE TRIGGER z_fremdverweis_storno_von_id BEFORE INSERT OR UPDATE OF storno_von_id, tenant_id ON public.sonstige_artikel_bewegungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('storno_von_id', 'sonstige_artikel_bewegungen', '', '', '');

-- 3. Verkaufsposition → Produkt ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.verkauf_positionen ADD COLUMN sonstige_artikel_id uuid REFERENCES public.sonstige_artikel(id);
COMMENT ON COLUMN public.verkauf_positionen.sonstige_artikel_id IS 'KAN-115: Sonstiges Produkt der Position (Typ sonstiges) – mit Lagerstand mindert der Verkauf den Bestand';
CREATE INDEX verkauf_positionen_sonstige_artikel_idx ON public.verkauf_positionen (sonstige_artikel_id) WHERE sonstige_artikel_id IS NOT NULL;
CREATE TRIGGER z_fremdverweis_sonstige_artikel_id BEFORE INSERT OR UPDATE OF sonstige_artikel_id, tenant_id ON public.verkauf_positionen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('sonstige_artikel_id', 'sonstige_artikel', '', '', '');

-- 4. RPCs ───────────────────────────────────────────────────────────────────────────────────────────────────
-- Bestand eines Produkts (Summe aller Bewegungen); intern, kein EXECUTE für Benutzerrollen
CREATE FUNCTION public.s112_artikel_bestand(p_artikel_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT coalesce(sum(b.menge), 0) FROM public.sonstige_artikel_bewegungen b WHERE b.artikel_id = p_artikel_id
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_artikel_bestand(uuid) FROM PUBLIC, anon, authenticated;

-- Schreibrecht Warenwirtschaft (Produkte und Verkauf) bzw. Kellerbuch (Verarbeitung)
CREATE FUNCTION public.s112_artikel_buchen(p_tenant_id uuid, p_artikel_id uuid, p_datum date, p_art text, p_menge numeric,
  p_notizen text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_a     public.sonstige_artikel%ROWTYPE;
  v_datum date := coalesce(p_datum, (now() AT TIME ZONE 'Europe/Vienna')::date);
  v_menge numeric := round(p_menge, 3);
  v_id    uuid;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT (public.ist_service_kontext() OR public.s112_darf_schreiben(p_tenant_id, 'warenwirtschaft')) THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für die Warenwirtschaft in diesem Betrieb.' USING ERRCODE = '42501';
  END IF;
  IF p_art IS NULL OR p_art NOT IN ('anfangsbestand', 'zugang', 'inventur') THEN
    RAISE EXCEPTION 'Unbekannte Buchungsart „%“ (erlaubt: Anfangsbestand, Zugang, Inventur).', coalesce(p_art, '–') USING ERRCODE = '22023';
  END IF;
  IF v_datum > (now() AT TIME ZONE 'Europe/Vienna')::date THEN
    RAISE EXCEPTION 'Das Datum liegt in der Zukunft.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_a FROM public.sonstige_artikel a WHERE a.id = p_artikel_id AND a.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produkt nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_a.bestand_fuehren THEN
    RAISE EXCEPTION 'Für „%“ wird kein Lagerstand geführt.', v_a.name USING ERRCODE = '22023';
  END IF;
  IF p_art = 'inventur' THEN
    -- p_menge = gezählter Ist-Bestand → gebucht wird die Differenz
    IF v_menge IS NULL OR v_menge < 0 THEN
      RAISE EXCEPTION 'Bitte den gezählten Bestand angeben (0 oder mehr).' USING ERRCODE = '22023';
    END IF;
    v_menge := v_menge - public.s112_artikel_bestand(p_artikel_id);
    IF v_menge = 0 THEN
      RAISE EXCEPTION 'Der gezählte Bestand stimmt mit dem Lagerstand überein – keine Differenz zu buchen.' USING ERRCODE = '22023';
    END IF;
  ELSIF v_menge IS NULL OR v_menge <= 0 THEN
    RAISE EXCEPTION 'Die Menge muss größer als 0 sein.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.sonstige_artikel_bewegungen (tenant_id, artikel_id, datum, art, menge, notizen, erstellt_von, erstellt_von_name)
  VALUES (p_tenant_id, p_artikel_id, v_datum, p_art, v_menge, NULLIF(btrim(coalesce(p_notizen, '')), ''), auth.uid(),
          public.s112_storno_benutzername(auth.uid()))
  RETURNING id INTO v_id;
  RETURN v_id;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_artikel_buchen(uuid, uuid, date, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_artikel_buchen(uuid, uuid, date, text, numeric, text) TO authenticated;
COMMENT ON FUNCTION public.s112_artikel_buchen(uuid, uuid, date, text, numeric, text) IS
  'KAN-115: Anfangsbestand, Zugang oder Inventur (Ist-Bestand → Differenz) eines Sonstigen Produkts mit Lagerstand';

-- Storno einer eigenen Lagerbuchung (Anfangsbestand, Zugang, Inventur) – Verkauf und Verarbeitung über ihren Vorgang
CREATE FUNCTION public.s112_artikel_bewegung_stornieren(p_tenant_id uuid, p_id uuid, p_grund text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_b     public.sonstige_artikel_bewegungen%ROWTYPE;
  v_grund text := btrim(coalesce(p_grund, ''));
  v_id    uuid;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT (public.ist_service_kontext() OR public.s112_darf_schreiben(p_tenant_id, 'warenwirtschaft')) THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für die Warenwirtschaft in diesem Betrieb.' USING ERRCODE = '42501';
  END IF;
  IF length(v_grund) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für das Stornieren angeben (mindestens 10 Zeichen).' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_b FROM public.sonstige_artikel_bewegungen b WHERE b.id = p_id AND b.tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Buchung nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_b.art NOT IN ('anfangsbestand', 'zugang', 'inventur') THEN
    RAISE EXCEPTION 'Verkauf und Verarbeitung werden über ihren Vorgang storniert (Verkauf bzw. Charge).' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.sonstige_artikel a WHERE a.id = v_b.artikel_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.sonstige_artikel_bewegungen s WHERE s.storno_von_id = p_id) THEN
    RAISE EXCEPTION 'Die Buchung ist bereits storniert.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.sonstige_artikel_bewegungen (tenant_id, artikel_id, datum, art, menge, storno_von_id, notizen, erstellt_von, erstellt_von_name)
  VALUES (p_tenant_id, v_b.artikel_id, (now() AT TIME ZONE 'Europe/Vienna')::date, 'storno', -v_b.menge, p_id, v_grund, auth.uid(),
          public.s112_storno_benutzername(auth.uid()))
  RETURNING id INTO v_id;
  RETURN v_id;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_artikel_bewegung_stornieren(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_artikel_bewegung_stornieren(uuid, uuid, text) TO authenticated;
COMMENT ON FUNCTION public.s112_artikel_bewegung_stornieren(uuid, uuid, text) IS
  'KAN-115: Gegenbuchung einer Lagerbuchung (Anfangsbestand, Zugang, Inventur) eines Sonstigen Produkts';

-- Verkauf: alle Positionen „Sonstiges“ eines Verkaufspostens mit Produkt und Lagerstand abbuchen – alles oder nichts
CREATE FUNCTION public.s112_artikel_verkauf_buchen(p_tenant_id uuid, p_verkaufsposten_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_p      public.verkaufsposten%ROWTYPE;
  r        record;
  v_n      integer := 0;
  v_best   numeric;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT (public.ist_service_kontext() OR public.s112_darf_schreiben(p_tenant_id, 'warenwirtschaft')) THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für die Warenwirtschaft in diesem Betrieb.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_p FROM public.verkaufsposten p WHERE p.id = p_verkaufsposten_id AND p.tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verkauf nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF coalesce(v_p.storniert, false) THEN
    RAISE EXCEPTION 'Der Verkauf ist storniert.' USING ERRCODE = '22023';
  END IF;
  -- je Produkt (gesperrt in fester Reihenfolge) die Summe prüfen, dann je Position buchen
  FOR r IN
    SELECT a.id, a.name, sum(vp.menge) AS menge
      FROM public.verkauf_positionen vp JOIN public.sonstige_artikel a ON a.id = vp.sonstige_artikel_id
     WHERE vp.verkaufsposten_id = p_verkaufsposten_id AND vp.tenant_id = p_tenant_id AND vp.typ = 'sonstiges'
       AND a.bestand_fuehren AND vp.menge > 0
       AND NOT EXISTS (SELECT 1 FROM public.sonstige_artikel_bewegungen b WHERE b.verkauf_position_id = vp.id AND b.art = 'verkauf')
     GROUP BY a.id, a.name ORDER BY a.id
  LOOP
    PERFORM 1 FROM public.sonstige_artikel a WHERE a.id = r.id FOR UPDATE;
    v_best := public.s112_artikel_bestand(r.id);
    IF r.menge > v_best + 0.0005 THEN
      RAISE EXCEPTION 'Nicht genug „%“ auf Lager: verkauft % , Lagerstand %.', r.name,
        replace(trim(to_char(r.menge, 'FM999999990.999')), '.', ','), replace(trim(to_char(v_best, 'FM999999990.999')), '.', ',')
        USING ERRCODE = '22023', HINT = 'artikel_bestand';
    END IF;
  END LOOP;
  INSERT INTO public.sonstige_artikel_bewegungen (tenant_id, artikel_id, datum, art, menge, verkauf_position_id, verkaufsposten_id,
                                                  erstellt_von, erstellt_von_name)
  SELECT p_tenant_id, vp.sonstige_artikel_id, v_p.datum, 'verkauf', -round(vp.menge, 3), vp.id, p_verkaufsposten_id, auth.uid(),
         public.s112_storno_benutzername(auth.uid())
    FROM public.verkauf_positionen vp JOIN public.sonstige_artikel a ON a.id = vp.sonstige_artikel_id
   WHERE vp.verkaufsposten_id = p_verkaufsposten_id AND vp.tenant_id = p_tenant_id AND vp.typ = 'sonstiges'
     AND a.bestand_fuehren AND vp.menge > 0
     AND NOT EXISTS (SELECT 1 FROM public.sonstige_artikel_bewegungen b WHERE b.verkauf_position_id = vp.id AND b.art = 'verkauf');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_artikel_verkauf_buchen(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_artikel_verkauf_buchen(uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.s112_artikel_verkauf_buchen(uuid, uuid) IS
  'KAN-115: Positionen „Sonstiges“ eines Verkaufs mit Lagerstand abbuchen (alles oder nichts, je Position einmal)';

-- Storno eines Verkaufs: die Verkaufsbuchungen des Postens gegenbuchen (heute)
CREATE FUNCTION public.s112_artikel_verkauf_stornieren(p_tenant_id uuid, p_verkaufsposten_id uuid, p_grund text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_n integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT (public.ist_service_kontext() OR public.s112_darf_schreiben(p_tenant_id, 'warenwirtschaft')) THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für die Warenwirtschaft in diesem Betrieb.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.sonstige_artikel_bewegungen (tenant_id, artikel_id, datum, art, menge, verkauf_position_id, verkaufsposten_id,
                                                  storno_von_id, notizen, erstellt_von, erstellt_von_name)
  SELECT p_tenant_id, b.artikel_id, (now() AT TIME ZONE 'Europe/Vienna')::date, 'storno', -b.menge, b.verkauf_position_id,
         b.verkaufsposten_id, b.id, NULLIF(btrim(coalesce(p_grund, '')), ''), auth.uid(), public.s112_storno_benutzername(auth.uid())
    FROM public.sonstige_artikel_bewegungen b
   WHERE b.tenant_id = p_tenant_id AND b.verkaufsposten_id = p_verkaufsposten_id AND b.art = 'verkauf'
     AND NOT EXISTS (SELECT 1 FROM public.sonstige_artikel_bewegungen s WHERE s.storno_von_id = b.id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_artikel_verkauf_stornieren(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_artikel_verkauf_stornieren(uuid, uuid, text) TO authenticated;
COMMENT ON FUNCTION public.s112_artikel_verkauf_stornieren(uuid, uuid, text) IS
  'KAN-115: Verkaufsbuchungen Sonstiger Produkte eines stornierten Verkaufs gegenbuchen (je Buchung einmal)';

-- Verarbeitung: optional Zugang beim Produkt (gleiche Transaktion). Neue Signatur mit zwei optionalen Parametern –
-- die alte wird ersetzt (Aufrufe mit benannten Parametern bleiben gültig).
DROP FUNCTION public.s112_verarbeitung_buchen(uuid, uuid, date, numeric, text, text);
CREATE FUNCTION public.s112_verarbeitung_buchen(p_tenant_id uuid, p_weinausbau_id uuid, p_datum date, p_menge numeric,
  p_zweck text, p_notizen text DEFAULT NULL, p_artikel_id uuid DEFAULT NULL, p_stueck numeric DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_w      public.weinausbau%ROWTYPE;
  v_a      public.sonstige_artikel%ROWTYPE;
  v_datum  date := coalesce(p_datum, (now() AT TIME ZONE 'Europe/Vienna')::date);
  v_heute  date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  v_menge  numeric := round(p_menge, 2);
  v_stueck numeric := round(p_stueck, 3);
  v_bis    date;
  v_letzte date;
  v_rest   numeric;
  v_id     uuid;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT (public.ist_service_kontext() OR public.s112_darf_schreiben(p_tenant_id, 'kellerbuch')) THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für das Kellerbuch in diesem Betrieb.' USING ERRCODE = '42501';
  END IF;
  IF p_zweck IS NULL OR p_zweck NOT IN ('traubensaft', 'essig', 'brennerei', 'sonstiges') THEN
    RAISE EXCEPTION 'Unbekannter Zweck der Verarbeitung „%“.', coalesce(p_zweck, '–') USING ERRCODE = '22023';
  END IF;
  IF v_menge IS NULL OR v_menge <= 0 THEN
    RAISE EXCEPTION 'Die verarbeitete Menge muss größer als 0 L sein.' USING ERRCODE = '22023';
  END IF;
  IF v_datum > v_heute THEN
    RAISE EXCEPTION 'Das Datum der Verarbeitung liegt in der Zukunft.' USING ERRCODE = '22023';
  END IF;
  v_bis := public.s112_kellerbuch_gesperrt_bis(p_tenant_id);
  IF v_bis IS NOT NULL AND v_datum <= v_bis THEN
    RAISE EXCEPTION 'Das Kellerbuch ist bis % abgeschlossen – die Verarbeitung kann frühestens am % gebucht werden.',
      to_char(v_bis, 'DD.MM.YYYY'), to_char(v_bis + 1, 'DD.MM.YYYY') USING ERRCODE = '42501', HINT = 'kellerbuch_abschluss';
  END IF;
  -- KAN-115: Produkt (optional) – eigener Betrieb, aktiv, mit Lagerstand; Stück > 0
  IF p_artikel_id IS NOT NULL THEN
    SELECT * INTO v_a FROM public.sonstige_artikel a WHERE a.id = p_artikel_id AND a.tenant_id = p_tenant_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produkt nicht gefunden.' USING ERRCODE = 'P0002';
    END IF;
    IF NOT v_a.aktiv OR NOT v_a.bestand_fuehren THEN
      RAISE EXCEPTION 'Das Produkt „%“ ist nicht aktiv oder führt keinen Lagerstand.', v_a.name USING ERRCODE = '22023';
    END IF;
    IF v_stueck IS NULL OR v_stueck <= 0 THEN
      RAISE EXCEPTION 'Bitte die erzeugte Menge des Produkts angeben (größer als 0 %).', v_a.einheit USING ERRCODE = '22023';
    END IF;
  ELSIF p_stueck IS NOT NULL THEN
    RAISE EXCEPTION 'Eine erzeugte Menge ohne Produkt ist nicht möglich.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_w FROM public.weinausbau w WHERE w.id = p_weinausbau_id AND w.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Charge nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_w.storniert_am IS NOT NULL OR NOT coalesce(v_w.aktiv, true) THEN
    RAISE EXCEPTION 'Die Charge ist storniert bzw. nicht mehr aktiv.' USING ERRCODE = '22023';
  END IF;
  -- nicht vor die letzte Journalbuchung der Charge (der Bestand zu diesem Tag stünde sonst nicht fest)
  SELECT max(k.datum) INTO v_letzte FROM public.kellerbuch_buchungen k
   WHERE k.tenant_id = p_tenant_id AND k.weinausbau_id = p_weinausbau_id AND k.storno_von_id IS NULL;
  IF v_letzte IS NOT NULL AND v_datum < v_letzte THEN
    RAISE EXCEPTION 'Die Charge hat am % schon eine Bewegung – die Verarbeitung kann frühestens an diesem Tag gebucht werden.',
      to_char(v_letzte, 'DD.MM.YYYY') USING ERRCODE = '22023';
  END IF;
  IF v_menge > coalesce(v_w.menge_liter, 0) + 0.005 THEN
    RAISE EXCEPTION 'Verarbeitung von % L übersteigt den Bestand der Charge „%“ (% L).',
      replace(to_char(v_menge, 'FM999999990.00'), '.', ','), v_w.name,
      replace(to_char(coalesce(v_w.menge_liter, 0), 'FM999999990.00'), '.', ',') USING ERRCODE = '22023';
  END IF;
  v_rest := greatest(coalesce(v_w.menge_liter, 0) - v_menge, 0);
  IF v_rest <= 0.01 THEN
    v_menge := v_menge + v_rest;   -- Restmenge ≤ 0,01 L mit verarbeiten, dann abschließen (wie schwund_buchen)
    v_rest := 0;
  END IF;

  INSERT INTO public.keller_verarbeitungen (tenant_id, weinausbau_id, datum, menge_liter, zweck, notizen, erstellt_von, erstellt_von_name)
  VALUES (p_tenant_id, p_weinausbau_id, v_datum, v_menge, p_zweck, NULLIF(btrim(coalesce(p_notizen, '')), ''), auth.uid(),
          public.s112_storno_benutzername(auth.uid()))
  RETURNING id INTO v_id;
  UPDATE public.weinausbau
     SET menge_liter = v_rest,
         aktiv = CASE WHEN v_rest = 0 THEN false ELSE aktiv END,
         status = CASE WHEN v_rest = 0 THEN 'abgeschlossen' ELSE status END
   WHERE id = p_weinausbau_id;
  IF p_artikel_id IS NOT NULL THEN
    INSERT INTO public.sonstige_artikel_bewegungen (tenant_id, artikel_id, datum, art, menge, keller_verarbeitung_id, notizen,
                                                    erstellt_von, erstellt_von_name)
    VALUES (p_tenant_id, p_artikel_id, v_datum, 'verarbeitung', v_stueck, v_id,
            format('Aus Charge „%s“ (%s L)', v_w.name, replace(to_char(v_menge, 'FM999999990.00'), '.', ',')),
            auth.uid(), public.s112_storno_benutzername(auth.uid()));
  END IF;
  RETURN v_id;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_verarbeitung_buchen(uuid, uuid, date, numeric, text, text, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_verarbeitung_buchen(uuid, uuid, date, numeric, text, text, uuid, numeric) TO authenticated;
COMMENT ON FUNCTION public.s112_verarbeitung_buchen(uuid, uuid, date, numeric, text, text, uuid, numeric) IS
  'KAN-41 Paket 3a / KAN-115: Verarbeitung einer Menge aus einer Charge buchen (Journal AB_VERAR); ganze Menge schließt die Charge ab; optional Zugang beim Sonstigen Produkt (Traubensaft, Essig, Destillat)';

-- Storno der Verarbeitung nimmt den Zugang beim Produkt zurück – abgelehnt, wenn dafür nicht mehr genug auf Lager ist
CREATE OR REPLACE FUNCTION public.s112_verarbeitung_stornieren(p_tenant_id uuid, p_id uuid, p_grund text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_v     public.keller_verarbeitungen%ROWTYPE;
  v_grund text := btrim(coalesce(p_grund, ''));
  v_bis   date;
  v_z     public.sonstige_artikel_bewegungen%ROWTYPE;
  v_name  text;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT (public.ist_service_kontext() OR public.s112_darf_schreiben(p_tenant_id, 'kellerbuch')) THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für das Kellerbuch in diesem Betrieb.' USING ERRCODE = '42501';
  END IF;
  IF length(v_grund) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für das Stornieren angeben (mindestens 10 Zeichen).' USING ERRCODE = '22023';
  END IF;
  v_bis := public.s112_kellerbuch_gesperrt_bis(p_tenant_id);
  IF v_bis IS NOT NULL AND (now() AT TIME ZONE 'Europe/Vienna')::date <= v_bis THEN
    RAISE EXCEPTION 'Das Kellerbuch ist bis % abgeschlossen – Stornieren ist erst danach möglich.',
      to_char(v_bis, 'DD.MM.YYYY') USING ERRCODE = '42501', HINT = 'kellerbuch_abschluss';
  END IF;
  SELECT * INTO v_v FROM public.keller_verarbeitungen v WHERE v.id = p_id AND v.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Verarbeitung nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_v.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Die Verarbeitung ist bereits storniert.' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.weinausbau w WHERE w.id = v_v.weinausbau_id FOR UPDATE;

  -- KAN-115: Zugang beim Produkt zurücknehmen (nur, wenn er noch auf Lager ist)
  SELECT * INTO v_z FROM public.sonstige_artikel_bewegungen b
   WHERE b.keller_verarbeitung_id = p_id AND b.art = 'verarbeitung'
     AND NOT EXISTS (SELECT 1 FROM public.sonstige_artikel_bewegungen s WHERE s.storno_von_id = b.id);
  IF FOUND THEN
    SELECT a.name INTO v_name FROM public.sonstige_artikel a WHERE a.id = v_z.artikel_id FOR UPDATE;
    IF public.s112_artikel_bestand(v_z.artikel_id) < v_z.menge - 0.0005 THEN
      RAISE EXCEPTION 'Von „%“ ist nicht mehr genug auf Lager, um den Zugang aus dieser Verarbeitung zurückzunehmen (schon verkauft). Bitte zuerst den Verkauf stornieren oder den Bestand per Inventur korrigieren.', v_name
        USING ERRCODE = '22023', HINT = 'artikel_bestand';
    END IF;
    INSERT INTO public.sonstige_artikel_bewegungen (tenant_id, artikel_id, datum, art, menge, keller_verarbeitung_id, storno_von_id,
                                                    notizen, erstellt_von, erstellt_von_name)
    VALUES (p_tenant_id, v_z.artikel_id, (now() AT TIME ZONE 'Europe/Vienna')::date, 'storno', -v_z.menge, p_id, v_z.id,
            'Storno der Verarbeitung: ' || v_grund, auth.uid(), public.s112_storno_benutzername(auth.uid()));
  END IF;

  UPDATE public.keller_verarbeitungen
     SET storniert_am = now(), storniert_von = auth.uid(), storniert_von_name = public.s112_storno_benutzername(auth.uid()),
         storno_grund = v_grund
   WHERE id = p_id;
  -- Menge zurück an die Charge; eine durch die Verarbeitung abgeschlossene Charge wird wieder aktiv
  UPDATE public.weinausbau
     SET menge_liter = round(coalesce(menge_liter, 0) + v_v.menge_liter, 2),
         aktiv = true,
         status = CASE WHEN status = 'abgeschlossen' THEN 'ausbau' ELSE status END
   WHERE id = v_v.weinausbau_id;
END
$function$;

-- 5. Nachbesserung KAN-107: Stoffkonto-Buchungen blockieren kein Löschen ihrer Bezüge mehr ────────────────────────
-- Gefunden mit DB-Test 61 (07.10.2026): s112_mandant_loeschen scheiterte mit 23503 an kellermittel_buchungen_keller_behandlung_id_fkey.
-- Die Buchung bleibt (Stoffkonto ist append-only), nur der Verweis wird leer.
ALTER TABLE public.kellermittel_buchungen
  DROP CONSTRAINT kellermittel_buchungen_keller_behandlung_id_fkey,
  DROP CONSTRAINT kellermittel_buchungen_weinausbau_id_fkey,
  DROP CONSTRAINT kellermittel_buchungen_behaelter_id_fkey,
  ADD CONSTRAINT kellermittel_buchungen_keller_behandlung_id_fkey FOREIGN KEY (keller_behandlung_id) REFERENCES public.keller_behandlungen(id) ON DELETE SET NULL,
  ADD CONSTRAINT kellermittel_buchungen_weinausbau_id_fkey FOREIGN KEY (weinausbau_id) REFERENCES public.weinausbau(id) ON DELETE SET NULL,
  ADD CONSTRAINT kellermittel_buchungen_behaelter_id_fkey FOREIGN KEY (behaelter_id) REFERENCES public.behaelter(id) ON DELETE SET NULL;
