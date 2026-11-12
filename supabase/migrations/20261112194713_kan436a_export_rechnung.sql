-- KAN-436 E1 (12.11.2026): Weinexport Teil E, Schritt 1 – Rechnung und Bestandsabgang aus dem Exportauftrag (Epic KAN-431).
--
-- Bisher minderte ein Exportauftrag weder den Flaschenbestand noch entstand eine Rechnung in der Fakturierung.
-- Entscheidungen Jörgen 12.11.2026 (alle Fragen A):
--   1A eigener Knopf „Rechnung stellen“ (ab Bestätigt): Verkauf, Rechnung und Bestandsabgang in einem Zug, danach gesperrt
--   2A Rechnungsnummer aus dem normalen Rechnungskreis; alte Exportaufträge ohne Verkauf bleiben wie bisher
--   3A nur steuerfreie Fälle (innergemeinschaftliche Lieferung, Ausfuhr) – der Steuerfall steht am Verkauf
--   4A Mustersendung: keine Rechnung, der Bestand geht als Entnahme ab („Muster ausbuchen“)
--   7A Storno des Exportauftrags erst, wenn die Rechnung storniert bzw. das Muster zurückgebucht ist
-- Den Verkauf legt die App über den bestehenden Weg an (createVerkauf: Bestand alles-oder-nichts, Periodensperre);
-- die Datenbank hält die Verknüpfung, die Sperre und den Rückweg beim Storno.

