-- KAN-148 (Folgeticket C), Etappe C1d: Löschsperre scharf für Lese, Pressung, Traubenverkauf und Chargen; endgültig
-- löschen stornierter Einträge; Jahrgang nur ohne Bezüge – ENTWURF, erst nach „OK, einspielen“, zuerst Staging
--
-- Seit C1b/C1c/C1c-2 storniert die App Lesedaten, Traubenverkäufe und Pressungen (samt Zeilen und Chargen), kein
-- App-Pfad löscht diese Zeilen mehr. Jetzt erzwingt die Datenbank das (wie KAN-145 B4 im Kellerbuch):
--
--  1. s112_loeschsperre (Block A): Wartung per Service-Role/SQL-Editor mit Flag s112.loeschen_erlaubt bzw. der
--     Demo-Reset lassen jetzt auch Zeilen ohne tenant_id durch (ernte_parzellen; bisher nur im Modus 'kind') – sonst
--     scheiterten die Wartungsskripte mit Betriebs-Flag. Für API-Rollen unverändert.
--  2. BEFORE-DELETE-Trigger a_loeschsperre: Modus 'storno' an pressungen, ernte_parzellen, traubenverkauf, weinausbau;
--     Modus 'kind' (über pressung_id) an pressung_behaelter und pressung_weingaerten (nur als Kaskade der Lösch-RPC).
--  3. RESTRICTIVE-Policy keine_direktloeschung (FOR DELETE TO authenticated USING false) an denselben sechs Tabellen.
--  4. s112_storniert_loeschen: zusätzlich pressungen, ernte_parzellen, traubenverkauf (Schreibmodul wie modul_delete:
--     Kellerbuch/Rieden bzw. Rieden/Warenwirtschaft; Mitarbeiter dürfen, KAN-166). Abgelehnt,
--       * solange es für den Jahrgang eine eingereichte/bestätigte/abgelehnte AMA-Erntemeldung gibt (Frage 6),
--       * beim Traubenverkauf, solange eine Rechnungsposition auf ihn verweist,
--       * bei der Pressung, solange aus ihr direkt verkauft wurde oder eine ihrer Chargen noch irgendeinen Bezug hat
--         (auch stornierte Buchungen, Analysen, DAC, Bestellungen – die Charge wird mit gelöscht; ihre Herkunft
--         weinausbau_weingaerten fällt per CASCADE weg).
--     Die Pressung wird mit ihren Behälter- und Traubenzeilen (CASCADE) und danach ihre Chargen gelöscht; der Grund
--     landet für jede Zeile in bestandsprotokoll.grund.
--  5. weinjahrgaenge: BEFORE-DELETE-Trigger a_jahrgang_loeschsperre (s112_jahrgang_loeschsperre) – löschbar nur ohne
--     Lesedaten, Pressungen und Traubenverkäufe (auch stornierte) und ohne AMA-Meldung außer einem Entwurf/„bereit“
--     ohne Positionen. Wartung wie in 1. Die DELETE-Policy „jahrgaenge: admin can delete“ bleibt.
-- Kein session_replication_role (KAN-124). Wartungsskripte: SELECT set_config('s112.loeschen_erlaubt', '<tenant_id>', true);

-- 1. Löschsperre: Wartung auch für Zeilen ohne tenant_id ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_loeschsperre()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_demo  constant text := '33333333-3333-4333-8333-333333333333';
  v_rolle text := COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text);
  v_modus text := COALESCE(TG_ARGV[0], 'storno');
  v_alt   jsonb := to_jsonb(OLD);
  v_tenant text := v_alt ->> 'tenant_id';
  v_frei  text := NULLIF(current_setting('s112.loeschen_erlaubt', true), '');
  v_rpc   text := NULLIF(current_setting('s112.storno_loeschen', true), '');
