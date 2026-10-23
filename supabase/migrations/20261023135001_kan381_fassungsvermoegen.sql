-- KAN-381 (23.10.2026, Entscheidung Jörgen): Ein Gebinde darf nicht überfüllt werden
--
-- Befund (UAT Musterhof 23.10.2026): 1.100 l Schaumwein in „Barrique 3“ (225 l) und zwei Chargen mit zusammen 1.900 l in
-- „Immervolltank 09“ (1.000 l) – ohne Sperre. Nur einzelne Wege prüften das Fassungsvermögen (Kellerplan, Chargen-Seite,
-- Pressung, seit PR #469 die Produktion), Verschnitt und Zukauf warnten nur, die Datenbank prüfte nichts.
--
-- Regel (dieselbe wie src/lib/keller/fassungsvermoegen.ts):
--   * gilt nur, wenn behaelter.volumen_liter > 0 hinterlegt ist (unbekannt → keine Sperre),
--   * Inhalt = Summe weinausbau.menge_liter aller aktiven, nicht stornierten Chargen mit Menge > 0 im Gebinde – über alle
--     Betriebe (Kellergemeinschaft: Wein eines Partnerbetriebs im Gebinde zählt mit). Derselbe Bestand wie
--     v_behaelter_fuellstand (KAN-44 Teil 2) bzw. lade_behaelter (eigen_liter + fremd_liter); andere Gebinde-Inhalte gibt es
--     nicht (Pressung, Zukauf, Produktion, Umzug, Verschnitt und Behandlungs-Zugang buchen alle auf weinausbau),
--   * Toleranz 0,5 l (wie Kellerplan-Ziehen, KAN-114, und Most-Prüfung KAN-126),
--   * gesperrt wird nur, was den Inhalt eines Gebindes ERHÖHT: Inhalt am Ende der Transaktion > Fassungsvermögen + 0,5 l
--     UND größer als vor der ersten Änderung dieses Gebindes in der Transaktion. Eine bestehende Überfüllung (Musterhof,
--     siehe Bestandsaufnahme im PR) blockiert also weder das Mindern noch das Umbenennen, Abstufen oder Stornieren einer
--     Charge darin – nur weitere Zugänge.
--
-- Umsetzung:
--   1. a_fassung_vorher (BEFORE INSERT/UPDATE OF menge_liter, behaelter_id, aktiv, storniert_am): merkt sich je Gebinde den
--      Inhalt vor der ersten Änderung in dieser Transaktion (transaktionslokale Einstellung s112.fassung_vorher, jsonb).
--   2. z_fassungsvermoegen (CONSTRAINT TRIGGER, AFTER INSERT/UPDATE OF …, DEFERRABLE INITIALLY DEFERRED): prüft am Ende
--      der Transaktion jedes Gebinde, dessen Inhalt eine Zeile erhöht hat. So dürfen Umzug, Verschnitt, Produktion usw.
--      innerhalb einer RPC zuerst das Ziel erhöhen und danach die Quelle mindern (bzw. umgekehrt). Die Prüfung sperrt das
--      Gebinde (FOR NO KEY UPDATE), damit zwei gleichzeitige Zugänge nicht beide durchgehen.
--      Folge der aufgeschobenen Prüfung: ein TRUNCATE von weinausbau nach einer Änderung in derselben Transaktion scheitert
--      schon mit 55006 (offene Trigger-Ereignisse) statt am Sperr-Trigger (42501) – gesperrt bleibt es so oder so.
--   Meldung: „Die Charge (X l) passt nicht in „<Gebinde>“ (Fassungsvermögen Y l, frei Z l).“ – X = Zugang in diesem Gebinde
--   in der Transaktion, Z = Fassungsvermögen − Inhalt davor; ERRCODE 23514 (check_violation), HINT 'fassungsvermoegen'.
--   dbFehlerText() reicht die Meldung bei 23514 unverändert ans Formular weiter.
--   Ausgenommen: Wartung (s112_wartung_frei – Service-Role/SQL-Editor mit s112.loeschen_erlaubt bzw. Demo-Reset des
--   Musterhofs mit s112.protokoll_aus). Sonst gilt die Sperre für alle Rollen, auch für die Service-Role.
--
-- Keine Datenänderung (die zwei überfüllten Musterhof-Gebinde bleiben; Korrektur gesondert). Kein session_replication_role.
-- Fremdverweis-, Abo- und Paketmodul-Regeln betreffen Triggerfunktionen nicht. Staging zuerst (sjpeghrlhsowmquacjhb),
-- DB-Test 84 (scripts/db-tests/84_fassungsvermoegen.sql), dann Produktion.

-- 1. Inhalt vor der ersten Änderung merken ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_fassung_vorher()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_map    jsonb;
  v_beh    uuid;
  v_inhalt numeric;
BEGIN
  IF public.s112_wartung_frei(NEW.tenant_id) THEN
    RETURN NEW;
  END IF;
  v_map := COALESCE(nullif(current_setting('s112.fassung_vorher', true), '')::jsonb, '{}'::jsonb);
  FOREACH v_beh IN ARRAY ARRAY[NEW.behaelter_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.behaelter_id END] LOOP
    CONTINUE WHEN v_beh IS NULL OR v_map ? v_beh::text;
    -- Stand vor dieser Zeile: die Änderung der Zeile selbst ist im BEFORE-Trigger noch nicht sichtbar
    SELECT COALESCE(sum(w.menge_liter), 0) INTO v_inhalt
      FROM public.weinausbau w
     WHERE w.behaelter_id = v_beh AND w.aktiv AND w.storniert_am IS NULL AND w.menge_liter > 0;
    v_map := v_map || jsonb_build_object(v_beh::text, v_inhalt);
  END LOOP;
  PERFORM set_config('s112.fassung_vorher', v_map::text, true);
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_fassung_vorher() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.s112_fassung_vorher() IS
  'KAN-381: Inhalt je Gebinde vor der ersten Änderung in der Transaktion (s112.fassung_vorher) – Trigger a_fassung_vorher an weinausbau';

DROP TRIGGER IF EXISTS a_fassung_vorher ON public.weinausbau;
CREATE TRIGGER a_fassung_vorher
  BEFORE INSERT OR UPDATE OF menge_liter, behaelter_id, aktiv, storniert_am
  ON public.weinausbau
  FOR EACH ROW EXECUTE FUNCTION public.s112_fassung_vorher();

-- 2. Fassungsvermögen am Ende der Transaktion prüfen ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_fassungsvermoegen_pruefen()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_neu    numeric;
  v_alt    numeric;
  v_beh    record;
  v_inhalt numeric;
  v_vorher numeric;
  v_frei   numeric;
BEGIN
  IF NEW.behaelter_id IS NULL OR public.s112_wartung_frei(NEW.tenant_id) THEN
    RETURN NULL;
  END IF;
  -- Beitrag der Zeile zum Inhalt ihres Gebindes nach bzw. vor der Änderung (vorher nur, wenn sie schon dort lag)
  v_neu := CASE WHEN NEW.aktiv AND NEW.storniert_am IS NULL AND COALESCE(NEW.menge_liter, 0) > 0 THEN NEW.menge_liter ELSE 0 END;
  v_alt := CASE WHEN TG_OP = 'UPDATE' AND OLD.behaelter_id IS NOT DISTINCT FROM NEW.behaelter_id
                 AND OLD.aktiv AND OLD.storniert_am IS NULL AND COALESCE(OLD.menge_liter, 0) > 0
                THEN OLD.menge_liter ELSE 0 END;
  IF v_neu <= v_alt THEN
    RETURN NULL;   -- erhöht den Inhalt dieses Gebindes nicht (mindern, umbenennen, abstufen, stornieren)
  END IF;

  SELECT b.id, b.name, b.volumen_liter INTO v_beh
    FROM public.behaelter b WHERE b.id = NEW.behaelter_id
     FOR NO KEY UPDATE;
  IF NOT FOUND OR COALESCE(v_beh.volumen_liter, 0) <= 0 THEN
    RETURN NULL;   -- Fassungsvermögen unbekannt: keine Sperre
  END IF;

  SELECT COALESCE(sum(w.menge_liter), 0) INTO v_inhalt
    FROM public.weinausbau w
   WHERE w.behaelter_id = NEW.behaelter_id AND w.aktiv AND w.storniert_am IS NULL AND w.menge_liter > 0;
  IF v_inhalt <= v_beh.volumen_liter + 0.5 THEN
    RETURN NULL;
  END IF;

  v_vorher := (nullif(current_setting('s112.fassung_vorher', true), '')::jsonb ->> NEW.behaelter_id::text)::numeric;
  IF v_vorher IS NULL THEN
    v_vorher := v_inhalt - (v_neu - v_alt);
  END IF;
  IF v_inhalt <= v_vorher + 0.005 THEN
    RETURN NULL;   -- der Vorgang erhöht den Inhalt insgesamt nicht (bestehende Überfüllung bleibt bearbeitbar)
  END IF;

  v_frei := greatest(0, v_beh.volumen_liter - v_vorher);
  RAISE EXCEPTION 'Die Charge (% l) passt nicht in „%“ (Fassungsvermögen % l, frei % l).',
      translate(rtrim(to_char(round(v_inhalt - v_vorher, 2), 'FM999,999,999,990.99'), '.'), ',.', '.,'),
      v_beh.name,
      translate(rtrim(to_char(round(v_beh.volumen_liter, 2), 'FM999,999,999,990.99'), '.'), ',.', '.,'),
      translate(rtrim(to_char(round(v_frei, 2), 'FM999,999,999,990.99'), '.'), ',.', '.,')
    USING ERRCODE = '23514', HINT = 'fassungsvermoegen',
          DETAIL = jsonb_build_object('behaelter_id', v_beh.id, 'volumen_liter', v_beh.volumen_liter,
                                      'inhalt_vorher', v_vorher, 'inhalt_nachher', v_inhalt)::text;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_fassungsvermoegen_pruefen() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.s112_fassungsvermoegen_pruefen() IS
  'KAN-381: kein Zugang über das Fassungsvermögen eines Gebindes (+0,5 l) – Constraint-Trigger z_fassungsvermoegen an weinausbau';

DROP TRIGGER IF EXISTS z_fassungsvermoegen ON public.weinausbau;
CREATE CONSTRAINT TRIGGER z_fassungsvermoegen
  AFTER INSERT OR UPDATE OF menge_liter, behaelter_id, aktiv, storniert_am
  ON public.weinausbau
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  -- nur Zeilen, die danach Wein in einem Gebinde haben (Mindern auf 0, Storno, Deaktivieren erzeugen kein Ereignis)
  WHEN (NEW.behaelter_id IS NOT NULL AND NEW.aktiv AND NEW.storniert_am IS NULL AND NEW.menge_liter > 0)
  EXECUTE FUNCTION public.s112_fassungsvermoegen_pruefen();

-- 3. Selbstprüfung ─────────────────────────────────────────────────────────────────────────────────────────────────
DO $pruef$
DECLARE
  v_fn text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'a_fassung_vorher' AND tgrelid = 'public.weinausbau'::regclass AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'KAN-381: Trigger a_fassung_vorher an weinausbau fehlt';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'z_fassungsvermoegen' AND tgrelid = 'public.weinausbau'::regclass
                   AND tgdeferrable AND tginitdeferred) THEN
    RAISE EXCEPTION 'KAN-381: Constraint-Trigger z_fassungsvermoegen an weinausbau fehlt oder ist nicht aufgeschoben';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY['public.s112_fassung_vorher()', 'public.s112_fassungsvermoegen_pruefen()'] LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'KAN-381: % ist für anon/authenticated ausführbar', v_fn;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_fn::regprocedure AND prosecdef
                     AND proconfig @> ARRAY['search_path=public']) THEN
      RAISE EXCEPTION 'KAN-381: % ohne SECURITY DEFINER bzw. search_path', v_fn;
    END IF;
  END LOOP;
END
$pruef$;
