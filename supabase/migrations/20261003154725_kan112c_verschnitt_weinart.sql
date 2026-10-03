-- KAN-112 Nachtrag (Entwurf 03.10.2026, Regel Jörgen 03.10.2026): Verschnitt Rot/Weiß ist erlaubt, wenn das Ergebnis auf
-- „Wein (aus Österreich)“ abgestuft wird (Rückfrage in der App). Die Weinart des Ergebnisses richtet sich nach der überwiegenden
-- Menge – dafür darf s112_verschnitt_buchen jetzt auch ziel.weinart setzen (sonst unverändert gegenüber kan112a).
-- Kein session_replication_role, kein DISABLE TRIGGER (KAN-124).

CREATE OR REPLACE FUNCTION public.s112_verschnitt_buchen(p_tenant_id uuid, p_kopf jsonb, p_quellen jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_ziel_felder constant text[] := ARRAY['rebsorte', 'jahrgang', 'qualitaetsstufe', 'zusatzbezeichnung', 'erzeugnis',
                                         'herkunft_code', 'kmw', 'oechsle', 'mostgewicht_einheit', 'weinart'];
  c_neu_felder  constant text[] := ARRAY['name', 'behaelter_id', 'rebsorte', 'jahrgang', 'weinart', 'herkunft_code', 'land_iso',
                                         'qualitaetsstufe', 'zusatzbezeichnung', 'erzeugnis', 'status', 'notizen'];
  v_nz      jsonb := p_kopf -> 'neue_ziel_charge';
  v_datum   date;
  v_ziel_id uuid;
  v_ziel    public.weinausbau%ROWTYPE;
  v_q       public.weinausbau%ROWTYPE;
  v_zf      jsonb := coalesce(p_kopf -> 'ziel', '{}'::jsonb);
  v_e       jsonb;
  v_id      uuid;
  v_vid     uuid;
  v_schw_id uuid;
  v_menge   numeric;
  v_schwund numeric;
  v_rest    numeric;
  v_summe   numeric := 0;
  v_k       text;
  v_n       integer := 0;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);   -- KAN-5 Nur-Lesen-Modus
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'kellerbuch');

  v_datum := (p_kopf ->> 'datum')::date;
  v_ziel_id := (p_kopf ->> 'ziel_weinausbau_id')::uuid;
  -- Neue Ziel-Charge (leeres Gebinde, gemischte Quellen) – in derselben Transaktion
  IF v_ziel_id IS NULL AND jsonb_typeof(v_nz) = 'object' AND v_datum IS NOT NULL THEN
    FOR v_k IN SELECT jsonb_object_keys(v_nz) LOOP
      IF NOT v_k = ANY (c_neu_felder) THEN
        RAISE EXCEPTION 'Feld „%“ kann für die neue Charge nicht gesetzt werden.', v_k USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF NULLIF(btrim(coalesce(v_nz ->> 'name', '')), '') IS NULL OR (v_nz ->> 'behaelter_id') IS NULL THEN
      RAISE EXCEPTION 'Bitte Name und Gebinde der neuen Charge angeben.' USING ERRCODE = '22023';
    END IF;
    IF NOT public.behaelter_nutzbar((v_nz ->> 'behaelter_id')::uuid, p_tenant_id) THEN
      RAISE EXCEPTION 'Gebinde gehört nicht zu diesem Betrieb.' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.weinausbau (tenant_id, name, behaelter_id, menge_liter, aktiv, rebsorte, jahrgang, weinart, herkunft_code,
        land_iso, qualitaetsstufe, zusatzbezeichnung, erzeugnis, status, notizen)
    VALUES (p_tenant_id, btrim(v_nz ->> 'name'), (v_nz ->> 'behaelter_id')::uuid, 0, true, v_nz ->> 'rebsorte', (v_nz ->> 'jahrgang')::integer,
        v_nz ->> 'weinart', v_nz ->> 'herkunft_code', coalesce(v_nz ->> 'land_iso', 'AT'), v_nz ->> 'qualitaetsstufe', v_nz ->> 'zusatzbezeichnung',
        v_nz ->> 'erzeugnis', coalesce(v_nz ->> 'status', 'ausbau'), v_nz ->> 'notizen')
    RETURNING id INTO v_ziel_id;
  END IF;
  IF v_datum IS NULL OR v_ziel_id IS NULL THEN
    RAISE EXCEPTION 'Bitte Datum und Ziel-Charge angeben.' USING ERRCODE = '22023';
  END IF;
  IF p_quellen IS NULL OR jsonb_typeof(p_quellen) <> 'array' OR jsonb_array_length(p_quellen) = 0 THEN
    RAISE EXCEPTION 'Bitte mindestens eine Quell-Charge angeben.' USING ERRCODE = '22023';
  END IF;
  FOR v_k IN SELECT jsonb_object_keys(v_zf) LOOP
    IF NOT v_k = ANY (c_ziel_felder) THEN
      RAISE EXCEPTION 'Feld „%“ kann beim Verschnitt nicht gesetzt werden.', v_k USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Sperren in fester Reihenfolge (Ziel und Quellen nach id) gegen Verklemmungen
  PERFORM 1 FROM public.weinausbau w
   WHERE w.tenant_id = p_tenant_id
     AND w.id IN (SELECT v_ziel_id UNION SELECT (e ->> 'weinausbau_id')::uuid FROM jsonb_array_elements(p_quellen) e)
   ORDER BY w.id FOR UPDATE;

  SELECT * INTO v_ziel FROM public.weinausbau w WHERE w.id = v_ziel_id AND w.tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ziel-Charge nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_ziel.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Die Ziel-Charge „%“ ist storniert.', v_ziel.name USING ERRCODE = '22023';
  END IF;
  IF p_kopf ? 'ziel_menge_erwartet'
     AND abs(coalesce(v_ziel.menge_liter, 0) - coalesce((p_kopf ->> 'ziel_menge_erwartet')::numeric, 0)) > 0.005 THEN
    RAISE EXCEPTION 'Der Bestand der Ziel-Charge „%“ hat sich inzwischen geändert – bitte erneut buchen.', v_ziel.name USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.verschneidungen (tenant_id, datum, ziel_weinausbau_id, notizen, ziel_behaelter_id,
      ziel_qualitaet_vorher, ziel_zusatz_vorher, ziel_erzeugnis_vorher, ziel_herkunft_code_vorher, ziel_rebsorte_vorher,
      ziel_jahrgang_vorher, ziel_kmw_vorher, ziel_oechsle_vorher, ziel_mostgewicht_einheit_vorher)
  VALUES (p_tenant_id, v_datum, v_ziel_id, NULLIF(btrim(coalesce(p_kopf ->> 'notizen', '')), ''), v_ziel.behaelter_id,
      v_ziel.qualitaetsstufe, v_ziel.zusatzbezeichnung, v_ziel.erzeugnis, v_ziel.herkunft_code, v_ziel.rebsorte,
      v_ziel.jahrgang, v_ziel.kmw, v_ziel.oechsle, v_ziel.mostgewicht_einheit)
  RETURNING id INTO v_vid;

  FOR v_e IN SELECT e FROM jsonb_array_elements(p_quellen) e LOOP
    v_id := (v_e ->> 'weinausbau_id')::uuid;
    v_menge := round(coalesce((v_e ->> 'menge_liter')::numeric, 0), 2);
    v_schwund := round(greatest(coalesce((v_e ->> 'schwund_liter')::numeric, 0), 0), 2);
    IF v_id IS NULL OR v_id = v_ziel_id THEN
      RAISE EXCEPTION 'Quelle und Ziel müssen verschiedene Chargen sein.' USING ERRCODE = '22023';
    END IF;
    IF v_menge < 0.01 THEN
      RAISE EXCEPTION 'Jede Quelle braucht mindestens 0,01 L.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_q FROM public.weinausbau w WHERE w.id = v_id AND w.tenant_id = p_tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Quell-Charge nicht gefunden.' USING ERRCODE = 'P0002';
    END IF;
    IF v_q.storniert_am IS NOT NULL OR NOT coalesce(v_q.aktiv, false) THEN
      RAISE EXCEPTION 'Die Quell-Charge „%“ ist nicht aktiv.', v_q.name USING ERRCODE = '22023';
    END IF;
    IF v_e ? 'menge_erwartet' AND abs(coalesce(v_q.menge_liter, 0) - coalesce((v_e ->> 'menge_erwartet')::numeric, 0)) > 0.005 THEN
      RAISE EXCEPTION 'Der Bestand der Quell-Charge „%“ hat sich inzwischen geändert – bitte erneut buchen.', v_q.name USING ERRCODE = '40001';
    END IF;
    IF v_menge + v_schwund > coalesce(v_q.menge_liter, 0) + 0.005 THEN
      RAISE EXCEPTION 'Quell-Charge „%“: % L übersteigen den Bestand von % L.', v_q.name,
        replace(to_char(v_menge + v_schwund, 'FM999999990.00'), '.', ','), replace(to_char(coalesce(v_q.menge_liter, 0), 'FM999999990.00'), '.', ',')
        USING ERRCODE = '22023';
    END IF;

    v_schw_id := NULL;
    IF v_schwund >= 0.01 THEN
      INSERT INTO public.keller_umzuege (tenant_id, datum, von_weinausbau_id, von_behaelter_id, nach_behaelter_id, menge_liter,
          brutto_liter, schwund_liter, umzug_typ, notizen)
      VALUES (p_tenant_id, v_datum, v_id, v_q.behaelter_id, v_q.behaelter_id, 0, v_schwund, v_schwund, 'schwund',
          format('Schwund beim Verschnitt in „%s“', v_ziel.name))
      RETURNING id INTO v_schw_id;
    END IF;

    INSERT INTO public.verschneidung_quellen (verschneidung_id, quell_weinausbau_id, menge_liter, anteil_pct, quell_behaelter_id, schwund_umzug_id)
    VALUES (v_vid, v_id, v_menge, NULL, v_q.behaelter_id, v_schw_id);

    v_rest := coalesce(v_q.menge_liter, 0) - v_menge - v_schwund;
    IF v_rest <= 0.01 THEN
      UPDATE public.weinausbau SET menge_liter = 0, aktiv = false, status = 'abgeschlossen' WHERE id = v_id AND tenant_id = p_tenant_id;
    ELSE
      UPDATE public.weinausbau SET menge_liter = round(v_rest, 2) WHERE id = v_id AND tenant_id = p_tenant_id;
    END IF;
    v_summe := v_summe + v_menge;
    v_n := v_n + 1;
  END LOOP;

  -- Anteil am Verschnitt (wie bisher: Anteil der Quelle an allen Quellen)
  UPDATE public.verschneidung_quellen q SET anteil_pct = round(q.menge_liter / v_summe * 100, 1)
   WHERE q.verschneidung_id = v_vid AND v_summe > 0;

  UPDATE public.weinausbau w SET
      menge_liter         = round(coalesce(v_ziel.menge_liter, 0) + v_summe, 2),
      rebsorte            = CASE WHEN v_zf ? 'rebsorte' THEN v_zf ->> 'rebsorte' ELSE w.rebsorte END,
      jahrgang            = CASE WHEN v_zf ? 'jahrgang' THEN (v_zf ->> 'jahrgang')::integer ELSE w.jahrgang END,
      qualitaetsstufe     = CASE WHEN v_zf ? 'qualitaetsstufe' THEN v_zf ->> 'qualitaetsstufe' ELSE w.qualitaetsstufe END,
      zusatzbezeichnung   = CASE WHEN v_zf ? 'zusatzbezeichnung' THEN v_zf ->> 'zusatzbezeichnung' ELSE w.zusatzbezeichnung END,
      erzeugnis           = CASE WHEN v_zf ? 'erzeugnis' THEN v_zf ->> 'erzeugnis' ELSE w.erzeugnis END,
      herkunft_code       = CASE WHEN v_zf ? 'herkunft_code' THEN v_zf ->> 'herkunft_code' ELSE w.herkunft_code END,
      kmw                 = CASE WHEN v_zf ? 'kmw' THEN (v_zf ->> 'kmw')::numeric ELSE w.kmw END,
      oechsle             = CASE WHEN v_zf ? 'oechsle' THEN (v_zf ->> 'oechsle')::numeric ELSE w.oechsle END,
      mostgewicht_einheit = CASE WHEN v_zf ? 'mostgewicht_einheit' THEN v_zf ->> 'mostgewicht_einheit' ELSE w.mostgewicht_einheit END,
      weinart             = CASE WHEN v_zf ? 'weinart' THEN v_zf ->> 'weinart' ELSE w.weinart END
   WHERE w.id = v_ziel_id AND w.tenant_id = p_tenant_id;

  RETURN jsonb_build_object('verschneidung_id', v_vid, 'ziel_weinausbau_id', v_ziel_id, 'quellen', v_n, 'liter', v_summe,
                            'ziel_menge', round(coalesce(v_ziel.menge_liter, 0) + v_summe, 2));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_verschnitt_buchen(uuid, jsonb, jsonb) FROM PUBLIC, anon;