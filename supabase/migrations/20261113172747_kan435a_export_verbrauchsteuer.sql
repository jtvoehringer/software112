-- KAN-435 D2 (13.11.2026): Weinexport D – Verbrauchsteuer-Angaben an Exportauftrag und Betrieb.
--
-- Am Auftrag gab es nur ARC-Nummer und EMCS-Status; im Betrieb keine Verbrauchsteuernummer (die frühere e-AD-Datei
-- schrieb die UID an deren Stelle). Neu – alles freiwillig, die Software prüft keine Pflicht (Entscheidung Jörgen
-- 13.11.2026, Frage 5A) und leitet daraus noch kein Dokument ab (wartet auf Auskünfte von Zollamt und BKI):
--   exportauftraege.verbrauchsteuer_verfahren     'aussetzung' (unter Steueraussetzung, e-VD) | 'freier_verkehr'
--   exportauftraege.mvv_code                      Code des weinrechtlichen Begleitdokuments (Art. 10 VO (EU) 2018/273)
--   exportauftraege.begleitdokument_nr            Nummer des Weinbegleitdokuments
--   exportauftraege.empfaenger_verbrauchsteuernr  Verbrauchsteuernummer (SEED) des Empfängers
--   tenant_einstellungen.betrieb_verbrauchsteuernr  Verbrauchsteuernummer (ATV/SEED) des Betriebs – ein Feld (Frage 4A)
-- Änderbar wie ARC und Belegnummern auch mit Rechnung bzw. ab „Versendet“ (die Nummern entstehen oft erst dann),
-- nach „Abgeschlossen“ gesperrt.

ALTER TABLE public.exportauftraege
  ADD COLUMN verbrauchsteuer_verfahren    text CONSTRAINT exportauftraege_verbrauchsteuer_verfahren_chk CHECK (verbrauchsteuer_verfahren IS NULL OR verbrauchsteuer_verfahren IN ('aussetzung', 'freier_verkehr')),
  ADD COLUMN mvv_code                     text CONSTRAINT exportauftraege_mvv_code_chk CHECK (mvv_code IS NULL OR char_length(mvv_code) BETWEEN 1 AND 40),
  ADD COLUMN begleitdokument_nr           text CONSTRAINT exportauftraege_begleitdokument_nr_chk CHECK (begleitdokument_nr IS NULL OR char_length(begleitdokument_nr) BETWEEN 1 AND 40),
  ADD COLUMN empfaenger_verbrauchsteuernr text CONSTRAINT exportauftraege_empfaenger_verbrauchsteuernr_chk CHECK (empfaenger_verbrauchsteuernr IS NULL OR char_length(empfaenger_verbrauchsteuernr) BETWEEN 1 AND 20);
COMMENT ON COLUMN public.exportauftraege.verbrauchsteuer_verfahren IS 'KAN-435: Verbrauchsteuerverfahren der Beförderung – aussetzung (unter Steueraussetzung) oder freier_verkehr; NULL = nicht festgelegt';
COMMENT ON COLUMN public.exportauftraege.mvv_code IS 'KAN-435: MVV-Code des weinrechtlichen Begleitdokuments (Art. 10 VO (EU) 2018/273)';
COMMENT ON COLUMN public.exportauftraege.begleitdokument_nr IS 'KAN-435: Nummer des Weinbegleitdokuments';
COMMENT ON COLUMN public.exportauftraege.empfaenger_verbrauchsteuernr IS 'KAN-435: Verbrauchsteuernummer (SEED) des Empfängers';

ALTER TABLE public.tenant_einstellungen
  ADD COLUMN betrieb_verbrauchsteuernr text CONSTRAINT tenant_einstellungen_betrieb_verbrauchsteuernr_chk CHECK (betrieb_verbrauchsteuernr IS NULL OR char_length(betrieb_verbrauchsteuernr) BETWEEN 1 AND 20);
COMMENT ON COLUMN public.tenant_einstellungen.betrieb_verbrauchsteuernr IS 'KAN-435: Verbrauchsteuernummer (ATV/SEED) des Betriebs – für das EMCS-Datenblatt';
-- kein Geheimnis: lesbar wie die übrigen Betriebsdaten (Spaltenrechte, KAN-135); geschrieben wird per Service-Role
GRANT SELECT (betrieb_verbrauchsteuernr) ON public.tenant_einstellungen TO authenticated, anon;

-- Sperre: die Verbrauchsteuer-Angaben bleiben wie ARC und Belegnummern ab „Versendet“ bzw. mit Rechnung änderbar
DROP TRIGGER a_freeze ON public.exportauftraege;
CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public.exportauftraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_freeze(
    'Exportauftrag versendet bzw. verrechnet',
    'o.storniert_am IS NULL AND (o.status IN (''versendet'', ''abgeschlossen'') OR o.verkaufsposten_id IS NOT NULL OR o.muster_ausgebucht_am IS NOT NULL)',
    'status,emcs_arc_nummer,emcs_status,emcs_datum,verpackung_kg,aktiv,storniert_am,storniert_von,storniert_von_name,storno_grund,verkaufsposten_id,muster_ausgebucht_am,ausfuhr_mrn,ausfuhr_anmeldung_datum,laender_belege,verbrauchsteuer_verfahren,mvv_code,begleitdokument_nr,empfaenger_verbrauchsteuernr',
    '');

-- … und nach „Abgeschlossen“ nicht mehr (wie Belegnummern und Angaben zur Ausfuhranmeldung)
DO $kan435a$
DECLARE
  v_def text;
  c_alt constant text := '  IF OLD.status = ''abgeschlossen'' AND NEW.laender_belege IS DISTINCT FROM OLD.laender_belege THEN';
  c_neu constant text := '  IF OLD.status = ''abgeschlossen'' AND (NEW.verbrauchsteuer_verfahren IS DISTINCT FROM OLD.verbrauchsteuer_verfahren
       OR NEW.mvv_code IS DISTINCT FROM OLD.mvv_code
       OR NEW.begleitdokument_nr IS DISTINCT FROM OLD.begleitdokument_nr
       OR NEW.empfaenger_verbrauchsteuernr IS DISTINCT FROM OLD.empfaenger_verbrauchsteuernr) THEN
    RAISE EXCEPTION ''Gesperrt: Der Exportauftrag ist abgeschlossen – die Angaben zu Verbrauchsteuer und Begleitdokument lassen sich nicht mehr ändern.''
      USING ERRCODE = ''42501'', HINT = ''freeze'';
  END IF;
  IF OLD.status = ''abgeschlossen'' AND NEW.laender_belege IS DISTINCT FROM OLD.laender_belege THEN';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 's112_export_workflow_schutz';
  IF v_def IS NULL OR (length(v_def) - length(replace(v_def, c_alt, ''))) / length(c_alt) <> 1 THEN
    RAISE EXCEPTION 'KAN-435: s112_export_workflow_schutz – Ankerstelle nicht genau einmal gefunden';
  END IF;
  EXECUTE replace(v_def, c_alt, c_neu);
END
$kan435a$;

DROP TRIGGER a_export_workflow ON public.exportauftraege;
CREATE TRIGGER a_export_workflow BEFORE INSERT OR UPDATE OF status, abschluss_ohne_nachweis, ausfuhr_mrn, ausfuhr_anmeldung_datum, laender_belege,
    verbrauchsteuer_verfahren, mvv_code, begleitdokument_nr, empfaenger_verbrauchsteuernr ON public.exportauftraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_export_workflow_schutz();
