-- KAN-99 (04.10.2026): Prüfnummer je Charge – Gültigkeitszeitraum und Weitergabe über Umzug/Filtration.
-- R3 „prüfnummer ist vergeben, änderung passiert: warnung prüfnummer wird entzogen …“. Rechtlich entzieht das Bundesamt
-- die Nummer; die Software kennzeichnet intern „gilt für den Tankbestand nicht mehr“, abgefüllte Flaschen behalten sie.
-- Entscheidungen Jörgen (04.10.2026):
--   * Teilumzug in ein leeres Gebinde: die Nummer gilt für beide Teile, die Mengenregel rechnet über alle Chargen
--     desselben Antrags zusammen (App).
--   * Ende automatisch beim Vorgang: Verschnitt, Zusammenführung per Umzug, Zukauf bzw. Pressung in die Charge beenden
--     die Gültigkeit mit Datum und Vorgang (die Rückfrage aus KAN-83 bleibt); Endstatus bzw. Storno des Antrags
--     beenden sie für alle Chargen. Storno des auslösenden Vorgangs nimmt das Ende bzw. die Weitergabe zurück.
--
--  1. Tabelle pruefnummer_chargen (Antrag × Charge, gueltig_ab/bis, ende_grund, ende_vorgang, Herkunft der Weitergabe).
--     Nur Lesen per API; geschrieben wird ausschließlich vom Trigger s112_pn_chargen_pflegen (SECURITY DEFINER).
--  2. pruefnummer_ereignisse: Ereignisse 'charge_weitergabe', 'charge_ende', 'charge_wieder'.
--  3. s112_pn_chargen_pflegen auf dac_antrag (Einreichen → Zeile, Endstatus/Storno → Ende), keller_umzuege (Ziel-Zeile:
--     neue Charge erbt, bestehende Charge endet; Storno nimmt zurück), verschneidungen, zukauf_posten,
--     pressung_behaelter (Zugang → Ende; Storno nimmt zurück).
--  4. Bestand: eingereichte/zugeteilte Anträge mit Charge bekommen ihre Zeile (gültig ab Einreichung).
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- 1. Tabelle ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.pruefnummer_chargen (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  dac_antrag_id        uuid NOT NULL REFERENCES public.dac_antrag(id) ON DELETE CASCADE,
  weinausbau_id        uuid NOT NULL REFERENCES public.weinausbau(id) ON DELETE CASCADE,
  gueltig_ab           date NOT NULL,
  gueltig_bis          date,
  ende_grund           text CHECK (ende_grund IS NULL OR ende_grund IN
                         ('verschnitt', 'zugang', 'zukauf', 'pressung', 'abgelehnt', 'zurueckgezogen', 'erloschen', 'entzogen', 'aufgebraucht', 'storno')),
  ende_vorgang         text,
  quelle_weinausbau_id uuid REFERENCES public.weinausbau(id) ON DELETE SET NULL,
  quelle_vorgang       text,
  erstellt_am          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pruefnummer_chargen_eindeutig UNIQUE (dac_antrag_id, weinausbau_id),
  CONSTRAINT pruefnummer_chargen_ende_chk CHECK ((gueltig_bis IS NULL) = (ende_grund IS NULL) AND (gueltig_bis IS NULL OR gueltig_bis >= gueltig_ab))
);
CREATE INDEX pruefnummer_chargen_charge_idx ON public.pruefnummer_chargen (weinausbau_id);
CREATE INDEX pruefnummer_chargen_tenant_idx ON public.pruefnummer_chargen (tenant_id);
CREATE INDEX pruefnummer_chargen_quelle_idx ON public.pruefnummer_chargen (quelle_weinausbau_id) WHERE quelle_weinausbau_id IS NOT NULL;
COMMENT ON TABLE public.pruefnummer_chargen IS
  'KAN-99: Gültigkeit einer Prüfnummer (DAC-Antrag) je Charge für den Tankbestand – nur per Trigger s112_pn_chargen_pflegen';

