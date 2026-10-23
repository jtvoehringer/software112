-- KAN-378 (23.10.2026, UAT 5.7): Änderungen an einer gespeicherten Füllung nur mit Grund.
-- Entscheidung Jörgen (23.10.2026): Jede Änderung der laut KAN-101 noch änderbaren Felder einer gespeicherten, nicht
-- stornierten Füllung (Produktname, VK-Preis, Einstandspreis, MwSt., KN-Code, Notizen, aktiv) braucht einen Grund mit
-- mindestens 10 Zeichen (gleiche Regel wie der Storno-Grund, stornoGrundFehler). Der Grund steht im Bestandsprotokoll.
--
--  1. s112_fuellung_aendern(tenant, füllung, werte, grund): einziger Schreibweg für diese Felder per API. Zugriff wie die
--     RLS von fuellungen (system_admin/tenant_admin/winzer mit Kellerbuch oder Warenwirtschaft), Abo-Schreibsperre, Grund
--     ≥ 10 Zeichen (≤ 500), nur Schlüssel der Positivliste (sonst 22023), stornierte Füllung → 42501. Ändert sich nichts,
--     liefert sie false ohne UPDATE. Grund über s112.aenderung_grund ins Bestandsprotokoll, danach zurückgesetzt.
--  2. Trigger a_grund_pflicht (BEFORE UPDATE OF <Positivliste> ON fuellungen): Für API-Rollen (authenticated/anon)
--     lehnt er eine Änderung dieser Felder an einer nicht stornierten Füllung ohne s112.aenderung_grund ab (42501,
--     HINT grund_fehlt). Nicht betroffen: Storno (storniert_am wird gesetzt – Grund in storno_grund), RPCs mit
--     s112.freeze_frei = 'fuellungen' (Bestand, Verkauf, Etikettieren, Sekt-Stufe, Nachtrag, s112_freeze_korrektur),
--     Service-Role, Wartung (s112.loeschen_erlaubt) und Demo-Reset (alle nicht authenticated/anon).
--  3. Bestandsprotokoll: z_protokoll_aendern überwacht zusätzlich vk_preis_brutto, einstandspreis, mwst_pct und
--     zolltarifnummer – sonst landete der Grund einer reinen Preisänderung nirgends.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion. Erst danach die App (PR KAN-378) mergen.

