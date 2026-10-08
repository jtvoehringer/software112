-- KAN-232 (08.10.2026): Lohnversektung – Grundwein geht außer Haus zur Versektung, Sekt kommt in Flaschen zurück.
-- Entscheidungen Jörgen (08.10.2026):
--   * Der Grundwein bleibt während der Versektung eigener Bestand („Wein bei Dritten“): Der Versand bucht nichts, die
--     Charge behält ihre Menge, gibt aber ihr Gebinde frei (der Wein ist nicht mehr im Keller).
--   * Die Rückkehr ist eine Füllung aus der Grundwein-Charge mit Kennzeichen lohnversektung_id. Das Journal bucht dann
--     LNSKT (Abgang Grundwein, Liter = menge_liter_gefuellt) und LNSKT_ZU (Zugang Sekt in Flaschen) statt FUELLUNG;
--     Mehr- oder Mindermenge (Dosage, Verluste) ist die Differenz der beiden – kein Füllverlust/SCHWUND.
--   * Teillieferungen: mehrere Rückkehr-Füllungen je Versand; abgeschlossen, sobald die Rückkehr-Füllungen den versandten
--     Grundwein vollständig abbuchen (die letzte Lieferung nimmt den Rest der Charge). Storno einer Rückkehr öffnet wieder.
--   * Nur Mengen, keine Lohnkosten. Teilmenge versenden = vorher Umzug in ein eigenes Gebinde (eigene Charge).
--  1. kat_buchungsart += LNSKT (ab), LNSKT_ZU (zu) – interne Codes, BKI-Mapping folgt mit KAN-38.
--  2. lohnversektungen (Versand: Charge, Versekter = Firma, Datum, Liter, Gebinde vorher) – nur über die RPCs.
--  3. fuellungen.lohnversektung_id + Prüf-/Stand-Trigger (Rückkehr nur aus der versandten Charge eines offenen Versands).
--  4. Journal: s112_journal_zeilen_fuellung mit LNSKT/LNSKT_ZU; Genealogie (charge_herkunft): Kante Charge → Sekt-Füllung.
--  5. s112_lohnversektung_versenden / s112_lohnversektung_stornieren; Folgebuchung der Charge.
-- Staging zuerst (sjpeghrlhsowmquacjhb), DB-Test 73, dann Produktion.

-- 1. Buchungsarten ──────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO public.kat_buchungsart (code, bezeichnung, richtung, einheit, bsm, bsm_code, reihenfolge)
VALUES ('LNSKT', 'Abgang zur Lohnversektung', 'ab', 'l', true, NULL, 27),
       ('LNSKT_ZU', 'Zugang aus Lohnversektung', 'zu', 'l', true, NULL, 28);

-- 2. Versand ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.lohnversektungen (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  weinausbau_id         uuid NOT NULL REFERENCES public.weinausbau(id) ON DELETE CASCADE,
  firma_id              uuid REFERENCES public.firmen(id) ON DELETE SET NULL,   -- Pflicht beim Versand (RPC); Firma löschen lässt den Versand stehen
  datum                 date NOT NULL,
  liter_versandt        numeric(10,2) NOT NULL CHECK (liter_versandt > 0),
  behaelter_id_vorher   uuid REFERENCES public.behaelter(id) ON DELETE SET NULL,
  abgeschlossen_am      date,
  notizen               text,
  erstellt_von          uuid,
  erstellt_von_name     text,
  erstellt_am           timestamptz NOT NULL DEFAULT now(),
  storniert_am          timestamptz,
  storniert_von         uuid,
  storniert_von_name    text,
  storno_grund          text
);
CREATE INDEX lohnversektungen_tenant_idx ON public.lohnversektungen (tenant_id, datum);
CREATE INDEX lohnversektungen_charge_idx ON public.lohnversektungen (weinausbau_id);
CREATE INDEX lohnversektungen_firma_idx ON public.lohnversektungen (firma_id);
CREATE UNIQUE INDEX lohnversektungen_offen_je_charge ON public.lohnversektungen (weinausbau_id) WHERE storniert_am IS NULL AND abgeschlossen_am IS NULL;
COMMENT ON TABLE public.lohnversektungen IS
  'KAN-232: Versand einer Grundwein-Charge zur Lohnversektung (bleibt eigener Bestand); Rückkehr = Füllungen mit lohnversektung_id (Journal LNSKT/LNSKT_ZU) – nur über s112_lohnversektung_versenden/_stornieren';

