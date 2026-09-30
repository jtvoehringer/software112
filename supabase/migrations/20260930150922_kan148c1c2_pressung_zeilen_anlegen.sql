-- KAN-148 (Folgeticket C), Etappe C1c-2: Pressung bearbeiten und anlegen ohne Löschen – ENTWURF, erst nach
-- „OK, einspielen“, zuerst Staging
--
-- Bisher löschte upsertPressung beim Bearbeiten entfernte Behälter- und Traubenzeilen (samt Charge) hart und baute
-- beim Anlegen nach einem Fehler per DELETE zurück (Behälterzeile/Charge, neue Pressung ohne Trauben) – in
-- einzelnen Aufrufen ohne Transaktion. Mit der Löschsperre (C1d) scheiterten diese DELETEs. Neu:
--
--  1. s112_charge_folgebuchung(p_tenant_id, p_charge_id) → boolean (intern, nicht per API aufrufbar): hängt an der
--     Charge eine nicht stornierte Bestandsbuchung (Umzug/Schwund, Verschnitt als Quelle oder Ziel, Füllung direkt
--     oder als Füllungscharge, Tankverkauf, Kellerbehandlung, Zukauf-Ziel)? Gleiche Regel wie bisher in
--     s112_pressung_stornieren, das die Funktion jetzt nutzt (Verhalten unverändert).
--  2. s112_pressung_zeilen_stornieren(p_tenant_id, p_pressung_id, p_behaelter_zeilen uuid[], p_trauben_zeilen uuid[],
--     p_grund) → jsonb: storniert beim Bearbeiten entfernte Zeilen einer (nicht stornierten) Pressung in EINER
--     Transaktion – Behälterzeilen samt Charge (wie beim Pressungs-Storno: 0 L, inaktiv, abgeschlossen) und
--     Traubenzeilen. Abgelehnt, wenn eine Zeile nicht zur Pressung gehört oder schon storniert ist, aus einer
--     Behälterzeile direkt verkauft wurde oder an ihrer Charge eine Folgebuchung hängt. Die App übergibt als Grund
--     den festen Text für „Bearbeiten“ (Bearbeiten braucht keinen eigenen Grund, KAN-166).
--  3. s112_mostzeile_anlegen(p_tenant_id, p_pressung_id, p_behaelter_id, p_menge_liter, p_notizen, p_charge jsonb)
--     → jsonb {pressung_behaelter_id, weinausbau_id}: Behälterzeile, Kellerbuch-Charge und Verknüpfung in EINER
--     Transaktion (bisher drei Aufrufe mit Rückbau per DELETE). p_charge: name, jahrgang, rebsorte,
--     qualitaetsstufe, herkunft_code, weinart. Die Trigger (Gebindeprüfung, Herkunft der Charge, Protokoll)
--     laufen wie bisher.
--  4. s112_pressung_anlegen(p_tenant_id, p_kopf jsonb, p_trauben jsonb) → uuid: neue Pressung samt Traubenzeilen in
--     EINER Transaktion (bisher Kopf, dann Zeilen, bei Fehler Kopf per DELETE zurück). Jahrgang, Ried, Grundstück
--     und Zukauf müssen zum Betrieb gehören.
-- Alle RPCs: pruefe_tenant_zugriff (system_admin/tenant_admin/winzer), s112_pruefe_abo_schreibsperre, Schreibmodul
-- Kellerbuch oder Rieden (wie die modul_*-Policies der Tabellen), REVOKE von PUBLIC/anon, search_path.
-- Kein session_replication_role (KAN-124). Keine Daten betroffen.

