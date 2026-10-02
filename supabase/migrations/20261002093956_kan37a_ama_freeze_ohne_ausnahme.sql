-- KAN-37 Etappe A (02.10.2026): Abgegebene AMA-Erntemeldung unveränderlich – für alle Wege, auch die Service-Role
-- Entscheidungen Jörgen 02.10.2026: Ein abgegebener Datenstand ist nach der Abgabe für ALLE Wege gesperrt, auch für die
-- Service-Role, n8n, SQL-Editor und Wartungsroutinen; ändern nur per Korrekturmeldung (neue Version, KAN-148 C2). Kein
-- Notschlüssel. Einzige Ausnahme (Entscheidung Jörgen 02.10.2026): Wartung im Demo-Betrieb Musterhof (3333…), dessen
-- bestätigte Meldung eine Vorführung ist – der nächtliche Reset löscht und erzeugt sie neu; App-Benutzer sehen auch dort
-- die Sperre. Die Mandanten-Löschung bricht bei abgegebenen Meldungen ab.
--
--  1. s112_ama_schutz: Ist die Meldung eingereicht/bestätigt/abgelehnt, gilt für JEDE Rolle:
--     • Löschen gesperrt;
--     • ändern nur die Statusfelder: status (nur vorwärts: eingereicht → bestätigt/abgelehnt), bestaetigt_am,
--       ama_referenznr, n8n_execution_id/_status/_fehler/_letzte_aktion (technischer Abgleich) und updated_at;
--       alle anderen Spalten (Mengen, Gebiet, Betriebsnummer, Notizen, Jahrgang, Version …) bleiben.
--     Für offene Meldungen (entwurf/bereit) bleibt alles wie in KAN-148 C2 (API-Rollen eingeschränkt, Wartung frei).
--  2. s112_ama_position_schutz: Positionen einer abgegebenen Meldung sind für jede Rolle unveränderlich (kein Insert,
--     Update, Delete).
--  3. s112_mandant_loeschen: bricht mit klarer Meldung ab, wenn der Betrieb abgegebene Meldungen hat (Aufbewahrung).

-- 1. Kopf ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_ama_schutz()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rolle text := COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text);
  v_rpc   boolean := coalesce(current_setting('s112.ama_rpc', true), '') = 'an';
  c_status_felder constant text[] := ARRAY['status', 'bestaetigt_am', 'ama_referenznr', 'n8n_execution_id', 'n8n_status',
                                           'n8n_fehler', 'n8n_letzte_aktion', 'updated_at'];
