-- KAN-437 Teil 3 (13.11.2026): Weinexport F – länderspezifische Belegnummern am Exportauftrag.
--
-- Manche Zielländer verlangen Nummern, die zur Sendung bzw. zum Wein gehören und vom Importeur kommen (USA: COLA je
-- Wein, Prior Notice je Sendung; Brasilien: Einfuhrlizenz …). Bisher gab es dafür nur das Notizfeld.
-- Entscheidung Jörgen 13.11.2026 (Frage 5A): freie Liste am Auftrag – Bezeichnung und Nummer, höchstens 20 Einträge;
-- änderbar bis „Abgeschlossen“ (auch mit Rechnung bzw. ab „Versendet“, weil die Nummern oft erst dann vorliegen).
-- Kein Druck auf Rechnung oder Packliste (Frage 6A) – Anzeige am Auftrag und in der CSV der Auftragsliste.

ALTER TABLE public.exportauftraege
  ADD COLUMN laender_belege jsonb NOT NULL DEFAULT '[]'::jsonb
    CONSTRAINT exportauftraege_laender_belege_chk CHECK (jsonb_typeof(laender_belege) = 'array' AND jsonb_array_length(laender_belege) <= 20);
COMMENT ON COLUMN public.exportauftraege.laender_belege IS
  'KAN-437: länderspezifische Belegnummern als Liste [{bezeichnung, nummer}] (z. B. COLA, Prior Notice) – höchstens 20, änderbar bis „Abgeschlossen“';

-- Sperre: Belegnummern bleiben wie MRN und Datum der Ausfuhranmeldung ab „Versendet“ bzw. mit Rechnung änderbar
DROP TRIGGER a_freeze ON public.exportauftraege;
CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public.exportauftraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_freeze(
    'Exportauftrag versendet bzw. verrechnet',
    'o.storniert_am IS NULL AND (o.status IN (''versendet'', ''abgeschlossen'') OR o.verkaufsposten_id IS NOT NULL OR o.muster_ausgebucht_am IS NOT NULL)',
    'status,emcs_arc_nummer,emcs_status,emcs_datum,verpackung_kg,aktiv,storniert_am,storniert_von,storniert_von_name,storno_grund,verkaufsposten_id,muster_ausgebucht_am,ausfuhr_mrn,ausfuhr_anmeldung_datum,laender_belege',
    '');

-- … und nach „Abgeschlossen“ nicht mehr (wie die Angaben zur Ausfuhranmeldung)
DO $kan437b$
DECLARE
  v_def text;
  c_alt constant text := '  IF OLD.status = ''abgeschlossen'' AND (NEW.ausfuhr_mrn IS DISTINCT FROM OLD.ausfuhr_mrn
       OR NEW.ausfuhr_anmeldung_datum IS DISTINCT FROM OLD.ausfuhr_anmeldung_datum) THEN';
  c_neu constant text := '  IF OLD.status = ''abgeschlossen'' AND NEW.laender_belege IS DISTINCT FROM OLD.laender_belege THEN
    RAISE EXCEPTION ''Gesperrt: Der Exportauftrag ist abgeschlossen – die Belegnummern lassen sich nicht mehr ändern.''
      USING ERRCODE = ''42501'', HINT = ''freeze'';
  END IF;
  IF OLD.status = ''abgeschlossen'' AND (NEW.ausfuhr_mrn IS DISTINCT FROM OLD.ausfuhr_mrn
       OR NEW.ausfuhr_anmeldung_datum IS DISTINCT FROM OLD.ausfuhr_anmeldung_datum) THEN';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 's112_export_workflow_schutz';
  IF v_def IS NULL OR (length(v_def) - length(replace(v_def, c_alt, ''))) / length(c_alt) <> 1 THEN
    RAISE EXCEPTION 'KAN-437: s112_export_workflow_schutz – Ankerstelle nicht genau einmal gefunden';
  END IF;
  EXECUTE replace(v_def, c_alt, c_neu);
END
$kan437b$;

DROP TRIGGER a_export_workflow ON public.exportauftraege;
CREATE TRIGGER a_export_workflow BEFORE INSERT OR UPDATE OF status, abschluss_ohne_nachweis, ausfuhr_mrn, ausfuhr_anmeldung_datum, laender_belege ON public.exportauftraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_export_workflow_schutz();