ALTER TABLE public.lohnversektungen ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.lohnversektungen FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.lohnversektungen FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.lohnversektungen FROM authenticated;
CREATE POLICY lohnversektungen_select ON public.lohnversektungen FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY mitgliedschaft_aktiv ON public.lohnversektungen AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY abo_schreibsperre_ins ON public.lohnversektungen AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.lohnversektungen AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.lohnversektungen AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.lohnversektungen AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));
CREATE POLICY keine_direktloeschung ON public.lohnversektungen AS RESTRICTIVE FOR DELETE TO authenticated USING (false);
CREATE TRIGGER a_loeschsperre BEFORE DELETE ON public.lohnversektungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_loeschsperre('storno');
-- KAN-178: Verweise nur in den eigenen Betrieb
CREATE TRIGGER z_fremdverweis_weinausbau_id BEFORE INSERT OR UPDATE OF weinausbau_id, tenant_id ON public.lohnversektungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weinausbau_id', 'weinausbau', '', '', '');
CREATE TRIGGER z_fremdverweis_firma_id BEFORE INSERT OR UPDATE OF firma_id, tenant_id ON public.lohnversektungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('firma_id', 'firmen', '', '', '');
CREATE TRIGGER z_fremdverweis_behaelter_id_vorher BEFORE INSERT OR UPDATE OF behaelter_id_vorher, tenant_id ON public.lohnversektungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('behaelter_id_vorher', 'behaelter', 'keller', '', '');

-- 3. Rückkehr = Füllung mit Kennzeichen ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.fuellungen ADD COLUMN lohnversektung_id uuid REFERENCES public.lohnversektungen(id);
CREATE INDEX fuellungen_lohnversektung_idx ON public.fuellungen (lohnversektung_id) WHERE lohnversektung_id IS NOT NULL;
COMMENT ON COLUMN public.fuellungen.lohnversektung_id IS
  'KAN-232: Rückkehr aus der Lohnversektung (Sekt in Flaschen) – Journal LNSKT/LNSKT_ZU statt FUELLUNG';
CREATE TRIGGER z_fremdverweis_lohnversektung_id BEFORE INSERT OR UPDATE OF lohnversektung_id, tenant_id ON public.fuellungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('lohnversektung_id', 'lohnversektungen', '', '', '');

-- Rückkehr nur aus der versandten Charge eines offenen, nicht stornierten Versands
CREATE FUNCTION public.s112_lohnversektung_rueckkehr_pruefen()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_lv public.lohnversektungen%ROWTYPE;
BEGIN
  IF NEW.lohnversektung_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_lv FROM public.lohnversektungen l WHERE l.id = NEW.lohnversektung_id;
  IF NOT FOUND OR v_lv.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'Lohnversektung nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_lv.storniert_am IS NOT NULL OR v_lv.abgeschlossen_am IS NOT NULL THEN
    RAISE EXCEPTION 'Diese Lohnversektung ist storniert bzw. abgeschlossen – keine weitere Rückkehr möglich.' USING ERRCODE = '22023';
  END IF;
  IF NEW.weinausbau_id IS DISTINCT FROM v_lv.weinausbau_id THEN
    RAISE EXCEPTION 'Die Rückkehr muss aus der versandten Grundwein-Charge gebucht werden.' USING ERRCODE = '22023';
  END IF;
  IF NEW.datum < v_lv.datum THEN
    RAISE EXCEPTION 'Die Rückkehr liegt vor dem Versand (%).', to_char(v_lv.datum, 'DD.MM.YYYY') USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_lohnversektung_rueckkehr_pruefen() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER b_lohnversektung BEFORE INSERT ON public.fuellungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_lohnversektung_rueckkehr_pruefen();

