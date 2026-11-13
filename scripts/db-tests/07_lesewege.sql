-- @bereich: Leserechte je Profil (KAN-455, R3 zu KAN-412) – Lesewege an den Sperr-Policies vorbei
-- @ziel: SECURITY-DEFINER-Funktionen und der Storage laufen an den Policies „lesebereich“ vorbei. Jede Funktion mit
-- @ziel: p_tenant_id, die Benutzer aufrufen können, prüft entweder den Lesebereich aus der Soll-Liste oder steht
-- @ziel: begründet in der Liste „ohne Lesebereich“ – eine neue Funktion ohne Einstufung macht den Test rot.
-- @ziel: Mitarbeiter mit Profil „extern“ bzw. „vertrieb“ bekommen aus Funktionen gesperrter Bereiche 42501 (HINT
-- @ziel: lesebereich) bzw. 0 Zeilen, die KI-Abfrage ist für „extern“ gesperrt und liefert „vertrieb“ keine Kellerdaten,
-- @ziel: Dateien im Storage sind je Bucket nur mit dem passenden Bereich lesbar. Ohne Profil ändert sich nichts.
-- @mutation pruefe_lesen_aus: s112_pruefe_lesen prüft nichts mehr | rot: (extern|vertrieb)_.*
-- @mutation uva_ohne_pruefung: berechne_ea_uva ohne Leseprüfung | rot: funktion:berechne_ea_uva|vertrieb_uva
-- @mutation storage_ohne_policy: die Sperre kennt keinen gesperrten Betrieb mehr | rot: storage_.*|(extern|vertrieb)_.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 07 (Stand 13.11.2026, KAN-455). Alles zurückgerollt.
-- Die Policy auf storage.objects gehört supabase_storage_admin – die Mutation läuft deshalb über die Hilfsfunktion.

