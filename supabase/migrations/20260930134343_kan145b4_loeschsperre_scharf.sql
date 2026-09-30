-- KAN-145 Block B, Etappe 4: Löschsperre scharf im Kellerbuch, Mitarbeiter dürfen endgültig löschen und Schwund
-- stornieren (KAN-166) – ENTWURF, erst nach „OK, einspielen“, zuerst Staging
--
-- Seit B2/B3 storniert die App Umzüge, Schwund, Verschnitte, Kellerbehandlungen, Füllungen und Zukäufe mit
-- Kennzeichen statt zu löschen; kein App-Pfad löscht diese Zeilen mehr direkt. Jetzt erzwingt die Datenbank das:
--
--  1. Löschsperre (s112_loeschsperre, Block A) als BEFORE-DELETE-Trigger a_loeschsperre an keller_umzuege,
--     verschneidungen, keller_behandlungen, fuellungen, zukauf_posten (Modus 'storno') sowie an den Kindern
--     verschneidung_quellen und fuellung_chargen (Modus 'kind' – nur als Kaskade der Lösch-RPC). Durch lassen nur die
--     Lösch-RPC s112_storniert_loeschen (nur stornierte Zeilen, mit Grund) und Wartung per Service-Role/SQL-Editor mit
--     transaktionslokalem Flag s112.loeschen_erlaubt bzw. der Demo-Reset (s112.protokoll_aus).
--  2. Kein direktes Löschen per API: RESTRICTIVE-Policy keine_direktloeschung (FOR DELETE TO authenticated USING false)
--     an denselben sieben Tabellen. Die bestehenden Policies bleiben unverändert (tenant_isolation ist teils FOR ALL);
--     die RPC (SECURITY DEFINER) und die Service-Role sind von RLS nicht betroffen.
--  3. s112_storniert_loeschen: endgültig löschen dürfen auch Mitarbeiter (winzer; Vorgabe KAN-166, 30.09.2026) – mit
--     dem Schreibmodul der Tabelle (wie modul_delete): Kellerbuch bzw. Warenwirtschaft. Reihenfolge: Zugriff, Abo,
--     Modul (Projektregel).
--  4. s112_schwund_minderung(p_tenant_id, p_umzug_id) – lesend, SECURITY DEFINER: liefert zur Schwundbuchung die
--     protokollierte Minderung der Charge (alt/neu von menge_liter, aktiv, status aus bestandsprotokoll). Bisher las
--     die App das Protokoll direkt – das dürfen nur Betriebs-Manager, deshalb konnten Mitarbeiter keinen Schwund
--     stornieren. Rolle system_admin/tenant_admin/winzer mit Schreibmodul Kellerbuch/Warenwirtschaft.
-- Kein session_replication_role (KAN-124). Wartungsskripte brauchen ab jetzt
--   SELECT set_config('s112.loeschen_erlaubt', '<tenant_id>', true);