-- ── 1. Verkauf: Steuerfall, UID des Kunden, Bestimmungsland ───────────────────────────────────────────
ALTER TABLE public.verkaufsposten
  ADD COLUMN steuerfall  text CONSTRAINT verkaufsposten_steuerfall_chk CHECK (steuerfall IS NULL OR steuerfall IN ('igl', 'ausfuhr')),
  ADD COLUMN kunde_uid   text CONSTRAINT verkaufsposten_kunde_uid_chk CHECK (kunde_uid IS NULL OR char_length(kunde_uid) <= 20),
  ADD COLUMN lieferland  text CONSTRAINT verkaufsposten_lieferland_chk CHECK (lieferland IS NULL OR lieferland ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT verkaufsposten_igl_uid_chk CHECK (steuerfall IS DISTINCT FROM 'igl' OR kunde_uid IS NOT NULL);
COMMENT ON COLUMN public.verkaufsposten.steuerfall IS 'KAN-436: steuerfreier Fall – igl = innergemeinschaftliche Lieferung, ausfuhr = Ausfuhrlieferung; NULL = gewöhnlicher Verkauf';
COMMENT ON COLUMN public.verkaufsposten.kunde_uid IS 'KAN-436: UID des Kunden zum Zeitpunkt des Verkaufs (Pflicht bei der innergemeinschaftlichen Lieferung)';
COMMENT ON COLUMN public.verkaufsposten.lieferland IS 'KAN-436: Bestimmungsland der Lieferung (ISO-Code)';

-- ── 2. Exportauftrag: Verknüpfung zum Verkauf, ausgebuchtes Muster ────────────────────────────────────────
ALTER TABLE public.exportauftraege
  ADD COLUMN verkaufsposten_id   uuid CONSTRAINT exportauftraege_verkaufsposten_fkey REFERENCES public.verkaufsposten(id),
  ADD COLUMN muster_ausgebucht_am date;
COMMENT ON COLUMN public.exportauftraege.verkaufsposten_id IS 'KAN-436: Verkauf (mit Rechnung und Bestandsabgang) zu diesem Exportauftrag; löst sich beim Storno des Verkaufs';
COMMENT ON COLUMN public.exportauftraege.muster_ausgebucht_am IS 'KAN-436: Mustersendung – Tag, an dem der Bestand als Entnahme ausgebucht wurde';
CREATE UNIQUE INDEX exportauftraege_verkaufsposten_idx ON public.exportauftraege (verkaufsposten_id) WHERE verkaufsposten_id IS NOT NULL;
CREATE TRIGGER z_fremdverweis_verkaufsposten_id BEFORE INSERT OR UPDATE OF verkaufsposten_id, tenant_id ON public.exportauftraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_fremdverweis_pruefen('verkaufsposten_id', 'verkaufsposten', '', '', '');

-- ── 3. Sperre: mit Rechnung bzw. ausgebuchtem Muster ist der Auftrag wie ab „Versendet“ gesperrt ────────────────────
DROP TRIGGER a_freeze ON public.exportauftraege;
CREATE TRIGGER a_freeze BEFORE UPDATE OR DELETE ON public.exportauftraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_freeze(
    'Exportauftrag versendet bzw. verrechnet',
    'o.storniert_am IS NULL AND (o.status IN (''versendet'', ''abgeschlossen'') OR o.verkaufsposten_id IS NOT NULL OR o.muster_ausgebucht_am IS NOT NULL)',
    'status,emcs_arc_nummer,emcs_status,emcs_datum,verpackung_kg,aktiv,storniert_am,storniert_von,storniert_von_name,storno_grund,verkaufsposten_id,muster_ausgebucht_am',
    '');

-- Positionen: dieselbe Bedingung (genau eine Stelle, sonst Abbruch)
DO $kan436$
DECLARE
  v_def text;
  c_alt constant text := '                    AND a.status IN (''versendet'', ''abgeschlossen'')) THEN
    RAISE EXCEPTION ''Gesperrt: Exportauftrag versendet – die Positionen lassen sich nicht mehr ändern.''';
  c_neu constant text := '                    AND (a.status IN (''versendet'', ''abgeschlossen'') OR a.verkaufsposten_id IS NOT NULL OR a.muster_ausgebucht_am IS NOT NULL)) THEN
    RAISE EXCEPTION ''Gesperrt: Exportauftrag versendet bzw. verrechnet – die Positionen lassen sich nicht mehr ändern.''';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 's112_export_kind_schutz';
  IF v_def IS NULL OR (length(v_def) - length(replace(v_def, c_alt, ''))) / length(c_alt) <> 1 THEN
    RAISE EXCEPTION 'KAN-436: s112_export_kind_schutz – Ankerstelle nicht genau einmal gefunden';
  END IF;
  EXECUTE replace(v_def, c_alt, c_neu);
END
$kan436$;

-- ── 4. Schutz der Verknüpfung und Storno-Sperre ────────────────────────────────────────────────────
CREATE FUNCTION public.s112_export_rechnung_schutz()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_frei boolean := COALESCE(NULLIF(current_setting('s112.export_frei', true), ''), '') = 'on';
BEGIN
  IF COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text) NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.verkaufsposten_id IS NOT NULL OR NEW.muster_ausgebucht_am IS NOT NULL THEN
      RAISE EXCEPTION 'Ein neuer Exportauftrag hat weder Rechnung noch ausgebuchtes Muster.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.verkaufsposten_id IS DISTINCT FROM OLD.verkaufsposten_id THEN
    IF OLD.verkaufsposten_id IS NOT NULL AND NOT v_frei THEN
      RAISE EXCEPTION 'Die Rechnung zum Exportauftrag löst sich nur über das Storno der Rechnung.' USING ERRCODE = '42501', HINT = 'export_rechnung';
    END IF;
    IF NEW.verkaufsposten_id IS NOT NULL THEN
      IF OLD.storniert_am IS NOT NULL THEN
        RAISE EXCEPTION 'Der Exportauftrag ist storniert.' USING ERRCODE = '42501';
      END IF;
      IF OLD.muster_ausgebucht_am IS NOT NULL OR OLD.mustersendung THEN
        RAISE EXCEPTION 'Eine Mustersendung bekommt keine Rechnung.' USING ERRCODE = '23514', HINT = 'export_rechnung';
      END IF;
      IF COALESCE(OLD.status, 'entwurf') = 'entwurf' THEN
        RAISE EXCEPTION 'Eine Rechnung gibt es erst ab dem Status „Bestätigt“.' USING ERRCODE = '23514', HINT = 'export_rechnung';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.verkaufsposten v
                      WHERE v.id = NEW.verkaufsposten_id AND v.tenant_id = NEW.tenant_id AND v.storniert IS NOT TRUE
                        AND v.steuerfall IS NOT NULL) THEN
        RAISE EXCEPTION 'Der Verkauf zum Exportauftrag fehlt, ist storniert oder hat keinen Steuerfall.' USING ERRCODE = '23514', HINT = 'export_rechnung';
      END IF;
    END IF;
  END IF;

  IF NEW.muster_ausgebucht_am IS DISTINCT FROM OLD.muster_ausgebucht_am AND NOT v_frei THEN
    RAISE EXCEPTION 'Das Muster wird nur über „Muster ausbuchen“ gebucht.' USING ERRCODE = '42501', HINT = 'export_rechnung';
  END IF;

  IF NEW.storniert_am IS NOT NULL AND OLD.storniert_am IS NULL THEN
    IF OLD.verkaufsposten_id IS NOT NULL THEN
      RAISE EXCEPTION 'Zu diesem Exportauftrag gibt es eine Rechnung – bitte zuerst die Rechnung stornieren.' USING ERRCODE = '23514', HINT = 'export_rechnung';
    END IF;
    IF OLD.muster_ausgebucht_am IS NOT NULL THEN
      RAISE EXCEPTION 'Das Muster ist ausgebucht – bitte zuerst zurückbuchen.' USING ERRCODE = '23514', HINT = 'export_rechnung';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_export_rechnung_schutz() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER a_export_rechnung_schutz BEFORE INSERT OR UPDATE ON public.exportauftraege
  FOR EACH ROW EXECUTE FUNCTION public.s112_export_rechnung_schutz();

-- Storno des Verkaufs (jeder Weg) gibt den Exportauftrag wieder frei
CREATE FUNCTION public.s112_export_rechnung_storno()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('s112.export_frei', 'on', true);
  UPDATE public.exportauftraege SET verkaufsposten_id = NULL WHERE verkaufsposten_id = NEW.id;
  PERFORM set_config('s112.export_frei', '', true);
  RETURN NULL;
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_export_rechnung_storno() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER z_export_rechnung_storno AFTER UPDATE OF storniert ON public.verkaufsposten
  FOR EACH ROW WHEN (NEW.storniert IS TRUE AND OLD.storniert IS DISTINCT FROM TRUE)
  EXECUTE FUNCTION public.s112_export_rechnung_storno();

