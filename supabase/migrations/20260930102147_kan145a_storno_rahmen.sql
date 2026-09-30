-- KAN-145 Block A: Rahmen „Stornieren statt Löschen“ (BKI) – ENTWURF, erst nach „OK, einspielen“, zuerst Staging
--
-- Vorgabe Jörgen/BKI (26.09.2026): berichtsrelevante Buchungen werden storniert (Zeile bleibt, gekennzeichnet),
-- endgültig gelöscht wird nur eine stornierte Zeile, nur von Betriebsleitung/Admin (tenant_admin, system_admin) und mit
-- Grund. Diese Migration legt nur den Rahmen an – an keiner Tabelle scharf. Block B (Kellerbuch) fügt die Storno-Spalten
-- hinzu und hängt die Sperre je Tabelle an, sobald die App dort storniert statt löscht.
--
--  1. bestandsprotokoll.grund – Grund einer endgültigen Löschung (bewusste Schemaänderung an der sonst unveränderlichen
--     Tabelle; Benutzer haben nur SELECT). bestandsprotokoll_schreiben() liest ihn aus der transaktionslokalen
--     Einstellung s112.loesch_grund, die nur die Lösch-RPC setzt. Sonst unverändert (Fassung Produktion 30.09.2026).
--  2. s112_loeschsperre() – generische BEFORE-DELETE-Triggerfunktion (je Tabelle mit Argumenten angehängt):
--       'storno'           Tabelle mit storniert_am: löschen nur über die Lösch-RPC und nur, wenn storniert
--       'kind', '<fk>'     Kind ohne eigenes Storno (z. B. verschneidung_quellen): nur, wenn die RPC gerade das
--                          Elternteil <fk> löscht (Kaskade)
--     Wartung (Service-Role, SQL-Editor, Mandanten-Löschung): transaktionslokal
--       SELECT set_config('s112.loeschen_erlaubt', '<tenant_id>' bzw. '*', true);
--     – gilt nie für die API-Rollen authenticated/anon. Demo-Reset: bestehende Konvention s112.protokoll_aus
--     (= Demo-Mandant) lässt auch die Sperre durch, die Demo-Funktionen bleiben unverändert. Kein
--     session_replication_role (KAN-124).
--  3. s112_storniert_loeschen(p_tenant_id, p_tabelle, p_id, p_grund) – SECURITY DEFINER: tenant_admin/system_admin
--     (pruefe_tenant_zugriff, prüft auch Mitgliedschaft aktiv und Zwei-Faktor), Abo-Schreibsperre, Tabelle aus der
--     Liste, Grund mind. 10 Zeichen, Zeile des Betriebs und storniert; löscht genau eine Zeile (das Protokoll trägt
--     Grund und Benutzer). Tabellen ohne storniert_am-Spalte (noch nicht umgestellt) lehnt sie ab.

-- 1. Grund im Bestandsprotokoll ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.bestandsprotokoll ADD COLUMN IF NOT EXISTS grund text;
COMMENT ON COLUMN public.bestandsprotokoll.grund IS
  'KAN-145: Grund einer endgültigen Löschung (nur über s112_storniert_loeschen, transaktionslokal s112.loesch_grund)';

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
REVOKE EXECUTE ON FUNCTION public.bestandsprotokoll_schreiben() FROM PUBLIC, anon, authenticated;

-- 2. Löschsperre (Triggerfunktion, noch an keiner Tabelle) ─────────────────────────────────────────────
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
  -- (1) Wartung per Service-Role/SQL-Editor mit transaktionslokalem Flag – nie für API-Rollen
  IF v_rolle NOT IN ('authenticated', 'anon') THEN
    IF v_frei IS NOT NULL AND (v_frei = '*' OR v_frei = v_tenant OR (v_modus = 'kind' AND v_tenant IS NULL)) THEN
      RETURN OLD;
    END IF;
    -- Demo-Reset (bestehende Konvention des Bestandsprotokolls)
    IF current_setting('s112.protokoll_aus', true) = c_demo AND (v_tenant = c_demo OR (v_modus = 'kind' AND v_tenant IS NULL)) THEN
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

-- 3. Endgültig löschen (nur stornierte Zeilen) ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_storniert_loeschen(p_tenant_id uuid, p_tabelle text, p_id uuid, p_grund text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Tabellen mit Storno (Block B ergänzt sie hier nicht – die Liste ist fest; die Spalte storniert_am entscheidet)
  c_tabellen constant text[] := ARRAY['verschneidungen', 'keller_umzuege', 'keller_behandlungen', 'fuellungen', 'zukauf_posten'];
  v_storniert boolean;
  v_n integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF p_tabelle IS NULL OR NOT (p_tabelle = ANY (c_tabellen)) THEN
    RAISE EXCEPTION 'Endgültig löschen ist für „%“ nicht vorgesehen.', coalesce(p_tabelle, '–') USING ERRCODE = '22023';
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

-- Selbstprüfung
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bestandsprotokoll' AND column_name = 'grund') THEN
    RAISE EXCEPTION 'KAN-145 A: bestandsprotokoll.grund fehlt';
  END IF;
  IF has_function_privilege('anon', 'public.s112_storniert_loeschen(uuid, text, uuid, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.s112_loeschsperre()', 'EXECUTE') THEN
    RAISE EXCEPTION 'KAN-145 A: EXECUTE-Rechte falsch';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgfoid = 'public.s112_loeschsperre()'::regprocedure) THEN
    RAISE EXCEPTION 'KAN-145 A: Löschsperre darf noch an keiner Tabelle hängen';
  END IF;
END $$;
