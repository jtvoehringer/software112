-- KAN-150 (Folgeticket F), Etappe F2a: Anträge und Aufzeichnungen stornieren statt löschen (Soll 8, Fragen 6 und 8)
--
-- Betrifft dac_antrag, weinanalysen, pruefnummernantraege, transportbescheinigungen, exportauftraege (+ Kinder
-- exportauftrag_positionen, export_dokumente). Heute löschbar per API (SA/TA bzw. jedes Mitglied), ohne Protokoll.
--
--  1. Storno-Spalten storniert_am/_von/_von_name/storno_grund + CHECK <tabelle>_storno_chk (Grund ≥ 10 Zeichen) und
--     Schutz-Trigger a_storno_schutz (s112_storno_schutz, unverändert) an den fünf Tabellen.
--  2. Kinder des Exportauftrags: a_export_kind_schutz – an einem stornierten Auftrag keine neuen oder geänderten
--     Positionen/Dokumente (API-Rollen; Wartung frei).
--  3. Löschsperre: a_loeschsperre ('storno') an den fünf Tabellen, ('kind', 'exportauftrag_id') an den Kindern;
--     RESTRICTIVE keine_direktloeschung an allen sieben; die PERMISSIVE-DELETE-Policies dac_antrag_delete,
--     „analysen: admin can delete“, pna_delete, tb_delete entfallen. Storage „analysen“: DELETE-Policy entfällt.
--  4. s112_loeschsperre: Durchlass zusätzlich für einen Entwurf, den die Lösch-RPC freigibt (s112.entwurf_loeschen
--     = id, Frage 8). Sonst unverändert.
--  5. Lösch-RPC s112_storniert_loeschen: + die fünf Tabellen (Module wie die modul_*-Policies). DAC nie mit Füllungen
--     oder Prüfnummernantrag (auch stornierten – sonst SET NULL), Füllung nie mit Exportposition. Entwürfe ohne Bezug
--     (DAC „entwurf“ ohne Füllung/Prüfnummernantrag, Export „entwurf“ ohne ausgestelltes Dokument und ohne ARC) auch
--     ohne Storno, dann nur system_admin/tenant_admin (Frage 8); Grund bleibt Pflicht.
--  6. Änderungsprotokoll: z_protokoll_aendern (Status, Prüfnummer, Mengen, Messwerte, formular_daten, EMCS, Storno),
--     z_protokoll_loeschen, z_protokoll_truncate an den fünf Tabellen.
-- Kein session_replication_role (KAN-124). Keine Daten betroffen: alle neuen Spalten NULL.

