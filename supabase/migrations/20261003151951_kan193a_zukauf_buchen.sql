-- KAN-193 (Entwurf 03.10.2026, Folge von KAN-112): Zukauf in eine befüllte Charge als atomarer Verschnitt.
--
-- s112_zukauf_buchen(p_tenant_id, p_zukauf, p_charge, p_verschnitt) bucht in EINER Transaktion:
--  1. die Zukauf-Charge (p_charge, Wein/Most mit Ziel-Gebinde; sie trägt die Merkmale und den Lieferanten des Zukaufs –
--     Zugang ZK_FASS/ZK_MOST, Herkunft „Zukauf“ in der Mischungsrechnung),
--  2. den Zukauf-Beleg (p_zukauf → zukauf_posten, ziel_weinausbau_id = Zukauf-Charge),
--  3. optional (p_verschnitt = Kopf wie s112_verschnitt_buchen ohne datum/quellen): den Verschnitt der GANZEN Zukauf-Charge
--     in die vorhandene Charge des Gebindes (abweichende Sorte, Jahrgang, Herkunft oder Qualität) – die Zukauf-Charge
--     ist danach leer und abgeschlossen; keine Zwischencharge, keine Weiterleitung ins Verschneiden-Formular.
-- Spalten nur aus festen Listen; Lieferant/Ansprechpartner und Gebinde nur aus dem eigenen Betrieb (SECURITY DEFINER
-- umgeht RLS – daher ausdrücklich geprüft). Rechte: Warenwirtschaft für den Zukauf, der Verschnitt prüft zusätzlich
-- das Kellerbuch (s112_verschnitt_buchen).
-- Kein session_replication_role, kein DISABLE TRIGGER (KAN-124).

