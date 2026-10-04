-- KAN-97 (04.10.2026): Prüfnummernantrag als Workflow – Statusmodell, Übergangs-RPC, Freeze je Status, Protokoll.
-- § 25 Abs. 6 WeinG: ab Antragstellung darf der Wein nicht verändert und dürfen die Angaben nach Abs. 4 nicht geändert werden.
-- Entscheidungen Jörgen (04.10.2026):
--   * Status: Entwurf → Eingereicht → (In Prüfung) → Zugeteilt (DB-Wert bleibt 'genehmigt') oder Abgelehnt;
--     Eingereicht/In Prüfung → Zurückgezogen; Zugeteilt → Erloschen, Entzogen oder Aufgebraucht.
--     Endstatus: abgelehnt, zurueckgezogen, erloschen, entzogen, aufgebraucht (Weiterarbeit: „Als neuen Entwurf kopieren“).
--   * Die Prüfnummer bleibt bis „Zugeteilt“ änderbar (Eingereicht/In Prüfung), danach gesperrt.
--   * Status setzen darf, wer den Antrag bearbeiten darf: system_admin, tenant_admin, winzer mit Schreibmodul Kellerbuch.
--
--  1. dac_antrag: Status-CHECK erweitert; neue Spalten status_seit, antragsnummer, untersuchungsnummer, charge_snapshot,
--     entzug_am, entzug_grund.
--  2. pruefnummernantraege: höchstens ein nicht stornierter Antrag je DAC-Antrag (eindeutiger Teilindex).
--  3. pruefnummer_ereignisse: Statuswechsel mit Benutzer, Zeitpunkt, Datum, Nummer und Grund (später auch KAN-99).
--  4. s112_pn_workflow_schutz: Status, Daten und Snapshot nur über die RPC; neuer Antrag immer als Entwurf;
--     Antragsformular nur zu einem Entwurf anlegen.
--  5. Freeze (KAN-96) je Status: ab Eingereicht nur Notizen, Prüf-/Antrags-/Untersuchungsnummer, aktiv, Storno; ab
--     Zugeteilt nur Notizen, aktiv, Storno; Endstatus nur aktiv und Storno. Antragsformular ab Eingereicht gesperrt.
--  6. s112_pruefnummernantrag_status_setzen: Übergangsmatrix, Zugriff, Abo-Sperre, Schreibmodul Kellerbuch, Ereignis.
--     s112_freeze lässt Wartung (s112.loeschen_erlaubt für den Betrieb, Demo-Reset) durch – sonst endeten
--     Mandanten-Löschung und Resets an eingereichten Anträgen.
--  7. bestandsprotokoll_schreiben: Grund auch bei Änderungen (s112.aenderung_grund, nur RPCs setzen es).
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

-- 1. dac_antrag ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.dac_antrag DROP CONSTRAINT dac_antrag_status_check;
ALTER TABLE public.dac_antrag ADD CONSTRAINT dac_antrag_status_check CHECK (status = ANY (ARRAY[
  'entwurf', 'eingereicht', 'in_pruefung', 'genehmigt', 'abgelehnt', 'zurueckgezogen', 'erloschen', 'entzogen', 'aufgebraucht']));

ALTER TABLE public.dac_antrag
  ADD COLUMN status_seit         timestamptz,
  ADD COLUMN antragsnummer       text CHECK (antragsnummer IS NULL OR length(btrim(antragsnummer)) BETWEEN 1 AND 60),
  ADD COLUMN untersuchungsnummer text CHECK (untersuchungsnummer IS NULL OR length(btrim(untersuchungsnummer)) BETWEEN 1 AND 60),
  ADD COLUMN charge_snapshot     jsonb CHECK (charge_snapshot IS NULL OR jsonb_typeof(charge_snapshot) = 'object'),
  ADD COLUMN entzug_am           date,
  ADD COLUMN entzug_grund        text,
  ADD CONSTRAINT dac_antrag_entzug_chk CHECK ((status = 'entzogen') = (entzug_am IS NOT NULL)
                                              AND (entzug_am IS NULL) = (entzug_grund IS NULL));
