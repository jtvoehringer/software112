-- KAN-82 (05.10.2026): Aktion „Abstufen“ an der Charge und im Kellerplan – Datum, Menge, neue Qualität/Herkunft/
-- Zusatzbezeichnung (nur niedriger), Pflichtgrund, Protokoll.
-- Entscheidungen Jörgen (05.10.2026):
--   * Teilmenge nur zusammen mit einem Umzug in ein leeres Gebinde: Die App bucht erst den Umzug (neue Charge), dann
--     stuft diese RPC die neue Charge ab (quelle_weinausbau_id = Ausgangscharge). Die ganze Charge wird an Ort und Stelle
--     abgestuft.
--   * Rückdatieren erlaubt, nicht in die Zukunft und nicht in einen abgeschlossenen Kellerbuch-Zeitraum (KAN-192);
--     technisch zusätzlich nicht vor die letzte Journalbuchung der Charge (sonst trügen spätere Bewegungen alte Merkmale).
--
--  1. charge_umstufungen: je Abstufung Datum, Menge, alt → neu (Qualität, Zusatz, Erzeugnis, Herkunft), Grund, Benutzer –
--     per API nur lesbar, geschrieben nur von s112_charge_abstufen.
--  2. s112_journal_umstufung: Umstufungspaar mit dem Datum der Abstufung (s112.umstufung_datum) und dem Grund im Hinweis.
--  3. s112_pn_chargen_pflegen: Ende der Prüfnummer (KAN-100, Abstufung) am Datum der Abstufung.
--  4. RPC s112_charge_abstufen: prüft Betrieb, Abo, Schreibmodul Kellerbuch, Grund, Datum und Periodensperre; ändert die
--     Merkmale der Charge (Änderungsprotokoll mit Grund über s112.aenderung_grund) und schreibt die Zeile in (1).
--     Dass die neue Angabe nicht höher ist (keine Aufwertung), prüft die Server Action mit der Rangfolge aus
--     lib/wein/qualitaetsrang.ts – wie updateWeinausbau (KAN-80); die Charge selbst ist per API ohnehin änderbar.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- 1. Tabelle ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.charge_umstufungen (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  weinausbau_id         uuid NOT NULL REFERENCES public.weinausbau(id) ON DELETE CASCADE,
  quelle_weinausbau_id  uuid REFERENCES public.weinausbau(id) ON DELETE SET NULL,
  datum                 date NOT NULL,
  menge_liter           numeric(14,3) NOT NULL CHECK (menge_liter >= 0),
  alt_qualitaetsstufe   text,
  alt_zusatzbezeichnung text,
  alt_erzeugnis         text,
  alt_herkunft_code     text,
  neu_qualitaetsstufe   text,
  neu_zusatzbezeichnung text,
  neu_erzeugnis         text,
  neu_herkunft_code     text,
  grund                 text NOT NULL CHECK (length(btrim(grund)) >= 10),
  erstellt_von          uuid,
  erstellt_von_name     text,
  erstellt_am           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX charge_umstufungen_charge_idx ON public.charge_umstufungen (weinausbau_id, datum);
CREATE INDEX charge_umstufungen_tenant_idx ON public.charge_umstufungen (tenant_id);
CREATE INDEX charge_umstufungen_quelle_idx ON public.charge_umstufungen (quelle_weinausbau_id) WHERE quelle_weinausbau_id IS NOT NULL;
COMMENT ON TABLE public.charge_umstufungen IS
  'KAN-82: Abstufungen einer Charge (Datum, Menge, alt → neu, Grund, Benutzer) – nur über s112_charge_abstufen';

ALTER TABLE public.charge_umstufungen ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.charge_umstufungen FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.charge_umstufungen FROM anon;
CREATE POLICY umstufungen_select ON public.charge_umstufungen FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY mitgliedschaft_aktiv ON public.charge_umstufungen AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY abo_schreibsperre_ins ON public.charge_umstufungen AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.charge_umstufungen AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.charge_umstufungen AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.charge_umstufungen AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));