BEGIN
  -- (1) Wartung per Service-Role/SQL-Editor mit transaktionslokalem Flag – nie für API-Rollen. Zeilen ohne
  --     tenant_id (Kinder, ernte_parzellen) gelten mit jedem Betriebs-Flag als freigegeben.
  IF v_rolle NOT IN ('authenticated', 'anon') THEN
    IF v_frei IS NOT NULL AND (v_frei = '*' OR v_frei = v_tenant OR v_tenant IS NULL) THEN
      RETURN OLD;
    END IF;
    -- Demo-Reset (bestehende Konvention des Bestandsprotokolls)
    IF current_setting('s112.protokoll_aus', true) = c_demo AND (v_tenant = c_demo OR v_tenant IS NULL) THEN
      RETURN OLD;
    END IF;
  END IF;
  -- (2) Lösch-RPC: genau die freigegebene, stornierte Zeile bzw. Kinder dieses Elternteils (Kaskade)
  IF v_rpc IS NOT NULL THEN
    IF v_modus = 'storno' AND v_rpc = v_alt ->> 'id' AND (v_alt ->> 'storniert_am') IS NOT NULL THEN
      RETURN OLD;
    END IF;
    IF v_modus = 'kind' AND TG_ARGV[1] IS NOT NULL AND v_rpc = v_alt ->> TG_ARGV[1] THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'Buchungen in „%“ werden storniert, nicht gelöscht (KAN-145) – bitte „Stornieren“ verwenden; endgültig löschen lassen sich nur stornierte Buchungen („Endgültig löschen“, Betriebsleitung).', TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_loeschsperre() FROM PUBLIC, anon, authenticated;

-- 2. Löschsperre an Lese, Pressung, Traubenverkauf und Chargen ──────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pressungen', 'ernte_parzellen', 'traubenverkauf', 'weinausbau'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS a_loeschsperre ON public.%I', t);
    EXECUTE format('CREATE TRIGGER a_loeschsperre BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.s112_loeschsperre(%L)', t, 'storno');
  END LOOP;
  FOREACH t IN ARRAY ARRAY['pressung_behaelter', 'pressung_weingaerten'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS a_loeschsperre ON public.%I', t);
    EXECUTE format('CREATE TRIGGER a_loeschsperre BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.s112_loeschsperre(%L, %L)', t, 'kind', 'pressung_id');
  END LOOP;
END $$;

-- 3. Kein direktes Löschen per API ──────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pressungen', 'pressung_behaelter', 'pressung_weingaerten', 'ernte_parzellen', 'traubenverkauf', 'weinausbau'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS keine_direktloeschung ON public.%I', t);
    EXECUTE format('CREATE POLICY keine_direktloeschung ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (false)', t);
  END LOOP;
END $$;