-- 1. Löschsperre ──────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['keller_umzuege', 'verschneidungen', 'keller_behandlungen', 'fuellungen', 'zukauf_posten'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS a_loeschsperre ON public.%I', t);
    EXECUTE format('CREATE TRIGGER a_loeschsperre BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.s112_loeschsperre(%L)', t, 'storno');
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS a_loeschsperre ON public.verschneidung_quellen;
CREATE TRIGGER a_loeschsperre BEFORE DELETE ON public.verschneidung_quellen
  FOR EACH ROW EXECUTE FUNCTION public.s112_loeschsperre('kind', 'verschneidung_id');
DROP TRIGGER IF EXISTS a_loeschsperre ON public.fuellung_chargen;
CREATE TRIGGER a_loeschsperre BEFORE DELETE ON public.fuellung_chargen
  FOR EACH ROW EXECUTE FUNCTION public.s112_loeschsperre('kind', 'fuellung_id');

-- 2. Kein direktes Löschen per API ──────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['keller_umzuege', 'verschneidungen', 'verschneidung_quellen', 'keller_behandlungen',
                           'fuellungen', 'fuellung_chargen', 'zukauf_posten'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS keine_direktloeschung ON public.%I', t);
    EXECUTE format('CREATE POLICY keine_direktloeschung ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (false)', t);
  END LOOP;
END $$;

-- 3. Endgültig löschen: auch Mitarbeiter, mit Schreibmodul der Tabelle ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_storniert_loeschen(p_tenant_id uuid, p_tabelle text, p_id uuid, p_grund text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Tabellen mit Storno und ihre Schreibmodule (wie die RESTRICTIVE-Policies modul_delete)
  c_tabellen constant text[] := ARRAY['verschneidungen', 'keller_umzuege', 'keller_behandlungen', 'fuellungen', 'zukauf_posten'];
  v_module text[];
  v_storniert boolean;
  v_n integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF p_tabelle IS NULL OR NOT (p_tabelle = ANY (c_tabellen)) THEN
    RAISE EXCEPTION 'Endgültig löschen ist für „%“ nicht vorgesehen.', coalesce(p_tabelle, '–') USING ERRCODE = '22023';
  END IF;
  v_module := CASE p_tabelle
    WHEN 'verschneidungen'     THEN ARRAY['kellerbuch']
    WHEN 'keller_behandlungen' THEN ARRAY['kellerbuch']
    WHEN 'keller_umzuege'      THEN ARRAY['kellerbuch', 'warenwirtschaft']
    WHEN 'fuellungen'          THEN ARRAY['kellerbuch', 'warenwirtschaft']
    WHEN 'zukauf_posten'       THEN ARRAY['warenwirtschaft']
  END;
  IF NOT public.s112_darf_schreiben(p_tenant_id, VARIADIC v_module) THEN
    RAISE EXCEPTION 'Für das endgültige Löschen fehlt das Schreibrecht (Modul %).', array_to_string(v_module, ' bzw. ') USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = p_tabelle AND column_name = 'storniert_am') THEN
    RAISE EXCEPTION '„%“ wird noch nicht storniert – endgültig löschen ist dort noch nicht möglich.', p_tabelle USING ERRCODE = '22023';
  END IF;
  IF length(btrim(coalesce(p_grund, ''))) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund angeben (mindestens 10 Zeichen).' USING ERRCODE = '22023';
  END IF;
  EXECUTE format('SELECT storniert_am IS NOT NULL FROM public.%I WHERE id = $1 AND tenant_id = $2 FOR UPDATE', p_tabelle)
    INTO v_storniert USING p_id, p_tenant_id;
  IF v_storniert IS NULL THEN
    RAISE EXCEPTION 'Buchung nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_storniert THEN
    RAISE EXCEPTION 'Endgültig löschen lassen sich nur stornierte Buchungen – bitte zuerst stornieren.' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('s112.storno_loeschen', p_id::text, true);
  PERFORM set_config('s112.loesch_grund', btrim(p_grund), true);
  EXECUTE format('DELETE FROM public.%I WHERE id = $1 AND tenant_id = $2', p_tabelle) USING p_id, p_tenant_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('s112.storno_loeschen', '', true);
  PERFORM set_config('s112.loesch_grund', '', true);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Buchung konnte nicht gelöscht werden (% Zeilen).', v_n USING ERRCODE = 'P0002';
  END IF;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_storniert_loeschen(uuid, text, uuid, text) FROM PUBLIC, anon;

-- 4. Schwund-Storno für Mitarbeiter: protokollierte Minderung lesen ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_schwund_minderung(p_tenant_id uuid, p_umzug_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_u record;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  IF NOT public.s112_darf_schreiben(p_tenant_id, VARIADIC ARRAY['kellerbuch', 'warenwirtschaft']) THEN
    RAISE EXCEPTION 'Für den Schwund-Storno fehlt das Schreibrecht (Modul Kellerbuch bzw. Warenwirtschaft).' USING ERRCODE = '42501';
  END IF;
  SELECT u.von_weinausbau_id, u.erstellt_am INTO v_u
    FROM public.keller_umzuege u
   WHERE u.id = p_umzug_id AND u.tenant_id = p_tenant_id AND u.umzug_typ = 'schwund';
  IF NOT FOUND OR v_u.von_weinausbau_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  -- Nur die für den Storno nötigen Werte (Menge, aktiv, Status) – nicht das ganze Protokoll
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'alt', jsonb_build_object('menge_liter', b.alt -> 'menge_liter', 'aktiv', b.alt -> 'aktiv', 'status', b.alt -> 'status')
                    - (CASE WHEN b.alt ? 'aktiv' THEN '' ELSE 'aktiv' END)
                    - (CASE WHEN b.alt ? 'status' THEN '' ELSE 'status' END),
             'neu', jsonb_build_object('menge_liter', b.neu -> 'menge_liter')))
      FROM public.bestandsprotokoll b
     WHERE b.tenant_id = p_tenant_id AND b.tabelle = 'weinausbau' AND b.datensatz_id = v_u.von_weinausbau_id
       AND b.aktion = 'UPDATE' AND b.erstellt_am = v_u.erstellt_am AND b.geaenderte_spalten @> ARRAY['menge_liter']), '[]'::jsonb);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_schwund_minderung(uuid, uuid) FROM PUBLIC, anon;

-- Selbstprüfung
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['keller_umzuege', 'verschneidungen', 'verschneidung_quellen', 'keller_behandlungen',
                           'fuellungen', 'fuellung_chargen', 'zukauf_posten'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'a_loeschsperre' AND tgrelid = ('public.' || t)::regclass
                     AND tgfoid = 'public.s112_loeschsperre()'::regprocedure) THEN
      RAISE EXCEPTION 'KAN-145 B4: a_loeschsperre fehlt an %', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'keine_direktloeschung'
                     AND permissive = 'RESTRICTIVE' AND cmd = 'DELETE') THEN
      RAISE EXCEPTION 'KAN-145 B4: keine_direktloeschung fehlt an %', t;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.s112_schwund_minderung(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.s112_storniert_loeschen(uuid, text, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'KAN-145 B4: EXECUTE-Rechte falsch';
  END IF;
END $$;