-- KAN-178: Verweise nur in den eigenen Betrieb
CREATE TRIGGER z_fremdverweis_weinausbau_id BEFORE INSERT OR UPDATE OF weinausbau_id, tenant_id ON public.charge_umstufungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weinausbau_id', 'weinausbau', '', '', '');
CREATE TRIGGER z_fremdverweis_quelle_weinausbau_id BEFORE INSERT OR UPDATE OF quelle_weinausbau_id, tenant_id ON public.charge_umstufungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('quelle_weinausbau_id', 'weinausbau', '', '', '');

-- 2. Journal ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_journal_umstufung(p_tenant_id uuid, p_bestand text, p_id uuid, p_alt jsonb, p_neu jsonb,
  p_ohne_quelle text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ab     date := public.s112_journal_ab(p_tenant_id);
  v_l      numeric;
  v_stk    integer;
  v_beleg  integer;
  v_tag    date;
  v_tab    text := CASE WHEN p_bestand = 'offen' THEN 'weinausbau_merkmale' ELSE 'fuellungen_merkmale' END;
  v_bez    text;
  v_most_a boolean := coalesce(p_alt ->> 'charge_status', '') IN ('ernte', 'gaerung');
  v_most_n boolean := coalesce(p_neu ->> 'charge_status', '') IN ('ernte', 'gaerung');
BEGIN
  IF v_ab IS NULL OR p_id IS NULL THEN
    RETURN;
  END IF;
  IF (p_alt ->> 'erzeugnis', p_alt ->> 'qualitaetsstufe', p_alt ->> 'zusatzbezeichnung', v_most_a)
     IS NOT DISTINCT FROM (p_neu ->> 'erzeugnis', p_neu ->> 'qualitaetsstufe', p_neu ->> 'zusatzbezeichnung', v_most_n) THEN
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('s112_journal:' || p_tenant_id::text, 0));
  SELECT coalesce(sum(k.menge_liter), 0), coalesce(sum(k.menge_stk), 0) INTO v_l, v_stk
    FROM public.kellerbuch_buchungen k
   WHERE k.tenant_id = p_tenant_id AND k.bestand = p_bestand
     AND (CASE WHEN p_bestand = 'offen' THEN k.weinausbau_id ELSE k.fuellung_id END) = p_id
     AND NOT (p_ohne_quelle IS NOT NULL AND k.quelle_tabelle = p_ohne_quelle AND k.quelle_id = p_id AND k.storno_von_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.kellerbuch_buchungen s WHERE s.tenant_id = k.tenant_id AND s.storno_von_id = k.id));
  IF (p_bestand = 'offen' AND abs(v_l) < 0.0005) OR (p_bestand = 'flasche' AND v_stk = 0) THEN
    RETURN;
  END IF;
  -- KAN-82: Datum der Abstufung (s112_charge_abstufen setzt s112.umstufung_datum transaktionslokal), sonst heute
  v_tag := greatest(coalesce(NULLIF(current_setting('s112.umstufung_datum', true), '')::date, (now() AT TIME ZONE 'Europe/Vienna')::date), v_ab);
  v_beleg := public.s112_journal_beleg(p_tenant_id, NULL);
  v_bez := concat_ws(' · ',
    CASE WHEN (p_alt ->> 'erzeugnis', p_alt ->> 'qualitaetsstufe', p_alt ->> 'zusatzbezeichnung')
              IS DISTINCT FROM (p_neu ->> 'erzeugnis', p_neu ->> 'qualitaetsstufe', p_neu ->> 'zusatzbezeichnung')
         THEN format('Umstufung: %s → %s',
           concat_ws(' / ', coalesce(p_alt ->> 'qualitaetsstufe', '–'), p_alt ->> 'zusatzbezeichnung', p_alt ->> 'erzeugnis'),
           concat_ws(' / ', coalesce(p_neu ->> 'qualitaetsstufe', '–'), p_neu ->> 'zusatzbezeichnung', p_neu ->> 'erzeugnis')) END,
    NULLIF(current_setting('s112.aenderung_grund', true), ''),   -- KAN-82: Grund der Abstufung
    CASE WHEN v_most_a AND NOT v_most_n THEN format('Most/Sturm wird Wein (Status %s → %s)', p_alt ->> 'charge_status', coalesce(p_neu ->> 'charge_status', '–'))
         WHEN v_most_n AND NOT v_most_a THEN format('Wein zurück zu Most/Sturm (Status %s → %s)', coalesce(p_alt ->> 'charge_status', '–'), p_neu ->> 'charge_status') END);
  PERFORM public.s112_journal_schreiben(p_tenant_id, v_beleg, v_tag,
    jsonb_build_object('code', 'AB_ABW', 'bestand', p_bestand,
      CASE WHEN p_bestand = 'offen' THEN 'weinausbau_id' ELSE 'fuellung_id' END, p_id, 'liter', -v_l, 'stk', -v_stk, 'merkmale', p_alt),
    v_tab, p_id, p_id, false, v_bez);
  PERFORM public.s112_journal_schreiben(p_tenant_id, v_beleg, v_tag,
    jsonb_build_object('code', 'ZU_ABW', 'bestand', p_bestand,
      CASE WHEN p_bestand = 'offen' THEN 'weinausbau_id' ELSE 'fuellung_id' END, p_id, 'liter', v_l, 'stk', v_stk, 'merkmale', p_neu),
    v_tab, p_id, p_id, false, v_bez);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_journal_umstufung(uuid, text, uuid, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;

-- 3. Prüfnummer ─────────────────────────────────────────────────────────────────────────────────────────────
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

  -- ── KAN-100: Abstufung bzw. geänderte Bezeichnung der Charge (Qualität, Zusatz, Erzeugnis, Herkunft) ──
  IF TG_TABLE_NAME = 'weinausbau' THEN
    IF (NEW.qualitaetsstufe, NEW.zusatzbezeichnung, NEW.erzeugnis, NEW.herkunft_code)
       IS DISTINCT FROM (OLD.qualitaetsstufe, OLD.zusatzbezeichnung, OLD.erzeugnis, OLD.herkunft_code) THEN
      -- KAN-82: Datum der Abstufung (s112_charge_abstufen), sonst heute
      v_datum := coalesce(NULLIF(current_setting('s112.umstufung_datum', true), '')::date, current_date);
      FOR r IN UPDATE public.pruefnummer_chargen pc
                  SET gueltig_bis = greatest(v_datum, pc.gueltig_ab), ende_grund = 'abstufung', ende_vorgang = 'weinausbau:' || NEW.id
                WHERE pc.weinausbau_id = NEW.id AND pc.gueltig_bis IS NULL
               RETURNING pc.* LOOP
        INSERT INTO public.pruefnummer_ereignisse (tenant_id, dac_antrag_id, weinausbau_id, ereignis, datum, grund, benutzer_id)
        VALUES (r.tenant_id, r.dac_antrag_id, r.weinausbau_id, 'charge_ende', v_datum, 'Für den Tankbestand erloschen: Abstufung bzw. geänderte Bezeichnung der Charge', v_uid);
      END LOOP;
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
  ELSIF TG_TABLE_NAME = 'keller_behandlungen' THEN   -- KAN-100: nur Typen mit pn_wirkung 'veraenderung' (s. u.)
    IF TG_OP = 'UPDATE' AND NEW.storniert_am IS NOT DISTINCT FROM OLD.storniert_am THEN
      -- geänderte Behandlung: bisherige Wirkung zurücknehmen, danach wie eine neue bewerten
      FOR r IN UPDATE public.pruefnummer_chargen pc SET gueltig_bis = NULL, ende_grund = NULL, ende_vorgang = NULL
                WHERE pc.ende_vorgang = 'keller_behandlungen:' || NEW.id RETURNING pc.* LOOP
        INSERT INTO public.pruefnummer_ereignisse (tenant_id, dac_antrag_id, weinausbau_id, ereignis, datum, grund, benutzer_id)
        VALUES (r.tenant_id, r.dac_antrag_id, r.weinausbau_id, 'charge_wieder', current_date, 'Gültigkeit wieder offen (Behandlung geändert, keller_behandlungen:' || NEW.id || ')', v_uid);
      END LOOP;
    END IF;
    v_ziel := NEW.weinausbau_id;  v_grund := 'behandlung';
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
      RETURN NULL;
    END IF;
    -- KAN-100: geänderte Kellerbehandlung (Typ, Charge, Datum) wird wie eine neue bewertet; sonst nichts
    IF TG_TABLE_NAME <> 'keller_behandlungen' OR NEW.storniert_am IS NOT NULL THEN RETURN NULL; END IF;
  END IF;
  IF TG_TABLE_NAME = 'keller_behandlungen' THEN   -- NEW.typ_id nur hier (andere Tabellen haben die Spalte nicht)
    IF NOT EXISTS (SELECT 1 FROM public.keller_behandlungstypen t WHERE t.id = NEW.typ_id AND t.pn_wirkung = 'veraenderung') THEN
      RETURN NULL;   -- Pflege bzw. nicht eingestuft: Warnung in der App, die Gültigkeit bleibt
    END IF;
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

-- 4. RPC ────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_charge_abstufen(p_tenant_id uuid, p_weinausbau_id uuid, p_datum date, p_neu jsonb,
  p_grund text, p_quelle_weinausbau_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_w      public.weinausbau%ROWTYPE;
  v_datum  date := coalesce(p_datum, (now() AT TIME ZONE 'Europe/Vienna')::date);
  v_heute  date := (now() AT TIME ZONE 'Europe/Vienna')::date;
  v_bis    date;
  v_letzte date;
  v_neu_q  text;
  v_neu_z  text;
  v_neu_e  text;
  v_neu_h  text;
  v_id     uuid;
  v_grund  text := btrim(coalesce(p_grund, ''));
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT (public.ist_service_kontext() OR public.s112_darf_schreiben(p_tenant_id, 'kellerbuch')) THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für das Kellerbuch in diesem Betrieb.' USING ERRCODE = '42501';
  END IF;
  IF length(v_grund) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für die Abstufung angeben (mindestens 10 Zeichen).' USING ERRCODE = '22023';
  END IF;
  IF v_datum > v_heute THEN
    RAISE EXCEPTION 'Das Datum der Abstufung liegt in der Zukunft.' USING ERRCODE = '22023';
  END IF;
  v_bis := public.s112_kellerbuch_gesperrt_bis(p_tenant_id);
  IF v_bis IS NOT NULL AND v_datum <= v_bis THEN
    RAISE EXCEPTION 'Das Kellerbuch ist bis % abgeschlossen – die Abstufung kann frühestens am % gebucht werden.',
      to_char(v_bis, 'DD.MM.YYYY'), to_char(v_bis + 1, 'DD.MM.YYYY') USING ERRCODE = '42501', HINT = 'kellerbuch_abschluss';
  END IF;

  SELECT * INTO v_w FROM public.weinausbau w WHERE w.id = p_weinausbau_id AND w.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Charge nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_w.storniert_am IS NOT NULL OR NOT coalesce(v_w.aktiv, true) THEN
    RAISE EXCEPTION 'Die Charge ist storniert bzw. nicht mehr aktiv.' USING ERRCODE = '22023';
  END IF;
  IF p_quelle_weinausbau_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.weinausbau q WHERE q.id = p_quelle_weinausbau_id AND q.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Ausgangscharge nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  -- nicht vor die letzte Journalbuchung der Charge (sonst trügen spätere Bewegungen die alten Merkmale)
  SELECT max(k.datum) INTO v_letzte FROM public.kellerbuch_buchungen k
   WHERE k.tenant_id = p_tenant_id AND k.weinausbau_id = p_weinausbau_id AND k.storno_von_id IS NULL;
  IF v_letzte IS NOT NULL AND v_datum < v_letzte THEN
    RAISE EXCEPTION 'Die Charge hat am % schon eine Bewegung – die Abstufung kann frühestens an diesem Tag gebucht werden.',
      to_char(v_letzte, 'DD.MM.YYYY') USING ERRCODE = '22023';
  END IF;

  v_neu_q := CASE WHEN p_neu ? 'qualitaetsstufe'   THEN NULLIF(p_neu ->> 'qualitaetsstufe', '')   ELSE v_w.qualitaetsstufe END;
  v_neu_z := CASE WHEN p_neu ? 'zusatzbezeichnung' THEN NULLIF(p_neu ->> 'zusatzbezeichnung', '') ELSE v_w.zusatzbezeichnung END;
  v_neu_e := CASE WHEN p_neu ? 'erzeugnis'         THEN NULLIF(p_neu ->> 'erzeugnis', '')         ELSE v_w.erzeugnis END;
  v_neu_h := CASE WHEN p_neu ? 'herkunft_code'     THEN NULLIF(p_neu ->> 'herkunft_code', '')     ELSE v_w.herkunft_code END;
  IF (v_neu_q, v_neu_z, v_neu_e, v_neu_h) IS NOT DISTINCT FROM (v_w.qualitaetsstufe, v_w.zusatzbezeichnung, v_w.erzeugnis, v_w.herkunft_code) THEN
    RAISE EXCEPTION 'Nichts zu ändern – Qualität, Zusatzbezeichnung, Erzeugnis und Herkunft sind gleich.' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('s112.umstufung_datum', v_datum::text, true);
  PERFORM set_config('s112.aenderung_grund',
    format('Abstufung am %s (%s L): %s', to_char(v_datum, 'DD.MM.YYYY'), replace(to_char(round(coalesce(v_w.menge_liter, 0), 2), 'FM9999999990.00'), '.', ','), v_grund), true);
  UPDATE public.weinausbau
     SET qualitaetsstufe = v_neu_q, zusatzbezeichnung = v_neu_z, erzeugnis = v_neu_e, herkunft_code = v_neu_h
   WHERE id = p_weinausbau_id;
  INSERT INTO public.charge_umstufungen (tenant_id, weinausbau_id, quelle_weinausbau_id, datum, menge_liter,
    alt_qualitaetsstufe, alt_zusatzbezeichnung, alt_erzeugnis, alt_herkunft_code,
    neu_qualitaetsstufe, neu_zusatzbezeichnung, neu_erzeugnis, neu_herkunft_code, grund, erstellt_von, erstellt_von_name)
  VALUES (p_tenant_id, p_weinausbau_id, p_quelle_weinausbau_id, v_datum, coalesce(v_w.menge_liter, 0),
    v_w.qualitaetsstufe, v_w.zusatzbezeichnung, v_w.erzeugnis, v_w.herkunft_code,
    v_neu_q, v_neu_z, v_neu_e, v_neu_h, v_grund, auth.uid(), public.s112_storno_benutzername(auth.uid()))
  RETURNING id INTO v_id;
  PERFORM set_config('s112.umstufung_datum', '', true);
  PERFORM set_config('s112.aenderung_grund', '', true);
  RETURN v_id;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_charge_abstufen(uuid, uuid, date, jsonb, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_charge_abstufen(uuid, uuid, date, jsonb, text, uuid) TO authenticated;