-- 1. Storno-Spalten und Schutz ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['dac_antrag', 'weinanalysen', 'pruefnummernantraege', 'transportbescheinigungen', 'exportauftraege'] LOOP
    EXECUTE format('ALTER TABLE public.%I
      ADD COLUMN IF NOT EXISTS storniert_am timestamptz,
      ADD COLUMN IF NOT EXISTS storniert_von uuid,
      ADD COLUMN IF NOT EXISTS storniert_von_name text,
      ADD COLUMN IF NOT EXISTS storno_grund text', t);
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_storno_chk');
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
      (storniert_am IS NULL AND storniert_von IS NULL AND storniert_von_name IS NULL AND storno_grund IS NULL)
      OR (storniert_am IS NOT NULL AND length(btrim(coalesce(storno_grund, ''''))) >= 10))', t, t || '_storno_chk');
    EXECUTE format('COMMENT ON COLUMN public.%I.storniert_am IS %L', t,
      'KAN-150 F2: Zeitpunkt des Stornos (Zeile bleibt stehen, gilt nicht mehr); setzt s112_storno_schutz');
    EXECUTE format('COMMENT ON COLUMN public.%I.storniert_von IS %L', t, 'KAN-150 F2: Benutzer (auth.uid(), ohne FK)');
    EXECUTE format('COMMENT ON COLUMN public.%I.storniert_von_name IS %L', t, 'KAN-150 F2: Name des Benutzers als Momentaufnahme');
    EXECUTE format('COMMENT ON COLUMN public.%I.storno_grund IS %L', t, 'KAN-150 F2: Grund des Stornos (mind. 10 Zeichen)');
    EXECUTE format('DROP TRIGGER IF EXISTS a_storno_schutz ON public.%I', t);
    EXECUTE format('CREATE TRIGGER a_storno_schutz BEFORE INSERT OR UPDATE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION public.s112_storno_schutz()', t);
  END LOOP;
END $$;

-- 2. Kinder eines stornierten Exportauftrags unveränderlich ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_export_kind_schutz()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text) NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.exportauftraege a
              WHERE a.id IN (NEW.exportauftrag_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.exportauftrag_id END)
                AND a.storniert_am IS NOT NULL) THEN
    RAISE EXCEPTION 'Der Exportauftrag ist storniert und kann nicht mehr geändert werden (KAN-150).' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_export_kind_schutz() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['exportauftrag_positionen', 'export_dokumente'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS a_export_kind_schutz ON public.%I', t);
    EXECUTE format('CREATE TRIGGER a_export_kind_schutz BEFORE INSERT OR UPDATE ON public.%I
      FOR EACH ROW EXECUTE FUNCTION public.s112_export_kind_schutz()', t);
  END LOOP;
END $$;

-- 3. Löschsperre ──────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['dac_antrag', 'weinanalysen', 'pruefnummernantraege', 'transportbescheinigungen', 'exportauftraege'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS a_loeschsperre ON public.%I', t);
    EXECUTE format('CREATE TRIGGER a_loeschsperre BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.s112_loeschsperre(%L)', t, 'storno');
  END LOOP;
  FOREACH t IN ARRAY ARRAY['exportauftrag_positionen', 'export_dokumente'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS a_loeschsperre ON public.%I', t);
    EXECUTE format('CREATE TRIGGER a_loeschsperre BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.s112_loeschsperre(%L, %L)', t, 'kind', 'exportauftrag_id');
  END LOOP;
  FOREACH t IN ARRAY ARRAY['dac_antrag', 'weinanalysen', 'pruefnummernantraege', 'transportbescheinigungen', 'exportauftraege',
                           'exportauftrag_positionen', 'export_dokumente'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS keine_direktloeschung ON public.%I', t);
    EXECUTE format('CREATE POLICY keine_direktloeschung ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (false)', t);
  END LOOP;
END $$;
DROP POLICY IF EXISTS dac_antrag_delete ON public.dac_antrag;
DROP POLICY IF EXISTS "analysen: admin can delete" ON public.weinanalysen;
DROP POLICY IF EXISTS pna_delete ON public.pruefnummernantraege;
DROP POLICY IF EXISTS tb_delete ON public.transportbescheinigungen;
DROP POLICY IF EXISTS "analysen: Admins löschen" ON storage.objects;

-- 4. s112_loeschsperre: Durchlass für freigegebene Entwürfe (Frage 8) ─────────────────────────────────────
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
  -- (2) Lösch-RPC: genau die freigegebene, stornierte Zeile bzw. Kinder dieses Elternteils (Kaskade);
  --     KAN-150 F2 (Frage 8): oder ein Entwurf, den die Lösch-RPC ausdrücklich freigibt (s112.entwurf_loeschen = id)
  IF v_rpc IS NOT NULL THEN
    IF v_modus = 'storno' AND v_rpc = v_alt ->> 'id'
       AND ((v_alt ->> 'storniert_am') IS NOT NULL OR NULLIF(current_setting('s112.entwurf_loeschen', true), '') = v_rpc) THEN
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

-- 5. Lösch-RPC ────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.s112_storniert_loeschen(p_tenant_id uuid, p_tabelle text, p_id uuid, p_grund text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Tabellen mit Storno und ihre Schreibmodule (wie die RESTRICTIVE-Policies modul_delete)
  c_tabellen constant text[] := ARRAY['verschneidungen', 'keller_umzuege', 'keller_behandlungen', 'fuellungen', 'zukauf_posten',
                                      'pressungen', 'ernte_parzellen', 'traubenverkauf',
                                      'dac_antrag', 'weinanalysen', 'pruefnummernantraege', 'transportbescheinigungen', 'exportauftraege'];
  v_module    text[];
  v_storniert boolean;
  v_entwurf   boolean := false;
  v_status    text;
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
    WHEN 'verschneidungen'          THEN ARRAY['kellerbuch']
    WHEN 'keller_behandlungen'      THEN ARRAY['kellerbuch']
    WHEN 'keller_umzuege'           THEN ARRAY['kellerbuch', 'warenwirtschaft']
    WHEN 'fuellungen'               THEN ARRAY['kellerbuch', 'warenwirtschaft']
    WHEN 'zukauf_posten'            THEN ARRAY['warenwirtschaft']
    WHEN 'pressungen'               THEN ARRAY['kellerbuch', 'rieden']
    WHEN 'ernte_parzellen'          THEN ARRAY['rieden', 'kellerbuch']
    WHEN 'traubenverkauf'           THEN ARRAY['rieden', 'warenwirtschaft']
    WHEN 'dac_antrag'               THEN ARRAY['kellerbuch']
    WHEN 'weinanalysen'             THEN ARRAY['kellerbuch']
    WHEN 'pruefnummernantraege'     THEN ARRAY['kellerbuch']
    WHEN 'transportbescheinigungen' THEN ARRAY['kellerbuch', 'warenwirtschaft']
    WHEN 'exportauftraege'          THEN ARRAY['warenwirtschaft']
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
    IF p_tabelle IN ('dac_antrag', 'exportauftraege') THEN
      EXECUTE format('SELECT status FROM public.%I WHERE id = $1', p_tabelle) INTO v_status USING p_id;
    END IF;
  END IF;
  IF v_storniert IS NULL THEN
    RAISE EXCEPTION 'Buchung nicht gefunden.' USING ERRCODE = 'P0002';
  END IF;

  -- KAN-150 F2 (Frage 8): DAC- und Export-Entwurf ohne Bezug auch ohne Storno – nur Betriebsleitung
  IF NOT v_storniert AND p_tabelle IN ('dac_antrag', 'exportauftraege') AND v_status = 'entwurf' THEN
    IF NOT public.user_has_role_in_tenant(p_tenant_id, ARRAY['system_admin', 'tenant_admin'])
       AND COALESCE(NULLIF(current_setting('role', true), 'none'), session_user::text) IN ('authenticated', 'anon') THEN
      RAISE EXCEPTION 'Einen Entwurf löscht nur die Betriebsleitung – bitte stornieren.' USING ERRCODE = '42501';
    END IF;
    v_entwurf := true;
  END IF;
  IF NOT v_storniert AND NOT v_entwurf THEN
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
  -- KAN-150 F2: Füllung nicht mit Exportposition (sonst SET NULL auf fullung_id)
  IF p_tabelle = 'fuellungen' AND EXISTS (SELECT 1 FROM public.exportauftrag_positionen ep
       JOIN public.exportauftraege a ON a.id = ep.exportauftrag_id
       WHERE ep.fullung_id = p_id AND a.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Die Füllung steht in einem Exportauftrag – sie bleibt als storniert stehen.' USING ERRCODE = '42501';
  END IF;
  -- KAN-150 F2: DAC-Antrag nicht mit Füllungen oder Prüfnummernantrag (auch stornierten; sonst SET NULL)
  IF p_tabelle = 'dac_antrag' AND (
       EXISTS (SELECT 1 FROM public.fuellungen f WHERE f.dac_antrag_id = p_id AND f.tenant_id = p_tenant_id)
       OR EXISTS (SELECT 1 FROM public.pruefnummernantraege pn WHERE pn.dac_antrag_id = p_id AND pn.tenant_id = p_tenant_id)) THEN
    RAISE EXCEPTION 'Am DAC-Antrag hängen Füllungen oder ein Prüfnummernantrag – er bleibt als storniert stehen.' USING ERRCODE = '42501';
  END IF;
  -- KAN-150 F2 (Frage 8): Export-Entwurf nur ohne ausgestelltes Dokument und ohne ARC
  IF p_tabelle = 'exportauftraege' AND v_entwurf AND (
       EXISTS (SELECT 1 FROM public.export_dokumente d WHERE d.exportauftrag_id = p_id AND d.status = 'ausgestellt')
       OR EXISTS (SELECT 1 FROM public.exportauftraege a WHERE a.id = p_id AND NULLIF(btrim(a.emcs_arc_nummer), '') IS NOT NULL)) THEN
    RAISE EXCEPTION 'Der Exportauftrag hat ausgestellte Dokumente oder eine ARC-Nummer – bitte stornieren.' USING ERRCODE = '42501';
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
  IF v_entwurf THEN
    PERFORM set_config('s112.entwurf_loeschen', p_id::text, true);
  END IF;
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
  PERFORM set_config('s112.entwurf_loeschen', '', true);
  PERFORM set_config('s112.loesch_grund', '', true);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.s112_storniert_loeschen(uuid, text, uuid, text) FROM PUBLIC, anon;

-- 6. Änderungsprotokoll ───────────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.dac_antrag;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF status, pruefnummer, eingereicht_am, bescheid_am, menge_liter, alkohol_prozent,
  weinausbau_id, jahrgang, rebsorte, dac_region, aktiv, tenant_id, storniert_am, storno_grund ON public.dac_antrag
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('status', 'pruefnummer', 'eingereicht_am', 'bescheid_am',
  'menge_liter', 'alkohol_prozent', 'weinausbau_id', 'jahrgang', 'rebsorte', 'dac_region', 'aktiv', 'tenant_id', 'storniert_am',
  'storno_grund');

DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.weinanalysen;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF analyse_datum, weinausbau_id, labor, probe_nr, alkohol_vol, gesamtalkohol_vol,
  restzucker_gl, gesamtsaeure_gl, "flüchtige_saeure_gl", ph_wert, freie_so2_mgl, gesamt_so2_mgl, weinsaeure_gl, apfelsaeure_gl,
  milchsaeure_gl, dichte, extrakt_gl, tenant_id, storniert_am, storno_grund ON public.weinanalysen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('analyse_datum', 'weinausbau_id', 'labor', 'probe_nr',
  'alkohol_vol', 'gesamtalkohol_vol', 'restzucker_gl', 'gesamtsaeure_gl', 'flüchtige_saeure_gl', 'ph_wert', 'freie_so2_mgl',
  'gesamt_so2_mgl', 'weinsaeure_gl', 'apfelsaeure_gl', 'milchsaeure_gl', 'dichte', 'extrakt_gl', 'tenant_id', 'storniert_am',
  'storno_grund');

DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.pruefnummernantraege;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF formular_daten, dac_antrag_id, tenant_id, storniert_am, storno_grund
  ON public.pruefnummernantraege
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('formular_daten', 'dac_antrag_id', 'tenant_id', 'storniert_am',
  'storno_grund');

DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.transportbescheinigungen;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF formular_daten, verkaufsposten_id, tenant_id, storniert_am, storno_grund
  ON public.transportbescheinigungen
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('formular_daten', 'verkaufsposten_id', 'tenant_id',
  'storniert_am', 'storno_grund');

DROP TRIGGER IF EXISTS z_protokoll_aendern ON public.exportauftraege;
CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF status, emcs_arc_nummer, emcs_status, emcs_datum, datum, lieferdatum,
  kontakt_id, firma_id, destination_land, aktiv, tenant_id, storniert_am, storno_grund ON public.exportauftraege
  FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('status', 'emcs_arc_nummer', 'emcs_status', 'emcs_datum',
  'datum', 'lieferdatum', 'kontakt_id', 'firma_id', 'destination_land', 'aktiv', 'tenant_id', 'storniert_am', 'storno_grund');

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['dac_antrag', 'weinanalysen', 'pruefnummernantraege', 'transportbescheinigungen', 'exportauftraege'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS z_protokoll_loeschen ON public.%I', t);
    EXECUTE format('CREATE TRIGGER z_protokoll_loeschen AFTER DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS z_protokoll_truncate ON public.%I', t);
    EXECUTE format('CREATE TRIGGER z_protokoll_truncate BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.bestandsprotokoll_schreiben()', t);
  END LOOP;
END $$;

-- Selbstprüfung ───────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text; v_n int;
BEGIN
  FOREACH t IN ARRAY ARRAY['dac_antrag', 'weinanalysen', 'pruefnummernantraege', 'transportbescheinigungen', 'exportauftraege'] LOOP
    SELECT count(*) INTO v_n FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = t AND column_name IN ('storniert_am', 'storniert_von', 'storniert_von_name', 'storno_grund');
    IF v_n <> 4 THEN RAISE EXCEPTION 'KAN-150 F2a: Storno-Spalten an % unvollständig', t; END IF;
    SELECT count(*) INTO v_n FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = ('public.' || t)::regclass
       AND tgname IN ('a_storno_schutz', 'a_loeschsperre', 'z_protokoll_aendern', 'z_protokoll_loeschen', 'z_protokoll_truncate');
    IF v_n <> 5 THEN RAISE EXCEPTION 'KAN-150 F2a: Trigger an % unvollständig (%)', t, v_n; END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND cmd = 'DELETE' AND permissive = 'PERMISSIVE'
     AND tablename IN ('dac_antrag', 'weinanalysen', 'pruefnummernantraege', 'transportbescheinigungen');
  IF v_n <> 0 THEN RAISE EXCEPTION 'KAN-150 F2a: noch % PERMISSIVE-DELETE-Policies', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE policyname = 'keine_direktloeschung' AND tablename IN ('dac_antrag', 'weinanalysen', 'pruefnummernantraege',
     'transportbescheinigungen', 'exportauftraege', 'exportauftrag_positionen', 'export_dokumente');
  IF v_n <> 7 THEN RAISE EXCEPTION 'KAN-150 F2a: keine_direktloeschung % statt 7', v_n; END IF;
END $$;
