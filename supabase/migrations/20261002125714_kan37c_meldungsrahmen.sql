-- KAN-37 Etappe C (02.10.2026): gemeinsamer Meldungsrahmen und Lese-Sperre nach dem Einreichen
-- Entscheidungen Jörgen 02.10.2026: (1) Rahmen als Spalten an der Erntemeldung – die Tabelle der Bestandsmeldung entsteht
-- mit KAN-43 und bekommt dieselben Spalten; (2) nach dem Einreichen sind Lesedaten und Lesen bis zum Stichtag gesperrt,
-- Änderungen erst nach „Korrekturmeldung anlegen“ (solange die Korrektur offen ist); Pressungen bleiben frei.
--
--  1. ama_erntemeldungen: meldungsart ('erntemeldung'), stichtag (30.11. des Jahrgangs), abgabefrist (15.12. des Jahrgangs),
--     eingereicht_von. Stichtag und Abgabefrist setzt beim Anlegen der Trigger a_ama_rahmen aus dem Jahrgang (auch für
--     Korrekturmeldungen); bestehende Meldungen werden nachgetragen (abgegeben ist nur die Demo-Meldung im Musterhof).
--  2. s112_ama_schutz: Benutzer ändern die Rahmenfelder nicht direkt; abgegebene Meldungen ohnehin unverändert (Etappe A).
--  3. s112_ama_status_setzen: „eingereicht“ merkt sich, wer eingereicht hat (eingereicht_von = auth.uid()).
--  4. s112_lese_meldesperre: Ist die neueste Version der Erntemeldung eines Jahrgangs abgegeben (eingereicht, bestätigt,
--     abgelehnt), sind Lesedaten (ernte_parzellen, Lesetag bis zum Stichtag oder ohne Lesetag) und Lesen (Beginn bis zum
--     Stichtag) dieses Jahrgangs gesperrt – Anlegen, Ändern, Stornieren, Löschen, für jede Rolle. Notizen bleiben änderbar.
--     Ausnahme wie Etappe A: Wartung im Demo-Betrieb Musterhof.

-- 1. Rahmen ─────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.ama_erntemeldungen
  ADD COLUMN meldungsart text NOT NULL DEFAULT 'erntemeldung' CONSTRAINT ama_erntemeldungen_meldungsart_check CHECK (meldungsart = 'erntemeldung'),
  ADD COLUMN stichtag date,
  ADD COLUMN abgabefrist date,
  ADD COLUMN eingereicht_von uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.s112_ama_rahmen()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_jahr integer;
BEGIN
  -- Stichtag 30.11. und Abgabefrist 15.12. des Jahrgangs (Erntemeldung, KAN-37 Punkt 6) – immer aus dem Jahrgang
  SELECT j.jahrgang INTO v_jahr FROM public.weinjahrgaenge j WHERE j.id = NEW.jahrgang_id;
  IF v_jahr IS NOT NULL THEN
    NEW.stichtag    := make_date(v_jahr, 11, 30);
    NEW.abgabefrist := make_date(v_jahr, 12, 15);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_ama_rahmen() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_ama_rahmen BEFORE INSERT ON public.ama_erntemeldungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_ama_rahmen();

UPDATE public.ama_erntemeldungen m SET stichtag = make_date(j.jahrgang, 11, 30), abgabefrist = make_date(j.jahrgang, 12, 15)
  FROM public.weinjahrgaenge j WHERE j.id = m.jahrgang_id AND m.stichtag IS NULL;
ALTER TABLE public.ama_erntemeldungen ALTER COLUMN stichtag SET NOT NULL, ALTER COLUMN abgabefrist SET NOT NULL;

-- 2. Schutz der Erntemeldung ─────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_ama_schutz()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rolle text := COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text);
  v_rpc   boolean := coalesce(current_setting('s112.ama_rpc', true), '') = 'an';
  c_status_felder constant text[] := ARRAY['status', 'bestaetigt_am', 'ama_referenznr', 'n8n_execution_id', 'n8n_status',
                                           'n8n_fehler', 'n8n_letzte_aktion', 'updated_at'];
