-- KAN-440 Teil 2 (13.11.2026): Weinexport E3 – Ausfuhr- und Gelangensnachweis je Exportauftrag.
--
-- Bisher gab es dafür nichts: kein Feld für die MRN der Ausfuhranmeldung, keinen Beleg, keine Frist.
--   1. exportauftraege: ausfuhr_mrn, ausfuhr_anmeldung_datum (für den Vermerk „Ausgeführt: Ausfuhranmeldung Nr. … vom …“,
--      gedruckt wird er mit KAN-435), abschluss_ohne_nachweis (Grund, nur über den Statuswechsel).
--   2. export_nachweise: mehrere Belege je Auftrag (Art, Datum, Datei, Notiz) – Entscheidung Jörgen 13.11.2026, Frage 1A.
--      Anlegen und Entfernen direkt (RLS: Schreibrecht Warenwirtschaft, Paket-Modul Export), nie ändern; ab
--      „Abgeschlossen“ und bei stornierten Aufträgen gesperrt.
--   3. Privater Speicher export-nachweise, Ordner je Betrieb: <tenant_id>/<exportauftrag_id>/<zeit>-<datei>
--      (Lesen: Mitglieder; Hochladen/Löschen: Schreibrecht Warenwirtschaft; das Paket-Modul prüft die Tabelle).
--   4. „Abgeschlossen“ nur mit Nachweis – oder mit Begründung (Frage 4A); Mustersendungen ohne (Frage 6A).

-- ── 1. Felder am Auftrag ───────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.exportauftraege
  ADD COLUMN ausfuhr_mrn             text CONSTRAINT exportauftraege_ausfuhr_mrn_chk CHECK (ausfuhr_mrn IS NULL OR ausfuhr_mrn ~ '^[A-Z0-9]{18}$'),
  ADD COLUMN ausfuhr_anmeldung_datum date,
  ADD COLUMN abschluss_ohne_nachweis text CONSTRAINT exportauftraege_abschluss_ohne_nachweis_chk
    CHECK (abschluss_ohne_nachweis IS NULL OR char_length(abschluss_ohne_nachweis) BETWEEN 10 AND 400);
COMMENT ON COLUMN public.exportauftraege.ausfuhr_mrn IS 'KAN-440: MRN der Ausfuhranmeldung (18 Zeichen)';
COMMENT ON COLUMN public.exportauftraege.ausfuhr_anmeldung_datum IS 'KAN-440: Datum der Ausfuhranmeldung';
COMMENT ON COLUMN public.exportauftraege.abschluss_ohne_nachweis IS 'KAN-440: Begründung, wenn der Auftrag ohne Ausfuhr- bzw. Gelangensnachweis abgeschlossen wurde (setzt nur der Statuswechsel)';

-- MRN und Datum der Ausfuhranmeldung stehen meist erst beim Versand fest: auch ab „Versendet“ bzw. mit Rechnung änderbar
DROP TRIGGER a_freeze ON public.exportauftraege;
CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public.exportauftraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_freeze(
    'Exportauftrag versendet bzw. verrechnet',
    'o.storniert_am IS NULL AND (o.status IN (''versendet'', ''abgeschlossen'') OR o.verkaufsposten_id IS NOT NULL OR o.muster_ausgebucht_am IS NOT NULL)',
    'status,emcs_arc_nummer,emcs_status,emcs_datum,verpackung_kg,aktiv,storniert_am,storniert_von,storniert_von_name,storno_grund,verkaufsposten_id,muster_ausgebucht_am,ausfuhr_mrn,ausfuhr_anmeldung_datum',
    '');

-- Schutz: Status und Abschluss-Begründung nur über den Statuswechsel; MRN/Datum nach „Abgeschlossen“ nicht mehr
CREATE OR REPLACE FUNCTION public.s112_export_workflow_schutz()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_rolle text := coalesce(nullif(current_setting('role', true), 'none'), session_user::text);
  v_frei  text := nullif(current_setting('s112.freeze_frei', true), '');