ALTER TABLE public.pruefnummer_chargen ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.pruefnummer_chargen FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.pruefnummer_chargen FROM anon;
CREATE POLICY pn_chargen_select ON public.pruefnummer_chargen FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY mitgliedschaft_aktiv ON public.pruefnummer_chargen AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY abo_schreibsperre_ins ON public.pruefnummer_chargen AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.pruefnummer_chargen AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.pruefnummer_chargen AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.pruefnummer_chargen AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));

-- KAN-178: Verweise nur in den eigenen Betrieb
CREATE TRIGGER z_fremdverweis_dac_antrag_id BEFORE INSERT OR UPDATE OF dac_antrag_id, tenant_id ON public.pruefnummer_chargen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('dac_antrag_id', 'dac_antrag', '', '', '');
CREATE TRIGGER z_fremdverweis_weinausbau_id BEFORE INSERT OR UPDATE OF weinausbau_id, tenant_id ON public.pruefnummer_chargen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weinausbau_id', 'weinausbau', '', '', '');
CREATE TRIGGER z_fremdverweis_quelle_weinausbau_id BEFORE INSERT OR UPDATE OF quelle_weinausbau_id, tenant_id ON public.pruefnummer_chargen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('quelle_weinausbau_id', 'weinausbau', '', '', '');

-- 2. Ereignisse ─────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_name text;
BEGIN
  SELECT c.conname INTO v_name FROM pg_constraint c
   WHERE c.conrelid = 'public.pruefnummer_ereignisse'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%ereignis%';
  EXECUTE format('ALTER TABLE public.pruefnummer_ereignisse DROP CONSTRAINT %I', v_name);
END $$;
ALTER TABLE public.pruefnummer_ereignisse ADD CONSTRAINT pruefnummer_ereignisse_ereignis_check
  CHECK (ereignis IN ('status', 'charge_weitergabe', 'charge_ende', 'charge_wieder'));

-- Erster Zugang in eine Charge NACH einem Tag (am Tag selbst gilt als davor, wie KAN-72): Verschnitt, Zukauf, Pressung
-- oder Umzug aus einer anderen Charge – für Anträge, die nach dem Vorgang angelegt bzw. eingereicht werden.
CREATE OR REPLACE FUNCTION public.s112_pn_erstes_ende(p_charge uuid, p_ab date)
RETURNS TABLE (datum date, grund text, vorgang text)
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT x.d, x.g, x.v FROM (
    SELECT v.datum::date AS d, 'verschnitt' AS g, 'verschneidungen:' || v.id AS v
      FROM public.verschneidungen v WHERE v.ziel_weinausbau_id = p_charge AND v.storniert_am IS NULL AND v.datum::date > p_ab
    UNION ALL
    SELECT z.datum::date, 'zukauf', 'zukauf_posten:' || z.id
      FROM public.zukauf_posten z WHERE z.ziel_weinausbau_id = p_charge AND z.storniert_am IS NULL AND z.datum::date > p_ab
    UNION ALL
    SELECT p.datum::date, 'pressung', 'pressung_behaelter:' || pb.id
      FROM public.pressung_behaelter pb JOIN public.pressungen p ON p.id = pb.pressung_id
     WHERE pb.weinausbau_id = p_charge AND pb.storniert_am IS NULL AND p.datum::date > p_ab
    UNION ALL
    SELECT k.datum::date, 'zugang', 'keller_umzuege:' || k.id
      FROM public.keller_umzuege k
     WHERE k.nach_weinausbau_id = p_charge AND k.zeilen_typ IS DISTINCT FROM 'quelle' AND k.storniert_am IS NULL AND k.datum::date > p_ab
       AND (coalesce(k.von_weinausbau_id, p_charge) <> p_charge
            OR EXISTS (SELECT 1 FROM public.keller_umzuege q
                        WHERE k.umzug_batch_id IS NOT NULL AND q.umzug_batch_id = k.umzug_batch_id AND q.zeilen_typ = 'quelle'
                          AND q.storniert_am IS NULL AND q.von_weinausbau_id IS DISTINCT FROM p_charge))
  ) x
  ORDER BY x.d, x.g
  LIMIT 1
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_pn_erstes_ende(uuid, date) FROM PUBLIC, anon, authenticated;

