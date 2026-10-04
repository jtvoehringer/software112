-- KAN-100 (04.10.2026): Warnung „Prüfnummer wird entzogen“ – alle Auslöser inkl. Kellerbehandlungen und Abstufung.
-- Löst die Übergangslösung KAN-83 ab: Seit KAN-99 beenden Verschnitt, Zusammenführung, Zukauf und Pressung die Gültigkeit
-- der Prüfnummer für den Tankbestand in derselben Transaktion wie die Buchung (Trigger s112_pn_chargen_pflegen); die
-- Rückfrage bleibt in der App. Neu:
-- Entscheidungen Jörgen (04.10.2026):
--   * Einstufung der Kellerbehandlungstypen (pn_wirkung): Säurekorrektur = Veränderung (Prüfnummer erlischt für den
--     Tankbestand, mit Rückfrage); Schwefelung, Filtration, Bentonit/Schönung, Kieselsol, sonstige Schönung,
--     Gärtemperatur, Hefegabe, Schwund = Pflege (keine Wirkung); neue Typen starten als „unklar“ (nur Warnung).
--   * Nach einer Abstufung (Qualität, Zusatzbezeichnung, Erzeugnis, Herkunft) erlischt die Prüfnummer für den Tankbestand.
--
--  1. keller_behandlungstypen.pn_wirkung (pflege | veraenderung | unklar, Standard unklar) – einzige Quelle dieser
--     Klassifikation (Kellermittel aus KAN-45 verweisen über den Behandlungstyp darauf); Bestand nach Namen eingestuft.
--  2. pruefnummer_chargen.ende_grund: zusätzlich 'behandlung' und 'abstufung'.
--  3. s112_pn_erstes_ende und s112_pn_chargen_pflegen: Kellerbehandlung vom Typ „Veränderung“ (Anlegen bzw. Ändern) beendet die Gültigkeit der
--     Charge, Storno nimmt das zurück; geänderte Bezeichnung der Charge (weinausbau) beendet sie ebenfalls.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- 1. Einstufung ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.keller_behandlungstypen
  ADD COLUMN pn_wirkung text NOT NULL DEFAULT 'unklar' CHECK (pn_wirkung IN ('pflege', 'veraenderung', 'unklar'));
COMMENT ON COLUMN public.keller_behandlungstypen.pn_wirkung IS
  'KAN-100: Wirkung auf die Prüfnummer – pflege (keine), veraenderung (erlischt für den Tankbestand), unklar (nur Warnung)';
UPDATE public.keller_behandlungstypen SET pn_wirkung = 'veraenderung'
 WHERE name ~* '(s(ä|ae)ure|entsäu|entsaeu|anreicher|s(ü|ue)ß|suess|aufbesser|alkohol)';
UPDATE public.keller_behandlungstypen SET pn_wirkung = 'pflege'
 WHERE pn_wirkung = 'unklar'
   AND name ~* '(schwef|filtr|bentonit|sch(ö|oe)n|kiesel|g(ä|ae)rtemp|temperatur|hefe|schwund|umbenenn|kl(ä|ae)r|stabilis|abstich)';

-- 2. Ende-Grund ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.pruefnummer_chargen DROP CONSTRAINT pruefnummer_chargen_ende_grund_check;
ALTER TABLE public.pruefnummer_chargen ADD CONSTRAINT pruefnummer_chargen_ende_grund_check CHECK (ende_grund IS NULL OR ende_grund IN
  ('verschnitt', 'zugang', 'zukauf', 'pressung', 'behandlung', 'abstufung', 'abgelehnt', 'zurueckgezogen', 'erloschen', 'entzogen', 'aufgebraucht', 'storno'));

-- 3. Erstes Ende (nachträglich eingereichter bzw. angelegter Antrag): auch Kellerbehandlungen ─────────────────
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
    UNION ALL   -- KAN-100: Kellerbehandlung, die den Wein verändert
    SELECT kb.datum::date, 'behandlung', 'keller_behandlungen:' || kb.id
      FROM public.keller_behandlungen kb JOIN public.keller_behandlungstypen t ON t.id = kb.typ_id
     WHERE kb.weinausbau_id = p_charge AND kb.storniert_am IS NULL AND t.pn_wirkung = 'veraenderung' AND kb.datum::date > p_ab
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

-- 4. Pflege ─────────────────────────────────────────────────────────────────────────────────────────────────
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
      FOR r IN UPDATE public.pruefnummer_chargen pc
                  SET gueltig_bis = greatest(current_date, pc.gueltig_ab), ende_grund = 'abstufung', ende_vorgang = 'weinausbau:' || NEW.id
                WHERE pc.weinausbau_id = NEW.id AND pc.gueltig_bis IS NULL
               RETURNING pc.* LOOP
        INSERT INTO public.pruefnummer_ereignisse (tenant_id, dac_antrag_id, weinausbau_id, ereignis, datum, grund, benutzer_id)
        VALUES (r.tenant_id, r.dac_antrag_id, r.weinausbau_id, 'charge_ende', current_date, 'Für den Tankbestand erloschen: Abstufung bzw. geänderte Bezeichnung der Charge', v_uid);
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

-- 5. Einstufung nachträglich ändern: von bzw. zu „Veränderung“ nur, solange der Typ keine Behandlung in einer Charge
--    mit Prüfnummer (ab deren Beginn) hat – sonst passte die gespeicherte Gültigkeit nicht mehr zur Einstufung
CREATE OR REPLACE FUNCTION public.s112_pn_wirkung_schutz()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.pn_wirkung IS DISTINCT FROM OLD.pn_wirkung AND 'veraenderung' IN (NEW.pn_wirkung, OLD.pn_wirkung)
     AND EXISTS (SELECT 1 FROM public.keller_behandlungen kb
                   JOIN public.pruefnummer_chargen pc ON pc.weinausbau_id = kb.weinausbau_id AND kb.datum >= pc.gueltig_ab
                  WHERE kb.typ_id = NEW.id AND kb.storniert_am IS NULL) THEN
    RAISE EXCEPTION 'Die Einstufung des Behandlungstyps „%“ kann nicht mehr geändert werden: Er wurde bereits in einer Charge mit Prüfnummer verwendet. Bitte einen neuen Behandlungstyp anlegen bzw. die Behandlung stornieren und neu erfassen.', NEW.name
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_pn_wirkung_schutz() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_pn_wirkung BEFORE UPDATE OF pn_wirkung ON public.keller_behandlungstypen
  FOR EACH ROW EXECUTE FUNCTION public.s112_pn_wirkung_schutz();

CREATE TRIGGER z_pn_chargen AFTER INSERT OR UPDATE OF storniert_am, typ_id, weinausbau_id, datum ON public.keller_behandlungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_pn_chargen_pflegen();
CREATE TRIGGER z_pn_chargen AFTER UPDATE OF qualitaetsstufe, zusatzbezeichnung, erzeugnis, herkunft_code ON public.weinausbau
  FOR EACH ROW EXECUTE FUNCTION public.s112_pn_chargen_pflegen();
