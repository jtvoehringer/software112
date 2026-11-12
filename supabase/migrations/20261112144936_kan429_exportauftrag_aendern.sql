-- KAN-429 (12.11.2026): Exportauftrag bearbeiten (Entwurf und Bestätigt), Sperre ab „Versendet“.
--
-- Bisher ließ sich ein Exportauftrag nach dem Anlegen nicht mehr korrigieren (nur Status, EMCS, Verpackung).
-- Entscheidungen Jörgen 12.11.2026: bearbeitbar in Entwurf und Bestätigt; ab Versendet gesperrt (App und Datenbank);
-- „ausgestellte“ Dokumente gehen beim Bearbeiten zurück auf „ausstehend“; Positionen ohne Menge über 0 werden abgelehnt.
--
-- 1. Freeze am Exportauftrag ab Status versendet/abgeschlossen (Status, EMCS, Verpackung und Storno bleiben änderbar).
-- 2. Positionen eines versendeten Auftrags sind unveränderlich (Schutz-Trigger der Kindtabellen).
-- 3. s112_exportauftrag_aendern: Kopf und Positionen in einer Transaktion ersetzen, Dokumente zurücksetzen.

-- ── 1. Freeze ───────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public.exportauftraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_freeze(
    'Exportauftrag versendet',
    'o.storniert_am IS NULL AND o.status IN (''versendet'', ''abgeschlossen'')',
    'status,emcs_arc_nummer,emcs_status,emcs_datum,verpackung_kg,aktiv,storniert_am,storniert_von,storniert_von_name,storno_grund',
    '');

-- ── 2. Positionen ───────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_export_kind_schutz()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text) NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.exportauftraege a
              WHERE a.id IN (NEW.exportauftrag_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.exportauftrag_id END)
                AND a.storniert_am IS NOT NULL) THEN
    RAISE EXCEPTION 'Der Exportauftrag ist storniert und kann nicht mehr geändert werden (KAN-150).' USING ERRCODE = '42501';
  END IF;
  -- KAN-429: Positionen eines versendeten Auftrags bleiben stehen (Dokumente und ihr Status bleiben änderbar);
  -- Korrektur nur durch die Betriebsleitung (s112_freeze_korrektur setzt s112.freeze_frei)
  IF TG_TABLE_NAME = 'exportauftrag_positionen'
     AND COALESCE(NULLIF(current_setting('s112.freeze_frei', true), ''), '') NOT IN ('*', 'exportauftrag_positionen', 'exportauftraege')
     AND EXISTS (SELECT 1 FROM public.exportauftraege a
                  WHERE a.id IN (NEW.exportauftrag_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.exportauftrag_id END)
                    AND a.status IN ('versendet', 'abgeschlossen')) THEN
    RAISE EXCEPTION 'Gesperrt: Exportauftrag versendet – die Positionen lassen sich nicht mehr ändern.'
      USING ERRCODE = '42501', HINT = 'freeze';
  END IF;
  RETURN NEW;
END;
$$;

