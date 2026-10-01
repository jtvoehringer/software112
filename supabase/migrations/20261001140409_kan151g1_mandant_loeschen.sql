-- KAN-151 (Folgeticket G), Etappe G1: Mandanten-Löschroutine und Altlasten
--
--  1. s112_mandant_loeschen(p_tenant_id, p_bestaetigung): löscht einen Betrieb vollständig in einer Transaktion –
--     nur Service-Role/SQL-Editor (EXECUTE nicht für authenticated/anon; erste Zeile pruefe_tenant_zugriff mit
--     system_admin). Bewusst OHNE s112_pruefe_abo_schreibsperre: gekündigte Betriebe stehen im Nur-Lesen-Modus und
--     müssen trotzdem gelöscht werden können.
--       a) Bestätigung = exakter Name des Betriebs; liegen Chargen, Umzüge, Behandlungen oder Pressungen ANDERER
--          Betriebe in eigenen Gebinden (Kellergemeinschaft), Abbruch mit 55000 und Anzahl – nichts geändert.
--       b) Wartungs-Kennzeichen s112.loeschen_erlaubt = Mandanten-UUID (transaktionslokal): Löschsperren
--          (s112_loeschsperre, Stammdaten-Sperre) lassen die Kaskade dieses Betriebs durch.
--       c) Vorab die RESTRICT-Bezüge: E/A-Buchungen (Gegenbuchungen zuerst, dann der Rest vor den Anlagen), Konto-Umbuchungen; NO-ACTION-Bezüge prüft
--          Postgres erst am Ende der Anweisung – die Kaskade von DELETE FROM tenants löscht Eltern und Kinder zusammen.
--       d) DELETE FROM tenants (73 Tabellen per CASCADE), danach die Tabellen mit tenant_id ohne FK auf tenants
--          (exportauftraege samt Kindern, pruefnummernantraege, transportbescheinigungen, sonstige_artikel,
--          weinbaugebiete_custom, zukauf_posten – erst nach Pressungen und Traubenverkäufen –, system_ereignisse,
--          aktivitaet_dokumente).
--       e) Restprüfung über alle Tabellen mit tenant_id außer bestandsprotokoll: 0 Zeilen, sonst Abbruch.
--       f) Rückgabe jsonb (Zeilen je Tabelle) und ein Eintrag in system_ereignisse (art 'db', tenant_id NULL,
--          UUID und Zählung in details, ohne Personendaten). Das Bestandsprotokoll bleibt bis
--          bestandsprotokoll_mandant_loeschen() (nach Ablauf der Frist).
--  2. bestandsprotokoll_schreiben(): Rückfall – findet sie für eine Zeile keinen Betrieb (Kind ohne tenant_id, Eltern
--     schon weg) und ist s112.loeschen_erlaubt eine Mandanten-UUID, gilt dieser Betrieb. Sonst unverändert.
--  3. Altlasten: set_verkauf_storniert(uuid) und mark_verkauf_bezahlt(uuid) entfernen (kein Aufruf, nur
--     service_role); die zwei Protokollzeilen ohne tenant_id (id 47/48, KAN-124-Bereinigung vom 25.09.2026, Sandbox)
--     der Sandbox zuordnen – bewusste einmalige Korrektur (bestandsprotokoll hat keinen UPDATE-Trigger).
-- Kein session_replication_role (KAN-124).

