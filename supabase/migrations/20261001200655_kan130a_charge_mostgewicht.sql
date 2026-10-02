-- KAN-130 Etappe 1 (01.10.2026): Die Charge aus einer Pressung bekommt das Mostgewicht der Pressung
-- (mengengewichteter Ø der Pressungszeilen in °KMW, Rechenregel 7 aus KAN-128) – vorher ging es bei Pressung → Charge
-- verloren. Die App übergibt kmw (und Einheit 'kmw') in p_charge; °Oe ergänzt der Trigger b_mostgewicht
-- (s112_mostgewicht_abgleichen). Ohne Mostgewicht bleiben die Spalten leer wie bisher. Sonst unverändert.

CREATE OR REPLACE FUNCTION public.s112_mostzeile_anlegen(p_tenant_id uuid, p_pressung_id uuid, p_behaelter_id uuid, p_menge_liter numeric, p_notizen text, p_charge jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pb uuid;
  v_wa uuid;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT public.s112_darf_schreiben(p_tenant_id, VARIADIC ARRAY['kellerbuch', 'rieden']) THEN
    RAISE EXCEPTION 'Für das Anlegen der Behälterzeile fehlt das Schreibrecht (Modul Kellerbuch bzw. Rieden).' USING ERRCODE = '42501';
  END IF;
  IF p_behaelter_id IS NULL OR p_menge_liter IS NULL OR p_menge_liter <= 0 THEN
    RAISE EXCEPTION 'Bitte Behälter und Mostmenge (größer als 0 L) angeben.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pressungen p WHERE p.id = p_pressung_id AND p.tenant_id = p_tenant_id AND p.storniert_am IS NULL) THEN
    RAISE EXCEPTION 'Pressung nicht gefunden oder storniert – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.pressung_behaelter (pressung_id, behaelter_id, menge_liter, notizen)
  VALUES (p_pressung_id, p_behaelter_id, p_menge_liter, NULLIF(btrim(coalesce(p_notizen, '')), ''))
  RETURNING id INTO v_pb;

  INSERT INTO public.weinausbau (tenant_id, name, jahrgang, rebsorte, menge_liter, status, behaelter_id,
                                 qualitaetsstufe, herkunft_code, weinart, aktiv,
                                 kmw, oechsle, mostgewicht_einheit)
  VALUES (p_tenant_id, coalesce(NULLIF(btrim(p_charge ->> 'name'), ''), 'Pressung'), (p_charge ->> 'jahrgang')::integer,
          NULLIF(p_charge ->> 'rebsorte', ''), p_menge_liter, 'ausbau', p_behaelter_id,
          NULLIF(p_charge ->> 'qualitaetsstufe', ''), NULLIF(p_charge ->> 'herkunft_code', ''),
          coalesce(NULLIF(p_charge ->> 'weinart', ''), 'unbekannt'), true,
          -- KAN-130: Mostgewicht der Pressung (gewichteter Ø in °KMW); der Trigger b_mostgewicht ergänzt °Oe
          NULLIF(p_charge ->> 'kmw', '')::numeric, NULLIF(p_charge ->> 'oechsle', '')::numeric,
          coalesce(NULLIF(p_charge ->> 'mostgewicht_einheit', ''), 'kmw'))
  RETURNING id INTO v_wa;

  -- Verknüpfung über die Behälterzeile; der Trigger trg_pressung_weinausbau_weingaerten ergänzt die Herkunft
  UPDATE public.pressung_behaelter SET weinausbau_id = v_wa WHERE id = v_pb;

  RETURN jsonb_build_object('pressung_behaelter_id', v_pb, 'weinausbau_id', v_wa);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_mostzeile_anlegen(uuid, uuid, uuid, numeric, text, jsonb) FROM PUBLIC, anon;