BEGIN
  -- KAN-37: abgegebene Meldung – für JEDE Rolle (auch Service-Role, SQL-Editor, Wartung) unveränderlich. Einzige
  -- Ausnahme (Entscheidung Jörgen 02.10.2026): der Demo-Betrieb Musterhof für Wartung/Reset – seine Meldung ist eine
  -- Vorführung, keine Abgabe; App-Benutzer sehen auch dort die Sperre.
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.status NOT IN ('entwurf', 'bereit')
     AND NOT (OLD.tenant_id = '33333333-3333-4333-8333-333333333333'::uuid AND v_rolle NOT IN ('authenticated', 'anon')) THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Die AMA-Erntemeldung ist % – abgegebene Meldungen werden nie gelöscht (KAN-37); Korrekturen bitte als Korrekturmeldung (neue Version).', OLD.status
        USING ERRCODE = '42501';
    END IF;
    IF (to_jsonb(NEW) - c_status_felder) IS DISTINCT FROM (to_jsonb(OLD) - c_status_felder) THEN
      RAISE EXCEPTION 'Die AMA-Erntemeldung ist % – ihr Inhalt bleibt unverändert (KAN-37); Korrekturen bitte als Korrekturmeldung (neue Version).', OLD.status
        USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'eingereicht' AND NEW.status IN ('bestaetigt', 'abgelehnt')) THEN
      RAISE EXCEPTION 'Der Status einer abgegebenen AMA-Erntemeldung geht nur vorwärts (eingereicht → bestätigt/abgelehnt), nicht von „%“ auf „%“ (KAN-37).', OLD.status, NEW.status
        USING ERRCODE = '42501';
    END IF;
    -- API-Rollen ändern auch die Statusfelder nur über die RPC (KAN-148 C2)
    IF v_rolle IN ('authenticated', 'anon') AND NOT v_rpc THEN
      RAISE EXCEPTION 'Die AMA-Erntemeldung ist bereits % – sie bleibt unverändert; Korrekturen bitte als Korrekturmeldung (neue Version).', OLD.status
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- offene Meldungen: wie KAN-148 C2 – Wartung (Service-Role, n8n, SQL-Editor, Demo-Reset) und die RPCs frei
  IF v_rolle NOT IN ('authenticated', 'anon') OR v_rpc THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('entwurf', 'bereit') OR NEW.eingereicht_am IS NOT NULL OR NEW.bestaetigt_am IS NOT NULL
       OR NEW.ama_referenznr IS NOT NULL OR NEW.version <> 1 OR NEW.vorgaenger_id IS NOT NULL THEN
      RAISE EXCEPTION 'Eine AMA-Erntemeldung wird als Entwurf angelegt; Einreichen, Rückmeldung und Korrekturen laufen über „Status setzen“ bzw. „Korrekturmeldung“ (KAN-148).' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.status NOT IN ('entwurf', 'bereit')
     OR NEW.eingereicht_am IS DISTINCT FROM OLD.eingereicht_am OR NEW.bestaetigt_am IS DISTINCT FROM OLD.bestaetigt_am
     OR NEW.ama_referenznr IS DISTINCT FROM OLD.ama_referenznr OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.vorgaenger_id IS DISTINCT FROM OLD.vorgaenger_id
     OR NEW.jahrgang_id IS DISTINCT FROM OLD.jahrgang_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'Status, Einreich- und Rückmeldedatum, Referenznummer und Version ändert nur „Status setzen“ bzw. „Korrekturmeldung“ (KAN-148).'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_ama_schutz() FROM PUBLIC, anon, authenticated;

-- 2. Positionen ─────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_ama_position_schutz()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rolle  text := COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text);
  v_status text;
BEGIN
  -- KAN-37: Positionen einer abgegebenen Meldung – für JEDE Rolle unveränderlich (vorher Wartung frei); Ausnahme nur
  -- Wartung im Demo-Betrieb Musterhof (wie s112_ama_schutz)
  SELECT CASE WHEN m.tenant_id = '33333333-3333-4333-8333-333333333333'::uuid AND v_rolle NOT IN ('authenticated', 'anon') THEN NULL ELSE m.status END
    INTO v_status FROM public.ama_erntemeldungen m
   WHERE m.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.meldung_id ELSE NEW.meldung_id END;
  IF v_status IS NOT NULL AND v_status NOT IN ('entwurf', 'bereit') THEN
    RAISE EXCEPTION 'Die AMA-Erntemeldung ist bereits % – ihre Positionen bleiben unverändert (KAN-37).', v_status USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.meldung_id IS DISTINCT FROM NEW.meldung_id THEN
    SELECT CASE WHEN m.tenant_id = '33333333-3333-4333-8333-333333333333'::uuid AND v_rolle NOT IN ('authenticated', 'anon') THEN NULL ELSE m.status END
      INTO v_status FROM public.ama_erntemeldungen m WHERE m.id = OLD.meldung_id;
    IF v_status IS NOT NULL AND v_status NOT IN ('entwurf', 'bereit') THEN
      RAISE EXCEPTION 'Die AMA-Erntemeldung ist bereits % – ihre Positionen bleiben unverändert (KAN-37).', v_status USING ERRCODE = '42501';
    END IF;
    IF v_rolle IN ('authenticated', 'anon') THEN
      RAISE EXCEPTION 'Eine Position kann nicht in eine andere Meldung verschoben werden.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_ama_position_schutz() FROM PUBLIC, anon, authenticated;