-- 1. Folgebuchungen einer Charge (intern) ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_charge_folgebuchung(p_tenant_id uuid, p_charge_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.keller_umzuege ku WHERE ku.tenant_id = p_tenant_id AND ku.storniert_am IS NULL
                   AND (ku.von_weinausbau_id = p_charge_id OR ku.nach_weinausbau_id = p_charge_id))
      OR EXISTS (SELECT 1 FROM public.verschneidung_quellen vq JOIN public.verschneidungen v ON v.id = vq.verschneidung_id
                  WHERE vq.quell_weinausbau_id = p_charge_id AND v.storniert_am IS NULL)
      OR EXISTS (SELECT 1 FROM public.verschneidungen v WHERE v.ziel_weinausbau_id = p_charge_id AND v.tenant_id = p_tenant_id AND v.storniert_am IS NULL)
      OR EXISTS (SELECT 1 FROM public.fuellungen f WHERE f.weinausbau_id = p_charge_id AND f.tenant_id = p_tenant_id AND f.storniert_am IS NULL AND f.aktiv)
      OR EXISTS (SELECT 1 FROM public.fuellung_chargen fc JOIN public.fuellungen f ON f.id = fc.fuellung_id
                  WHERE fc.weinausbau_id = p_charge_id AND f.storniert_am IS NULL AND f.aktiv)
      OR EXISTS (SELECT 1 FROM public.verkauf_positionen vp JOIN public.verkaufsposten vs ON vs.id = vp.verkaufsposten_id
                  WHERE vp.weinausbau_id = p_charge_id AND vp.typ = 'tank' AND vp.tenant_id = p_tenant_id AND NOT coalesce(vs.storniert, false))
      OR EXISTS (SELECT 1 FROM public.keller_behandlungen kb WHERE kb.weinausbau_id = p_charge_id AND kb.tenant_id = p_tenant_id AND kb.storniert_am IS NULL)
      OR EXISTS (SELECT 1 FROM public.zukauf_posten zp WHERE zp.ziel_weinausbau_id = p_charge_id AND zp.tenant_id = p_tenant_id
                   AND zp.storniert_am IS NULL AND zp.aktiv)
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_charge_folgebuchung(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- s112_pressung_stornieren nutzt die Hilfsfunktion (Verhalten unverändert)
CREATE OR REPLACE FUNCTION public.s112_pressung_stornieren(p_tenant_id uuid, p_pressung_id uuid, p_grund text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_grund   text := btrim(coalesce(p_grund, ''));
  v_datum   date;
  v_chargen uuid[];
  v_name    text;
  v_n_pb    integer;
  v_n_pw    integer;
  v_n_wa    integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT public.s112_darf_schreiben(p_tenant_id, VARIADIC ARRAY['kellerbuch', 'rieden']) THEN
    RAISE EXCEPTION 'Für das Stornieren der Pressung fehlt das Schreibrecht (Modul Kellerbuch bzw. Rieden).' USING ERRCODE = '42501';
  END IF;
  IF length(v_grund) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für den Storno angeben (mindestens 10 Zeichen).' USING ERRCODE = '22023';
  END IF;

  SELECT p.datum INTO v_datum FROM public.pressungen p
   WHERE p.id = p_pressung_id AND p.tenant_id = p_tenant_id AND p.storniert_am IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.pressungen p WHERE p.id = p_pressung_id AND p.tenant_id = p_tenant_id) THEN
      RAISE EXCEPTION 'Die Pressung ist bereits storniert – bitte die Seite neu laden.' USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'Pressung nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;

  -- Direktverkauf aus einer Behälterzeile (offene Rechnung)
  IF EXISTS (SELECT 1 FROM public.verkauf_positionen vp
               JOIN public.verkaufsposten vs ON vs.id = vp.verkaufsposten_id
               JOIN public.pressung_behaelter pb ON pb.id = vp.pressung_behaelter_id
              WHERE pb.pressung_id = p_pressung_id AND vp.tenant_id = p_tenant_id AND NOT coalesce(vs.storniert, false)) THEN
    RAISE EXCEPTION 'Die Pressung vom % kann nicht storniert werden: Aus ihren Behältern wurde bereits direkt verkauft – bitte zuerst den Verkauf stornieren.',
      to_char(v_datum, 'DD.MM.YYYY') USING ERRCODE = '42501';
  END IF;

  -- Chargen der Pressung und ihre Folgebuchungen (nur nicht stornierte zählen)
  SELECT coalesce(array_agg(DISTINCT pb.weinausbau_id), '{}') INTO v_chargen
    FROM public.pressung_behaelter pb
   WHERE pb.pressung_id = p_pressung_id AND pb.weinausbau_id IS NOT NULL AND pb.storniert_am IS NULL;
  SELECT w.name INTO v_name
    FROM public.weinausbau w
   WHERE w.id = ANY (v_chargen) AND w.tenant_id = p_tenant_id AND public.s112_charge_folgebuchung(p_tenant_id, w.id)
   ORDER BY w.name
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Die Pressung vom % kann nicht storniert werden: An der Charge „%“ hängen bereits Folgebuchungen (Umzug, Verschnitt, Füllung, Verkauf, Behandlung oder Zukauf) – bitte diese zuerst stornieren.',
      to_char(v_datum, 'DD.MM.YYYY'), v_name USING ERRCODE = '42501';
  END IF;

  -- Stornieren (Zeitpunkt/Benutzer setzt s112_storno_schutz)
  UPDATE public.pressung_behaelter SET storniert_am = now(), storno_grund = v_grund
   WHERE pressung_id = p_pressung_id AND storniert_am IS NULL;
  GET DIAGNOSTICS v_n_pb = ROW_COUNT;
  UPDATE public.pressung_weingaerten SET storniert_am = now(), storno_grund = v_grund
   WHERE pressung_id = p_pressung_id AND storniert_am IS NULL;
  GET DIAGNOSTICS v_n_pw = ROW_COUNT;
  UPDATE public.weinausbau SET menge_liter = 0, aktiv = false, status = 'abgeschlossen', storniert_am = now(), storno_grund = v_grund
   WHERE id = ANY (v_chargen) AND tenant_id = p_tenant_id AND storniert_am IS NULL;
  GET DIAGNOSTICS v_n_wa = ROW_COUNT;
  UPDATE public.pressungen SET storniert_am = now(), storno_grund = v_grund
   WHERE id = p_pressung_id AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object('chargen', v_n_wa, 'behaelterzeilen', v_n_pb, 'traubenzeilen', v_n_pw);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_pressung_stornieren(uuid, uuid, text) FROM PUBLIC, anon;

-- 2. Zeilen einer Pressung stornieren (Bearbeiten) ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_pressung_zeilen_stornieren(p_tenant_id uuid, p_pressung_id uuid,
  p_behaelter_zeilen uuid[], p_trauben_zeilen uuid[], p_grund text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_grund   text := btrim(coalesce(p_grund, ''));
  v_pb      uuid[] := coalesce(p_behaelter_zeilen, '{}');
  v_pw      uuid[] := coalesce(p_trauben_zeilen, '{}');
  v_chargen uuid[];
  v_name    text;
  v_n_pb    integer;
  v_n_pw    integer;
  v_n_wa    integer;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT public.s112_darf_schreiben(p_tenant_id, VARIADIC ARRAY['kellerbuch', 'rieden']) THEN
    RAISE EXCEPTION 'Für das Bearbeiten der Pressung fehlt das Schreibrecht (Modul Kellerbuch bzw. Rieden).' USING ERRCODE = '42501';
  END IF;
  IF length(v_grund) < 10 THEN
    RAISE EXCEPTION 'Bitte einen Grund für den Storno angeben (mindestens 10 Zeichen).' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.pressungen p
   WHERE p.id = p_pressung_id AND p.tenant_id = p_tenant_id AND p.storniert_am IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pressung nicht gefunden oder storniert – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;

  -- Jede Zeile gehört zur Pressung und ist noch nicht storniert
  IF (SELECT count(*) FROM public.pressung_behaelter pb
       WHERE pb.id = ANY (v_pb) AND pb.pressung_id = p_pressung_id AND pb.storniert_am IS NULL) <> cardinality(v_pb)
     OR (SELECT count(*) FROM public.pressung_weingaerten pw
          WHERE pw.id = ANY (v_pw) AND pw.pressung_id = p_pressung_id AND pw.storniert_am IS NULL) <> cardinality(v_pw) THEN
    RAISE EXCEPTION 'Eine Zeile gehört nicht (mehr) zu dieser Pressung oder ist schon storniert – bitte die Seite neu laden.' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM public.verkauf_positionen vp JOIN public.verkaufsposten vs ON vs.id = vp.verkaufsposten_id
              WHERE vp.pressung_behaelter_id = ANY (v_pb) AND vp.tenant_id = p_tenant_id AND NOT coalesce(vs.storniert, false)) THEN
    RAISE EXCEPTION 'Der Behälter kann nicht aus der Pressung entfernt werden: Aus ihm wurde bereits direkt verkauft.' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(array_agg(DISTINCT pb.weinausbau_id), '{}') INTO v_chargen
    FROM public.pressung_behaelter pb WHERE pb.id = ANY (v_pb) AND pb.weinausbau_id IS NOT NULL;
  SELECT w.name INTO v_name
    FROM public.weinausbau w
   WHERE w.id = ANY (v_chargen) AND w.tenant_id = p_tenant_id AND public.s112_charge_folgebuchung(p_tenant_id, w.id)
   ORDER BY w.name
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Der Behälter mit der Charge „%“ kann nicht aus der Pressung entfernt werden: An der Charge hängen bereits Folgebuchungen – bitte diese zuerst stornieren.',
      v_name USING ERRCODE = '42501';
  END IF;

  UPDATE public.pressung_behaelter SET storniert_am = now(), storno_grund = v_grund
   WHERE id = ANY (v_pb) AND pressung_id = p_pressung_id AND storniert_am IS NULL;
  GET DIAGNOSTICS v_n_pb = ROW_COUNT;
  UPDATE public.weinausbau SET menge_liter = 0, aktiv = false, status = 'abgeschlossen', storniert_am = now(), storno_grund = v_grund
   WHERE id = ANY (v_chargen) AND tenant_id = p_tenant_id AND storniert_am IS NULL;
  GET DIAGNOSTICS v_n_wa = ROW_COUNT;
  UPDATE public.pressung_weingaerten SET storniert_am = now(), storno_grund = v_grund
   WHERE id = ANY (v_pw) AND pressung_id = p_pressung_id AND storniert_am IS NULL;
  GET DIAGNOSTICS v_n_pw = ROW_COUNT;

  RETURN jsonb_build_object('chargen', v_n_wa, 'behaelterzeilen', v_n_pb, 'traubenzeilen', v_n_pw);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_pressung_zeilen_stornieren(uuid, uuid, uuid[], uuid[], text) FROM PUBLIC, anon;

-- 3. Behälterzeile samt Charge anlegen ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_mostzeile_anlegen(p_tenant_id uuid, p_pressung_id uuid, p_behaelter_id uuid,
  p_menge_liter numeric, p_notizen text, p_charge jsonb)
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
                                 qualitaetsstufe, herkunft_code, weinart, aktiv)
  VALUES (p_tenant_id, coalesce(NULLIF(btrim(p_charge ->> 'name'), ''), 'Pressung'), (p_charge ->> 'jahrgang')::integer,
          NULLIF(p_charge ->> 'rebsorte', ''), p_menge_liter, 'ausbau', p_behaelter_id,
          NULLIF(p_charge ->> 'qualitaetsstufe', ''), NULLIF(p_charge ->> 'herkunft_code', ''),
          coalesce(NULLIF(p_charge ->> 'weinart', ''), 'unbekannt'), true)
  RETURNING id INTO v_wa;

  -- Verknüpfung über die Behälterzeile; der Trigger trg_pressung_weinausbau_weingaerten ergänzt die Herkunft
  UPDATE public.pressung_behaelter SET weinausbau_id = v_wa WHERE id = v_pb;

  RETURN jsonb_build_object('pressung_behaelter_id', v_pb, 'weinausbau_id', v_wa);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_mostzeile_anlegen(uuid, uuid, uuid, numeric, text, jsonb) FROM PUBLIC, anon;