-- Bestand: Status gilt seit Bescheid bzw. Einreichung, sonst seit Anlage
UPDATE public.dac_antrag
   SET status_seit = coalesce(CASE WHEN status IN ('genehmigt', 'abgelehnt') THEN bescheid_am END,
                              CASE WHEN status <> 'entwurf' THEN eingereicht_am END, created_at::date)::timestamptz
 WHERE status_seit IS NULL;
ALTER TABLE public.dac_antrag ALTER COLUMN status_seit SET DEFAULT now(), ALTER COLUMN status_seit SET NOT NULL;
COMMENT ON COLUMN public.dac_antrag.status IS
  'KAN-97: entwurf, eingereicht, in_pruefung, genehmigt (= „Zugeteilt“), abgelehnt, zurueckgezogen, erloschen, entzogen, aufgebraucht – nur über s112_pruefnummernantrag_status_setzen';
COMMENT ON COLUMN public.dac_antrag.charge_snapshot IS 'KAN-97: Charge beim Einreichen (Wein darf ab Antragstellung nicht verändert werden)';

-- 2. Höchstens ein Antragsformular je DAC-Antrag ────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX pruefnummernantraege_ein_formular ON public.pruefnummernantraege (dac_antrag_id)
  WHERE storniert_am IS NULL AND dac_antrag_id IS NOT NULL;

-- 3. Ereignisse ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.pruefnummer_ereignisse (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  dac_antrag_id  uuid NOT NULL REFERENCES public.dac_antrag(id) ON DELETE CASCADE,
  weinausbau_id  uuid REFERENCES public.weinausbau(id) ON DELETE SET NULL,
  ereignis       text NOT NULL CHECK (ereignis IN ('status')),   -- KAN-99 ergänzt die Gültigkeit je Charge
  status_alt     text,
  status_neu     text,
  datum          date NOT NULL,
  pruefnummer    text,
  grund          text,
  benutzer_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  benutzer_name  text,
  erstellt_am    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pruefnummer_ereignisse_antrag_idx ON public.pruefnummer_ereignisse (dac_antrag_id, erstellt_am);
CREATE INDEX pruefnummer_ereignisse_tenant_idx ON public.pruefnummer_ereignisse (tenant_id);
CREATE INDEX pruefnummer_ereignisse_weinausbau_idx ON public.pruefnummer_ereignisse (weinausbau_id) WHERE weinausbau_id IS NOT NULL;
COMMENT ON TABLE public.pruefnummer_ereignisse IS
  'KAN-97: Statuswechsel der Prüfnummernanträge (Benutzer, Zeitpunkt, Datum, Grund) – nur per RPC, unveränderlich';

ALTER TABLE public.pruefnummer_ereignisse ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.pruefnummer_ereignisse FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.pruefnummer_ereignisse FROM anon;
-- Schreiben: keine Policy für INSERT/UPDATE/DELETE – nur die RPC (SECURITY DEFINER)
CREATE POLICY ereignisse_select ON public.pruefnummer_ereignisse FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY mitgliedschaft_aktiv ON public.pruefnummer_ereignisse AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY abo_schreibsperre_ins ON public.pruefnummer_ereignisse AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.pruefnummer_ereignisse AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.pruefnummer_ereignisse AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.pruefnummer_ereignisse AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));

-- KAN-178: Verweise nur in den eigenen Betrieb
CREATE TRIGGER z_fremdverweis_dac_antrag_id BEFORE INSERT OR UPDATE OF dac_antrag_id, tenant_id ON public.pruefnummer_ereignisse
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('dac_antrag_id', 'dac_antrag', '', '', '');
CREATE TRIGGER z_fremdverweis_weinausbau_id BEFORE INSERT OR UPDATE OF weinausbau_id, tenant_id ON public.pruefnummer_ereignisse
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('weinausbau_id', 'weinausbau', '', '', '');