BEGIN
  -- KAN-37: abgegebene Meldung – für JEDE Rolle (auch Service-Role, SQL-Editor, Wartung) unveränderlich. Einzige
  -- Ausnahme (Entscheidung Jörgen 02.10.2026): der Demo-Betrieb Musterhof für Wartung/Reset – seine Meldung ist eine
  -- Vorführung, keine Abgabe; App-Benutzer sehen auch dort die Sperre.
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.status NOT IN ('entwurf', 'bereit')
     AND NOT (OLD.tenant_id = '33333333-3333-4333-8333-333333333333'::uuid AND v_rolle NOT IN ('authenticated', 'anon')) THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Die AMA-Erntemeldung ist % – abgegebene Meldungen werden nie gelöscht (KAN-37); Korrekturen bitte als Korrekturmeldung (neue Version).', OLD.status
        USING ERRCODE = '42501';
    END IF;
    IF (to_jsonb(NEW) - c_status_felder) IS DISTINCT FROM (to_jsonb(OLD) - c_status_felder) THEN
      RAISE EXCEPTION 'Die AMA-Erntemeldung ist % – ihr Inhalt bleibt unverändert (KAN-37); Korrekturen bitte als Korrekturmeldung (neue Version).', OLD.status
        USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'eingereicht' AND NEW.status IN ('bestaetigt', 'abgelehnt')) THEN
      RAISE EXCEPTION 'Der Status einer abgegebenen AMA-Erntemeldung geht nur vorwärts (eingereicht → bestätigt/abgelehnt), nicht von „%“ auf „%“ (KAN-37).', OLD.status, NEW.status
        USING ERRCODE = '42501';
    END IF;
    -- API-Rollen ändern auch die Statusfelder nur über die RPC (KAN-148 C2)
    IF v_rolle IN ('authenticated', 'anon') AND NOT v_rpc THEN
      RAISE EXCEPTION 'Die AMA-Erntemeldung ist bereits % – sie bleibt unverändert; Korrekturen bitte als Korrekturmeldung (neue Version).', OLD.status
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- offene Meldungen: wie KAN-148 C2 – Wartung (Service-Role, n8n, SQL-Editor, Demo-Reset) und die RPCs frei
  IF v_rolle NOT IN ('authenticated', 'anon') OR v_rpc THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('entwurf', 'bereit') OR NEW.eingereicht_am IS NOT NULL OR NEW.bestaetigt_am IS NOT NULL
       OR NEW.ama_referenznr IS NOT NULL OR NEW.version <> 1 OR NEW.vorgaenger_id IS NOT NULL OR NEW.eingereicht_von IS NOT NULL THEN
      RAISE EXCEPTION 'Eine AMA-Erntemeldung wird als Entwurf angelegt; Einreichen, Rückmeldung und Korrekturen laufen über „Status setzen“ bzw. „Korrekturmeldung“ (KAN-148).' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.status NOT IN ('entwurf', 'bereit')
     OR NEW.eingereicht_am IS DISTINCT FROM OLD.eingereicht_am OR NEW.bestaetigt_am IS DISTINCT FROM OLD.bestaetigt_am
     OR NEW.ama_referenznr IS DISTINCT FROM OLD.ama_referenznr OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.vorgaenger_id IS DISTINCT FROM OLD.vorgaenger_id
     OR NEW.jahrgang_id IS DISTINCT FROM OLD.jahrgang_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     -- KAN-37 C: Rahmen (Meldungsart, Stichtag, Abgabefrist, eingereicht von) setzen Trigger bzw. RPC
     OR NEW.meldungsart IS DISTINCT FROM OLD.meldungsart OR NEW.stichtag IS DISTINCT FROM OLD.stichtag
     OR NEW.abgabefrist IS DISTINCT FROM OLD.abgabefrist OR NEW.eingereicht_von IS DISTINCT FROM OLD.eingereicht_von THEN
    RAISE EXCEPTION 'Status, Einreich- und Rückmeldedatum, Referenznummer und Version ändert nur „Status setzen“ bzw. „Korrekturmeldung“ (KAN-148).'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_ama_schutz() FROM PUBLIC, anon, authenticated;

