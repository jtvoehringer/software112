-- KAN-96 (04.10.2026): Generischer Freeze-Trigger als Baustein (R24 aus der BKI-Sitzung vom 24.09.2026).
-- Angewendet wird er in den Folgetickets (KAN-97 Prüfnummernantrag, KAN-101 Füllung …) nach der Matrix aus KAN-85;
-- diese Migration legt nur die Bausteine an, keine Tabelle wird gesperrt.
--
-- s112_freeze() – BEFORE UPDATE OR DELETE, je Tabelle mit Argumenten:
--   0  grund        Text für die Meldung, z. B. 'Prüfnummernantrag eingereicht'
--   1  bedingung    SQL-Ausdruck über die bisherige Zeile (Alias o), z. B. $$o.status <> 'entwurf'$$ – true = gesperrt
--   2  erlaubt      Spalten, die auch gesperrt änderbar bleiben, kommagetrennt (Positivliste – neue Spalten sind damit
--                   automatisch gesperrt); '' = keine
--   3  seit         optional: Datums-/Zeitspalte für die Meldung („… am 04.10.2026“)
--   Gesperrt: UPDATE einer nicht erlaubten Spalte und DELETE enden mit 42501 (HINT 'freeze', DETAIL als JSON für die
--   App) – die ganze Anweisung, keine Teil-Updates. Ausnahme: transaktionslokales Kennzeichen s112.freeze_frei = Tabelle
--   bzw. '*' (nur SECURITY-DEFINER-RPCs setzen es, z. B. Status-, Storno- und Buchungs-RPCs; API-Rollen können es nicht).
--
-- s112_freeze_korrektur(tenant, tabelle, id, werte, grund) – Entscheidung Jörgen (KAN-85, 04.10.2026): Sperren hebt
--   der Betriebsleiter auf (system_admin/tenant_admin des Betriebs), mit Grund (≥ 10 Zeichen) im Bestandsprotokoll.
--   Ändert genau die übergebenen Spalten einer Zeile des eigenen Betriebs in einer Tabelle mit Freeze-Trigger.
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion.

CREATE OR REPLACE FUNCTION public.s112_freeze()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_grund     text := coalesce(TG_ARGV[0], 'gesperrt');
  v_bedingung text := TG_ARGV[1];
  v_erlaubt   text[] := coalesce(string_to_array(nullif(btrim(coalesce(TG_ARGV[2], '')), ''), ','), '{}');
  v_seit_sp   text := nullif(btrim(coalesce(TG_ARGV[3], '')), '');
  v_frei      text := nullif(current_setting('s112.freeze_frei', true), '');
  v_gesperrt  boolean;
  v_alt       jsonb := to_jsonb(OLD);
  v_neu       jsonb;
  v_spalten   text[];
  v_seit      text;
  v_text      text;