-- 4. Neue Pressung samt Traubenzeilen anlegen ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_pressung_anlegen(p_tenant_id uuid, p_kopf jsonb, p_trauben jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_jahrgang uuid := NULLIF(p_kopf ->> 'jahrgang_id', '')::uuid;
  v_id       uuid;
  v_z        jsonb;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin', 'winzer']);
  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);
  IF NOT public.s112_darf_schreiben(p_tenant_id, VARIADIC ARRAY['kellerbuch', 'rieden']) THEN
    RAISE EXCEPTION 'Für das Anlegen der Pressung fehlt das Schreibrecht (Modul Kellerbuch bzw. Rieden).' USING ERRCODE = '42501';
  END IF;
  IF v_jahrgang IS NULL OR NOT EXISTS (SELECT 1 FROM public.weinjahrgaenge j WHERE j.id = v_jahrgang AND j.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Jahrgang nicht gefunden – bitte die Seite neu laden.' USING ERRCODE = 'P0002';
  END IF;
  IF jsonb_typeof(coalesce(p_trauben, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Ungültige Traubenzeilen.' USING ERRCODE = '22023';
  END IF;
  -- Ried, Grundstück und Zukauf der Traubenzeilen gehören zum Betrieb
  FOR v_z IN SELECT x FROM jsonb_array_elements(coalesce(p_trauben, '[]'::jsonb)) x LOOP
    IF (NULLIF(v_z ->> 'weingarten_id', '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.weingarten w
          WHERE w.id = (v_z ->> 'weingarten_id')::uuid AND w.tenant_id = p_tenant_id))
       OR (NULLIF(v_z ->> 'grundstueck_id', '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.grundstuecke g
          WHERE g.id = (v_z ->> 'grundstueck_id')::uuid AND g.tenant_id = p_tenant_id))
       OR (NULLIF(v_z ->> 'zukauf_posten_id', '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.zukauf_posten z
          WHERE z.id = (v_z ->> 'zukauf_posten_id')::uuid AND z.tenant_id = p_tenant_id)) THEN
      RAISE EXCEPTION 'Eine Traubenzeile verweist auf eine Ried, ein Grundstück oder einen Zukauf eines anderen Betriebs.' USING ERRCODE = '42501';
    END IF;
  END LOOP;

  INSERT INTO public.pressungen (tenant_id, jahrgang_id, lese_id, datum, most_liter_gesamt, weinbezeichnung, kmw_grad, notizen)
  VALUES (p_tenant_id, v_jahrgang, NULLIF(p_kopf ->> 'lese_id', '')::uuid, (p_kopf ->> 'datum')::date,
          NULLIF(p_kopf ->> 'most_liter_gesamt', '')::numeric, NULLIF(p_kopf ->> 'weinbezeichnung', ''),
          NULLIF(p_kopf ->> 'kmw_grad', '')::numeric, NULLIF(p_kopf ->> 'notizen', ''))
  RETURNING id INTO v_id;

  INSERT INTO public.pressung_weingaerten (pressung_id, weingarten_id, grundstueck_id, zukauf_posten_id, trauben_kg, rebsorte,
                                           notizen, ernte_datum, kmw, oechsle, mostgewicht_einheit)
  SELECT v_id, NULLIF(z ->> 'weingarten_id', '')::uuid, NULLIF(z ->> 'grundstueck_id', '')::uuid,
         NULLIF(z ->> 'zukauf_posten_id', '')::uuid, (z ->> 'trauben_kg')::numeric, NULLIF(z ->> 'rebsorte', ''),
         NULLIF(z ->> 'notizen', ''), NULLIF(z ->> 'ernte_datum', '')::date, NULLIF(z ->> 'kmw', '')::numeric,
         NULLIF(z ->> 'oechsle', '')::numeric, NULLIF(z ->> 'mostgewicht_einheit', '')
    FROM jsonb_array_elements(coalesce(p_trauben, '[]'::jsonb)) z;

  RETURN v_id;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_pressung_anlegen(uuid, jsonb, jsonb) FROM PUBLIC, anon;

-- Selbstprüfung
DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.s112_charge_folgebuchung(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.s112_pressung_zeilen_stornieren(uuid, uuid, uuid[], uuid[], text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.s112_mostzeile_anlegen(uuid, uuid, uuid, numeric, text, jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.s112_pressung_anlegen(uuid, jsonb, jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.s112_pressung_stornieren(uuid, uuid, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.s112_pressung_zeilen_stornieren(uuid, uuid, uuid[], uuid[], text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.s112_mostzeile_anlegen(uuid, uuid, uuid, numeric, text, jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.s112_pressung_anlegen(uuid, jsonb, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'KAN-148 C1c-2: EXECUTE-Rechte falsch';
  END IF;
END $$;
