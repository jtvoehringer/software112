-- KAN-166 Nachtrag: Abo-Prüfung in s112_buchung_loeschen direkt nach der Zugriffsprüfung – ENTWURF, erst nach
-- „OK, einspielen“, zuerst Staging
--
-- Projektregel (DB-Test 14 rpc_katalog_nach_zugriffspruefung): In schreibenden SECURITY-DEFINER-RPCs folgt
-- s112_pruefe_abo_schreibsperre unmittelbar auf pruefe_tenant_zugriff. In kan166_loeschen_mit_grund stand die
-- Modulprüfung (Schreibmodul rieden) dazwischen – kein Sicherheitsproblem (auch sie verlangt eine aktive Mitgliedschaft),
-- aber gegen die Regel. Nur die Reihenfolge ändert sich; Rechte (REVOKE) bleiben bei CREATE OR REPLACE erhalten.

CREATE OR REPLACE FUNCTION public.s112_buchung_loeschen(p_tenant_id uuid, p_tabelle text, p_id uuid, p_grund text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_tabellen constant text[] := ARRAY['behandlungen', 'psm_lager_bewegungen', 'duengemittel_lager_bewegungen'];
  v_n integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT public.s112_darf_schreiben(p_tenant_id, 'rieden') THEN
    RAISE EXCEPTION 'Für das Löschen fehlt das Schreibrecht im Modul Rieden.' USING ERRCODE = '42501';
  END IF;
  IF p_tabelle IS NULL OR NOT (p_tabelle = ANY (c_tabellen)) THEN
    RAISE EXCEPTION 'Löschen ist für „%“ hier nicht vorgesehen.', coalesce(p_tabelle, '–') USING ERRCODE = '22023';
  END IF;
  IF length(btrim(coalesce(p_grund, ''))) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für das Löschen angeben (mindestens 10 Zeichen).' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('s112.loesch_grund', btrim(p_grund), true);
  EXECUTE format('DELETE FROM public.%I WHERE id = $1 AND tenant_id = $2', p_tabelle) USING p_id, p_tenant_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('s112.loesch_grund', '', true);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Eintrag nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
END;
$function$;

-- Selbstprüfung
DO $$
BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.s112_buchung_loeschen(uuid, text, uuid, text)'::regprocedure)
     !~ 'pruefe_tenant_zugriff\s*\([^;]*\);\s*PERFORM public\.s112_pruefe_abo_schreibsperre\(p_tenant_id\);' THEN
    RAISE EXCEPTION 'KAN-166: Abo-Prüfung nicht direkt nach der Zugriffsprüfung';
  END IF;
  IF has_function_privilege('anon', 'public.s112_buchung_loeschen(uuid, text, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'KAN-166: EXECUTE-Rechte falsch';
  END IF;
END $$;