CREATE OR REPLACE FUNCTION public.s112_zukauf_buchen(p_tenant_id uuid, p_zukauf jsonb, p_charge jsonb DEFAULT NULL, p_verschnitt jsonb DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_zukauf constant text[] := ARRAY['datum', 'lieferung_uhrzeit', 'art', 'lieferant_kontakt_id', 'lieferant_firma_id', 'zh_kontakt_id',
    'eingangsrechnungsnummer', 'transport_zugmaschine', 'transport_anhaenger1', 'transport_anhaenger2', 'weinart', 'rebsorte',
    'qualitaetsstufe', 'zusatzbezeichnung', 'erzeugnis', 'land_iso', 'jahrgang', 'herkunft', 'anreicherung', 'kmw', 'oechsle',
    'mostgewicht_einheit', 'alkohol_pct', 'staatliche_pruefnummer', 'menge', 'einheit', 'preis_gesamt', 'einstandspreis_pro_liter', 'notizen'];
  c_charge constant text[] := ARRAY['name', 'rebsorte', 'behaelter_id', 'jahrgang', 'menge_liter', 'einstandspreis_pro_liter', 'weinart',
    'qualitaetsstufe', 'zusatzbezeichnung', 'erzeugnis', 'land_iso', 'herkunft_code', 'kmw', 'oechsle', 'mostgewicht_einheit'];
  v_k        text;
  v_spalten  text;
  v_charge   uuid;
  v_menge    numeric;
  v_zukauf   uuid;
  v_vs       jsonb;
  v_json     jsonb;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);   -- KAN-5 Nur-Lesen-Modus
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'warenwirtschaft');

  IF p_zukauf IS NULL OR jsonb_typeof(p_zukauf) <> 'object' THEN
    RAISE EXCEPTION 'Bitte die Angaben zum Zukauf übergeben.' USING ERRCODE = '22023';
  END IF;
  FOR v_k IN SELECT jsonb_object_keys(p_zukauf) LOOP
    IF NOT v_k = ANY (c_zukauf) THEN
      RAISE EXCEPTION 'Feld „%“ kann beim Zukauf nicht gesetzt werden.', v_k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (p_zukauf ->> 'datum') IS NULL OR (p_zukauf ->> 'art') IS NULL OR coalesce((p_zukauf ->> 'menge')::numeric, 0) <= 0 THEN
    RAISE EXCEPTION 'Bitte Datum, Art und eine Menge über 0 angeben.' USING ERRCODE = '22023';
  END IF;
  -- Verweise nur aus dem eigenen Betrieb
  IF (p_zukauf ->> 'lieferant_kontakt_id') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.kontakte k WHERE k.id = (p_zukauf ->> 'lieferant_kontakt_id')::uuid AND k.tenant_id = p_tenant_id)
     OR (p_zukauf ->> 'zh_kontakt_id') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.kontakte k WHERE k.id = (p_zukauf ->> 'zh_kontakt_id')::uuid AND k.tenant_id = p_tenant_id)
     OR (p_zukauf ->> 'lieferant_firma_id') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.firmen f WHERE f.id = (p_zukauf ->> 'lieferant_firma_id')::uuid AND f.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Lieferant gehört nicht zu diesem Betrieb.' USING ERRCODE = '42501';
  END IF;

  -- 1. Zukauf-Charge
  IF p_charge IS NOT NULL AND jsonb_typeof(p_charge) = 'object' THEN
    FOR v_k IN SELECT jsonb_object_keys(p_charge) LOOP
      IF NOT v_k = ANY (c_charge) THEN
        RAISE EXCEPTION 'Feld „%“ kann für die Zukauf-Charge nicht gesetzt werden.', v_k USING ERRCODE = '22023';
      END IF;
    END LOOP;
    v_menge := round(coalesce((p_charge ->> 'menge_liter')::numeric, 0), 2);
    IF (p_charge ->> 'behaelter_id') IS NULL OR v_menge <= 0 THEN
      RAISE EXCEPTION 'Für die Zukauf-Charge bitte Gebinde und Menge angeben.' USING ERRCODE = '22023';
    END IF;
    IF NOT public.behaelter_nutzbar((p_charge ->> 'behaelter_id')::uuid, p_tenant_id) THEN
      RAISE EXCEPTION 'Gebinde gehört nicht zu diesem Betrieb.' USING ERRCODE = '42501';
    END IF;
    v_json := p_charge || jsonb_build_object('tenant_id', p_tenant_id, 'status', 'ausbau', 'aktiv', true,
                                             'name', coalesce(NULLIF(btrim(p_charge ->> 'name'), ''), NULLIF(btrim(p_charge ->> 'rebsorte'), ''), 'Zukauf'));
    SELECT string_agg(quote_ident(k), ', ') INTO v_spalten FROM jsonb_object_keys(v_json) k;
    EXECUTE format('INSERT INTO public.weinausbau (%s) SELECT %s FROM jsonb_populate_record(NULL::public.weinausbau, $1) RETURNING id', v_spalten, v_spalten)
      INTO v_charge USING v_json;
  ELSIF p_verschnitt IS NOT NULL THEN
    RAISE EXCEPTION 'Ein Verschnitt braucht die Zukauf-Charge.' USING ERRCODE = '22023';
  END IF;

  -- 2. Zukauf-Beleg
  v_json := p_zukauf || jsonb_build_object('tenant_id', p_tenant_id) || CASE WHEN v_charge IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('ziel_weinausbau_id', v_charge) END;
  SELECT string_agg(quote_ident(k), ', ') INTO v_spalten FROM jsonb_object_keys(v_json) k;
  EXECUTE format('INSERT INTO public.zukauf_posten (%s) SELECT %s FROM jsonb_populate_record(NULL::public.zukauf_posten, $1) RETURNING id', v_spalten, v_spalten)
    INTO v_zukauf USING v_json;

  -- 3. Verschnitt der ganzen Zukauf-Charge in die vorhandene Charge
  IF p_verschnitt IS NOT NULL AND jsonb_typeof(p_verschnitt) = 'object' THEN
    IF p_verschnitt ? 'datum' OR p_verschnitt ? 'neue_ziel_charge' THEN
      RAISE EXCEPTION 'Datum und neue Charge kommen beim Zukauf-Verschnitt nicht aus dem Kopf.' USING ERRCODE = '22023';
    END IF;
    v_vs := public.s112_verschnitt_buchen(p_tenant_id,
      p_verschnitt || jsonb_build_object('datum', p_zukauf ->> 'datum'),
      jsonb_build_array(jsonb_build_object('weinausbau_id', v_charge, 'menge_liter', v_menge, 'menge_erwartet', v_menge)));
  END IF;

  RETURN jsonb_build_object('zukauf_id', v_zukauf, 'charge_id', v_charge, 'verschnitt', v_vs);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_zukauf_buchen(uuid, jsonb, jsonb, jsonb) FROM PUBLIC, anon;