-- 1. RPC ─────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_fuellung_aendern(p_tenant_id uuid, p_id uuid, p_werte jsonb, p_grund text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  c_erlaubt constant text[] := ARRAY['name', 'vk_preis_brutto', 'einstandspreis', 'mwst_pct', 'zolltarifnummer', 'notizen', 'aktiv'];
  v_grund   text := btrim(coalesce(p_grund, ''));
  v_f       public.fuellungen%ROWTYPE;
  v_fremd   text[];
  v_name    text;
  v_vk      numeric;
  v_ek      numeric;
  v_mwst    numeric;
  v_kn      text;
  v_notizen text;
  v_aktiv   boolean;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);   -- KAN-5 Nur-Lesen-Modus
  IF NOT public.ist_service_kontext()
     AND NOT public.s112_darf_schreiben(p_tenant_id, 'kellerbuch', 'warenwirtschaft') THEN
    RAISE EXCEPTION 'Keine Schreibberechtigung für Füllungen in diesem Betrieb' USING ERRCODE = '42501';
  END IF;

  IF char_length(v_grund) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für die Änderung angeben (mindestens 10 Zeichen).'
      USING ERRCODE = '22023', HINT = 'grund_fehlt';
  END IF;
  IF char_length(v_grund) > 500 THEN
    RAISE EXCEPTION 'Der Grund der Änderung ist zu lang (höchstens 500 Zeichen).' USING ERRCODE = '22023';
  END IF;
  IF p_werte IS NULL OR jsonb_typeof(p_werte) <> 'object' THEN
    RAISE EXCEPTION 'Keine Änderungen übergeben.' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(k ORDER BY k) INTO v_fremd FROM jsonb_object_keys(p_werte) k WHERE NOT (k = ANY (c_erlaubt));
  IF v_fremd IS NOT NULL THEN
    RAISE EXCEPTION 'Nicht änderbar: % – nach dem Speichern sind nur Produktname, Preise, MwSt., KN-Code, Notizen und aktiv änderbar.',
      array_to_string(v_fremd, ', ') USING ERRCODE = '22023', HINT = 'freeze';
  END IF;

  SELECT * INTO v_f FROM public.fuellungen f WHERE f.id = p_id AND f.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Füllung nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_f.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Die Füllung ist storniert und kann nicht mehr geändert werden.' USING ERRCODE = '42501';
  END IF;

  v_name    := CASE WHEN p_werte ? 'name' THEN btrim(coalesce(p_werte ->> 'name', '')) ELSE v_f.name END;
  v_vk      := CASE WHEN p_werte ? 'vk_preis_brutto' THEN (p_werte ->> 'vk_preis_brutto')::numeric ELSE v_f.vk_preis_brutto END;
  v_ek      := CASE WHEN p_werte ? 'einstandspreis' THEN (p_werte ->> 'einstandspreis')::numeric ELSE v_f.einstandspreis END;
  v_mwst    := CASE WHEN p_werte ? 'mwst_pct' THEN (p_werte ->> 'mwst_pct')::numeric ELSE v_f.mwst_pct END;
  v_kn      := CASE WHEN p_werte ? 'zolltarifnummer' THEN nullif(btrim(coalesce(p_werte ->> 'zolltarifnummer', '')), '') ELSE v_f.zolltarifnummer END;
  v_notizen := CASE WHEN p_werte ? 'notizen' THEN nullif(p_werte ->> 'notizen', '') ELSE v_f.notizen END;
  v_aktiv   := CASE WHEN p_werte ? 'aktiv' THEN (p_werte ->> 'aktiv')::boolean ELSE v_f.aktiv END;

  IF v_name = '' THEN
    RAISE EXCEPTION 'Bitte einen Produktnamen angeben.' USING ERRCODE = '22023';
  END IF;
  IF v_mwst IS NULL THEN
    RAISE EXCEPTION 'Bitte einen MwSt.-Satz angeben.' USING ERRCODE = '22023';
  END IF;
  IF v_aktiv IS NULL THEN
    RAISE EXCEPTION 'Bitte „aktiv“ mit ja oder nein angeben.' USING ERRCODE = '22023';
  END IF;
  IF (v_vk IS NOT NULL AND v_vk < 0) OR (v_ek IS NOT NULL AND v_ek < 0) THEN
    RAISE EXCEPTION 'Preise dürfen nicht negativ sein.' USING ERRCODE = '22023';
  END IF;

  IF v_name IS NOT DISTINCT FROM v_f.name AND v_vk IS NOT DISTINCT FROM v_f.vk_preis_brutto
     AND v_ek IS NOT DISTINCT FROM v_f.einstandspreis AND v_mwst IS NOT DISTINCT FROM v_f.mwst_pct
     AND v_kn IS NOT DISTINCT FROM v_f.zolltarifnummer AND v_notizen IS NOT DISTINCT FROM v_f.notizen
     AND v_aktiv IS NOT DISTINCT FROM v_f.aktiv THEN
    RETURN false;   -- nichts geändert
  END IF;

  PERFORM set_config('s112.aenderung_grund', v_grund, true);
  UPDATE public.fuellungen f
     SET name = v_name, vk_preis_brutto = v_vk, einstandspreis = v_ek, mwst_pct = v_mwst,
         zolltarifnummer = v_kn, notizen = v_notizen, aktiv = v_aktiv
   WHERE f.id = v_f.id;
  PERFORM set_config('s112.aenderung_grund', '', true);
  RETURN true;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_fuellung_aendern(uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_fuellung_aendern(uuid, uuid, jsonb, text) TO authenticated;

-- 2. Grund-Pflicht für direkte Updates ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_fuellung_grund_pflicht()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_rolle   text := coalesce(nullif(current_setting('role', true), 'none'), session_user::text);
  v_frei    text := nullif(current_setting('s112.freeze_frei', true), '');
  v_alt     jsonb;
  v_neu     jsonb;
  v_spalten text[];
BEGIN
  -- Service-Role, Wartung (s112.loeschen_erlaubt), Demo-Reset, SQL-Editor: nicht betroffen
  IF v_rolle NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  -- Stornierte Füllungen schützt s112_storno_schutz; ein Storno trägt seinen Grund in storno_grund
  IF OLD.storniert_am IS NOT NULL OR NEW.storniert_am IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- Buchungs-RPCs mit Freeze-Freigabe (Bestand, Verkauf, Etikettieren, Sekt-Stufe, Nachtrag, s112_freeze_korrektur)
  IF v_frei IS NOT NULL AND (v_frei = '*' OR v_frei = TG_TABLE_NAME) THEN
    RETURN NEW;
  END IF;
  -- Grund gesetzt (nur SECURITY-DEFINER-RPCs wie s112_fuellung_aendern setzen ihn)
  IF nullif(btrim(coalesce(current_setting('s112.aenderung_grund', true), '')), '') IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_alt := to_jsonb(OLD);
  v_neu := to_jsonb(NEW);
  SELECT array_agg(k ORDER BY k) INTO v_spalten
    FROM unnest(ARRAY['name', 'vk_preis_brutto', 'einstandspreis', 'mwst_pct', 'zolltarifnummer', 'notizen', 'aktiv']) k
   WHERE (v_neu -> k) IS DISTINCT FROM (v_alt -> k);
  IF v_spalten IS NULL THEN
    RETURN NEW;   -- nichts davon geändert
  END IF;

  RAISE EXCEPTION 'Änderungen an einer gespeicherten Füllung brauchen einen Grund (mindestens 10 Zeichen) – bitte über „Füllung bearbeiten“ speichern (betrifft: %).',
    array_to_string(v_spalten, ', ')
    USING ERRCODE = '42501', HINT = 'grund_fehlt',
          DETAIL = jsonb_build_object('tabelle', TG_TABLE_NAME, 'spalten', to_jsonb(v_spalten))::text;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_fuellung_grund_pflicht() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER a_grund_pflicht
  BEFORE UPDATE OF name, vk_preis_brutto, einstandspreis, mwst_pct, zolltarifnummer, notizen, aktiv ON public.fuellungen
  FOR EACH ROW EXECUTE FUNCTION public.s112_fuellung_grund_pflicht();

-- 3. Bestandsprotokoll: Preise, MwSt. und KN-Code mit überwachen ─────────────────────────────────────────────
DROP TRIGGER z_protokoll_aendern ON public.fuellungen;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF bestand_flaschen, anzahl_flaschen, menge_liter_gefuellt,
    flaschengroesse_ml, aktiv, weinausbau_id, datum, qualitaet, jahrgang, rebsorte, herkunft_code, pruefnummer,
    anbaugebiet, tenant_id, storniert_am, storno_grund, dac_antrag_id, weinart, erzeugnis, zusatzbezeichnung, land_iso,
    bezeichnung, name, notizen, vk_preis_brutto, einstandspreis, mwst_pct, zolltarifnummer ON public.fuellungen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('bestand_flaschen', 'anzahl_flaschen',
    'menge_liter_gefuellt', 'flaschengroesse_ml', 'aktiv', 'weinausbau_id', 'datum', 'qualitaet', 'jahrgang', 'rebsorte',
    'herkunft_code', 'pruefnummer', 'anbaugebiet', 'tenant_id', 'storniert_am', 'storno_grund', 'dac_antrag_id', 'weinart',
    'erzeugnis', 'zusatzbezeichnung', 'land_iso', 'bezeichnung', 'name', 'notizen', 'vk_preis_brutto', 'einstandspreis',
    'mwst_pct', 'zolltarifnummer');

-- Selbstprüfung ──────────────────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.s112_fuellung_aendern(uuid, uuid, jsonb, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.s112_fuellung_aendern(uuid, uuid, jsonb, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.s112_fuellung_grund_pflicht()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.s112_fuellung_grund_pflicht()', 'EXECUTE') THEN
    RAISE EXCEPTION 'KAN-378: Rechte der neuen Funktionen stimmen nicht';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.fuellungen'::regclass AND tgname = 'a_grund_pflicht') THEN
    RAISE EXCEPTION 'KAN-378: Trigger a_grund_pflicht fehlt';
  END IF;
END
$$;