-- Stand: abgeschlossen, sobald die nicht stornierten Rückkehr-Füllungen den versandten Grundwein abbuchen
CREATE FUNCTION public.s112_lohnversektung_stand()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_lv   public.lohnversektungen%ROWTYPE;
  v_summe numeric;
  v_letzt date;
BEGIN
  IF NEW.lohnversektung_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_lv FROM public.lohnversektungen l WHERE l.id = NEW.lohnversektung_id FOR UPDATE;
  IF NOT FOUND OR v_lv.storniert_am IS NOT NULL THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(sum(f.menge_liter_gefuellt), 0), max(f.datum) INTO v_summe, v_letzt
    FROM public.fuellungen f WHERE f.lohnversektung_id = v_lv.id AND f.storniert_am IS NULL;
  UPDATE public.lohnversektungen
     SET abgeschlossen_am = CASE WHEN v_summe >= v_lv.liter_versandt - 0.005 THEN coalesce(abgeschlossen_am, v_letzt) END
   WHERE id = v_lv.id
     AND abgeschlossen_am IS DISTINCT FROM CASE WHEN v_summe >= v_lv.liter_versandt - 0.005 THEN coalesce(abgeschlossen_am, v_letzt) END;
  RETURN NULL;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_lohnversektung_stand() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER z_lohnversektung_stand AFTER INSERT OR UPDATE OF storniert_am, menge_liter_gefuellt ON public.fuellungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_lohnversektung_stand();