-- 3. Status setzen: eingereicht von ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_ama_status_setzen(p_tenant_id uuid, p_meldung_id uuid, p_status text, p_datum date, p_referenznr text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_m record;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT public.s112_darf_schreiben(p_tenant_id, VARIADIC ARRAY['rieden']) THEN
    RAISE EXCEPTION 'Für die AMA-Erntemeldung fehlt das Schreibrecht (Modul Rieden).' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('eingereicht', 'bestaetigt', 'abgelehnt') THEN
    RAISE EXCEPTION 'Unbekannter Status „%“.', coalesce(p_status, '–') USING ERRCODE = '22023';
  END IF;
  -- KAN-37 B: jede Abgabe hat ihren Snapshot – „eingereicht“ nur über s112_ama_einreichen
  IF p_status = 'eingereicht' AND coalesce(current_setting('s112.ama_einreichen', true), '') <> 'an' THEN
    RAISE EXCEPTION 'Eingereicht wird über „Einreichen“ (s112_ama_einreichen) – dabei wird die abgegebene CSV gespeichert (KAN-37).' USING ERRCODE = '42501';
  END IF;
  IF p_datum IS NULL THEN
    RAISE EXCEPTION 'Bitte das Datum angeben.' USING ERRCODE = '22023';
  END IF;
  IF p_datum > current_date THEN
    RAISE EXCEPTION 'Das Datum liegt in der Zukunft.' USING ERRCODE = '22023';
  END IF;
  SELECT m.* INTO v_m FROM public.ama_erntemeldungen m WHERE m.id = p_meldung_id AND m.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMA-Erntemeldung nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ama_erntemeldungen x WHERE x.tenant_id = p_tenant_id AND x.jahrgang_id = v_m.jahrgang_id AND x.version > v_m.version) THEN
    RAISE EXCEPTION 'Das ist nicht die neueste Version der Meldung – bitte die Seite neu laden.' USING ERRCODE = '42501';
  END IF;
  IF NOT ((v_m.status = 'bereit' AND p_status = 'eingereicht')
          OR (v_m.status = 'eingereicht' AND p_status IN ('bestaetigt', 'abgelehnt'))) THEN
    RAISE EXCEPTION 'Der Status kann nur vorwärts gesetzt werden (bereit → eingereicht → bestätigt/abgelehnt), nicht von „%“ auf „%“.', v_m.status, p_status
      USING ERRCODE = '42501';
  END IF;
  IF p_status <> 'eingereicht' AND p_datum < v_m.eingereicht_am::date THEN
    RAISE EXCEPTION 'Die Rückmeldung kann nicht vor dem Einreichen (%) liegen.', to_char(v_m.eingereicht_am, 'DD.MM.YYYY') USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('s112.ama_rpc', 'an', true);
  IF p_status = 'eingereicht' THEN
    UPDATE public.ama_erntemeldungen SET status = 'eingereicht', eingereicht_am = p_datum, eingereicht_von = auth.uid(),
           ama_referenznr = coalesce(NULLIF(btrim(p_referenznr), ''), ama_referenznr)
     WHERE id = p_meldung_id;
    UPDATE public.weinjahrgaenge SET ama_gemeldet = true, ama_meldedatum = p_datum,
           ama_meldungsnr = coalesce(NULLIF(btrim(p_referenznr), ''), ama_meldungsnr)
     WHERE id = v_m.jahrgang_id AND tenant_id = p_tenant_id;
  ELSE
    UPDATE public.ama_erntemeldungen SET status = p_status, bestaetigt_am = p_datum,
           ama_referenznr = coalesce(NULLIF(btrim(p_referenznr), ''), ama_referenznr)
     WHERE id = p_meldung_id;
  END IF;
  PERFORM set_config('s112.ama_rpc', '', true);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_ama_status_setzen(uuid, uuid, text, date, text) FROM PUBLIC, anon;

-- 4. Lese-Sperre nach dem Einreichen ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_lese_meldesperre()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rolle  text := COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text);
  v_zeile  jsonb;
  v_jg     uuid;
  v_datum  date;
  v_m      record;
  v_runde  integer;
  c_frei   constant text[] := ARRAY['notizen', 'updated_at'];
BEGIN
  -- Nur Notizen geändert: immer erlaubt
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - c_frei) = (to_jsonb(OLD) - c_frei) THEN
    RETURN NEW;
  END IF;
  -- Alte und neue Zeile prüfen (Verschieben in einen anderen Jahrgang bzw. auf ein anderes Datum)
  FOR v_runde IN 1..2 LOOP
    CONTINUE WHEN v_runde = 1 AND TG_OP = 'INSERT';
    CONTINUE WHEN v_runde = 2 AND TG_OP = 'DELETE';
    v_zeile := CASE WHEN v_runde = 1 THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
    v_jg := (v_zeile ->> 'jahrgang_id')::uuid;
    v_datum := CASE TG_TABLE_NAME WHEN 'lesen' THEN (v_zeile ->> 'beginn')::date ELSE (v_zeile ->> 'ernte_datum')::date END;
    SELECT m.status, m.stichtag, m.tenant_id, j.jahrgang INTO v_m
      FROM public.ama_erntemeldungen m JOIN public.weinjahrgaenge j ON j.id = m.jahrgang_id
     WHERE m.jahrgang_id = v_jg ORDER BY m.version DESC LIMIT 1;
    IF FOUND AND v_m.status NOT IN ('entwurf', 'bereit') AND (v_datum IS NULL OR v_datum <= v_m.stichtag)
       AND NOT (v_m.tenant_id = '33333333-3333-4333-8333-333333333333'::uuid AND v_rolle NOT IN ('authenticated', 'anon')) THEN
      RAISE EXCEPTION 'Die Erntemeldung % ist bereits abgegeben – % bis zum Stichtag % sind gesperrt (KAN-37). Für Änderungen bitte auf der Lese-Seite „Korrekturmeldung anlegen“.',
        v_m.jahrgang, CASE TG_TABLE_NAME WHEN 'lesen' THEN 'Lesen' ELSE 'Lesedaten' END, to_char(v_m.stichtag, 'DD.MM.YYYY')
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_lese_meldesperre() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_lese_meldesperre BEFORE INSERT OR UPDATE OR DELETE ON public.ernte_parzellen
  FOR EACH ROW EXECUTE FUNCTION public.s112_lese_meldesperre();
CREATE TRIGGER a_lese_meldesperre BEFORE INSERT OR UPDATE OR DELETE ON public.lesen
  FOR EACH ROW EXECUTE FUNCTION public.s112_lese_meldesperre();