-- 4. Endgültig löschen: auch Pressung, Lesedaten, Traubenverkauf ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_storniert_loeschen(p_tenant_id uuid, p_tabelle text, p_id uuid, p_grund text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Tabellen mit Storno und ihre Schreibmodule (wie die RESTRICTIVE-Policies modul_delete)
  c_tabellen constant text[] := ARRAY['verschneidungen', 'keller_umzuege', 'keller_behandlungen', 'fuellungen', 'zukauf_posten',
                                      'pressungen', 'ernte_parzellen', 'traubenverkauf'];
  v_module    text[];
  v_storniert boolean;
  v_jahrgang  uuid;
  v_chargen   uuid[] := '{}';
  v_c         uuid;
  v_n         integer;
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
    WHEN 'pressungen'          THEN ARRAY['kellerbuch', 'rieden']
    WHEN 'ernte_parzellen'     THEN ARRAY['rieden', 'kellerbuch']
    WHEN 'traubenverkauf'      THEN ARRAY['rieden', 'warenwirtschaft']
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

  -- Zeile sperren; ernte_parzellen hat keine tenant_id (Betrieb über den Jahrgang)
  IF p_tabelle = 'ernte_parzellen' THEN
    SELECT e.storniert_am IS NOT NULL, e.jahrgang_id INTO v_storniert, v_jahrgang
      FROM public.ernte_parzellen e JOIN public.weinjahrgaenge j ON j.id = e.jahrgang_id
     WHERE e.id = p_id AND j.tenant_id = p_tenant_id
       FOR UPDATE OF e;
  ELSE
    EXECUTE format('SELECT storniert_am IS NOT NULL FROM public.%I WHERE id = $1 AND tenant_id = $2 FOR UPDATE', p_tabelle)
      INTO v_storniert USING p_id, p_tenant_id;
    IF p_tabelle IN ('pressungen', 'traubenverkauf') THEN
      EXECUTE format('SELECT jahrgang_id FROM public.%I WHERE id = $1', p_tabelle) INTO v_jahrgang USING p_id;
    END IF;
  END IF;
  IF v_storniert IS NULL THEN
    RAISE EXCEPTION 'Buchung nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_storniert THEN
    RAISE EXCEPTION 'Endgültig löschen lassen sich nur stornierte Buchungen – bitte zuerst stornieren.' USING ERRCODE = '42501';
  END IF;

  -- KAN-148 Frage 6: nie nach einer eingereichten Erntemeldung des Jahrgangs
  IF v_jahrgang IS NOT NULL AND EXISTS (SELECT 1 FROM public.ama_erntemeldungen a
       WHERE a.jahrgang_id = v_jahrgang AND a.tenant_id = p_tenant_id AND a.status IN ('eingereicht', 'bestaetigt', 'abgelehnt')) THEN
    RAISE EXCEPTION 'Für diesen Jahrgang ist die Erntemeldung bereits eingereicht – stornierte Einträge bleiben als Nachweis stehen.' USING ERRCODE = '42501';
  END IF;
  -- Traubenverkauf: nicht, solange eine Rechnungsposition auf ihn verweist (sonst SET NULL, KAN-145 Soll 5)
  IF p_tabelle = 'traubenverkauf' AND EXISTS (SELECT 1 FROM public.verkauf_positionen vp
       WHERE vp.traubenverkauf_id = p_id AND vp.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Der Traubenverkauf gehört zu einer Rechnung – er bleibt als storniert stehen.' USING ERRCODE = '42501';
  END IF;
  -- Pressung: Chargen gehen mit – nur ohne jeden weiteren Bezug
  IF p_tabelle = 'pressungen' THEN
    IF EXISTS (SELECT 1 FROM public.verkauf_positionen vp JOIN public.pressung_behaelter pb ON pb.id = vp.pressung_behaelter_id
                WHERE pb.pressung_id = p_id AND vp.tenant_id = p_tenant_id) THEN
      RAISE EXCEPTION 'Aus der Pressung wurde direkt verkauft – sie bleibt als storniert stehen.' USING ERRCODE = '42501';
    END IF;
    SELECT coalesce(array_agg(DISTINCT pb.weinausbau_id), '{}') INTO v_chargen
      FROM public.pressung_behaelter pb WHERE pb.pressung_id = p_id AND pb.weinausbau_id IS NOT NULL;
    IF EXISTS (SELECT 1 FROM public.weinausbau w WHERE w.id = ANY (v_chargen) AND w.storniert_am IS NULL)
       OR EXISTS (SELECT 1 FROM public.pressung_behaelter pb WHERE pb.weinausbau_id = ANY (v_chargen) AND pb.pressung_id <> p_id)
       OR EXISTS (SELECT 1 FROM public.keller_umzuege x WHERE x.von_weinausbau_id = ANY (v_chargen) OR x.nach_weinausbau_id = ANY (v_chargen))
       OR EXISTS (SELECT 1 FROM public.verschneidungen x WHERE x.ziel_weinausbau_id = ANY (v_chargen))
       OR EXISTS (SELECT 1 FROM public.verschneidung_quellen x WHERE x.quell_weinausbau_id = ANY (v_chargen))
       OR EXISTS (SELECT 1 FROM public.fuellungen x WHERE x.weinausbau_id = ANY (v_chargen))
       OR EXISTS (SELECT 1 FROM public.fuellung_chargen x WHERE x.weinausbau_id = ANY (v_chargen))
       OR EXISTS (SELECT 1 FROM public.verkauf_positionen x WHERE x.weinausbau_id = ANY (v_chargen))
       OR EXISTS (SELECT 1 FROM public.zukauf_posten x WHERE x.ziel_weinausbau_id = ANY (v_chargen))
       OR EXISTS (SELECT 1 FROM public.keller_behandlungen x WHERE x.weinausbau_id = ANY (v_chargen))
       OR EXISTS (SELECT 1 FROM public.weinanalysen x WHERE x.weinausbau_id = ANY (v_chargen))
       OR EXISTS (SELECT 1 FROM public.dac_antrag x WHERE x.weinausbau_id = ANY (v_chargen))
       OR EXISTS (SELECT 1 FROM public.bestellung_positionen x WHERE x.weinausbau_id = ANY (v_chargen)) THEN
      RAISE EXCEPTION 'An einer Charge der Pressung hängen noch (auch stornierte) Buchungen, Analysen oder Anträge – die Pressung bleibt als storniert stehen.' USING ERRCODE = '42501';
    END IF;
  END IF;

  PERFORM set_config('s112.storno_loeschen', p_id::text, true);
  PERFORM set_config('s112.loesch_grund', btrim(p_grund), true);
  IF p_tabelle = 'ernte_parzellen' THEN
    DELETE FROM public.ernte_parzellen WHERE id = p_id AND jahrgang_id = v_jahrgang;
  ELSE
    EXECUTE format('DELETE FROM public.%I WHERE id = $1 AND tenant_id = $2', p_tabelle) USING p_id, p_tenant_id;
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Buchung konnte nicht gelöscht werden (% Zeilen).', v_n USING ERRCODE = 'P0002';
  END IF;
  -- Chargen der Pressung (Behälterzeilen sind per CASCADE schon weg)
  FOREACH v_c IN ARRAY v_chargen LOOP
    PERFORM set_config('s112.storno_loeschen', v_c::text, true);
    DELETE FROM public.weinausbau WHERE id = v_c AND tenant_id = p_tenant_id;
  END LOOP;
  PERFORM set_config('s112.storno_loeschen', '', true);
  PERFORM set_config('s112.loesch_grund', '', true);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_storniert_loeschen(uuid, text, uuid, text) FROM PUBLIC, anon;

-- 5. Jahrgang nur ohne Bezüge ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_jahrgang_loeschsperre()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_demo  constant text := '33333333-3333-4333-8333-333333333333';
  v_rolle text := COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text);
  v_frei  text := NULLIF(current_setting('s112.loeschen_erlaubt', true), '');
  v_was   text;
BEGIN
  -- Wartung (Mandanten-Löschung, Demo-Reset) wie s112_loeschsperre
  IF v_rolle NOT IN ('authenticated', 'anon') THEN
    IF v_frei IS NOT NULL AND (v_frei = '*' OR v_frei = OLD.tenant_id::text) THEN
      RETURN OLD;
    END IF;
    IF current_setting('s112.protokoll_aus', true) = c_demo AND OLD.tenant_id::text = c_demo THEN
      RETURN OLD;
    END IF;
  END IF;
  v_was := CASE
    WHEN EXISTS (SELECT 1 FROM public.ernte_parzellen e WHERE e.jahrgang_id = OLD.id) THEN 'Lesedaten'
    WHEN EXISTS (SELECT 1 FROM public.pressungen p WHERE p.jahrgang_id = OLD.id) THEN 'Pressungen'
    WHEN EXISTS (SELECT 1 FROM public.traubenverkauf t WHERE t.jahrgang_id = OLD.id) THEN 'Traubenverkäufe'
    WHEN EXISTS (SELECT 1 FROM public.ama_erntemeldungen a WHERE a.jahrgang_id = OLD.id
                   AND (a.status NOT IN ('entwurf', 'bereit')
                        OR EXISTS (SELECT 1 FROM public.ama_meldepositionen m WHERE m.meldung_id = a.id))) THEN 'eine AMA-Erntemeldung'
  END;
  IF v_was IS NOT NULL THEN
    RAISE EXCEPTION 'Der Jahrgang % hat bereits % (auch stornierte zählen) und kann nicht gelöscht werden.', OLD.jahrgang, v_was
      USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_jahrgang_loeschsperre() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a_jahrgang_loeschsperre ON public.weinjahrgaenge;
CREATE TRIGGER a_jahrgang_loeschsperre BEFORE DELETE ON public.weinjahrgaenge
  FOR EACH ROW EXECUTE FUNCTION public.s112_jahrgang_loeschsperre();

-- Selbstprüfung
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pressungen', 'pressung_behaelter', 'pressung_weingaerten', 'ernte_parzellen', 'traubenverkauf', 'weinausbau'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'a_loeschsperre' AND tgrelid = ('public.' || t)::regclass
                     AND tgfoid = 'public.s112_loeschsperre()'::regprocedure) THEN
      RAISE EXCEPTION 'KAN-148 C1d: a_loeschsperre fehlt an %', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'keine_direktloeschung'
                     AND permissive = 'RESTRICTIVE' AND cmd = 'DELETE') THEN
      RAISE EXCEPTION 'KAN-148 C1d: keine_direktloeschung fehlt an %', t;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'a_jahrgang_loeschsperre' AND tgrelid = 'public.weinjahrgaenge'::regclass) THEN
    RAISE EXCEPTION 'KAN-148 C1d: a_jahrgang_loeschsperre fehlt';
  END IF;
  IF has_function_privilege('authenticated', 'public.s112_jahrgang_loeschsperre()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.s112_storniert_loeschen(uuid, text, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'KAN-148 C1d: EXECUTE-Rechte falsch';
  END IF;
END $$;