BEGIN
  IF v_frei IS NOT NULL AND (v_frei = '*' OR v_frei = TG_TABLE_NAME) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  v_erlaubt := ARRAY(SELECT btrim(x) FROM unnest(v_erlaubt) x);

  EXECUTE format('SELECT (%s) FROM (SELECT ($1).*) o', v_bedingung) INTO v_gesperrt USING OLD;
  IF NOT coalesce(v_gesperrt, false) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_neu := to_jsonb(NEW);
    SELECT array_agg(k ORDER BY k) INTO v_spalten
      FROM jsonb_object_keys(v_neu) k
     WHERE (v_neu -> k) IS DISTINCT FROM (v_alt -> k) AND NOT (k = ANY (v_erlaubt));
    IF v_spalten IS NULL THEN
      RETURN NEW;   -- nur erlaubte Spalten geändert
    END IF;
  END IF;

  IF v_seit_sp IS NOT NULL AND (v_alt ->> v_seit_sp) IS NOT NULL THEN
    v_seit := to_char((v_alt ->> v_seit_sp)::timestamptz AT TIME ZONE 'Europe/Vienna', 'DD.MM.YYYY');
  END IF;
  v_text := 'Gesperrt: ' || v_grund || coalesce(' am ' || v_seit, '') || ' – '
            || CASE WHEN TG_OP = 'DELETE' THEN 'Löschen ist nicht möglich.'
                    WHEN cardinality(v_erlaubt) = 0 THEN 'keine Änderung möglich (' || array_to_string(v_spalten, ', ') || ').'
                    ELSE 'änderbar sind nur ' || array_to_string(v_erlaubt, ', ') || ' (nicht: ' || array_to_string(v_spalten, ', ') || ').' END;
  RAISE EXCEPTION '%', v_text
    USING ERRCODE = '42501', HINT = 'freeze',
          DETAIL = jsonb_build_object('tabelle', TG_TABLE_NAME, 'grund', v_grund, 'seit', v_seit,
                                      'erlaubt', to_jsonb(v_erlaubt), 'spalten', to_jsonb(coalesce(v_spalten, '{}')),
                                      'aktion', TG_OP)::text;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_freeze() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.s112_freeze_korrektur(p_tenant_id uuid, p_tabelle text, p_id uuid, p_werte jsonb, p_grund text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_spalten text[];
  v_falsch  text[];
  v_alt     jsonb;
  v_neu     jsonb;
  v_diff    text[];
  v_n       integer;
BEGIN
  -- Betriebsleiter (Entscheidung KAN-85): system_admin/tenant_admin des eigenen Betriebs
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF length(btrim(coalesce(p_grund, ''))) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für die Korrektur angeben (mindestens 10 Zeichen).' USING ERRCODE = '23514';
  END IF;
  IF p_tabelle IS NULL OR NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = to_regclass(format('public.%I', p_tabelle)) AND NOT t.tgisinternal
          AND t.tgfoid = 'public.s112_freeze()'::regprocedure) THEN
    RAISE EXCEPTION 'Die Tabelle „%“ hat keine Sperre – bitte normal bearbeiten.', coalesce(p_tabelle, '–') USING ERRCODE = '42501';
  END IF;
  IF p_werte IS NULL OR jsonb_typeof(p_werte) <> 'object' OR p_werte = '{}'::jsonb THEN
    RAISE EXCEPTION 'Keine Änderungen übergeben.' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(k ORDER BY k) INTO v_spalten FROM jsonb_object_keys(p_werte) k;
  SELECT array_agg(k ORDER BY k) INTO v_falsch FROM unnest(v_spalten) k
   WHERE k IN ('id', 'tenant_id')
      OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass(format('public.%I', p_tabelle))
                      AND a.attname = k AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '');
  IF v_falsch IS NOT NULL THEN
    RAISE EXCEPTION 'Diese Spalten lassen sich nicht korrigieren: %', array_to_string(v_falsch, ', ') USING ERRCODE = '22023';
  END IF;

  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id = $1 AND t.tenant_id = $2 FOR UPDATE', p_tabelle)
    INTO v_alt USING p_id, p_tenant_id;
  IF v_alt IS NULL THEN
    RAISE EXCEPTION 'Datensatz nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('s112.freeze_frei', p_tabelle, true);
  EXECUTE format('UPDATE public.%I t SET (%s) = (SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1) r) WHERE t.id = $2 AND t.tenant_id = $3',
                 p_tabelle,
                 (SELECT string_agg(quote_ident(k), ', ') FROM unnest(v_spalten) k),
                 (SELECT string_agg('r.' || quote_ident(k), ', ') FROM unnest(v_spalten) k),
                 p_tabelle)
    USING p_werte, p_id, p_tenant_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('s112.freeze_frei', '', true);

  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id = $1', p_tabelle) INTO v_neu USING p_id;
  SELECT array_agg(k ORDER BY k) INTO v_diff FROM unnest(v_spalten) k WHERE (v_neu -> k) IS DISTINCT FROM (v_alt -> k);
  IF v_n = 1 AND v_diff IS NOT NULL THEN
    INSERT INTO public.bestandsprotokoll (tenant_id, tabelle, datensatz_id, aktion, alt, neu, geaenderte_spalten, db_rolle, benutzer_id, grund)
    VALUES (p_tenant_id, p_tabelle, p_id, 'UPDATE',
            (SELECT jsonb_object_agg(k, v_alt -> k) FROM unnest(v_diff) k),
            (SELECT jsonb_object_agg(k, v_neu -> k) FROM unnest(v_diff) k),
            v_diff, coalesce(nullif(current_setting('role', true), 'none'), session_user::text), auth.uid(),
            'Korrektur trotz Sperre (Betriebsleiter): ' || btrim(p_grund));
  END IF;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_freeze_korrektur(uuid, text, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.s112_freeze_korrektur(uuid, text, uuid, jsonb, text) TO authenticated;