-- ── 5. Mustersendung: Bestand als Entnahme aus- bzw. zurückbuchen ──────────────────────────────────────────
CREATE FUNCTION public.s112_export_muster_buchen(p_tenant_id uuid, p_auftrag_id uuid, p_datum date, p_zurueck boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_a       record;
  v_std     integer;
  r         record;
  v_flaschen integer := 0;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_paketmodul(p_tenant_id, 'modul_export');
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft');

  IF p_datum IS NULL OR p_datum > (now() AT TIME ZONE 'Europe/Vienna')::date THEN
    RAISE EXCEPTION 'Bitte ein Buchungsdatum angeben, das nicht in der Zukunft liegt.' USING ERRCODE = '22023';
  END IF;

  SELECT id, referenz, status, storniert_am, mustersendung, verkaufsposten_id, muster_ausgebucht_am INTO v_a
    FROM public.exportauftraege WHERE id = p_auftrag_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exportauftrag nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_a.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Der Exportauftrag % ist storniert.', coalesce(v_a.referenz, '') USING ERRCODE = '42501';
  END IF;
  IF NOT v_a.mustersendung OR v_a.verkaufsposten_id IS NOT NULL THEN
    RAISE EXCEPTION 'Ausbuchen als Muster geht nur bei einer Mustersendung ohne Rechnung.' USING ERRCODE = '23514';
  END IF;
  IF p_zurueck AND v_a.muster_ausgebucht_am IS NULL THEN
    RAISE EXCEPTION 'Das Muster ist nicht ausgebucht.' USING ERRCODE = '23514';
  END IF;
  IF NOT p_zurueck AND v_a.muster_ausgebucht_am IS NOT NULL THEN
    RAISE EXCEPTION 'Das Muster ist schon ausgebucht.' USING ERRCODE = '23514';
  END IF;
  IF NOT p_zurueck AND coalesce(v_a.status, 'entwurf') = 'entwurf' THEN
    RAISE EXCEPTION 'Ausbuchen geht erst ab dem Status „Bestätigt“.' USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(export_flaschen_je_karton, 6) INTO v_std FROM public.tenant_einstellungen WHERE tenant_id = p_tenant_id;
  v_std := coalesce(v_std, 6);

  IF EXISTS (SELECT 1 FROM public.exportauftrag_positionen p
              WHERE p.exportauftrag_id = p_auftrag_id
                AND (p.fullung_id IS NULL OR coalesce(p.einheit, 'Fl') NOT IN ('Fl', 'Kiste')
                     OR p.menge * CASE WHEN p.einheit = 'Kiste' THEN coalesce(p.flaschen_je_karton, v_std) ELSE 1 END
                        <> trunc(p.menge * CASE WHEN p.einheit = 'Kiste' THEN coalesce(p.flaschen_je_karton, v_std) ELSE 1 END))) THEN
    RAISE EXCEPTION 'Ausbuchen geht nur, wenn jede Position eine Füllung und eine ganze Zahl Flaschen hat (keine lose Ware).' USING ERRCODE = '23514';
  END IF;

  FOR r IN
    SELECT p.fullung_id AS fuellung_id,
           sum(p.menge * CASE WHEN p.einheit = 'Kiste' THEN coalesce(p.flaschen_je_karton, v_std) ELSE 1 END)::integer AS flaschen
      FROM public.exportauftrag_positionen p
     WHERE p.exportauftrag_id = p_auftrag_id
     GROUP BY p.fullung_id
     ORDER BY p.fullung_id
  LOOP
    IF p_zurueck THEN
      PERFORM public.fuellung_bestand_buchen(p_tenant_id, r.fuellung_id, 'korrektur', p_datum, r.flaschen, NULL,
        'Mustersendung ' || coalesce(v_a.referenz, '') || ' zurückgebucht');
    ELSE
      PERFORM public.fuellung_bestand_buchen(p_tenant_id, r.fuellung_id, 'eigenverbrauch', p_datum, -r.flaschen, NULL,
        'Mustersendung ' || coalesce(v_a.referenz, ''));
    END IF;
    v_flaschen := v_flaschen + r.flaschen;
  END LOOP;
  IF v_flaschen = 0 THEN
    RAISE EXCEPTION 'Der Exportauftrag hat keine Positionen.' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('s112.export_frei', 'on', true);
  UPDATE public.exportauftraege SET muster_ausgebucht_am = CASE WHEN p_zurueck THEN NULL ELSE p_datum END
   WHERE id = p_auftrag_id AND tenant_id = p_tenant_id;
  PERFORM set_config('s112.export_frei', '', true);

  RETURN jsonb_build_object('id', p_auftrag_id, 'flaschen', v_flaschen, 'zurueck', p_zurueck);
END
$$;
REVOKE EXECUTE ON FUNCTION public.s112_export_muster_buchen(uuid, uuid, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_export_muster_buchen(uuid, uuid, date, boolean) TO authenticated, service_role;