BEGIN
  -- Wartung (Service-Role, SQL-Editor, Demo-Reset) und die RPC (Kennzeichen s112.freeze_frei): frei
  IF v_rolle NOT IN ('authenticated', 'anon') OR v_frei = '*' OR v_frei = TG_TABLE_NAME THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF coalesce(NEW.status, 'entwurf') <> 'entwurf' OR NEW.abschluss_ohne_nachweis IS NOT NULL THEN
      RAISE EXCEPTION 'Ein Exportauftrag beginnt als Entwurf – der Status ändert sich über den Statuswechsel.'
        USING ERRCODE = '42501', HINT = 'export_status';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.abschluss_ohne_nachweis IS DISTINCT FROM OLD.abschluss_ohne_nachweis THEN
    RAISE EXCEPTION 'Der Status eines Exportauftrags ändert sich nur über den Statuswechsel.'
      USING ERRCODE = '42501', HINT = 'export_status';
  END IF;
  IF OLD.status = 'abgeschlossen' AND (NEW.ausfuhr_mrn IS DISTINCT FROM OLD.ausfuhr_mrn
       OR NEW.ausfuhr_anmeldung_datum IS DISTINCT FROM OLD.ausfuhr_anmeldung_datum) THEN
    RAISE EXCEPTION 'Gesperrt: Der Exportauftrag ist abgeschlossen – die Angaben zur Ausfuhranmeldung lassen sich nicht mehr ändern.'
      USING ERRCODE = '42501', HINT = 'freeze';
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER a_export_workflow ON public.exportauftraege;
CREATE TRIGGER a_export_workflow BEFORE INSERT OR UPDATE OF status, abschluss_ohne_nachweis, ausfuhr_mrn, ausfuhr_anmeldung_datum ON public.exportauftraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_export_workflow_schutz();

-- ── 2. Nachweise ───────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.export_nachweise (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  exportauftrag_id uuid NOT NULL REFERENCES public.exportauftraege(id) ON DELETE CASCADE,
  art              text NOT NULL CONSTRAINT export_nachweise_art_chk
                     CHECK (art IN ('ausgangsvermerk', 'gelangensbestaetigung', 'frachtbrief', 'spediteurbescheinigung', 'sonstiger')),
  datum            date NOT NULL,
  datei_pfad       text NOT NULL CONSTRAINT export_nachweise_datei_pfad_key UNIQUE,
  dateiname        text NOT NULL CONSTRAINT export_nachweise_dateiname_chk CHECK (char_length(dateiname) BETWEEN 1 AND 200),
  notiz            text CONSTRAINT export_nachweise_notiz_chk CHECK (notiz IS NULL OR char_length(notiz) <= 400),
  erstellt_am      timestamptz NOT NULL DEFAULT now(),
  erstellt_von     uuid DEFAULT auth.uid(),
  -- die Datei liegt im Ordner des Betriebs und des Auftrags (Speicher-Policies prüfen den ersten Ordner)
  CONSTRAINT export_nachweise_datei_pfad_chk CHECK (char_length(datei_pfad) <= 400
    AND datei_pfad LIKE tenant_id::text || '/' || exportauftrag_id::text || '/%')
);
CREATE INDEX export_nachweise_tenant_idx ON public.export_nachweise (tenant_id);
CREATE INDEX export_nachweise_auftrag_idx ON public.export_nachweise (exportauftrag_id);
COMMENT ON TABLE public.export_nachweise IS
  'KAN-440: Ausfuhr- bzw. Gelangensnachweise je Exportauftrag (Beleg als Datei im Speicher export-nachweise). Anlegen und Entfernen direkt, nie ändern; ab „Abgeschlossen“ gesperrt.';

ALTER TABLE public.export_nachweise ENABLE ROW LEVEL SECURITY;
REVOKE TRUNCATE ON public.export_nachweise FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.export_nachweise FROM anon;
REVOKE UPDATE ON public.export_nachweise FROM authenticated;
CREATE POLICY export_nachweise_select ON public.export_nachweise FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.s112_meine_tenants()));
CREATE POLICY export_nachweise_insert ON public.export_nachweise FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m
                             WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin', 'tenant_admin', 'winzer')));