-- 3. Pflege ─────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_pn_chargen_pflegen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  c_ende_status constant text[] := ARRAY['abgelehnt', 'zurueckgezogen', 'erloschen', 'entzogen', 'aufgebraucht'];
  v_ziel     uuid;
  v_datum    date;
  v_vorgang  text;
  v_grund    text;
  v_quellen  uuid[];
  v_neu      boolean;
  v_w        public.weinausbau%ROWTYPE;
  r          record;
  v_uid      uuid := auth.uid();
BEGIN
  -- ── DAC-Antrag: Einreichen legt die Zeile an, Endstatus bzw. Storno beenden alle Zeilen ──
  IF TG_TABLE_NAME = 'dac_antrag' THEN
    -- direkt angelegte Anträge (Wartung, Demo, Import) mit Status ab „Eingereicht“ ebenso
    IF TG_OP = 'INSERT' THEN
      IF NEW.storniert_am IS NULL AND NEW.weinausbau_id IS NOT NULL AND NEW.status IN ('eingereicht', 'in_pruefung', 'genehmigt') THEN
        INSERT INTO public.pruefnummer_chargen (tenant_id, dac_antrag_id, weinausbau_id, gueltig_ab)
        VALUES (NEW.tenant_id, NEW.id, NEW.weinausbau_id, coalesce(NEW.eingereicht_am, NEW.bescheid_am, (NEW.created_at AT TIME ZONE 'Europe/Vienna')::date, current_date))
        ON CONFLICT (dac_antrag_id, weinausbau_id) DO NOTHING;
      -- schon vorhandene Zugänge nach dem Beginn beenden die Gültigkeit sofort
      UPDATE public.pruefnummer_chargen pc SET gueltig_bis = e.datum, ende_grund = e.grund, ende_vorgang = e.vorgang
        FROM public.s112_pn_erstes_ende(NEW.weinausbau_id, (SELECT q.gueltig_ab FROM public.pruefnummer_chargen q WHERE q.dac_antrag_id = NEW.id AND q.weinausbau_id = NEW.weinausbau_id)) e
       WHERE pc.dac_antrag_id = NEW.id AND pc.weinausbau_id = NEW.weinausbau_id AND pc.gueltig_bis IS NULL;
      END IF;
      RETURN NULL;
    END IF;
    IF NEW.storniert_am IS NULL AND NEW.status = 'eingereicht' AND OLD.status IS DISTINCT FROM 'eingereicht'
       AND NEW.weinausbau_id IS NOT NULL THEN
      INSERT INTO public.pruefnummer_chargen (tenant_id, dac_antrag_id, weinausbau_id, gueltig_ab)
      VALUES (NEW.tenant_id, NEW.id, NEW.weinausbau_id, coalesce(NEW.eingereicht_am, current_date))
      ON CONFLICT (dac_antrag_id, weinausbau_id) DO NOTHING;
      -- schon vorhandene Zugänge nach dem Beginn beenden die Gültigkeit sofort
      UPDATE public.pruefnummer_chargen pc SET gueltig_bis = e.datum, ende_grund = e.grund, ende_vorgang = e.vorgang
        FROM public.s112_pn_erstes_ende(NEW.weinausbau_id, (SELECT q.gueltig_ab FROM public.pruefnummer_chargen q WHERE q.dac_antrag_id = NEW.id AND q.weinausbau_id = NEW.weinausbau_id)) e
       WHERE pc.dac_antrag_id = NEW.id AND pc.weinausbau_id = NEW.weinausbau_id AND pc.gueltig_bis IS NULL;
    END IF;
    IF (NEW.status = ANY (c_ende_status) AND NOT (OLD.status = ANY (c_ende_status)))
       OR (NEW.storniert_am IS NOT NULL AND OLD.storniert_am IS NULL) THEN
      v_grund := CASE WHEN NEW.storniert_am IS NOT NULL AND OLD.storniert_am IS NULL THEN 'storno' ELSE NEW.status END;
      v_datum := coalesce(CASE WHEN v_grund = 'entzogen' THEN NEW.entzug_am END, current_date);
      UPDATE public.pruefnummer_chargen pc
         SET gueltig_bis = greatest(v_datum, pc.gueltig_ab), ende_grund = v_grund, ende_vorgang = 'dac_antrag:' || NEW.id
       WHERE pc.dac_antrag_id = NEW.id AND pc.gueltig_bis IS NULL;
    END IF;
    RETURN NULL;
  END IF;

  -- ── Vorgänge mit einer Ziel-Charge ──
  IF TG_TABLE_NAME = 'keller_umzuege' THEN
    IF NEW.nach_weinausbau_id IS NULL OR NEW.zeilen_typ = 'quelle' THEN RETURN NULL; END IF;
    v_ziel := NEW.nach_weinausbau_id;  v_grund := 'zugang';
  ELSIF TG_TABLE_NAME = 'verschneidungen' THEN
    v_ziel := NEW.ziel_weinausbau_id;  v_grund := 'verschnitt';
  ELSIF TG_TABLE_NAME = 'zukauf_posten' THEN
    v_ziel := NEW.ziel_weinausbau_id;  v_grund := 'zukauf';
  ELSIF TG_TABLE_NAME = 'pressung_behaelter' THEN
    v_ziel := NEW.weinausbau_id;  v_grund := 'pressung';
  ELSE
    RETURN NULL;
  END IF;
  IF v_ziel IS NULL THEN RETURN NULL; END IF;
  v_vorgang := TG_TABLE_NAME || ':' || NEW.id;

  -- Storno des Vorgangs: Weitergabe entfernen, beendete Gültigkeit wieder öffnen
  IF TG_OP = 'UPDATE' THEN
    IF NEW.storniert_am IS NOT NULL AND OLD.storniert_am IS NULL THEN
      FOR r IN DELETE FROM public.pruefnummer_chargen pc WHERE pc.quelle_vorgang = v_vorgang RETURNING pc.* LOOP
        INSERT INTO public.pruefnummer_ereignisse (tenant_id, dac_antrag_id, weinausbau_id, ereignis, datum, grund, benutzer_id)
        VALUES (r.tenant_id, r.dac_antrag_id, r.weinausbau_id, 'charge_wieder', current_date, 'Weitergabe zurückgenommen (Storno ' || v_vorgang || ')', v_uid);
      END LOOP;
      FOR r IN UPDATE public.pruefnummer_chargen pc SET gueltig_bis = NULL, ende_grund = NULL, ende_vorgang = NULL
                WHERE pc.ende_vorgang = v_vorgang RETURNING pc.* LOOP
        INSERT INTO public.pruefnummer_ereignisse (tenant_id, dac_antrag_id, weinausbau_id, ereignis, datum, grund, benutzer_id)
        VALUES (r.tenant_id, r.dac_antrag_id, r.weinausbau_id, 'charge_wieder', current_date, 'Gültigkeit wieder offen (Storno ' || v_vorgang || ')', v_uid);
      END LOOP;
    END IF;
    RETURN NULL;
  END IF;

  -- INSERT: Datum des Vorgangs
  v_datum := coalesce(CASE TG_TABLE_NAME
                        WHEN 'pressung_behaelter' THEN (SELECT p.datum FROM public.pressungen p WHERE p.id = (to_jsonb(NEW) ->> 'pressung_id')::uuid)
                        ELSE (to_jsonb(NEW) ->> 'datum')::date END, current_date);

  IF TG_TABLE_NAME = 'keller_umzuege' THEN
    -- Quellen des Umzugs: Quelle-Zeilen desselben Batches bzw. von_weinausbau_id (ältere Zeilen)
    SELECT array_agg(DISTINCT q) INTO v_quellen FROM (
      SELECT k.von_weinausbau_id AS q FROM public.keller_umzuege k
       WHERE NEW.umzug_batch_id IS NOT NULL AND k.umzug_batch_id = NEW.umzug_batch_id AND k.zeilen_typ = 'quelle'
         AND k.storniert_am IS NULL AND k.von_weinausbau_id IS NOT NULL
      UNION SELECT NEW.von_weinausbau_id WHERE NEW.von_weinausbau_id IS NOT NULL) x;
    v_quellen := array_remove(coalesce(v_quellen, '{}'), v_ziel);
    IF cardinality(v_quellen) = 0 THEN RETURN NULL; END IF;   -- Umzug innerhalb derselben Charge

    SELECT * INTO v_w FROM public.weinausbau w WHERE w.id = v_ziel;
    v_neu := NOT coalesce(v_w.ist_eroeffnungsbestand, false) AND coalesce(v_w.anfangsbestand_liter, 0) = 0
      AND NOT EXISTS (SELECT 1 FROM public.keller_umzuege k WHERE k.nach_weinausbau_id = v_ziel AND k.id <> NEW.id AND k.storniert_am IS NULL)
      AND NOT EXISTS (SELECT 1 FROM public.verschneidungen v WHERE v.ziel_weinausbau_id = v_ziel AND v.storniert_am IS NULL)
      AND NOT EXISTS (SELECT 1 FROM public.zukauf_posten z WHERE z.ziel_weinausbau_id = v_ziel AND z.storniert_am IS NULL)
      AND NOT EXISTS (SELECT 1 FROM public.pressung_behaelter p WHERE p.weinausbau_id = v_ziel AND p.storniert_am IS NULL)
      AND NOT EXISTS (SELECT 1 FROM public.pruefnummer_chargen pc WHERE pc.weinausbau_id = v_ziel);

    IF v_neu THEN
      -- Neue Charge (leeres Gebinde): sie erbt jede Nummer, die für ALLE Quellen am Umzugstag gilt
      FOR r IN
        SELECT pc.dac_antrag_id, min(pc.tenant_id::text)::uuid AS tenant_id, min(pc.weinausbau_id::text)::uuid AS quelle
          FROM public.pruefnummer_chargen pc
         WHERE pc.weinausbau_id = ANY (v_quellen) AND pc.gueltig_ab <= v_datum AND (pc.gueltig_bis IS NULL OR pc.gueltig_bis >= v_datum)
         GROUP BY pc.dac_antrag_id
        HAVING count(DISTINCT pc.weinausbau_id) = cardinality(v_quellen)
      LOOP
        INSERT INTO public.pruefnummer_chargen (tenant_id, dac_antrag_id, weinausbau_id, gueltig_ab, quelle_weinausbau_id, quelle_vorgang)
        VALUES (r.tenant_id, r.dac_antrag_id, v_ziel, v_datum, r.quelle, v_vorgang)
        ON CONFLICT (dac_antrag_id, weinausbau_id) DO NOTHING;
        INSERT INTO public.pruefnummer_ereignisse (tenant_id, dac_antrag_id, weinausbau_id, ereignis, datum, grund, benutzer_id)
        VALUES (r.tenant_id, r.dac_antrag_id, v_ziel, 'charge_weitergabe', v_datum, 'Umzug in ein leeres Gebinde (' || v_vorgang || ')', v_uid);
      END LOOP;
      RETURN NULL;
    END IF;
  END IF;

  -- Zugang in eine bestehende Charge: ihre Gültigkeit endet – außer bei einem Umzug, dessen Quellen alle dieselbe
  -- Nummer tragen (Teile desselben Antrags werden wieder zusammengeführt)
  FOR r IN
    UPDATE public.pruefnummer_chargen pc
       SET gueltig_bis = greatest(v_datum, pc.gueltig_ab), ende_grund = v_grund, ende_vorgang = v_vorgang
     WHERE pc.weinausbau_id = v_ziel AND pc.gueltig_bis IS NULL AND pc.gueltig_ab <= v_datum
       AND NOT (TG_TABLE_NAME = 'keller_umzuege' AND (
             SELECT count(DISTINCT q.weinausbau_id) FROM public.pruefnummer_chargen q
              WHERE q.dac_antrag_id = pc.dac_antrag_id AND q.weinausbau_id = ANY (v_quellen)
                AND q.gueltig_ab <= v_datum AND (q.gueltig_bis IS NULL OR q.gueltig_bis >= v_datum)) = cardinality(v_quellen))
    RETURNING pc.*
  LOOP
    INSERT INTO public.pruefnummer_ereignisse (tenant_id, dac_antrag_id, weinausbau_id, ereignis, datum, grund, benutzer_id)
    VALUES (r.tenant_id, r.dac_antrag_id, r.weinausbau_id, 'charge_ende', v_datum, 'Für den Tankbestand erloschen: ' || v_grund || ' (' || v_vorgang || ')', v_uid);
  END LOOP;
  RETURN NULL;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_pn_chargen_pflegen() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER z_pn_chargen AFTER INSERT OR UPDATE OF status, storniert_am ON public.dac_antrag
  FOR EACH ROW EXECUTE FUNCTION public.s112_pn_chargen_pflegen();