-- 4. Status nur über die RPC ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_pn_workflow_schutz()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_rolle text := coalesce(nullif(current_setting('role', true), 'none'), session_user::text);
  v_frei  text := nullif(current_setting('s112.freeze_frei', true), '');
  v_st    text;
BEGIN
  -- Wartung (Service-Role, SQL-Editor, Demo-Reset) und die RPCs (Kennzeichen s112.freeze_frei): frei
  IF v_rolle NOT IN ('authenticated', 'anon') OR v_frei = '*' OR v_frei = TG_TABLE_NAME THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'pruefnummernantraege' THEN
    -- Antragsformular nur zu einem Entwurf anlegen bzw. umhängen
    IF TG_OP = 'INSERT' OR NEW.dac_antrag_id IS DISTINCT FROM OLD.dac_antrag_id THEN
      SELECT a.status INTO v_st FROM public.dac_antrag a WHERE a.id = NEW.dac_antrag_id AND a.storniert_am IS NULL;
      IF NEW.dac_antrag_id IS NOT NULL AND v_st IS DISTINCT FROM 'entwurf' THEN
        RAISE EXCEPTION 'Gesperrt: Prüfnummernantrag eingereicht – das Antragsformular lässt sich nur zu einem Entwurf anlegen.'
          USING ERRCODE = '42501', HINT = 'pn_status';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- dac_antrag
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'entwurf' OR NEW.charge_snapshot IS NOT NULL OR NEW.entzug_am IS NOT NULL
       OR NEW.entzug_grund IS NOT NULL OR NEW.eingereicht_am IS NOT NULL OR NEW.bescheid_am IS NOT NULL THEN
      RAISE EXCEPTION 'Ein Prüfnummernantrag beginnt als Entwurf – Einreichen, Bescheid und Entzug werden über den Statuswechsel erfasst.'
        USING ERRCODE = '42501', HINT = 'pn_status';
    END IF;
    NEW.status_seit := now();
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.status_seit IS DISTINCT FROM OLD.status_seit
     OR NEW.charge_snapshot IS DISTINCT FROM OLD.charge_snapshot OR NEW.entzug_am IS DISTINCT FROM OLD.entzug_am
     OR NEW.entzug_grund IS DISTINCT FROM OLD.entzug_grund OR NEW.eingereicht_am IS DISTINCT FROM OLD.eingereicht_am
     OR NEW.bescheid_am IS DISTINCT FROM OLD.bescheid_am THEN
    RAISE EXCEPTION 'Status, Einreichung, Bescheid und Entzug ändern sich nur über den Statuswechsel des Prüfnummernantrags.'
      USING ERRCODE = '42501', HINT = 'pn_status';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_pn_workflow_schutz() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER a_pn_workflow BEFORE INSERT OR UPDATE ON public.dac_antrag
  FOR EACH ROW EXECUTE FUNCTION public.s112_pn_workflow_schutz();
CREATE TRIGGER a_pn_workflow BEFORE INSERT OR UPDATE OF dac_antrag_id ON public.pruefnummernantraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_pn_workflow_schutz();

-- 5. Freeze je Status (KAN-96) ──────────────────────────────────────────────────────────────────────────────
CREATE TRIGGER a_freeze_eingereicht BEFORE UPDATE OR DELETE ON public.dac_antrag
  FOR EACH ROW EXECUTE FUNCTION public.s112_freeze('Prüfnummernantrag eingereicht',
    $$o.storniert_am IS NULL AND o.status IN ('eingereicht', 'in_pruefung')$$,
    'notizen,aktiv,updated_at,pruefnummer,antragsnummer,untersuchungsnummer,storniert_am,storniert_von,storniert_von_name,storno_grund',
    'eingereicht_am');