CREATE POLICY export_nachweise_delete ON public.export_nachweise FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT m.tenant_id FROM public.tenant_memberships m
                        WHERE m.user_id = (SELECT auth.uid()) AND m.aktiv AND m.role IN ('system_admin', 'tenant_admin', 'winzer')));
CREATE POLICY modul_insert ON public.export_nachweise AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.s112_darf_schreiben(tenant_id, 'warenwirtschaft'));
CREATE POLICY modul_delete ON public.export_nachweise AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.s112_darf_schreiben(tenant_id, 'warenwirtschaft'));
CREATE POLICY mitgliedschaft_aktiv ON public.export_nachweise AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants())));
CREATE POLICY abo_schreibsperre_ins ON public.export_nachweise AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_upd ON public.export_nachweise AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) WITH CHECK (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY abo_schreibsperre_del ON public.export_nachweise AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())));
CREATE POLICY zwei_faktor_aal ON public.export_nachweise AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.s112_aal_ok())) WITH CHECK ((SELECT public.s112_aal_ok()));
-- KAN-195: Paket-Modul Exportaufträge
CREATE POLICY paketmodul_ins ON public.export_nachweise AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_export'));
CREATE POLICY paketmodul_upd ON public.export_nachweise AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_export')) WITH CHECK (public.s112_paketmodul_frei(tenant_id, 'modul_export'));
CREATE POLICY paketmodul_del ON public.export_nachweise AS RESTRICTIVE FOR DELETE TO authenticated USING (public.s112_paketmodul_frei(tenant_id, 'modul_export'));

-- KAN-178: Verweis nur in den eigenen Betrieb
CREATE TRIGGER z_fremdverweis_exportauftrag_id BEFORE INSERT OR UPDATE OF exportauftrag_id, tenant_id ON public.export_nachweise
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('exportauftrag_id', 'exportauftraege', '', '', '');

-- Sperre: nie ändern; anlegen und entfernen nur, solange der Auftrag weder abgeschlossen noch storniert ist
CREATE FUNCTION public.s112_export_nachweis_schutz()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_rolle text := coalesce(nullif(current_setting('role', true), 'none'), session_user::text);
  v_frei  text := nullif(current_setting('s112.freeze_frei', true), '');
  v_z     record;
  v_a     record;
BEGIN
  IF TG_OP = 'DELETE' THEN v_z := OLD; ELSE v_z := NEW; END IF;
  -- Wartung (Service-Role, SQL-Editor, Demo-Reset): frei
  IF v_rolle NOT IN ('authenticated', 'anon') OR v_frei = '*' OR v_frei = TG_TABLE_NAME THEN
    RETURN v_z;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Ein Nachweis lässt sich nicht ändern – bitte entfernen und neu erfassen.' USING ERRCODE = '42501', HINT = 'freeze';
  END IF;
  SELECT a.status, a.storniert_am INTO v_a FROM public.exportauftraege a
   WHERE a.id = v_z.exportauftrag_id AND a.tenant_id = v_z.tenant_id;
  IF NOT FOUND THEN
    -- Auftrag wird gerade gelöscht (Kaskade) bzw. gehört nicht zum Betrieb – das meldet der Fremdverweis-Trigger
    RETURN v_z;
  END IF;
  IF v_a.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Gesperrt: Der Exportauftrag ist storniert – Nachweise lassen sich nicht mehr ändern.' USING ERRCODE = '42501', HINT = 'freeze';
  END IF;
  IF v_a.status = 'abgeschlossen' THEN
    RAISE EXCEPTION 'Gesperrt: Der Exportauftrag ist abgeschlossen – Nachweise lassen sich nicht mehr ändern.' USING ERRCODE = '42501', HINT = 'freeze';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.datum > (now() AT TIME ZONE 'Europe/Vienna')::date THEN
    RAISE EXCEPTION 'Das Datum des Nachweises liegt in der Zukunft.' USING ERRCODE = '23514', HINT = 'datum';
  END IF;
  RETURN v_z;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_export_nachweis_schutz() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_nachweis_schutz BEFORE INSERT OR UPDATE OR DELETE ON public.export_nachweise
  FOR EACH ROW EXECUTE FUNCTION public.s112_export_nachweis_schutz();