-- ── 3. Ändern ───────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.s112_exportauftrag_aendern(p_tenant_id uuid, p_auftrag_id uuid, p_kopf jsonb, p_positionen jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_a    record;
  v_z    jsonb;
  v_nr   integer := 0;
  v_dok  integer := 0;
  v_m    numeric;
  v_e    text;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_paketmodul(p_tenant_id, 'modul_export');
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft');

  IF p_kopf IS NULL OR jsonb_typeof(p_kopf) <> 'object' THEN
    RAISE EXCEPTION 'Die Auftragsdaten fehlen.' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(p_kopf ->> 'datum', '') IS NULL THEN
    RAISE EXCEPTION 'Bitte das Auftragsdatum angeben.' USING ERRCODE = '23514';
  END IF;
  IF p_positionen IS NULL OR jsonb_typeof(p_positionen) <> 'array' THEN
    RAISE EXCEPTION 'Die Positionen fehlen.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_positionen) > 200 THEN
    RAISE EXCEPTION 'Höchstens 200 Positionen je Exportauftrag.' USING ERRCODE = '23514';
  END IF;

  SELECT id, referenz, status, storniert_am INTO v_a FROM public.exportauftraege WHERE id = p_auftrag_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exportauftrag nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_a.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Der Exportauftrag % ist storniert und kann nicht mehr geändert werden.', coalesce(v_a.referenz, '') USING ERRCODE = '42501';
  END IF;
  IF coalesce(v_a.status, 'entwurf') NOT IN ('entwurf', 'bestaetigt') THEN
    RAISE EXCEPTION 'Gesperrt: Der Exportauftrag % ist versendet – bearbeiten lässt er sich nur als Entwurf oder Bestätigt.', coalesce(v_a.referenz, '')
      USING ERRCODE = '42501', HINT = 'freeze';
  END IF;

  -- Positionen prüfen, bevor etwas geschrieben wird
  FOR v_z IN SELECT e FROM jsonb_array_elements(p_positionen) e LOOP
    v_nr := v_nr + 1;
    v_m := NULLIF(v_z ->> 'menge', '')::numeric;
    v_e := coalesce(NULLIF(v_z ->> 'einheit', ''), 'Fl');
    IF v_m IS NULL OR v_m <= 0 THEN
      RAISE EXCEPTION 'Position %: Bitte eine Menge über 0 angeben.', v_nr USING ERRCODE = '23514', HINT = 'menge';
    END IF;
    IF v_e NOT IN ('Fl', 'Kiste', 'HL') THEN
      RAISE EXCEPTION 'Position %: unbekannte Einheit „%“.', v_nr, v_e USING ERRCODE = '23514';
    END IF;
    IF NULLIF(v_z ->> 'fullung_id', '') IS NULL AND NULLIF(btrim(coalesce(v_z ->> 'beschreibung', '')), '') IS NULL THEN
      RAISE EXCEPTION 'Position %: Bitte eine Füllung wählen oder eine Bezeichnung angeben.', v_nr USING ERRCODE = '23514';
    END IF;
  END LOOP;

  UPDATE public.exportauftraege SET
    kontakt_id        = NULLIF(p_kopf ->> 'kontakt_id', '')::uuid,
    firma_id          = NULLIF(p_kopf ->> 'firma_id', '')::uuid,
    datum             = (p_kopf ->> 'datum')::date,
    lieferdatum       = NULLIF(p_kopf ->> 'lieferdatum', '')::date,
    incoterms         = NULLIF(p_kopf ->> 'incoterms', ''),
    transport_art     = NULLIF(p_kopf ->> 'transport_art', ''),
    destination_land  = NULLIF(p_kopf ->> 'destination_land', ''),
    destination_stadt = NULLIF(btrim(coalesce(p_kopf ->> 'destination_stadt', '')), ''),
    eori_kunde        = NULLIF(btrim(coalesce(p_kopf ->> 'eori_kunde', '')), ''),
    versicherungswert = NULLIF(p_kopf ->> 'versicherungswert', '')::numeric,
    verpackung_kg     = NULLIF(p_kopf ->> 'verpackung_kg', '')::numeric,
    notizen           = NULLIF(p_kopf ->> 'notizen', '')
  WHERE id = p_auftrag_id AND tenant_id = p_tenant_id;

  -- Positionen ersetzen: die Löschsperre der Kindtabelle gibt genau die Zeilen dieses Auftrags frei
  PERFORM set_config('s112.storno_loeschen', p_auftrag_id::text, true);
  DELETE FROM public.exportauftrag_positionen WHERE exportauftrag_id = p_auftrag_id;   -- storno-ausnahme: Positionen eines noch nicht versendeten Auftrags werden beim Bearbeiten ersetzt
  PERFORM set_config('s112.storno_loeschen', '', true);

  INSERT INTO public.exportauftrag_positionen (exportauftrag_id, fullung_id, beschreibung, menge, einheit, preis_eur, taric_code, sort_order)
  SELECT p_auftrag_id, NULLIF(e ->> 'fullung_id', '')::uuid, NULLIF(btrim(coalesce(e ->> 'beschreibung', '')), ''),
         (e ->> 'menge')::numeric, coalesce(NULLIF(e ->> 'einheit', ''), 'Fl'), coalesce(NULLIF(e ->> 'preis_eur', '')::numeric, 0),
         coalesce(NULLIF(btrim(coalesce(e ->> 'taric_code', '')), ''), '2204.21'), (nr - 1)::integer
    FROM jsonb_array_elements(p_positionen) WITH ORDINALITY AS x(e, nr)
   ORDER BY nr;

  -- Der Inhalt hat sich geändert: ausgestellte Dokumente sind neu auszustellen
  UPDATE public.export_dokumente SET status = 'ausstehend', ausgestellt_am = NULL
   WHERE exportauftrag_id = p_auftrag_id AND status = 'ausgestellt';
  GET DIAGNOSTICS v_dok = ROW_COUNT;

  RETURN jsonb_build_object('id', p_auftrag_id, 'positionen', v_nr, 'dokumente_zurueck', v_dok);
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_exportauftrag_aendern(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_exportauftrag_aendern(uuid, uuid, jsonb, jsonb) TO authenticated, service_role;