CREATE TRIGGER a_freeze_zugeteilt BEFORE UPDATE OR DELETE ON public.dac_antrag
  FOR EACH ROW EXECUTE FUNCTION public.s112_freeze('Prüfnummer zugeteilt',
    $$o.storniert_am IS NULL AND o.status = 'genehmigt'$$,
    'notizen,aktiv,updated_at,storniert_am,storniert_von,storniert_von_name,storno_grund',
    'bescheid_am');
CREATE TRIGGER a_freeze_abgeschlossen BEFORE UPDATE OR DELETE ON public.dac_antrag
  FOR EACH ROW EXECUTE FUNCTION public.s112_freeze('Prüfnummernantrag abgeschlossen',
    $$o.storniert_am IS NULL AND o.status IN ('abgelehnt', 'zurueckgezogen', 'erloschen', 'entzogen', 'aufgebraucht')$$,
    'aktiv,updated_at,storniert_am,storniert_von,storniert_von_name,storno_grund',
    'status_seit');
-- Antragsformular: ab Eingereicht unveränderlich (Storno erst, wenn der DAC-Antrag selbst storniert ist)
CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public.pruefnummernantraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_freeze('Prüfnummernantrag eingereicht',
    $$o.storniert_am IS NULL AND EXISTS (SELECT 1 FROM public.dac_antrag a WHERE a.id = o.dac_antrag_id AND a.storniert_am IS NULL AND a.status <> 'entwurf')$$,
    '', '');

-- 5b. Freeze-Baustein: Wartungs-Kennzeichen (s112.loeschen_erlaubt bzw. Demo-Reset) wie bei der Löschsperre ───────
CREATE OR REPLACE FUNCTION public.s112_freeze()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_grund     text := coalesce(TG_ARGV[0], 'gesperrt');
  v_bedingung text := TG_ARGV[1];
  v_erlaubt   text[] := coalesce(string_to_array(nullif(btrim(coalesce(TG_ARGV[2], '')), ''), ','), '{}');
  v_seit_sp   text := nullif(btrim(coalesce(TG_ARGV[3], '')), '');
  v_frei      text := nullif(current_setting('s112.freeze_frei', true), '');
  v_rolle     text := coalesce(nullif(current_setting('role', true), 'none'), session_user::text);
  v_wartung   text := nullif(current_setting('s112.loeschen_erlaubt', true), '');
  v_tenant    text := to_jsonb(OLD) ->> 'tenant_id';
  v_gesperrt  boolean;
  v_alt       jsonb := to_jsonb(OLD);
  v_neu       jsonb;
  v_spalten   text[];
  v_seit      text;
  v_text      text;