-- 1. Mandanten-Löschroutine ───────────────────────────────────────────────────────────────────────────────
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
REVOKE EXECUTE ON FUNCTION public.s112_mandant_loeschen(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.s112_mandant_loeschen(uuid, text) TO service_role;
COMMENT ON FUNCTION public.s112_mandant_loeschen(uuid, text) IS
  'KAN-151: Betrieb vollständig löschen (nur Service-Role/SQL-Editor, Bestätigung = Name). Runbook docs/Mandant_loeschen.md';

-- 2. bestandsprotokoll_schreiben: Rückfall auf den Betrieb der Mandanten-Löschung ─────────────────────────
CREATE OR REPLACE FUNCTION public.bestandsprotokoll_schreiben()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_demo      constant uuid := '33333333-3333-4333-8333-333333333333';
  v_rolle     text := COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text);
  v_alt       jsonb;
  v_neu       jsonb;
  v_alt_diff  jsonb;
  v_neu_diff  jsonb;
  v_spalten   text[];
  v_tenant    uuid;
  v_eltern    text;
  v_eltern_id uuid;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'TRUNCATE auf „%“ ist gesperrt (KAN-35 Bestandsprotokoll) – bitte zeilenweise mit DELETE löschen', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- Datenminimierung: Versand-E-Mail-Adresse ist nicht bestandsrelevant
    v_alt := to_jsonb(OLD) - 'rechnung_versendet_an';
  ELSIF TG_OP = 'UPDATE' THEN
    v_alt := to_jsonb(OLD);
    v_neu := to_jsonb(NEW);
    SELECT array_agg(s.k ORDER BY s.k),
           jsonb_object_agg(s.k, v_alt -> s.k),
           jsonb_object_agg(s.k, v_neu -> s.k)
      INTO v_spalten, v_alt_diff, v_neu_diff
      FROM unnest(CASE WHEN TG_NARGS > 0 THEN TG_ARGV
                       ELSE ARRAY(SELECT jsonb_object_keys(v_neu)) END) AS s(k)
     WHERE (v_alt -> s.k) IS DISTINCT FROM (v_neu -> s.k);
    IF v_spalten IS NULL THEN
      RETURN NULL;  -- keine überwachte Spalte hat sich tatsächlich geändert
    END IF;
  ELSE
    RETURN NULL;
  END IF;

  v_tenant := COALESCE((v_alt ->> 'tenant_id')::uuid, (v_neu ->> 'tenant_id')::uuid);

  IF v_tenant IS NULL THEN
    -- (1) Elternzeile
    CASE TG_TABLE_NAME
      WHEN 'pressung_behaelter', 'pressung_weingaerten' THEN
        v_eltern := 'pressungen';
        v_eltern_id := COALESCE((v_alt ->> 'pressung_id')::uuid, (v_neu ->> 'pressung_id')::uuid);
        SELECT p.tenant_id INTO v_tenant FROM public.pressungen p WHERE p.id = v_eltern_id;
      WHEN 'verschneidung_quellen' THEN
        v_eltern := 'verschneidungen';
        v_eltern_id := COALESCE((v_alt ->> 'verschneidung_id')::uuid, (v_neu ->> 'verschneidung_id')::uuid);
        SELECT v.tenant_id INTO v_tenant FROM public.verschneidungen v WHERE v.id = v_eltern_id;
      WHEN 'ama_meldepositionen' THEN
        v_eltern := 'ama_erntemeldungen';
        v_eltern_id := COALESCE((v_alt ->> 'meldung_id')::uuid, (v_neu ->> 'meldung_id')::uuid);
        SELECT a.tenant_id INTO v_tenant FROM public.ama_erntemeldungen a WHERE a.id = v_eltern_id;
      WHEN 'ernte_parzellen' THEN
        v_eltern := 'weinjahrgaenge';
        v_eltern_id := COALESCE((v_alt ->> 'jahrgang_id')::uuid, (v_neu ->> 'jahrgang_id')::uuid);
        SELECT j.tenant_id INTO v_tenant FROM public.weinjahrgaenge j WHERE j.id = v_eltern_id;
      ELSE
        NULL;
    END CASE;

    -- (2) Protokollzeile der Eltern-Löschung (FK-Kaskade)
    IF v_tenant IS NULL AND v_eltern_id IS NOT NULL THEN
      SELECT b.tenant_id INTO v_tenant
        FROM public.bestandsprotokoll b
       WHERE b.tabelle = v_eltern AND b.datensatz_id = v_eltern_id
         AND b.aktion = 'DELETE' AND b.tenant_id IS NOT NULL
       ORDER BY b.id DESC
       LIMIT 1;
    END IF;

    -- (3) noch vorhandene Verweise
    IF v_tenant IS NULL THEN
      CASE TG_TABLE_NAME
        WHEN 'pressung_behaelter' THEN
          SELECT w.tenant_id INTO v_tenant FROM public.weinausbau w WHERE w.id = (v_alt ->> 'weinausbau_id')::uuid;
        WHEN 'verschneidung_quellen' THEN
          SELECT w.tenant_id INTO v_tenant FROM public.weinausbau w WHERE w.id = (v_alt ->> 'quell_weinausbau_id')::uuid;
        WHEN 'pressung_weingaerten' THEN
          v_tenant := COALESCE(
            (SELECT g.tenant_id FROM public.weingarten g    WHERE g.id = (v_alt ->> 'weingarten_id')::uuid),
            (SELECT z.tenant_id FROM public.zukauf_posten z WHERE z.id = (v_alt ->> 'zukauf_posten_id')::uuid),
            (SELECT s.tenant_id FROM public.grundstuecke s  WHERE s.id = (v_alt ->> 'grundstueck_id')::uuid));
        WHEN 'ernte_parzellen' THEN
          v_tenant := COALESCE(
            (SELECT g.tenant_id FROM public.weingarten g   WHERE g.id = (v_alt ->> 'weingarten_id')::uuid),
            (SELECT s.tenant_id FROM public.grundstuecke s WHERE s.id = (v_alt ->> 'grundstueck_id')::uuid));
        ELSE
          NULL;
      END CASE;
    END IF;
  END IF;

  -- (4) KAN-151: Mandanten-Löschung – Kind ohne tenant_id, Eltern schon weg: Betrieb aus dem Wartungs-Kennzeichen
  IF v_tenant IS NULL AND current_setting('s112.loeschen_erlaubt', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_tenant := current_setting('s112.loeschen_erlaubt', true)::uuid;
  END IF;

  -- Bypass Demo-Reset (siehe Kopfkommentar); nie für API-Benutzer, nie für echte Mandanten
  IF v_tenant = c_demo
     AND current_setting('s112.protokoll_aus', true) = c_demo::text
     AND v_rolle NOT IN ('authenticated', 'anon') THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.bestandsprotokoll
    (tenant_id, tabelle, datensatz_id, aktion, alt, neu, geaenderte_spalten, db_rolle, benutzer_id, grund)
  VALUES
    (v_tenant, TG_TABLE_NAME, COALESCE((v_alt ->> 'id')::uuid, (v_neu ->> 'id')::uuid), TG_OP,
     CASE WHEN TG_OP = 'DELETE' THEN v_alt ELSE v_alt_diff END,
     v_neu_diff, v_spalten, v_rolle, auth.uid(),
     -- KAN-145: Grund einer endgültigen Löschung (nur die Lösch-RPC setzt ihn, transaktionslokal)
     CASE WHEN TG_OP = 'DELETE' THEN NULLIF(current_setting('s112.loesch_grund', true), '') END);

  RETURN NULL;
END;
$function$;

-- 3. Altlasten ────────────────────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.set_verkauf_storniert(uuid);
DROP FUNCTION IF EXISTS public.mark_verkauf_bezahlt(uuid);

-- Protokollzeilen ohne Betrieb: nur die zwei bekannten der KAN-124-Bereinigung (Sandbox), sonst Abbruch
DO $$
DECLARE v_n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.bestandsprotokoll WHERE tenant_id IS NULL
              AND NOT (id IN (47, 48) AND tabelle = 'ernte_parzellen' AND alt ->> 'jahrgang_id' = 'f0b1928f-a64a-4116-a01e-6da78ca90d41')) THEN
    RAISE EXCEPTION 'KAN-151: unerwartete Protokollzeilen ohne tenant_id';
  END IF;
  UPDATE public.bestandsprotokoll SET tenant_id = 'fa22dc07-eca5-43df-af96-f7b9b09f0471'
   WHERE tenant_id IS NULL AND id IN (47, 48) AND tabelle = 'ernte_parzellen'
     AND alt ->> 'jahrgang_id' = 'f0b1928f-a64a-4116-a01e-6da78ca90d41';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n NOT IN (0, 2) THEN RAISE EXCEPTION 'KAN-151: % statt 2 Protokollzeilen nachgetragen', v_n; END IF;
  IF EXISTS (SELECT 1 FROM public.bestandsprotokoll WHERE tenant_id IS NULL) THEN
    RAISE EXCEPTION 'KAN-151: Protokollzeilen ohne tenant_id übrig';
  END IF;
END $$;