CREATE TRIGGER z_pn_chargen AFTER INSERT OR UPDATE OF storniert_am ON public.keller_umzuege
  FOR EACH ROW EXECUTE FUNCTION public.s112_pn_chargen_pflegen();
CREATE TRIGGER z_pn_chargen AFTER INSERT OR UPDATE OF storniert_am ON public.verschneidungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_pn_chargen_pflegen();
CREATE TRIGGER z_pn_chargen AFTER INSERT OR UPDATE OF storniert_am ON public.zukauf_posten
  FOR EACH ROW EXECUTE FUNCTION public.s112_pn_chargen_pflegen();
CREATE TRIGGER z_pn_chargen AFTER INSERT OR UPDATE OF storniert_am ON public.pressung_behaelter
  FOR EACH ROW EXECUTE FUNCTION public.s112_pn_chargen_pflegen();

-- 4. Bestand ────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO public.pruefnummer_chargen (tenant_id, dac_antrag_id, weinausbau_id, gueltig_ab)
SELECT a.tenant_id, a.id, a.weinausbau_id, coalesce(a.eingereicht_am, a.bescheid_am, (a.created_at AT TIME ZONE 'Europe/Vienna')::date)
  FROM public.dac_antrag a
 WHERE a.storniert_am IS NULL AND a.weinausbau_id IS NOT NULL AND a.status IN ('eingereicht', 'in_pruefung', 'genehmigt')
ON CONFLICT (dac_antrag_id, weinausbau_id) DO NOTHING;
UPDATE public.pruefnummer_chargen pc SET gueltig_bis = x.datum, ende_grund = x.grund, ende_vorgang = x.vorgang
  FROM (SELECT q.id, e.datum, e.grund, e.vorgang FROM public.pruefnummer_chargen q
          CROSS JOIN LATERAL public.s112_pn_erstes_ende(q.weinausbau_id, q.gueltig_ab) e WHERE q.gueltig_bis IS NULL) x
 WHERE pc.id = x.id;