BEGIN
  IF v_frei IS NOT NULL AND (v_frei = '*' OR v_frei = TG_TABLE_NAME) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  -- KAN-97: Wartung wie bei der Löschsperre – Mandanten-Löschung, Sandbox- und Demo-Reset (nie für API-Rollen)
  IF v_rolle NOT IN ('authenticated', 'anon')
     AND ((v_wartung IS NOT NULL AND (v_wartung = '*' OR v_wartung = v_tenant))
          OR (current_setting('s112.protokoll_aus', true) = '33333333-3333-4333-8333-333333333333'
              AND v_tenant = '33333333-3333-4333-8333-333333333333')) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  v_erlaubt := ARRAY(SELECT btrim(x) FROM unnest(v_erlaubt) x);

  EXECUTE format('SELECT (%s) FROM (SELECT ($1).*) o', v_bedingung) INTO v_gesperrt USING OLD;
  IF NOT coalesce(v_gesperrt, false) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_neu := to_jsonb(NEW);
    SELECT array_agg(k ORDER BY k) INTO v_spalten
      FROM jsonb_object_keys(v_neu) k
     WHERE (v_neu -> k) IS DISTINCT FROM (v_alt -> k) AND NOT (k = ANY (v_erlaubt));
    IF v_spalten IS NULL THEN
      RETURN NEW;   -- nur erlaubte Spalten geändert
    END IF;
  END IF;

  IF v_seit_sp IS NOT NULL AND (v_alt ->> v_seit_sp) IS NOT NULL THEN
    v_seit := to_char((v_alt ->> v_seit_sp)::timestamptz AT TIME ZONE 'Europe/Vienna', 'DD.MM.YYYY');
  END IF;
  v_text := 'Gesperrt: ' || v_grund || coalesce(' am ' || v_seit, '') || ' – '
            || CASE WHEN TG_OP = 'DELETE' THEN 'Löschen ist nicht möglich.'
                    WHEN cardinality(v_erlaubt) = 0 THEN 'keine Änderung möglich (' || array_to_string(v_spalten, ', ') || ').'
                    ELSE 'änderbar sind nur ' || array_to_string(v_erlaubt, ', ') || ' (nicht: ' || array_to_string(v_spalten, ', ') || ').' END;
  RAISE EXCEPTION '%', v_text
    USING ERRCODE = '42501', HINT = 'freeze',
          DETAIL = jsonb_build_object('tabelle', TG_TABLE_NAME, 'grund', v_grund, 'seit', v_seit,
                                      'erlaubt', to_jsonb(v_erlaubt), 'spalten', to_jsonb(coalesce(v_spalten, '{}')),
                                      'aktion', TG_OP)::text;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_freeze() FROM PUBLIC, anon, authenticated;