-- 4. Journal ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_journal_zeilen_fuellung(f jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_wa   uuid := (f ->> 'weinausbau_id')::uuid;
  v_ml   integer := coalesce(NULLIF((f ->> 'flaschengroesse_ml')::integer, 0), 750);
  v_stk  integer := greatest(coalesce((f ->> 'anzahl_flaschen')::integer, 0), 0);
  v_fl   numeric := round(greatest(coalesce((f ->> 'anzahl_flaschen')::integer, 0), 0) * v_ml / 1000.0, 3);
  v_tank numeric;
  z      jsonb := '[]'::jsonb;
BEGIN
  -- KAN-232: Rückkehr aus der Lohnversektung – Grundwein ab (LNSKT), Sekt in Flaschen zu (LNSKT_ZU); Differenz = Dosage/Verluste
  IF v_wa IS NOT NULL AND NULLIF(f ->> 'lohnversektung_id', '') IS NOT NULL THEN
    v_tank := coalesce((f ->> 'menge_liter_gefuellt')::numeric, v_fl);
    IF v_tank > 0 THEN
      z := z || jsonb_build_object('code', 'LNSKT', 'bestand', 'offen', 'weinausbau_id', v_wa, 'fuellung_id', f ->> 'id', 'liter', -v_tank,
                                   'hinweis', 'Grundwein aus der Lohnversektung zurück (als Sekt)');
    END IF;
    IF v_stk > 0 THEN
      z := z || jsonb_build_object('code', 'LNSKT_ZU', 'bestand', 'flasche', 'fuellung_id', f ->> 'id', 'stk', v_stk, 'liter', v_fl,
                                   'gegen_weinausbau_id', v_wa, 'hinweis', 'Sekt aus der Lohnversektung');
    END IF;
    RETURN z;
  END IF;
  IF v_wa IS NOT NULL THEN
    v_tank := coalesce((f ->> 'menge_liter_gefuellt')::numeric, v_fl);
    IF least(v_fl, v_tank) > 0 THEN
      z := z || jsonb_build_object('code', 'FUELLUNG', 'bestand', 'offen', 'weinausbau_id', v_wa, 'fuellung_id', f ->> 'id', 'liter', -least(v_fl, v_tank));
    END IF;
    IF v_tank - v_fl > 0.0005 THEN
      z := z || jsonb_build_object('code', 'SCHWUND', 'bestand', 'offen', 'weinausbau_id', v_wa, 'fuellung_id', f ->> 'id', 'liter', -(v_tank - v_fl),
                                   'hinweis', 'Füllverlust (Tankabgang − Flascheninhalt)');
    END IF;
    IF v_stk > 0 THEN
      z := z || jsonb_build_object('code', 'FUELLUNG', 'bestand', 'flasche', 'fuellung_id', f ->> 'id', 'stk', v_stk, 'liter', v_fl,
                                   'gegen_weinausbau_id', v_wa);
    END IF;
    RETURN z;
  END IF;
  IF v_stk > 0 THEN
    IF f ->> 'import_quelle' = 'eroeffnungsbestand' THEN
      z := z || jsonb_build_object('code', 'EROEFF', 'bestand', 'flasche', 'fuellung_id', f ->> 'id', 'stk', v_stk, 'liter', v_fl,
                                   'hinweis', 'Eröffnungsbestand Flaschen');
    ELSIF f ->> 'zukauf_posten_id' IS NOT NULL THEN
      z := z || jsonb_build_object('code', 'ZK_FLA', 'bestand', 'flasche', 'fuellung_id', f ->> 'id', 'stk', v_stk, 'liter', v_fl,
                                   'zukauf_posten_id', f ->> 'zukauf_posten_id', 'hinweis', 'Flaschenzukauf (Handelsware)');
    ELSE
      z := z || jsonb_build_object('code', 'ZK_FLA', 'bestand', 'flasche', 'fuellung_id', f ->> 'id', 'stk', v_stk, 'liter', v_fl,
                                   'hinweis', 'Füllung ohne Charge – als Flaschenzukauf gebucht');
    END IF;
  END IF;
  RETURN z;
END;
$function$;

-- Genealogie: LNSKT_ZU mit Gegencharge = Kante Grundwein-Charge → Sekt-Füllung
CREATE OR REPLACE VIEW public.charge_herkunft WITH (security_invoker = true) AS
WITH z AS (
  SELECT k.*, (k.storno_von_id IS NOT NULL) AS gb
    FROM public.kellerbuch_buchungen k
   WHERE k.buchungsart_code IN ('UMZUG', 'FILTRAT', 'VS_ZU', 'VS_AB', 'FUELLUNG')
)
SELECT n.tenant_id, n.beleg_nr, n.datum, n.buchungsart_code AS art,
       CASE WHEN n.bestand = 'offen' THEN n.weinausbau_id END AS nach_weinausbau_id,
       CASE WHEN n.bestand = 'flasche' THEN n.fuellung_id END AS nach_fuellung_id,
       v.weinausbau_id AS von_weinausbau_id,
       NULL::uuid AS zukauf_posten_id,
       round(n.menge_liter * v.menge_liter / NULLIF(sum(v.menge_liter) OVER (PARTITION BY n.id), 0), 3) AS liter,
       n.gb AS gegenbuchung, n.quelle_tabelle, n.quelle_id, n.gruppe_id, n.erstellt_am, n.id AS buchung_id
  FROM z n
  JOIN z v ON v.tenant_id = n.tenant_id AND v.beleg_nr = n.beleg_nr AND v.gb = n.gb AND v.bestand = 'offen'
          AND v.buchungsart_code = CASE n.buchungsart_code WHEN 'VS_ZU' THEN 'VS_AB' ELSE n.buchungsart_code END
          AND sign(v.menge_liter) = -sign(n.menge_liter) AND v.weinausbau_id IS DISTINCT FROM n.weinausbau_id
 WHERE ((n.menge_liter > 0) <> n.gb)
   AND ((n.buchungsart_code IN ('UMZUG', 'FILTRAT', 'VS_ZU') AND n.bestand = 'offen') OR (n.buchungsart_code = 'FUELLUNG' AND n.bestand = 'flasche'))
UNION ALL
SELECT k.tenant_id, k.beleg_nr, k.datum, k.buchungsart_code, k.weinausbau_id, NULL::uuid, k.gegen_weinausbau_id, NULL::uuid,
       k.menge_liter, k.storno_von_id IS NOT NULL, k.quelle_tabelle, k.quelle_id, k.gruppe_id, k.erstellt_am, k.id
  FROM public.kellerbuch_buchungen k
 WHERE k.bestand = 'offen' AND k.buchungsart_code = 'ZU_PROD' AND k.gegen_weinausbau_id IS NOT NULL
UNION ALL
-- KAN-232: Rückkehr aus der Lohnversektung (Grundwein-Charge → Sekt-Füllung)
SELECT k.tenant_id, k.beleg_nr, k.datum, k.buchungsart_code, NULL::uuid, k.fuellung_id, k.gegen_weinausbau_id, NULL::uuid,
       k.menge_liter, k.storno_von_id IS NOT NULL, k.quelle_tabelle, k.quelle_id, k.gruppe_id, k.erstellt_am, k.id
  FROM public.kellerbuch_buchungen k
 WHERE k.bestand = 'flasche' AND k.buchungsart_code = 'LNSKT_ZU' AND k.gegen_weinausbau_id IS NOT NULL
UNION ALL
SELECT k.tenant_id, k.beleg_nr, k.datum, k.buchungsart_code, k.weinausbau_id, NULL::uuid, NULL::uuid, k.zukauf_posten_id,
       k.menge_liter, k.storno_von_id IS NOT NULL, k.quelle_tabelle, k.quelle_id, k.gruppe_id, k.erstellt_am, k.id
  FROM public.kellerbuch_buchungen k
 WHERE k.bestand = 'offen' AND (k.buchungsart_code IN ('ERNTE', 'ZK_TRAUB', 'ZK_MAISC', 'ZK_MOST', 'ZK_FASS', 'EROEFF', 'INV_PLUS')
                                OR (k.buchungsart_code = 'ZU_PROD' AND k.gegen_weinausbau_id IS NULL));
COMMENT ON VIEW public.charge_herkunft IS
  'KAN-192: Genealogie aus dem Bewegungsjournal – Kante von_weinausbau_id → nach_weinausbau_id bzw. nach_fuellung_id je Beleg (Liter anteilig), Wurzeln ohne Quell-Charge (KAN-41: auch ZK_MAISC; KAN-118: Produktion – ZU_PROD je Quelle, Zusatzvolumen als Wurzel; KAN-232: Lohnversektung LNSKT_ZU Charge → Sekt-Füllung); Gegenbuchungen negativ';

-- 5. RPCs ───────────────────────────────────────────────────────────────────────────────────────────────────
-- Versand: ganze Charge (Teilmenge vorher per Umzug in ein eigenes Gebinde), Gebinde wird frei, Menge bleibt
CREATE FUNCTION public.s112_lohnversektung_versenden(p_tenant_id uuid, p_weinausbau_id uuid, p_datum date, p_firma_id uuid, p_notizen text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_heute  date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  v_datum  date := coalesce(p_datum, (now() AT TIME ZONE 'Europe/Vienna')::date);
  v_w      public.weinausbau%ROWTYPE;
  v_bis    date;
  v_letzte date;
  v_id     uuid;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT (public.ist_service_kontext() OR public.s112_darf_schreiben(p_tenant_id, 'kellerbuch')) THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für das Kellerbuch in diesem Betrieb.' USING ERRCODE = '42501';
  END IF;
  IF v_datum > v_heute THEN
    RAISE EXCEPTION 'Das Versanddatum liegt in der Zukunft.' USING ERRCODE = '22023';
  END IF;
  v_bis := public.s112_kellerbuch_gesperrt_bis(p_tenant_id);
  IF v_bis IS NOT NULL AND v_datum <= v_bis THEN
    RAISE EXCEPTION 'Das Kellerbuch ist bis % abgeschlossen – der Versand kann frühestens am % gebucht werden.',
      to_char(v_bis, 'DD.MM.YYYY'), to_char(v_bis + 1, 'DD.MM.YYYY') USING ERRCODE = '42501', HINT = 'kellerbuch_abschluss';
  END IF;
  IF p_firma_id IS NULL THEN
    RAISE EXCEPTION 'Bitte die Sektkellerei (Versekter) angeben.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.firmen f WHERE f.id = p_firma_id AND f.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Sektkellerei nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_w FROM public.weinausbau w WHERE w.id = p_weinausbau_id AND w.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Charge nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_w.storniert_am IS NOT NULL OR NOT coalesce(v_w.aktiv, true) OR coalesce(v_w.menge_liter, 0) < 0.01 THEN
    RAISE EXCEPTION 'Die Charge „%“ ist storniert, abgeschlossen oder leer.', v_w.name USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lohnversektungen l WHERE l.weinausbau_id = v_w.id AND l.storniert_am IS NULL AND l.abgeschlossen_am IS NULL) THEN
    RAISE EXCEPTION 'Die Charge „%“ ist bereits in Lohnversektung.', v_w.name USING ERRCODE = '22023';
  END IF;
  SELECT max(k.datum) INTO v_letzte FROM public.kellerbuch_buchungen k
   WHERE k.tenant_id = p_tenant_id AND k.weinausbau_id = v_w.id AND k.storno_von_id IS NULL;
  IF v_letzte IS NOT NULL AND v_datum < v_letzte THEN
    RAISE EXCEPTION 'Die Charge „%“ hat am % schon eine Bewegung – der Versand kann frühestens an diesem Tag gebucht werden.',
      v_w.name, to_char(v_letzte, 'DD.MM.YYYY') USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.lohnversektungen (tenant_id, weinausbau_id, firma_id, datum, liter_versandt, behaelter_id_vorher, notizen,
                                       erstellt_von, erstellt_von_name)
  VALUES (p_tenant_id, v_w.id, p_firma_id, v_datum, round(v_w.menge_liter, 2), v_w.behaelter_id,
          NULLIF(btrim(coalesce(p_notizen, '')), ''), auth.uid(), public.s112_storno_benutzername(auth.uid()))
  RETURNING id INTO v_id;
  -- Der Wein ist außer Haus: Gebinde frei, Menge und Charge bleiben (eigener Bestand bei Dritten)
  UPDATE public.weinausbau SET behaelter_id = NULL WHERE id = v_w.id;
  RETURN v_id;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_lohnversektung_versenden(uuid, uuid, date, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_lohnversektung_versenden(uuid, uuid, date, uuid, text) TO authenticated;
COMMENT ON FUNCTION public.s112_lohnversektung_versenden(uuid, uuid, date, uuid, text) IS
  'KAN-232: Grundwein-Charge zur Lohnversektung versenden – bleibt eigener Bestand, Gebinde wird frei; Rückkehr als Füllung mit lohnversektung_id';

-- Storno des Versands: nur ohne (nicht stornierte) Rückkehr; die Charge kommt in ihr Gebinde zurück
CREATE FUNCTION public.s112_lohnversektung_stornieren(p_tenant_id uuid, p_id uuid, p_grund text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_lv    public.lohnversektungen%ROWTYPE;
  v_grund text := btrim(coalesce(p_grund, ''));
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT (public.ist_service_kontext() OR public.s112_darf_schreiben(p_tenant_id, 'kellerbuch')) THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für das Kellerbuch in diesem Betrieb.' USING ERRCODE = '42501';
  END IF;
  IF length(v_grund) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für das Stornieren angeben (mindestens 10 Zeichen).' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_lv FROM public.lohnversektungen l WHERE l.id = p_id AND l.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lohnversektung nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_lv.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Die Lohnversektung ist bereits storniert.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.fuellungen f WHERE f.lohnversektung_id = p_id AND f.storniert_am IS NULL) THEN
    RAISE EXCEPTION 'Es gibt schon eine Rückkehr (Füllung) – bitte zuerst diese stornieren.' USING ERRCODE = '22023', HINT = 'lohnversektung_rueckkehr';
  END IF;
  IF v_lv.behaelter_id_vorher IS NOT NULL AND NOT public.behaelter_nutzbar(v_lv.behaelter_id_vorher, p_tenant_id) THEN
    RAISE EXCEPTION 'Das frühere Gebinde ist inzwischen belegt oder nicht nutzbar – bitte zuerst freimachen.' USING ERRCODE = '22023',
      HINT = 'lohnversektung_gebinde';
  END IF;
  UPDATE public.lohnversektungen
     SET storniert_am = now(), storniert_von = auth.uid(), storniert_von_name = public.s112_storno_benutzername(auth.uid()), storno_grund = v_grund
   WHERE id = p_id;
  UPDATE public.weinausbau SET behaelter_id = v_lv.behaelter_id_vorher
   WHERE id = v_lv.weinausbau_id AND behaelter_id IS NULL;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_lohnversektung_stornieren(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_lohnversektung_stornieren(uuid, uuid, text) TO authenticated;
COMMENT ON FUNCTION public.s112_lohnversektung_stornieren(uuid, uuid, text) IS
  'KAN-232: Versand zur Lohnversektung stornieren – nur ohne Rückkehr; Charge zurück ins frühere Gebinde';

-- Eine offene Lohnversektung ist eine Folgebuchung der Charge (z. B. Storno einer Produktion, die sie erzeugt hat)
CREATE OR REPLACE FUNCTION public.s112_charge_hat_folgebuchung(p_charge uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.keller_umzuege u WHERE u.storniert_am IS NULL AND (u.von_weinausbau_id = p_charge OR u.nach_weinausbau_id = p_charge))
      OR EXISTS (SELECT 1 FROM public.verschneidung_quellen q JOIN public.verschneidungen v ON v.id = q.verschneidung_id
                  WHERE q.quell_weinausbau_id = p_charge AND v.storniert_am IS NULL)
      OR EXISTS (SELECT 1 FROM public.verschneidungen v WHERE v.ziel_weinausbau_id = p_charge AND v.storniert_am IS NULL)
      OR EXISTS (SELECT 1 FROM public.fuellungen f WHERE f.weinausbau_id = p_charge AND f.aktiv)
      OR EXISTS (SELECT 1 FROM public.fuellung_chargen fc JOIN public.fuellungen f ON f.id = fc.fuellung_id WHERE fc.weinausbau_id = p_charge AND f.aktiv)
      OR EXISTS (SELECT 1 FROM public.verkauf_positionen vp JOIN public.verkaufsposten k ON k.id = vp.verkaufsposten_id
                  WHERE vp.weinausbau_id = p_charge AND vp.typ = 'tank' AND NOT coalesce(k.storniert, false))
      OR EXISTS (SELECT 1 FROM public.keller_behandlungen b WHERE b.weinausbau_id = p_charge AND b.storniert_am IS NULL)
      OR EXISTS (SELECT 1 FROM public.weinanalysen a WHERE a.weinausbau_id = p_charge)
      OR EXISTS (SELECT 1 FROM public.dac_antrag d WHERE d.weinausbau_id = p_charge)
      OR EXISTS (SELECT 1 FROM public.zukauf_posten z WHERE z.ziel_weinausbau_id = p_charge AND z.aktiv)
      OR EXISTS (SELECT 1 FROM public.keller_verarbeitungen kv WHERE kv.weinausbau_id = p_charge AND kv.storniert_am IS NULL)
      OR EXISTS (SELECT 1 FROM public.keller_zugangskorrekturen zk WHERE zk.weinausbau_id = p_charge AND zk.storniert_am IS NULL)
      -- KAN-118: Quelle einer (nicht stornierten) Produktion
      OR EXISTS (SELECT 1 FROM public.produktion_eingaenge pe JOIN public.produktionen p ON p.id = pe.produktion_id
                  WHERE pe.weinausbau_id = p_charge AND p.storniert_am IS NULL)
      -- KAN-232: in (nicht stornierter) Lohnversektung
      OR EXISTS (SELECT 1 FROM public.lohnversektungen l WHERE l.weinausbau_id = p_charge AND l.storniert_am IS NULL)
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_charge_hat_folgebuchung(uuid) FROM PUBLIC, anon, authenticated;
