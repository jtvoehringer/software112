-- KAN-440 Teil 1 (13.11.2026): Weinexport E3 – Statuswechsel des Exportauftrags nur noch mit Prüfung.
--
-- Bisher war der Status ein frei wählbares Feld: jeder Wert, auch rückwärts, auch „Versendet“ ohne Rechnung.
-- Jetzt ändert er sich nur über s112_exportauftrag_status_setzen (dieselben Regeln: exportUebergangFehler in
-- src/lib/export/workflow.ts); ein neuer Auftrag ist immer ein Entwurf (Trigger a_export_workflow).
--
--   Entwurf → Bestätigt → Versendet → Abgeschlossen
--   „Versendet“ nur mit Rechnung bzw. ausgebuchtem Muster.
--   Zurück je ein Schritt (Bestätigt → Entwurf nur ohne Rechnung/Muster, Versendet → Bestätigt) – nur Betriebsleitung,
--   mit Grund (≥ 10 Zeichen, steht im Änderungsprotokoll). „Abgeschlossen“ ist endgültig. (Entscheidungen Jörgen
--   13.11.2026, Fragen 5A.) Die Prüfung des Nachweises vor „Abgeschlossen“ kommt mit Teil 2.

-- ── 1. Schutz: Status nie direkt ───────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_export_workflow_schutz()
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
    IF coalesce(NEW.status, 'entwurf') <> 'entwurf' THEN
      RAISE EXCEPTION 'Ein Exportauftrag beginnt als Entwurf – der Status ändert sich über den Statuswechsel.'
        USING ERRCODE = '42501', HINT = 'export_status';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Der Status eines Exportauftrags ändert sich nur über den Statuswechsel.'
      USING ERRCODE = '42501', HINT = 'export_status';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_export_workflow_schutz() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER a_export_workflow BEFORE INSERT OR UPDATE OF status ON public.exportauftraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_export_workflow_schutz();

-- ── 2. Statuswechsel ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_exportauftrag_status_setzen(p_tenant_id uuid, p_auftrag_id uuid, p_status text, p_grund text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  c_stufe constant jsonb := '{"entwurf": 0, "bestaetigt": 1, "versendet": 2, "abgeschlossen": 3}';
  c_label constant jsonb := '{"entwurf": "Entwurf", "bestaetigt": "Bestätigt", "versendet": "Versendet", "abgeschlossen": "Abgeschlossen"}';
  v_a     record;
  v_alt   text;
  v_grund text := NULLIF(btrim(coalesce(p_grund, '')), '');
  v_uid   uuid := (SELECT auth.uid());
  v_diff  integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_paketmodul(p_tenant_id, 'modul_export');
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft');

  IF p_status IS NULL OR NOT c_stufe ? p_status THEN
    RAISE EXCEPTION 'Unbekannter Status „%“.', coalesce(p_status, '') USING ERRCODE = '22023';
  END IF;

  SELECT id, referenz, status, storniert_am, verkaufsposten_id, muster_ausgebucht_am, mustersendung
    INTO v_a FROM public.exportauftraege WHERE id = p_auftrag_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exportauftrag nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_a.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Der Exportauftrag % ist storniert.', coalesce(v_a.referenz, '') USING ERRCODE = '42501';
  END IF;

  v_alt := coalesce(v_a.status, 'entwurf');
  IF NOT c_stufe ? v_alt THEN
    RAISE EXCEPTION 'Der Exportauftrag hat einen unbekannten Status „%“.', v_alt USING ERRCODE = '22023';
  END IF;
  v_diff := (c_stufe ->> p_status)::integer - (c_stufe ->> v_alt)::integer;
  IF v_diff = 0 THEN
    RAISE EXCEPTION 'Der Exportauftrag ist bereits „%“.', c_label ->> v_alt USING ERRCODE = '23514', HINT = 'export_status';
  END IF;
  IF v_alt = 'abgeschlossen' THEN
    RAISE EXCEPTION 'Der Exportauftrag ist abgeschlossen – der Status lässt sich nicht mehr ändern.' USING ERRCODE = '23514', HINT = 'export_status';
  END IF;
  IF abs(v_diff) <> 1 THEN
    RAISE EXCEPTION 'Von „%“ geht es nicht direkt auf „%“ – bitte Schritt für Schritt.', c_label ->> v_alt, c_label ->> p_status
      USING ERRCODE = '23514', HINT = 'export_status';
  END IF;

  IF v_diff = 1 THEN
    IF p_status = 'versendet' AND v_a.verkaufsposten_id IS NULL AND v_a.muster_ausgebucht_am IS NULL THEN
      IF v_a.mustersendung THEN
        RAISE EXCEPTION '„Versendet“ geht erst, wenn das Muster ausgebucht ist.' USING ERRCODE = '23514', HINT = 'export_status';
      END IF;
      RAISE EXCEPTION '„Versendet“ geht erst, wenn die Rechnung gestellt ist.' USING ERRCODE = '23514', HINT = 'export_status';
    END IF;
  ELSE
    -- zurückstufen: nur Betriebsleitung, mit Grund
    IF v_uid IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.tenant_memberships m
          WHERE m.tenant_id = p_tenant_id AND m.user_id = v_uid AND m.aktiv
            AND m.role = ANY (ARRAY['system_admin', 'tenant_admin'])) THEN
      RAISE EXCEPTION 'Zurückstufen darf nur die Betriebsleitung.' USING ERRCODE = '42501', HINT = 'export_status';
    END IF;
    IF length(coalesce(v_grund, '')) < 10 THEN
      RAISE EXCEPTION 'Bitte den Grund für das Zurückstufen angeben (mindestens 10 Zeichen).' USING ERRCODE = '23514', HINT = 'grund';
    END IF;
    IF p_status = 'entwurf' AND (v_a.verkaufsposten_id IS NOT NULL OR v_a.muster_ausgebucht_am IS NOT NULL) THEN
      RAISE EXCEPTION 'Zurück auf „Entwurf“ geht nicht, solange es eine Rechnung bzw. ein ausgebuchtes Muster gibt.'
        USING ERRCODE = '23514', HINT = 'export_status';
    END IF;
  END IF;

  PERFORM set_config('s112.freeze_frei', 'exportauftraege', true);
  PERFORM set_config('s112.aenderung_grund',
    'Statuswechsel ' || (c_label ->> v_alt) || ' → ' || (c_label ->> p_status) || coalesce(': ' || v_grund, ''), true);
  UPDATE public.exportauftraege SET status = p_status WHERE id = v_a.id AND tenant_id = p_tenant_id;
  PERFORM set_config('s112.aenderung_grund', '', true);
  PERFORM set_config('s112.freeze_frei', '', true);

  RETURN jsonb_build_object('id', v_a.id, 'status_alt', v_alt, 'status', p_status);
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_exportauftrag_status_setzen(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_exportauftrag_status_setzen(uuid, uuid, text, text) TO authenticated, service_role;