-- 6. Statuswechsel ──────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_pruefnummernantrag_status_setzen(
  p_tenant_id uuid, p_antrag_id uuid, p_status text, p_datum date, p_pruefnummer text, p_grund text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  c_uebergaenge constant jsonb := '{
    "entwurf":     ["eingereicht"],
    "eingereicht": ["in_pruefung", "genehmigt", "abgelehnt", "zurueckgezogen"],
    "in_pruefung": ["genehmigt", "abgelehnt", "zurueckgezogen"],
    "genehmigt":   ["erloschen", "entzogen", "aufgebraucht"]
  }';
  c_label constant jsonb := '{"entwurf": "Entwurf", "eingereicht": "Eingereicht", "in_pruefung": "In Prüfung",
    "genehmigt": "Zugeteilt", "abgelehnt": "Abgelehnt", "zurueckgezogen": "Zurückgezogen", "erloschen": "Erloschen",
    "entzogen": "Entzogen", "aufgebraucht": "Aufgebraucht"}';
  v_a      public.dac_antrag%ROWTYPE;
  v_datum  date := coalesce(p_datum, current_date);
  v_grund  text := nullif(btrim(coalesce(p_grund, '')), '');
  v_nr     text;
  v_snap   jsonb;
  v_uid    uuid := auth.uid();
  v_name   text;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT public.s112_darf_schreiben(p_tenant_id, VARIADIC ARRAY['kellerbuch'])
     AND coalesce(nullif(current_setting('role', true), 'none'), session_user::text) IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'Für Prüfnummernanträge fehlt das Schreibrecht (Modul Kellerbuch).' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_a FROM public.dac_antrag a WHERE a.id = p_antrag_id AND a.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prüfnummernantrag nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_a.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Der Prüfnummernantrag ist storniert – kein Statuswechsel mehr möglich.' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR NOT (c_label ? p_status) THEN
    RAISE EXCEPTION 'Unbekannter Status „%“.', coalesce(p_status, '–') USING ERRCODE = '22023';
  END IF;
  IF NOT coalesce((c_uebergaenge -> v_a.status) ? p_status, false) THEN
    RAISE EXCEPTION 'Statuswechsel „%“ → „%“ ist nicht zulässig.', c_label ->> v_a.status, c_label ->> p_status
      USING ERRCODE = '23514', HINT = 'pn_uebergang';
  END IF;
  IF v_datum > current_date THEN
    RAISE EXCEPTION 'Das Datum darf nicht in der Zukunft liegen.' USING ERRCODE = '22023';
  END IF;
  IF p_status <> 'eingereicht' AND v_a.eingereicht_am IS NOT NULL AND v_datum < v_a.eingereicht_am THEN
    RAISE EXCEPTION 'Das Datum liegt vor der Einreichung am %.', to_char(v_a.eingereicht_am, 'DD.MM.YYYY') USING ERRCODE = '22023';
  END IF;
  IF p_status IN ('erloschen', 'entzogen', 'aufgebraucht') AND v_a.bescheid_am IS NOT NULL AND v_datum < v_a.bescheid_am THEN
    RAISE EXCEPTION 'Das Datum liegt vor der Zuteilung am %.', to_char(v_a.bescheid_am, 'DD.MM.YYYY') USING ERRCODE = '22023';
  END IF;
  IF p_status = 'entzogen' AND length(coalesce(v_grund, '')) < 10 THEN
    RAISE EXCEPTION 'Bitte den Grund des Entzugs angeben (mindestens 10 Zeichen).' USING ERRCODE = '23514';
  END IF;

  v_nr := coalesce(nullif(btrim(coalesce(p_pruefnummer, '')), ''), v_a.pruefnummer);
  IF p_status = 'genehmigt' AND v_nr IS NULL THEN
    RAISE EXCEPTION 'Für „Zugeteilt“ bitte die Prüfnummer angeben.' USING ERRCODE = '23514';
  END IF;
  IF p_status = 'eingereicht' AND v_a.weinausbau_id IS NOT NULL THEN
    SELECT to_jsonb(w) - 'tenant_id' INTO v_snap FROM public.weinausbau w WHERE w.id = v_a.weinausbau_id AND w.tenant_id = p_tenant_id;
    v_snap := jsonb_build_object('erfasst_am', now(), 'charge', v_snap);
  END IF;

  PERFORM set_config('s112.freeze_frei', 'dac_antrag', true);
  PERFORM set_config('s112.aenderung_grund',
    'Statuswechsel ' || (c_label ->> v_a.status) || ' → ' || (c_label ->> p_status) || coalesce(': ' || v_grund, ''), true);
  UPDATE public.dac_antrag a SET
    status          = p_status,
    status_seit     = now(),
    eingereicht_am  = CASE WHEN p_status = 'eingereicht' THEN v_datum ELSE a.eingereicht_am END,
    bescheid_am     = CASE WHEN p_status IN ('genehmigt', 'abgelehnt') THEN v_datum ELSE a.bescheid_am END,
    pruefnummer     = CASE WHEN p_status IN ('eingereicht', 'in_pruefung', 'genehmigt') THEN v_nr ELSE a.pruefnummer END,
    charge_snapshot = CASE WHEN p_status = 'eingereicht' THEN v_snap ELSE a.charge_snapshot END,
    entzug_am       = CASE WHEN p_status = 'entzogen' THEN v_datum ELSE a.entzug_am END,
    entzug_grund    = CASE WHEN p_status = 'entzogen' THEN v_grund ELSE a.entzug_grund END
  WHERE a.id = v_a.id;
  PERFORM set_config('s112.aenderung_grund', '', true);
  PERFORM set_config('s112.freeze_frei', '', true);

  IF v_uid IS NOT NULL THEN
    SELECT coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.display_name), ''))
      INTO v_name FROM public.profiles p WHERE p.user_id = v_uid OR p.id = v_uid ORDER BY (p.user_id = v_uid) DESC LIMIT 1;
    IF v_name IS NULL THEN
      SELECT u.email INTO v_name FROM auth.users u WHERE u.id = v_uid;
    END IF;
  END IF;
  INSERT INTO public.pruefnummer_ereignisse (tenant_id, dac_antrag_id, weinausbau_id, ereignis, status_alt, status_neu, datum,
                                            pruefnummer, grund, benutzer_id, benutzer_name)
  VALUES (p_tenant_id, v_a.id, v_a.weinausbau_id, 'status', v_a.status, p_status, v_datum,
          CASE WHEN p_status IN ('eingereicht', 'in_pruefung', 'genehmigt') THEN v_nr ELSE v_a.pruefnummer END,
          v_grund, v_uid, v_name);
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_pruefnummernantrag_status_setzen(uuid, uuid, text, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_pruefnummernantrag_status_setzen(uuid, uuid, text, date, text, text) TO authenticated;

-- 7. Änderungsprotokoll mit Grund (bisher nur bei Löschungen) ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bestandsprotokoll_schreiben()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_demo      constant uuid := '33333333-3333-4333-8333-333333333333';
  v_rolle     text := COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text);
  v_alt       jsonb;
  v_neu       jsonb;
  v_alt_diff  jsonb;
  v_neu_diff  jsonb;
  v_spalten   text[];
  v_tenant    uuid;
  v_eltern    text;
  v_eltern_id uuid;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'TRUNCATE auf „%“ ist gesperrt (KAN-35 Bestandsprotokoll) – bitte zeilenweise mit DELETE löschen', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Datenminimierung: Versand-E-Mail-Adresse ist nicht bestandsrelevant
    v_alt := to_jsonb(OLD) - 'rechnung_versendet_an';
  ELSIF TG_OP = 'UPDATE' THEN
    v_alt := to_jsonb(OLD);
    v_neu := to_jsonb(NEW);
    SELECT array_agg(s.k ORDER BY s.k),
           jsonb_object_agg(s.k, v_alt -> s.k),
           jsonb_object_agg(s.k, v_neu -> s.k)
      INTO v_spalten, v_alt_diff, v_neu_diff
      FROM unnest(CASE WHEN TG_NARGS > 0 THEN TG_ARGV
                       ELSE ARRAY(SELECT jsonb_object_keys(v_neu)) END) AS s(k)
     WHERE (v_alt -> s.k) IS DISTINCT FROM (v_neu -> s.k);
    IF v_spalten IS NULL THEN
      RETURN NULL;  -- keine überwachte Spalte hat sich tatsächlich geändert
    END IF;
  ELSE
    RETURN NULL;
  END IF;

  v_tenant := COALESCE((v_alt ->> 'tenant_id')::uuid, (v_neu ->> 'tenant_id')::uuid);

  IF v_tenant IS NULL THEN
    -- (1) Elternzeile
    CASE TG_TABLE_NAME
      WHEN 'pressung_behaelter', 'pressung_weingaerten' THEN
        v_eltern := 'pressungen';
        v_eltern_id := COALESCE((v_alt ->> 'pressung_id')::uuid, (v_neu ->> 'pressung_id')::uuid);
        SELECT p.tenant_id INTO v_tenant FROM public.pressungen p WHERE p.id = v_eltern_id;
      WHEN 'verschneidung_quellen' THEN
        v_eltern := 'verschneidungen';
        v_eltern_id := COALESCE((v_alt ->> 'verschneidung_id')::uuid, (v_neu ->> 'verschneidung_id')::uuid);
        SELECT v.tenant_id INTO v_tenant FROM public.verschneidungen v WHERE v.id = v_eltern_id;
      WHEN 'ama_meldepositionen' THEN
        v_eltern := 'ama_erntemeldungen';
        v_eltern_id := COALESCE((v_alt ->> 'meldung_id')::uuid, (v_neu ->> 'meldung_id')::uuid);
        SELECT a.tenant_id INTO v_tenant FROM public.ama_erntemeldungen a WHERE a.id = v_eltern_id;
      WHEN 'ernte_parzellen' THEN
        v_eltern := 'weinjahrgaenge';
        v_eltern_id := COALESCE((v_alt ->> 'jahrgang_id')::uuid, (v_neu ->> 'jahrgang_id')::uuid);
        SELECT j.tenant_id INTO v_tenant FROM public.weinjahrgaenge j WHERE j.id = v_eltern_id;
      ELSE
        NULL;
    END CASE;

    -- (2) Protokollzeile der Eltern-Löschung (FK-Kaskade)
    IF v_tenant IS NULL AND v_eltern_id IS NOT NULL THEN
      SELECT b.tenant_id INTO v_tenant
        FROM public.bestandsprotokoll b
       WHERE b.tabelle = v_eltern AND b.datensatz_id = v_eltern_id
         AND b.aktion = 'DELETE' AND b.tenant_id IS NOT NULL
       ORDER BY b.id DESC
       LIMIT 1;
    END IF;

    -- (3) noch vorhandene Verweise
    IF v_tenant IS NULL THEN
      CASE TG_TABLE_NAME
        WHEN 'pressung_behaelter' THEN
          SELECT w.tenant_id INTO v_tenant FROM public.weinausbau w WHERE w.id = (v_alt ->> 'weinausbau_id')::uuid;
        WHEN 'verschneidung_quellen' THEN
          SELECT w.tenant_id INTO v_tenant FROM public.weinausbau w WHERE w.id = (v_alt ->> 'quell_weinausbau_id')::uuid;
        WHEN 'pressung_weingaerten' THEN
          v_tenant := COALESCE(
            (SELECT g.tenant_id FROM public.weingarten g    WHERE g.id = (v_alt ->> 'weingarten_id')::uuid),
            (SELECT z.tenant_id FROM public.zukauf_posten z WHERE z.id = (v_alt ->> 'zukauf_posten_id')::uuid),
            (SELECT s.tenant_id FROM public.grundstuecke s  WHERE s.id = (v_alt ->> 'grundstueck_id')::uuid));
        WHEN 'ernte_parzellen' THEN
          v_tenant := COALESCE(
            (SELECT g.tenant_id FROM public.weingarten g   WHERE g.id = (v_alt ->> 'weingarten_id')::uuid),
            (SELECT s.tenant_id FROM public.grundstuecke s WHERE s.id = (v_alt ->> 'grundstueck_id')::uuid));
        ELSE
          NULL;
      END CASE;
    END IF;
  END IF;

  -- (4) KAN-151: Mandanten-Löschung – Kind ohne tenant_id, Eltern schon weg: Betrieb aus dem Wartungs-Kennzeichen
  IF v_tenant IS NULL AND current_setting('s112.loeschen_erlaubt', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_tenant := current_setting('s112.loeschen_erlaubt', true)::uuid;
  END IF;

  -- Bypass Demo-Reset (siehe Kopfkommentar); nie für API-Benutzer, nie für echte Mandanten
  IF v_tenant = c_demo
     AND current_setting('s112.protokoll_aus', true) = c_demo::text
     AND v_rolle NOT IN ('authenticated', 'anon') THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.bestandsprotokoll
    (tenant_id, tabelle, datensatz_id, aktion, alt, neu, geaenderte_spalten, db_rolle, benutzer_id, grund)
  VALUES
    (v_tenant, TG_TABLE_NAME, COALESCE((v_alt ->> 'id')::uuid, (v_neu ->> 'id')::uuid), TG_OP,
     CASE WHEN TG_OP = 'DELETE' THEN v_alt ELSE v_alt_diff END,
     v_neu_diff, v_spalten, v_rolle, auth.uid(),
     -- KAN-145: Grund einer endgültigen Löschung (nur die Lösch-RPC setzt ihn, transaktionslokal);
     -- KAN-97: Grund einer Änderung (nur RPCs setzen s112.aenderung_grund, z. B. der Statuswechsel)
     CASE WHEN TG_OP = 'DELETE' THEN NULLIF(current_setting('s112.loesch_grund', true), '')
          ELSE NULLIF(current_setting('s112.aenderung_grund', true), '') END);

  RETURN NULL;
END;
$function$;