-- 3. Mandanten-Löschung ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_mandant_loeschen(p_tenant_id uuid, p_bestaetigung text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Tabellen mit tenant_id ohne FK auf tenants, in Löschreihenfolge (zukauf_posten nach der Kaskade, die Pressungen
  -- und Traubenverkäufe schon entfernt hat – sonst bricht chk_pressung_wg_quelle bzw. chk_traubenverkauf_quelle)
  c_ohne_fk constant text[] := ARRAY['exportauftraege', 'pruefnummernantraege', 'transportbescheinigungen', 'sonstige_artikel',
                                     'weinbaugebiete_custom', 'zukauf_posten', 'system_ereignisse', 'aktivitaet_dokumente'];
  v_name    text;
  v_fremd   bigint;
  v_tab     text;
  v_n       bigint;
  v_zeilen  jsonb := '{}';
  v_rest    jsonb := '{}';
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin']);
  -- bewusst ohne s112_pruefe_abo_schreibsperre: gekündigte Betriebe (Nur-Lesen-Modus) müssen löschbar sein

  SELECT t.name INTO v_name FROM public.tenants t WHERE t.id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Betrieb % nicht gefunden.', p_tenant_id USING ERRCODE = 'P0002';
  END IF;
  IF p_bestaetigung IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'Bestätigung stimmt nicht: bitte den Namen des Betriebs exakt angeben („%“).', v_name USING ERRCODE = '22023';
  END IF;

  -- Kellergemeinschaft: Buchungen anderer Betriebe in eigenen Gebinden blockieren das Löschen
  SELECT (SELECT count(*) FROM public.weinausbau w JOIN public.behaelter b ON b.id = w.behaelter_id
           WHERE b.tenant_id = p_tenant_id AND w.tenant_id <> p_tenant_id)
       + (SELECT count(*) FROM public.keller_umzuege u JOIN public.behaelter b ON b.id IN (u.von_behaelter_id, u.nach_behaelter_id)
           WHERE b.tenant_id = p_tenant_id AND u.tenant_id <> p_tenant_id)
       + (SELECT count(*) FROM public.keller_behandlungen k JOIN public.behaelter b ON b.id = k.behaelter_id
           WHERE b.tenant_id = p_tenant_id AND k.tenant_id <> p_tenant_id)
       + (SELECT count(*) FROM public.pressung_behaelter pb JOIN public.behaelter b ON b.id = pb.behaelter_id
           JOIN public.pressungen p ON p.id = pb.pressung_id
           WHERE b.tenant_id = p_tenant_id AND p.tenant_id <> p_tenant_id)
    INTO v_fremd;
  IF v_fremd > 0 THEN
    RAISE EXCEPTION 'In Gebinden des Betriebs liegen % Buchungen anderer Betriebe (Kellergemeinschaft) – bitte zuerst dort umziehen bzw. bereinigen. Nichts geändert.', v_fremd
      USING ERRCODE = '55000';
  END IF;

  -- KAN-37 (02.10.2026): abgegebene AMA-Erntemeldungen werden nie gelöscht (Aufbewahrung, Sperre auch für die
  -- Service-Role) – Betrieb mit abgegebenen Meldungen ist nicht löschbar; Demo-Betrieb Musterhof ausgenommen
  IF p_tenant_id <> '33333333-3333-4333-8333-333333333333'::uuid AND EXISTS (
       SELECT 1 FROM public.ama_erntemeldungen m WHERE m.tenant_id = p_tenant_id AND m.status NOT IN ('entwurf', 'bereit')) THEN
    RAISE EXCEPTION 'Der Betrieb hat abgegebene AMA-Erntemeldungen – sie werden aufbewahrt und nie gelöscht (KAN-37). Der Betrieb kann deshalb nicht gelöscht werden; bitte stattdessen deaktivieren. Nichts geändert.'
      USING ERRCODE = '55000';
  END IF;

  -- Zählung vorab (alle Tabellen mit tenant_id außer bestandsprotokoll)
  FOR v_tab IN
    SELECT c.relname::text FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname NOT IN ('bestandsprotokoll', 'tenants')
     ORDER BY 1
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id = $1', v_tab) INTO v_n USING p_tenant_id;
    IF v_n > 0 THEN v_zeilen := v_zeilen || jsonb_build_object(v_tab, v_n); END IF;
  END LOOP;

  -- Wartungs-Kennzeichen nur für diesen Betrieb (transaktionslokal)
  PERFORM set_config('s112.loeschen_erlaubt', p_tenant_id::text, true);

  -- RESTRICT-Bezüge vorab (werden nicht am Ende der Anweisung geprüft)
  DELETE FROM public.ea_transaktionen WHERE tenant_id = p_tenant_id AND storno_von_id IS NOT NULL;   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Gegenbuchungen vor den Originalen
  DELETE FROM public.ea_transaktionen WHERE tenant_id = p_tenant_id;   -- storno-ausnahme: Mandanten-Löschung (KAN-151), vor ea_anlagen (RESTRICT)
  DELETE FROM public.konto_umbuchungen WHERE tenant_id = p_tenant_id;   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt

  -- Bewegungen in NO-ACTION-Reihenfolge (Kaskaden prüfen NO ACTION je Ebene, nicht erst am Ende): Verschnitt samt
  -- Quellen, Kellerbehandlungen, Umzüge, Füllungs-Chargen, Pressungen samt Kindern, Traubenverkäufe, Lesedaten,
  -- Maßnahmen – vor Chargen, Gebinden, Rieden, Lesen, Jahrgängen und Mitteln; Kinder ohne tenant_id ausdrücklich (KAN-124)
  DELETE FROM public.verschneidung_quellen WHERE verschneidung_id IN (SELECT id FROM public.verschneidungen WHERE tenant_id = p_tenant_id);   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt
  DELETE FROM public.verschneidungen WHERE tenant_id = p_tenant_id;   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt
  DELETE FROM public.keller_behandlungen WHERE tenant_id = p_tenant_id;   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt
  DELETE FROM public.keller_umzuege WHERE tenant_id = p_tenant_id;   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt
  DELETE FROM public.fuellung_chargen WHERE tenant_id = p_tenant_id;   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt
  DELETE FROM public.pressung_behaelter WHERE pressung_id IN (SELECT id FROM public.pressungen WHERE tenant_id = p_tenant_id);   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt
  DELETE FROM public.pressung_weingaerten WHERE pressung_id IN (SELECT id FROM public.pressungen WHERE tenant_id = p_tenant_id);   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt
  DELETE FROM public.pressungen WHERE tenant_id = p_tenant_id;   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt
  DELETE FROM public.traubenverkauf WHERE tenant_id = p_tenant_id;   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt
  DELETE FROM public.ernte_parzellen WHERE jahrgang_id IN (SELECT id FROM public.weinjahrgaenge WHERE tenant_id = p_tenant_id);   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt
  DELETE FROM public.behandlungen WHERE tenant_id = p_tenant_id;   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt
  DELETE FROM public.weinausbau WHERE tenant_id = p_tenant_id;   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt
  UPDATE public.kontakte SET rabattgruppe_id = NULL WHERE tenant_id = p_tenant_id AND rabattgruppe_id IS NOT NULL;
  UPDATE public.firmen SET rabattgruppe_id = NULL WHERE tenant_id = p_tenant_id AND rabattgruppe_id IS NOT NULL;

  DELETE FROM public.tenants WHERE id = p_tenant_id;

  FOREACH v_tab IN ARRAY c_ohne_fk LOOP
    EXECUTE format('DELETE FROM public.%I WHERE tenant_id = $1', v_tab) USING p_tenant_id;   -- storno-ausnahme: Mandanten-Löschung (KAN-151), Kennzeichen s112.loeschen_erlaubt
  END LOOP;

  -- Restprüfung
  FOR v_tab IN
    SELECT c.relname::text FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname NOT IN ('bestandsprotokoll', 'tenants')
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id = $1', v_tab) INTO v_n USING p_tenant_id;
    IF v_n > 0 THEN v_rest := v_rest || jsonb_build_object(v_tab, v_n); END IF;
  END LOOP;
  IF v_rest <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Mandanten-Löschung unvollständig, zurückgerollt: %', v_rest USING ERRCODE = '55000';
  END IF;
  PERFORM set_config('s112.loeschen_erlaubt', '', true);

  INSERT INTO public.system_ereignisse (art, quelle, meldung, tenant_id, user_id, details)
  VALUES ('db', 's112_mandant_loeschen', 'Betrieb gelöscht (KAN-151)', NULL, NULL,
          jsonb_build_object('tenant_id', p_tenant_id, 'zeilen', v_zeilen));

  RETURN jsonb_build_object('tenant_id', p_tenant_id, 'zeilen', v_zeilen,
                            'gesamt', (SELECT coalesce(sum(value::bigint), 0) FROM jsonb_each_text(v_zeilen)));
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_mandant_loeschen(uuid, text) FROM PUBLIC, anon;