-- KAN-476 Nebenbefund (19.11.2026): die ganze Ried in einem Vorgang als Trauben verkaufen
--
-- Befund: An einer Ried mit Grundstücken wird je GST verkauft (KAN-394). Wer die ganze Ried verkauft, musste je GST
-- einen eigenen Traubenverkauf samt eigener Rechnung anlegen.
--
-- Lösung (Variante A, freigegeben): s112_traubenverkauf_anlegen_zeilen legt in EINER Transaktion einen Verkauf (eine
-- Rechnung) und je Zeile (GST) einen Traubenverkauf mit eigener Liefernummer an – die Rechnungsposition je Zeile ist
-- wie im Verkaufsformular vom Typ 'trauben' mit Verweis auf ihren Traubenverkauf (verkauf_positionen.traubenverkauf_id).
-- Scheitert eine Zeile, entsteht nichts (auch keine verbrauchte Liefernummer).
-- SECURITY INVOKER wie s112_traubenverkauf_anlegen: Policies und Trigger der Tabellen gelten unverändert.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

CREATE FUNCTION public.s112_traubenverkauf_anlegen_zeilen(p_tenant_id uuid, p_kopf jsonb, p_zeilen jsonb, p_quelle text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_posten  uuid := gen_random_uuid();
  v_datum   date := nullif(p_kopf ->> 'datum', '')::date;
  v_preis   numeric := nullif(p_kopf ->> 'preis_per_kg', '')::numeric;
  v_kontakt uuid := nullif(p_kopf ->> 'kontakt_id', '')::uuid;
  v_firma   uuid := nullif(p_kopf ->> 'firma_id', '')::uuid;
  v_quelle  text := coalesce(nullif(btrim(p_quelle), ''), 'Trauben');
  v_anzahl  int;
  v_z       jsonb;
  v_menge   numeric;
  v_gst     uuid;
  v_id      uuid;
  v_ln      text;
  v_aus     jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  IF v_datum IS NULL THEN
    RAISE EXCEPTION 'Bitte ein Datum für den Traubenverkauf angeben.' USING ERRCODE = '22023';
  END IF;
  IF p_zeilen IS NULL OR jsonb_typeof(p_zeilen) <> 'array' THEN
    RAISE EXCEPTION 'Bitte mindestens ein Grundstück mit Menge angeben.' USING ERRCODE = '22023';
  END IF;
  v_anzahl := jsonb_array_length(p_zeilen);
  IF v_anzahl < 1 OR v_anzahl > 20 THEN
    RAISE EXCEPTION 'Ein Traubenverkauf hat 1 bis 20 Grundstücke – bitte die Zeilen prüfen.' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(p_zeilen) z WHERE nullif(z ->> 'grundstueck_id', '') IS NULL) > 0 THEN
    RAISE EXCEPTION 'Bitte je Zeile das Grundstück (GST) angeben.' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT z ->> 'grundstueck_id') FROM jsonb_array_elements(p_zeilen) z) <> v_anzahl THEN
    RAISE EXCEPTION 'Jedes Grundstück darf im Traubenverkauf nur einmal vorkommen.' USING ERRCODE = '22023';
  END IF;

  -- ein Verkauf für alle Zeilen (Rechnungsnummer und Rechnung über die Trigger a_rechnungsnummer / b_rechnung_anlegen)
  INSERT INTO public.verkaufsposten (id, tenant_id, datum, kontakt_id, firma_id, notizen)
  VALUES (v_posten, p_tenant_id, v_datum, v_kontakt, v_firma, 'Traubenverkauf – ' || v_quelle);

  FOR v_z IN SELECT z FROM jsonb_array_elements(p_zeilen) WITH ORDINALITY AS t(z, nr) ORDER BY nr LOOP
    v_menge := nullif(v_z ->> 'menge_kg', '')::numeric;
    v_gst   := nullif(v_z ->> 'grundstueck_id', '')::uuid;
    IF v_menge IS NULL OR v_menge <= 0 THEN
      RAISE EXCEPTION 'Bitte je Grundstück eine Menge in kg größer als 0 angeben.' USING ERRCODE = '22023';
    END IF;

    -- Liefernummer je Zeile in derselben Transaktion: scheitert ein Schritt, bleibt keine Lücke im Nummernkreis
    v_ln := public.get_next_liefernummer(p_tenant_id);

    INSERT INTO public.traubenverkauf (tenant_id, jahrgang_id, lese_id, weingarten_id, grundstueck_id, kontakt_id, firma_id,
      datum, menge_kg, preis_per_kg, kmw_grad, oechsle, mostgewicht_einheit, qualitaetsstufe, gesundheit, herkunft_code, notizen,
      liefernummer, verkaufsposten_id)
    VALUES (p_tenant_id,
      nullif(p_kopf ->> 'jahrgang_id', '')::uuid, nullif(p_kopf ->> 'lese_id', '')::uuid,
      nullif(p_kopf ->> 'weingarten_id', '')::uuid, v_gst, v_kontakt, v_firma,
      v_datum, v_menge, v_preis,
      nullif(p_kopf ->> 'kmw_grad', '')::numeric, nullif(p_kopf ->> 'oechsle', '')::numeric,
      coalesce(nullif(p_kopf ->> 'mostgewicht_einheit', ''), 'kmw'),
      nullif(p_kopf ->> 'qualitaetsstufe', ''), coalesce(nullif(p_kopf ->> 'gesundheit', ''), 'G'),
      coalesce(nullif(v_z ->> 'herkunft_code', ''), nullif(p_kopf ->> 'herkunft_code', '')), nullif(p_kopf ->> 'notizen', ''),
      v_ln, v_posten)
    RETURNING id INTO v_id;

    -- Position wie im Verkaufsformular: Typ 'trauben' mit Verweis – Bearbeiten und Storno finden sie darüber
    INSERT INTO public.verkauf_positionen (tenant_id, verkaufsposten_id, typ, traubenverkauf_id, name, menge, einheit, preis_brutto, ust_satz, rabatt_pct, sonderrabatt_pct)
    VALUES (p_tenant_id, v_posten, 'trauben', v_id,
      'Weintrauben – ' || coalesce(nullif(btrim(v_z ->> 'bezeichnung'), ''), v_quelle), v_menge, 'kg', v_preis, 13, 0, 0);

    v_aus := v_aus || jsonb_build_object('id', v_id, 'liefernummer', v_ln, 'grundstueck_id', v_gst);
  END LOOP;

  RETURN jsonb_build_object('verkaufsposten_id', v_posten, 'zeilen', v_aus);