-- ── 3. Speicher ────────────────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('export-nachweise', 'export-nachweise', false, 5242880, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "export-nachweise: Lesen (Mitglieder)" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'export-nachweise'
         AND (storage.foldername(objects.name))[1] IN
             (SELECT m.tenant_id::text FROM public.s112_meine_tenants() AS m(tenant_id)));
CREATE POLICY "export-nachweise: Hochladen (Schreibrecht warenwirtschaft)" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'export-nachweise'
              AND EXISTS (SELECT 1 FROM public.s112_meine_tenants() AS m(tenant_id)
                           WHERE m.tenant_id::text = (storage.foldername(objects.name))[1]
                             AND public.s112_darf_schreiben(m.tenant_id, 'warenwirtschaft')));
CREATE POLICY "export-nachweise: Löschen (Schreibrecht warenwirtschaft)" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'export-nachweise'
         AND EXISTS (SELECT 1 FROM public.s112_meine_tenants() AS m(tenant_id)
                      WHERE m.tenant_id::text = (storage.foldername(objects.name))[1]
                        AND public.s112_darf_schreiben(m.tenant_id, 'warenwirtschaft')));

-- ── 4. Statuswechsel: „Abgeschlossen“ nur mit Nachweis bzw. Begründung ─────────────────────────────────────────────
DO $kan440b$
DECLARE
  v_def text;
  r     record;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 's112_exportauftrag_status_setzen';
  FOR r IN SELECT * FROM (VALUES
      ('  v_diff  integer;
BEGIN',
       '  v_diff  integer;
  v_ohne  text;
BEGIN'),
      ('      RAISE EXCEPTION ''„Versendet“ geht erst, wenn die Rechnung gestellt ist.'' USING ERRCODE = ''23514'', HINT = ''export_status'';
    END IF;',
       '      RAISE EXCEPTION ''„Versendet“ geht erst, wenn die Rechnung gestellt ist.'' USING ERRCODE = ''23514'', HINT = ''export_status'';
    END IF;
    -- KAN-440 Teil 2: abschließen nur mit Nachweis – oder mit Begründung; Mustersendungen ohne
    IF p_status = ''abgeschlossen'' AND NOT coalesce(v_a.mustersendung, false)
       AND NOT EXISTS (SELECT 1 FROM public.export_nachweise n WHERE n.exportauftrag_id = v_a.id AND n.tenant_id = p_tenant_id) THEN
      IF length(coalesce(v_grund, '''')) < 10 THEN
        RAISE EXCEPTION ''Zum Abschließen fehlt der Ausfuhr- bzw. Gelangensnachweis – bitte den Nachweis erfassen oder den Abschluss ohne Nachweis begründen (mindestens 10 Zeichen).''
          USING ERRCODE = ''23514'', HINT = ''nachweis'';
      END IF;
      v_ohne := left(v_grund, 400);
    END IF;'),
      ('  UPDATE public.exportauftraege SET status = p_status WHERE id = v_a.id AND tenant_id = p_tenant_id;',
       '  UPDATE public.exportauftraege SET status = p_status, abschluss_ohne_nachweis = v_ohne WHERE id = v_a.id AND tenant_id = p_tenant_id;')
    ) AS x(alt, neu)
  LOOP
    IF (length(v_def) - length(replace(v_def, r.alt, ''))) / length(r.alt) <> 1 THEN
      RAISE EXCEPTION 'KAN-440: s112_exportauftrag_status_setzen – Stelle nicht genau einmal gefunden: %', left(r.alt, 60);
    END IF;
    v_def := replace(v_def, r.alt, r.neu);
  END LOOP;
  EXECUTE v_def;
END
$kan440b$;
