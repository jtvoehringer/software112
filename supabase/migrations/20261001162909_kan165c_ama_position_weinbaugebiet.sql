-- KAN-165 C (01.10.2026): Erntemeldung je Weinbaugebiet. Betriebe mit Rieden aus mehreren Gebieten bekommen je
-- Rebsorte UND Weinbaugebiet eine Position (vorher: Gebiet nur im Kopf, bei mehreren still das erste).
-- Das Gebiet leitet die App aus dem Herkunft-Code des Grundstücks ab (lib/herkunft.ts, herkunftGebiet);
-- der Kopf (ama_erntemeldungen.weinbaugebiet) listet alle Gebiete der Meldung.
-- Bestehende Positionen bleiben unverändert (weinbaugebiet NULL = vor KAN-165 erstellt).

ALTER TABLE public.ama_meldepositionen ADD COLUMN weinbaugebiet text;
COMMENT ON COLUMN public.ama_meldepositionen.weinbaugebiet IS 'Weinbaugebiet der Position (KAN-165), aus dem Herkunft-Code der Grundstücke; NULL = vor KAN-165 erstellt';

-- Speichern: Gebiet je Position übernehmen
CREATE OR REPLACE FUNCTION public.s112_ama_meldung_speichern(p_tenant_id uuid, p_jahrgang_id uuid, p_kopf jsonb, p_positionen jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id      uuid;
  v_version integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT public.s112_darf_schreiben(p_tenant_id, VARIADIC ARRAY['rieden']) THEN
    RAISE EXCEPTION 'Für die AMA-Erntemeldung fehlt das Schreibrecht (Modul Rieden).' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.weinjahrgaenge j WHERE j.id = p_jahrgang_id AND j.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Jahrgang nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF jsonb_typeof(coalesce(p_positionen, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Ungültige Positionen.' USING ERRCODE = '22023';
  END IF;
  -- Jahrgang sperren: kein paralleles Anlegen einer zweiten offenen Version
  PERFORM 1 FROM public.weinjahrgaenge j WHERE j.id = p_jahrgang_id FOR UPDATE;
  PERFORM set_config('s112.ama_rpc', 'an', true);

  SELECT m.id INTO v_id FROM public.ama_erntemeldungen m
   WHERE m.tenant_id = p_tenant_id AND m.jahrgang_id = p_jahrgang_id AND m.status IN ('entwurf', 'bereit');
  IF v_id IS NULL THEN
    SELECT max(m.version) INTO v_version FROM public.ama_erntemeldungen m
     WHERE m.tenant_id = p_tenant_id AND m.jahrgang_id = p_jahrgang_id;
    IF v_version IS NOT NULL THEN
      RAISE EXCEPTION 'Die AMA-Erntemeldung dieses Jahrgangs ist bereits eingereicht – für Änderungen bitte eine Korrekturmeldung anlegen.' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.ama_erntemeldungen (tenant_id, jahrgang_id, status, version)
    VALUES (p_tenant_id, p_jahrgang_id, 'entwurf', 1) RETURNING id INTO v_id;
  END IF;

  UPDATE public.ama_erntemeldungen SET
    betriebsnummer = NULLIF(p_kopf ->> 'betriebsnummer', ''),
    weinbaugebiet  = NULLIF(p_kopf ->> 'weinbaugebiet', ''),
    gesamtmenge_kg = NULLIF(p_kopf ->> 'gesamtmenge_kg', '')::numeric,
    gesamtmenge_hl = NULLIF(p_kopf ->> 'gesamtmenge_hl', '')::numeric,
    status         = 'bereit'
   WHERE id = v_id;

  DELETE FROM public.ama_meldepositionen WHERE meldung_id = v_id;
  INSERT INTO public.ama_meldepositionen (meldung_id, rebsorte_name, weinbaugebiet, flaeche_ha, menge_kg, menge_hl, qualitaetsstufe)
  SELECT v_id, NULLIF(z ->> 'rebsorte_name', ''), NULLIF(z ->> 'weinbaugebiet', ''), NULLIF(z ->> 'flaeche_ha', '')::numeric, NULLIF(z ->> 'menge_kg', '')::numeric,
         NULLIF(z ->> 'menge_hl', '')::numeric, NULLIF(z ->> 'qualitaetsstufe', '')
    FROM jsonb_array_elements(coalesce(p_positionen, '[]'::jsonb)) z;

  PERFORM set_config('s112.ama_rpc', '', true);
  RETURN v_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_ama_meldung_speichern(uuid, uuid, jsonb, jsonb) FROM PUBLIC, anon;

-- Korrekturmeldung: Gebiet je Position mitkopieren
CREATE OR REPLACE FUNCTION public.s112_ama_korrektur_anlegen(p_tenant_id uuid, p_meldung_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_m  record;
  v_id uuid;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT public.s112_darf_schreiben(p_tenant_id, VARIADIC ARRAY['rieden']) THEN
    RAISE EXCEPTION 'Für die AMA-Erntemeldung fehlt das Schreibrecht (Modul Rieden).' USING ERRCODE = '42501';
  END IF;
  SELECT m.* INTO v_m FROM public.ama_erntemeldungen m WHERE m.id = p_meldung_id AND m.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMA-Erntemeldung nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_m.status IN ('entwurf', 'bereit') THEN
    RAISE EXCEPTION 'Die Meldung ist noch nicht eingereicht – sie kann direkt neu berechnet werden.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ama_erntemeldungen x WHERE x.tenant_id = p_tenant_id AND x.jahrgang_id = v_m.jahrgang_id AND x.version > v_m.version) THEN
    RAISE EXCEPTION 'Es gibt bereits eine neuere Version dieser Meldung – bitte die Seite neu laden.' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('s112.ama_rpc', 'an', true);
  INSERT INTO public.ama_erntemeldungen (tenant_id, jahrgang_id, betriebsnummer, weinbaugebiet, status, gesamtmenge_kg, gesamtmenge_hl,
                                         version, vorgaenger_id, notizen)
  VALUES (p_tenant_id, v_m.jahrgang_id, v_m.betriebsnummer, v_m.weinbaugebiet, 'entwurf', v_m.gesamtmenge_kg, v_m.gesamtmenge_hl,
          v_m.version + 1, v_m.id, v_m.notizen)
  RETURNING id INTO v_id;
  INSERT INTO public.ama_meldepositionen (meldung_id, rebsorte_id, rebsorte_name, weingarten_name, weinbaugebiet, flaeche_ha, menge_kg, menge_hl, qualitaetsstufe, oechsle)
  SELECT v_id, p.rebsorte_id, p.rebsorte_name, p.weingarten_name, p.weinbaugebiet, p.flaeche_ha, p.menge_kg, p.menge_hl, p.qualitaetsstufe, p.oechsle
    FROM public.ama_meldepositionen p WHERE p.meldung_id = v_m.id;
  PERFORM set_config('s112.ama_rpc', '', true);
  RETURN v_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_ama_korrektur_anlegen(uuid, uuid) FROM PUBLIC, anon;
