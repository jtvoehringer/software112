-- KAN-112 Nachtrag (Entwurf 03.10.2026, Entscheidung Jörgen 03.10.2026: „n Zielgebinde“): Umzug als Verschnitt in
-- mehrere Ziel-Gebinde in EINER Transaktion.
--
-- s112_verschnitte_buchen(p_tenant_id, p_buchungen): p_buchungen = [ { kopf, quellen } … ] mit denselben Feldern wie
-- s112_verschnitt_buchen(p_tenant_id, p_kopf, p_quellen); bucht alle Verschnitte nacheinander in derselben Transaktion –
-- scheitert einer, wird keiner gebucht. Die erwarteten Bestände (menge_erwartet, ziel_menge_erwartet) beziehen sich auf
-- den Stand unmittelbar vor der jeweiligen Buchung (die App zieht frühere Anteile derselben Quelle ab).
-- Liefert die Ergebnisse der einzelnen Buchungen als Array in derselben Reihenfolge.
-- Kein session_replication_role, kein DISABLE TRIGGER (KAN-124).

CREATE OR REPLACE FUNCTION public.s112_verschnitte_buchen(p_tenant_id uuid, p_buchungen jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_b   jsonb;
  v_erg jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);   -- KAN-5 Nur-Lesen-Modus
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'kellerbuch');
  IF p_buchungen IS NULL OR jsonb_typeof(p_buchungen) <> 'array' OR jsonb_array_length(p_buchungen) = 0 THEN
    RAISE EXCEPTION 'Bitte mindestens einen Verschnitt angeben.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_buchungen) > 50 THEN
    RAISE EXCEPTION 'Höchstens 50 Verschnitte auf einmal.' USING ERRCODE = '22023';
  END IF;
  FOR v_b IN SELECT b FROM jsonb_array_elements(p_buchungen) b LOOP
    IF jsonb_typeof(v_b -> 'kopf') <> 'object' OR jsonb_typeof(v_b -> 'quellen') <> 'array' THEN
      RAISE EXCEPTION 'Jeder Verschnitt braucht „kopf“ und „quellen“.' USING ERRCODE = '22023';
    END IF;
    v_erg := v_erg || jsonb_build_array(public.s112_verschnitt_buchen(p_tenant_id, v_b -> 'kopf', v_b -> 'quellen'));
  END LOOP;
  RETURN v_erg;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_verschnitte_buchen(uuid, jsonb) FROM PUBLIC, anon;