END $$;
REVOKE EXECUTE ON FUNCTION public.s112_traubenverkauf_anlegen_zeilen(uuid, jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_traubenverkauf_anlegen_zeilen(uuid, jsonb, jsonb, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.s112_traubenverkauf_anlegen_zeilen(uuid, jsonb, jsonb, text) IS
  'KAN-476: legt je Zeile (GST) einen Traubenverkauf mit Liefernummer und alle zusammen als EINEN Verkauf mit einer Rechnung in einer Transaktion an (SECURITY INVOKER – Policies und Trigger der Tabellen gelten).';

-- ── Selbstprüfung ───────────────────────────────────────────────────────────────────────────────────────────────────
DO $pruef$
BEGIN
  IF (SELECT prosecdef FROM pg_proc WHERE oid = 'public.s112_traubenverkauf_anlegen_zeilen(uuid, jsonb, jsonb, text)'::regprocedure) THEN
    RAISE EXCEPTION 'KAN-476: s112_traubenverkauf_anlegen_zeilen muss SECURITY INVOKER sein';
  END IF;
  IF has_function_privilege('anon', 'public.s112_traubenverkauf_anlegen_zeilen(uuid, jsonb, jsonb, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'KAN-476: anon darf s112_traubenverkauf_anlegen_zeilen nicht ausführen';
  END IF;
END $pruef$;