-- 'ok' bzw. '<SQLSTATE>|<HINT>' einer Anweisung als gerade aktive Rolle
CREATE FUNCTION pg_temp.t07(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v_state text;
  v_hint  text;
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_hint = PG_EXCEPTION_HINT;
  RETURN v_state || '|' || coalesce(v_hint, '');
END $f$;

DO $test$
DECLARE
  c_datei constant text := '07_lesewege';
  -- Funktion=Bereich: der Quelltext prüft genau diesen Bereich ('*' = Bereich je Tabelle)
  c_soll  constant text[] := ARRAY[
    'berechne_ea_uva=ea', 'crm_dubletten=crm', 'crm_filterwerte=crm', 'crm_zaehler=crm',
    'journal_abgleichen=keller', 'journal_konsistenz=keller', 'ki_readonly_query=ki', 'lade_behaelter=keller',
    'lade_crmgemeinschaft=crm', 'lade_kellergemeinschaft=keller', 's112_ama_einreichen=lese', 's112_ama_korrektur_anlegen=lese',
    's112_ama_meldung_speichern=lese', 's112_ama_status_setzen=lese', 's112_betriebsmittel_einkauf=betriebsmittel', 's112_betriebsmittel_stornieren=betriebsmittel',
    's112_lager_einkauf=betriebsmittel', 's112_lager_einkauf_stornieren=betriebsmittel', 's112_mostzeile_anlegen=lese', 's112_pressung_anlegen=lese',
    's112_pressung_stornieren=lese', 's112_pressung_zeilen_stornieren=lese', 's112_psm_uebermittlung_protokollieren=betriebsmittel', 's112_schwund_minderung=keller',
    's112_stammdaten_bezuege=*', 's112_verkauf_samt_rechnung_stornieren=verkauf', 'schwund_buchen=keller'];
  -- ohne Lesebereich: Rechte-Helfer, Nummernkreise, Funktionen in Bereichen, die jedes Profil mit dem nötigen
  -- Schreibmodul auch lesen darf (Kellerbuch, Warenwirtschaft, CRM, E&A), und Funktionen nur für die Betriebsleitung
  c_frei  constant text[] := ARRAY[
    'fuellung_bestand_buchen', 'get_next_accountnummer', 'get_next_chargennummer', 'get_next_liefernummer',
    'get_next_personenkonto', 'get_next_transaktionsnr', 'get_user_role_in_tenant', 'journal_eroeffnen',
    'kellerbuch_abschliessen', 'kontakte_zusammenfuehren', 'pruefe_ea_zeitraum_offen', 'pruefe_tenant_zugriff',
    's112_angebot_aendern', 's112_angebot_anlegen', 's112_angebot_status_setzen', 's112_artikel_bewegung_stornieren',
    's112_artikel_buchen', 's112_artikel_verkauf_buchen', 's112_artikel_verkauf_stornieren', 's112_auftrag_ab_vermerken',
    's112_auftrag_abschliessen', 's112_auftrag_anlegen', 's112_auftrag_liefern', 's112_auftrag_lieferung_zuruecknehmen',
    's112_auftrag_stornieren', 's112_charge_abstufen', 's112_charge_status_setzen', 's112_darf_lesen',
    's112_ea_beleg_loesen', 's112_ea_kosten_zuordnen', 's112_ea_stornieren', 's112_elabel_umleiten',
    's112_etikettierung_stornieren', 's112_export_muster_buchen', 's112_exportauftrag_aendern', 's112_exportauftrag_status_setzen',
    's112_freeze_korrektur', 's112_fuellung_aendern', 's112_fuellung_etikettieren', 's112_fuellung_nachtragen',
    's112_fuellung_verkauf_buchen', 's112_gutschrift_anlegen', 's112_herkunft_setzen', 's112_kontakt_historie_zu_firma',
    's112_kontakt_personendaten_loeschen', 's112_lohnversektung_stornieren', 's112_lohnversektung_versenden', 's112_mandant_mitglieder',
    's112_paketmodul_frei', 's112_privat_bloecke', 's112_produktion_buchen', 's112_produktion_stornieren',
    's112_pruefnummernantrag_status_setzen', 's112_rechnung_erstellen', 's112_rechnung_stornieren', 's112_sekt_stufe_setzen',
    's112_storniert_loeschen', 's112_umbuchung_stornieren', 's112_verarbeitung_buchen', 's112_verarbeitung_stornieren',
    's112_verschnitt_buchen', 's112_verschnitte_buchen', 's112_zahlung_stornieren', 's112_zugangskorrektur_buchen',
    's112_zugangskorrektur_stornieren', 's112_zukauf_buchen', 'setze_kontobewegung_abgeglichen', 'sperre_ea_monat',
    'sperre_ea_uva', 'user_has_role_in_tenant'];
  c_buckets constant text[] := ARRAY['aktivitaet-dokumente=crm', 'analysen=keller', 'dokumente=betrieb', 'ea-belege=ea', 'etiketten=lager',
    'export-nachweise=verkauf', 'fuellung-bilder=lager'];
  v_t0   timestamptz;
  v_erg  text[] := '{}';
  v_a    jsonb;
  v_b    uuid;
  v_bta  uuid;
  v_bw   uuid;
  v_ext  uuid;
  v_ver  uuid;
  v_e    text;
  v_fn   text;
  v_ber  text;
  v_src  text;
  v_n    bigint;
  v_txt  text;
  v_uuid uuid := gen_random_uuid();
  v_einkauf text;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_ext := pg_temp.s112_benutzer('winzer', v_b);
  v_ver := pg_temp.s112_benutzer('winzer', v_b);
  UPDATE public.tenant_memberships SET profil = 'extern' WHERE tenant_id = v_b AND user_id = v_ext;
  UPDATE public.tenant_memberships SET profil = 'vertrieb' WHERE tenant_id = v_b AND user_id = v_ver;
  PERFORM pg_temp.s112_beispiel('kontakte', v_b, v_bta);
  PERFORM pg_temp.s112_beispiel('behaelter', v_b, v_bta);   -- für die KI-Abfrage als Vertrieb (Keller gesperrt)
  INSERT INTO storage.objects (bucket_id, name, owner)
    SELECT split_part(e, '=', 1), v_b || '/s112test/lesewege.dat', v_bta FROM unnest(c_buckets) e;
  INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('mandant-logos', v_b || '/s112test/lesewege.dat', v_bta);

  PERFORM pg_temp.s112_mutiere('pruefe_lesen_aus', $m$CREATE OR REPLACE FUNCTION public.s112_pruefe_lesen(p_tenant_id uuid, p_bereich text)
    RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $x$ BEGIN RETURN; END $x$$m$);
  PERFORM pg_temp.s112_mutiere('uva_ohne_pruefung', $m$DO $d$ BEGIN
    EXECUTE regexp_replace(pg_get_functiondef('public.berechne_ea_uva(uuid, smallint, text)'::regprocedure),
      'PERFORM public\.s112_pruefe_lesen\([^;]*;', '');
  END $d$$m$);
  PERFORM pg_temp.s112_mutiere('storage_ohne_policy', $m$CREATE OR REPLACE FUNCTION public.s112_lesegesperrte_tenants(p_bereich text)
    RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $x$ SELECT NULL::uuid WHERE false $x$$m$);

  -- ── 1. Katalog: jede Funktion der Soll-Liste prüft ihren Bereich; keine Funktion ohne Einstufung ───────────────
  FOREACH v_e IN ARRAY c_soll LOOP
    v_fn := split_part(v_e, '=', 1);
    v_ber := split_part(v_e, '=', 2);
    SELECT string_agg(p.prosrc, '') INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = v_fn;
    v_erg := v_erg || pg_temp.s112_erwarte('funktion:' || v_fn,
      CASE WHEN v_ber = '*' THEN v_src ~ 's112_pruefe_lesen\(p_tenant_id, CASE'
           ELSE v_src ~ ('s112_(pruefe|darf)_lesen\(p_tenant_id, ''' || v_ber || '''\)') END, true);
  END LOOP;
  -- Die sechs SQL-Funktionen prüfen die Mitgliedschaft selbst und lassen die Sitzung „postgres“ durch (Einstufung
  -- session_user) – im Testrahmen sind sie deshalb nicht als Benutzer prüfbar. Statisch: die Leseprüfung steht im
  -- Zweig der Mitgliedschaft, direkt hinter der Sperre des Betriebs.
  SELECT string_agg(p.proname, ',' ORDER BY p.proname) INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('crm_dubletten', 'crm_filterwerte', 'crm_zaehler', 'lade_crmgemeinschaft', 'lade_behaelter', 'lade_kellergemeinschaft')
     AND p.prosrc !~ 'm\.aktiv\)\s+(/\* KAN-159 B15/B16 \*/ )?AND public\.s112_aal_ok\(\) AND NOT public\.s112_betrieb_gesperrt\(p_tenant_id\) /\* KAN-455 \*/ AND public\.s112_darf_lesen\(p_tenant_id, ''(crm|keller)''\)\)';
  v_erg := v_erg || pg_temp.s112_erwarte('sql_funktion_pruefung_im_mitgliedszweig', coalesce(v_txt, ''), '');
  SELECT string_agg(p.proname, ',' ORDER BY p.proname) INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND pg_get_function_identity_arguments(p.oid) LIKE 'p_tenant_id uuid%'
     AND NOT (p.proname = ANY (c_frei)) AND NOT EXISTS (SELECT 1 FROM unnest(c_soll) s WHERE split_part(s, '=', 1) = p.proname);
  v_erg := v_erg || pg_temp.s112_erwarte('funktion_ohne_einstufung', coalesce(v_txt, ''), '');
  SELECT string_agg(f, ',' ORDER BY f) INTO v_txt
    FROM (SELECT split_part(s, '=', 1) AS f FROM unnest(c_soll) s UNION ALL SELECT unnest(c_frei)) x
   WHERE NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = x.f);
  v_erg := v_erg || pg_temp.s112_erwarte('liste_verwaist', coalesce(v_txt, ''), '');
  SELECT string_agg(f, ',') INTO v_txt FROM unnest(c_frei) f WHERE EXISTS (SELECT 1 FROM unnest(c_soll) s WHERE split_part(s, '=', 1) = f);
  v_erg := v_erg || pg_temp.s112_erwarte('liste_doppelt', coalesce(v_txt, ''), '');
  v_erg := v_erg || pg_temp.s112_erwarte('helfer_intern',
    concat_ws('|', has_function_privilege('authenticated', 'public.s112_pruefe_lesen(uuid, text)', 'EXECUTE'),
      has_function_privilege('anon', 'public.s112_pruefe_lesen(uuid, text)', 'EXECUTE'),
      has_function_privilege('service_role', 'public.s112_pruefe_lesen(uuid, text)', 'EXECUTE')), 'f|f|t');
  v_erg := v_erg || pg_temp.s112_erwarte('storage_policy',
    (SELECT concat_ws('|', p.permissive, p.cmd, p.roles::text) FROM pg_policies p WHERE p.schemaname = 'storage' AND p.tablename = 'objects' AND p.policyname = 'lesebereich'),
    'RESTRICTIVE|SELECT|{authenticated}');
  FOREACH v_e IN ARRAY c_buckets LOOP
    v_erg := v_erg || pg_temp.s112_erwarte('storage_bucket:' || split_part(v_e, '=', 1),
      (SELECT split_part(split_part(p.qual, 'bucket_id <> ''' || split_part(v_e, '=', 1) || '''', 2), 'bucket_id <> ', 1)
                LIKE '%s112_lesegesperrte_tenants(''' || split_part(v_e, '=', 2) || '''::text)%'
         FROM pg_policies p WHERE p.schemaname = 'storage' AND p.tablename = 'objects' AND p.policyname = 'lesebereich'), true);
  END LOOP;

  v_einkauf := format('SELECT public.s112_lager_einkauf(%L, %L, %L, pg_temp.s112_heute(), 1, %L, 1, 13, NULL, NULL, NULL)', v_b, 'psm', v_uuid, 'l');

  -- ── 2. Ohne Profil: wie bisher ───────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_profil_uva', pg_temp.t07(format('SELECT * FROM public.berechne_ea_uva(%L, 2026::smallint, %L)', v_b, 'Q1')), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_profil_journal', pg_temp.t07(format('SELECT * FROM public.journal_konsistenz(%L)', v_b)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_profil_ki', pg_temp.t07(format('SELECT public.ki_readonly_query(%L, %L)', 'select 1 as x', v_b)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_profil_einkauf_kein_lesefehler', pg_temp.t07(v_einkauf) LIKE '%|lesebereich', false);
  v_erg := v_erg || pg_temp.s112_erwarte('ohne_profil_bezuege', pg_temp.t07(format('SELECT public.s112_stammdaten_bezuege(%L, %L, %L)', v_b, 'kontakte', v_uuid)), 'P0002|');
  SELECT count(*) INTO v_n FROM storage.objects o WHERE o.name = v_b || '/s112test/lesewege.dat';
  v_erg := v_erg || pg_temp.s112_erwarte('storage_ohne_profil', v_n, 8::bigint);

  -- ── 3. Extern: nur Rieden und Maßnahmen ──────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_ext);
  v_erg := v_erg || pg_temp.s112_erwarte('extern_uva', pg_temp.t07(format('SELECT * FROM public.berechne_ea_uva(%L, 2026::smallint, %L)', v_b, 'Q1')), '42501|lesebereich');
  v_erg := v_erg || pg_temp.s112_erwarte('extern_journal', pg_temp.t07(format('SELECT * FROM public.journal_konsistenz(%L)', v_b)), '42501|lesebereich');
  v_erg := v_erg || pg_temp.s112_erwarte('extern_ki', pg_temp.t07(format('SELECT public.ki_readonly_query(%L, %L)', 'select 1 as x', v_b)), '42501|lesebereich');
  v_erg := v_erg || pg_temp.s112_erwarte('extern_einkauf', pg_temp.t07(v_einkauf), '42501|lesebereich');
  v_erg := v_erg || pg_temp.s112_erwarte('extern_ama', pg_temp.t07(format('SELECT public.s112_ama_korrektur_anlegen(%L, %L)', v_b, v_uuid)), '42501|lesebereich');
  v_erg := v_erg || pg_temp.s112_erwarte('extern_bezuege_crm', pg_temp.t07(format('SELECT public.s112_stammdaten_bezuege(%L, %L, %L)', v_b, 'kontakte', v_uuid)), '42501|lesebereich');
  v_erg := v_erg || pg_temp.s112_erwarte('extern_bezuege_mittel', pg_temp.t07(format('SELECT public.s112_stammdaten_bezuege(%L, %L, %L)', v_b, 'pflanzenschutzmittel', v_uuid)), '42501|lesebereich');
  v_erg := v_erg || pg_temp.s112_erwarte('extern_bezuege_rieden_frei', pg_temp.t07(format('SELECT public.s112_stammdaten_bezuege(%L, %L, %L)', v_b, 'weingarten', v_uuid)), 'P0002|');
  SELECT string_agg(o.bucket_id, ',' ORDER BY o.bucket_id) INTO v_txt FROM storage.objects o WHERE o.name = v_b || '/s112test/lesewege.dat';
  v_erg := v_erg || pg_temp.s112_erwarte('storage_extern', coalesce(v_txt, ''), 'mandant-logos');

  -- ── 4. Vertrieb: CRM, Verkauf, Lager, Auswertungen, KI – nicht Keller, Lese, Betriebsmittel, E&A ───────────────
  PERFORM pg_temp.s112_als(v_ver);
  v_erg := v_erg || pg_temp.s112_erwarte('vertrieb_uva', pg_temp.t07(format('SELECT * FROM public.berechne_ea_uva(%L, 2026::smallint, %L)', v_b, 'Q1')), '42501|lesebereich');
  v_erg := v_erg || pg_temp.s112_erwarte('vertrieb_journal', pg_temp.t07(format('SELECT * FROM public.journal_konsistenz(%L)', v_b)), '42501|lesebereich');
  v_erg := v_erg || pg_temp.s112_erwarte('vertrieb_schwund', pg_temp.t07(format('SELECT public.s112_schwund_minderung(%L, %L)', v_b, v_uuid)), '42501|lesebereich');
  v_erg := v_erg || pg_temp.s112_erwarte('vertrieb_einkauf', pg_temp.t07(v_einkauf), '42501|lesebereich');
  v_erg := v_erg || pg_temp.s112_erwarte('vertrieb_bezuege_crm_frei', pg_temp.t07(format('SELECT public.s112_stammdaten_bezuege(%L, %L, %L)', v_b, 'kontakte', v_uuid)), 'P0002|');
  v_erg := v_erg || pg_temp.s112_erwarte('vertrieb_bezuege_ea', pg_temp.t07(format('SELECT public.s112_stammdaten_bezuege(%L, %L, %L)', v_b, 'ea_kategorien', v_uuid)), '42501|lesebereich');
  v_erg := v_erg || pg_temp.s112_erwarte('vertrieb_ki_frei', pg_temp.t07(format('SELECT public.ki_readonly_query(%L, %L)', 'select 1 as x', v_b)), 'ok');
  v_erg := v_erg || pg_temp.s112_erwarte('vertrieb_ki_keller_leer',
    public.ki_readonly_query('select count(*) as n from behaelter', v_b) -> 0 ->> 'n', '0');
  v_erg := v_erg || pg_temp.s112_erwarte('vertrieb_ki_crm_sichtbar',
    (public.ki_readonly_query('select count(*) as n from kontakte', v_b) -> 0 ->> 'n')::int > 0, true);
  SELECT string_agg(o.bucket_id, ',' ORDER BY o.bucket_id) INTO v_txt FROM storage.objects o WHERE o.name = v_b || '/s112test/lesewege.dat';
  v_erg := v_erg || pg_temp.s112_erwarte('storage_vertrieb', coalesce(v_txt, ''), 'aktivitaet-dokumente,dokumente,etiketten,export-nachweise,fuellung-bilder,mandant-logos');

  -- ── 5. Die Betriebsleitung liest alles; die Service-Role passiert die Prüfung ─────────────────────────────────
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('betriebsleitung_uva', pg_temp.t07(format('SELECT * FROM public.berechne_ea_uva(%L, 2026::smallint, %L)', v_b, 'Q1')), 'ok');
  SELECT count(*) INTO v_n FROM storage.objects o WHERE o.name = v_b || '/s112test/lesewege.dat';
  v_erg := v_erg || pg_temp.s112_erwarte('storage_betriebsleitung', v_n, 8::bigint);
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('service_passiert', pg_temp.t07(format('SELECT public.s112_pruefe_lesen(%L, %L)', v_b, 'ea')), 'ok');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 68);
END
$test$;
