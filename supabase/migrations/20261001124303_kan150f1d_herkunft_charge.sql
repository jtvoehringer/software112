-- KAN-150 (Folgeticket F), Etappe F1d: Herkunft der Charge (Rieden) ändern statt löschen und neu anlegen
--
-- Bisher löschte updateWeinausbau bei jedem Speichern alle weinausbau_weingaerten der Charge und legte sie neu an –
-- ohne Spur, welche Ried entfernt oder ergänzt wurde (Ticket Ist (3), Soll 7, KAN-145 B Nr. 7, Frage 5).
--
--  1. RPC s112_herkunft_setzen(p_tenant_id, p_weinausbau_id, p_weingarten_ids, p_grund): ändert nur die Differenz
--     (entfernte Rieden löschen, neue einfügen) und schreibt EINE Zeile ins Änderungsprotokoll (alte und neue Rieden
--     als Text, Benutzer, Grund). Ohne Änderung: nichts, auch kein Protokoll. Der Grund (≥ 10 Zeichen) ist ab der ersten
--     Folgebuchung Pflicht – das prüft die App (Folgebuchungen sind dort definiert); die RPC prüft einen angegebenen Grund.
--     Zugriff SA/TA/winzer, Abo-Schreibsperre, Schreibmodul Kellerbuch; Charge und Rieden des eigenen Betriebs, nicht
--     storniert.
--  2. Löschsperre an weinausbau_weingaerten (s112_loeschsperre Modus 'kind' über weinausbau_id): löschen nur durch diese
--     RPC, als Kaskade der Lösch-RPC (s112_storniert_loeschen setzt s112.storno_loeschen auf die Charge) und per Wartung;
--     dazu RESTRICTIVE keine_direktloeschung für authenticated. Anlegen (neue Charge, Pressung, Erntemeldung) bleibt.
--     Kein eigenes Löschprotokoll an der Tabelle – Löschen geht nur noch über die RPC (protokolliert) bzw. mit der Charge.
-- Kein session_replication_role (KAN-124).

CREATE OR REPLACE FUNCTION public.s112_herkunft_setzen(p_tenant_id uuid, p_weinausbau_id uuid, p_weingarten_ids uuid[], p_grund text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_charge record;
  v_soll   uuid[];
  v_alt    uuid[];
  v_weg    uuid[];
  v_neu    uuid[];
  v_name_alt text;
  v_name_neu text;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  PERFORM public.s112_pruefe_schreibmodul(p_tenant_id, 'kellerbuch');

  SELECT w.id, w.storniert_am INTO v_charge FROM public.weinausbau w
   WHERE w.id = p_weinausbau_id AND w.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Charge nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF v_charge.storniert_am IS NOT NULL THEN
    RAISE EXCEPTION 'Die Charge ist storniert – die Herkunft bleibt unverändert.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}') INTO v_soll FROM unnest(COALESCE(p_weingarten_ids, '{}')) x WHERE x IS NOT NULL;
  IF EXISTS (SELECT 1 FROM unnest(v_soll) x WHERE NOT EXISTS (SELECT 1 FROM public.weingarten g WHERE g.id = x AND g.tenant_id = p_tenant_id)) THEN
    RAISE EXCEPTION 'Eine gewählte Ried wurde nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(array_agg(ww.weingarten_id ORDER BY ww.weingarten_id), '{}') INTO v_alt
    FROM public.weinausbau_weingaerten ww WHERE ww.weinausbau_id = p_weinausbau_id;

  SELECT COALESCE(array_agg(x), '{}') INTO v_weg FROM unnest(v_alt) x WHERE NOT (x = ANY (v_soll));
  SELECT COALESCE(array_agg(x), '{}') INTO v_neu FROM unnest(v_soll) x WHERE NOT (x = ANY (v_alt));
  IF cardinality(v_weg) = 0 AND cardinality(v_neu) = 0 THEN
    RETURN jsonb_build_object('geaendert', false);
  END IF;
  IF p_grund IS NOT NULL AND length(btrim(p_grund)) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für die Änderung der Herkunft angeben (mindestens 10 Zeichen).' USING ERRCODE = '23514';
  END IF;

  IF cardinality(v_weg) > 0 THEN
    PERFORM set_config('s112.storno_loeschen', p_weinausbau_id::text, true);
    DELETE FROM public.weinausbau_weingaerten WHERE weinausbau_id = p_weinausbau_id AND weingarten_id = ANY (v_weg);
    PERFORM set_config('s112.storno_loeschen', '', true);
  END IF;
  IF cardinality(v_neu) > 0 THEN
    INSERT INTO public.weinausbau_weingaerten (tenant_id, weinausbau_id, weingarten_id)
    SELECT p_tenant_id, p_weinausbau_id, x FROM unnest(v_neu) x
    ON CONFLICT (weinausbau_id, weingarten_id) DO NOTHING;
  END IF;

  SELECT string_agg(g.name, ', ' ORDER BY g.name) INTO v_name_alt FROM public.weingarten g WHERE g.id = ANY (v_alt);
  SELECT string_agg(g.name, ', ' ORDER BY g.name) INTO v_name_neu FROM public.weingarten g WHERE g.id = ANY (v_soll);
  INSERT INTO public.bestandsprotokoll (tenant_id, tabelle, datensatz_id, aktion, alt, neu, geaenderte_spalten, db_rolle, benutzer_id, grund)
  VALUES (p_tenant_id, 'weinausbau_weingaerten', p_weinausbau_id, 'UPDATE',
          jsonb_build_object('rieden', v_name_alt), jsonb_build_object('rieden', v_name_neu), ARRAY['rieden'],
          COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text), auth.uid(), NULLIF(btrim(p_grund), ''));

  RETURN jsonb_build_object('geaendert', true, 'entfernt', cardinality(v_weg), 'neu', cardinality(v_neu));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_herkunft_setzen(uuid, uuid, uuid[], text) FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS a_loeschsperre ON public.weinausbau_weingaerten;
CREATE TRIGGER a_loeschsperre BEFORE DELETE ON public.weinausbau_weingaerten
  FOR EACH ROW EXECUTE FUNCTION public.s112_loeschsperre('kind', 'weinausbau_id');
DROP POLICY IF EXISTS keine_direktloeschung ON public.weinausbau_weingaerten;
CREATE POLICY keine_direktloeschung ON public.weinausbau_weingaerten AS RESTRICTIVE FOR DELETE TO authenticated USING (false);
