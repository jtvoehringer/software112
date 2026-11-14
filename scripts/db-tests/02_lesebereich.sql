-- @bereich: Leserechte je Profil (KAN-454, R2 zu KAN-412) – Sperr-Policies „lesebereich“ auf allen Tabellen
-- @ziel: Jede Tabelle außerhalb des Bereichs „allgemein“ hat genau eine RESTRICTIVE-Policy „lesebereich“ (seit KAN-459 für alle Befehle) für
-- @ziel: authenticated mit ihrem Bereich aus scripts/lesebereiche.json; Tabellen im Bereich „allgemein“ haben keine.
-- @ziel: Ein Mitarbeiter mit Profil „extern“ bzw. „vertrieb“ sieht in jeder Tabelle genau dann Zeilen des Betriebs,
-- @ziel: wenn der Bereich der Tabelle zu seinem Profil gehört – verglichen mit einem Mitarbeiter ohne Profil, für
-- @ziel: den sich nichts ändert. Partnerbetriebe einer Gemeinschaft sind mitgesperrt.
-- @mutation ohne_policy_kontakte: kontakte ohne Sperr-Policy | rot: policy:kontakte|gesperrt:kontakte:extern
-- @mutation ohne_policy_behaelter: behaelter ohne Sperr-Policy | rot: policy:behaelter|gesperrt:behaelter:.*
-- @mutation partner_offen: die Sperre kennt die Gemeinschaften nicht | rot: partner_gesperrt
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 02 (Stand 13.11.2026, KAN-454). Alles zurückgerollt.
-- Die Soll-Liste (c_soll) ist die Ausgabe von scripts/lesebereich-sql.js – der Test kan454-lesebereich vergleicht sie.

DO $test$
DECLARE
  c_datei constant text := '02_lesebereich';
  c_soll  constant text[] := ARRAY[
    'aktivitaet_dokumente=crm', 'aktivitaeten=crm', 'ama_erntemeldungen=lese', 'ama_meldepositionen=lese', 'assistent_aktionen=ki', 'assistent_korrekturen=ki',
    'assistent_nachrichten=ki', 'assistent_unterhaltungen=ki', 'auftraege=verkauf', 'auftrag_lieferungen=verkauf', 'auftrag_positionen=verkauf', 'behaelter=keller',
    'behandlung_grundstuecke=massnahmen', 'behandlungen=massnahmen', 'bestandsprotokoll=verwaltung', 'bestellung_positionen=verkauf', 'bestellungen=verkauf', 'betriebsmittel=betriebsmittel',
    'betriebsmittel_lager_bewegungen=betriebsmittel', 'buchhaltung_export_protokoll=ea', 'buchhaltung_kontenmapping=ea', 'charge_umstufungen=keller', 'checklisten=betrieb', 'checklisten_punkte=betrieb',
    'crm_dubletten_ignoriert=crm', 'crm_freigaben=crm', 'dac_antrag=keller', 'datenschutz_consents=crm', 'duengemittel=betriebsmittel', 'duengemittel_lager_bewegungen=betriebsmittel',
    'ea_anlagen=ea', 'ea_belege=ea', 'ea_dauerauftraege=ea', 'ea_dauerauftrag_log=ea', 'ea_kategorien=ea', 'ea_monatsabschluss=ea',
    'ea_transaktionen=ea', 'ea_uva=ea', 'elabel_umleitungen=lager', 'elabels=lager', 'email_lead_ignoriert=crm', 'ernte_gst_abgeschlossen=lese',
    'ernte_parzellen=lese', 'export_dokumente=verkauf', 'export_nachweise=verkauf', 'export_registrierungen=verkauf', 'exportauftraege=verkauf', 'exportauftrag_positionen=verkauf',
    'firmen=crm', 'fristen=betrieb', 'fuellung_bewegungen=lager', 'fuellung_chargen=lager', 'fuellung_etikettierungen=lager', 'fuellungen=lager',
    'grundstueck_recht=ea', 'grundstuecke=rieden', 'keller_behandlungen=keller', 'keller_behandlungstypen=keller', 'keller_freigaben=keller', 'keller_umzuege=keller', 'keller_verarbeitungen=keller',
    'keller_zugangskorrekturen=keller', 'kellerbuch_abschluesse=keller', 'kellerbuch_buchungen=keller', 'kellermittel=keller', 'kellermittel_buchungen=keller', 'kellerplaene=keller',
    'kellerplan_positionen=keller', 'kontakt_firmen=crm', 'kontakt_praeferenzen=crm', 'kontakte=crm', 'konten=ea', 'konto_umbuchungen=ea',
    'kostenarten=controlling', 'kosteneintraege=controlling', 'kosteneintrag_behaelter=controlling', 'kosteneintrag_weingaerten=controlling', 'kostenstellen=controlling', 'lagen=rieden',
    'lesen=lese', 'lieferadressen=verkauf', 'lohnversektungen=keller', 'meldung_abgaben=verwaltung', 'morgenberichte=verwaltung', 'pflanzenschutzmittel=betriebsmittel',
    'pipeline_eintraege=crm', 'pipeline_verlauf=crm', 'pressung_behaelter=lese', 'pressung_weingaerten=lese', 'pressungen=lese', 'produktion_eingaenge=keller',
    'produktionen=keller', 'pruefnummer_chargen=keller', 'pruefnummer_ereignisse=keller', 'pruefnummernantraege=keller', 'psm_lager_bewegungen=betriebsmittel', 'psm_uebermittlungen=betriebsmittel',
    'rabattgruppen=verkauf', 'rechnungen=verkauf', 'reifemessungen=rieden', 'saetze_massnahmen=controlling', 'sonstige_artikel=lager', 'sonstige_artikel_bewegungen=lager',
    'stripe_zahlungen_log=verwaltung', 'sumup_checkouts=verkauf', 'sumup_terminals=verkauf', 'sumup_transaktionen=verkauf', 'system_ereignisse=verwaltung', 'transaktionszaehler=verwaltung',
    'transportbescheinigungen=lager', 'traubenverkauf=lese', 'verkauf_ki_begriffe=verkauf', 'verkauf_positionen=verkauf', 'verkaufsposten=verkauf', 'verschneidung_quellen=keller',
    'verschneidungen=keller', 'weinanalysen=keller', 'weinausbau=keller', 'weinausbau_weingaerten=keller', 'weinbaugebiete_custom=rieden', 'weingarten=rieden',
    'weingarten_rebsorten=rieden', 'weinjahrgaenge=lese', 'zahlungen=verkauf', 'zeiterfassung=controlling', 'zukauf_posten=lager'];
  c_allgemein constant text[] := ARRAY[
    'benachrichtigungen', 'benutzer_dashboard', 'elabel_zutaten', 'kat_buchungsart', 'kat_erzeugnis', 'kat_farbe', 'kat_land', 'kat_qualitaetsstufe',
    'katalog_mapping', 'module_flags', 'plattform_admins', 'profiles', 'rebsorten', 'release_notes', 'release_notes_gesehen', 'svs_parameter',
    'tenant_einstellungen', 'tenant_memberships', 'tenants', 'user_email_connections', 'wetter_stunden'];
  -- Tabellen, die auch ein Mitarbeiter ohne Profil nicht bzw. nur als Eigentümer liest – ohne Aussage für die Profile
  v_t0     timestamptz;
  v_erg    text[] := '{}';
  v_a      jsonb;
  v_b      uuid;
  v_m      uuid;
  v_bta    uuid;
  v_bw     uuid;    -- Mitarbeiter ohne Profil (Vergleich)
  v_ext    uuid;    -- Mitarbeiter mit Profil extern
  v_ver    uuid;    -- Mitarbeiter mit Profil vertrieb
  r        record;
  v_e      text;
  v_tab    text;
  v_ber    text;
  v_zb     jsonb;
  v_sql    text;
  v_ohne   text;
  v_frei   integer := 0;
  v_zu     integer := 0;
  v_aussage text[] := '{}';
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_t0 := clock_timestamp();

  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_m := (v_a ->> 'm')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_ext := pg_temp.s112_benutzer('winzer', v_b);
  v_ver := pg_temp.s112_benutzer('winzer', v_b);
  UPDATE public.tenant_memberships SET profil = 'extern' WHERE tenant_id = v_b AND user_id = v_ext;
  UPDATE public.tenant_memberships SET profil = 'vertrieb' WHERE tenant_id = v_b AND user_id = v_ver;

  PERFORM pg_temp.s112_mutiere('ohne_policy_kontakte', $m$DROP POLICY lesebereich ON public.kontakte$m$);
  PERFORM pg_temp.s112_mutiere('ohne_policy_behaelter', $m$DROP POLICY lesebereich ON public.behaelter$m$);
  PERFORM pg_temp.s112_mutiere('partner_offen', $m$DO $d$ BEGIN
    EXECUTE replace(pg_get_functiondef('public.s112_lesegesperrte_tenants(text)'::regprocedure),
      $a$WHERE f.nutzer_tenant_id IN (SELECT m.tenant_id FROM meine m WHERE m.gesperrt)$a$, $a$WHERE false$a$);
  END $d$$m$);

  -- ── 1. Katalog: genau eine Sperr-Policy mit dem richtigen Bereich; „allgemein“ ohne ────────────────────────────
  FOREACH v_e IN ARRAY c_soll LOOP
    v_tab := split_part(v_e, '=', 1);
    v_ber := split_part(v_e, '=', 2);
    v_erg := v_erg || pg_temp.s112_erwarte('policy:' || v_tab,
      (SELECT concat_ws('|', count(*), bool_and(p.permissive = 'RESTRICTIVE' AND p.cmd = 'ALL' AND p.with_check IS NOT DISTINCT FROM p.qual AND p.roles = '{authenticated}'),   -- seit KAN-459 für alle Befehle
                        bool_and(p.qual LIKE '%s112_lesegesperrte_tenants(''' || v_ber || '''::text)%' OR p.qual LIKE 'EXISTS%' OR p.qual LIKE '(EXISTS%'))
         FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = v_tab AND p.policyname = 'lesebereich'),
      '1|t|t');
  END LOOP;
  v_erg := v_erg || pg_temp.s112_erwarte('allgemein_ohne_policy',
    (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.policyname = 'lesebereich' AND p.tablename = ANY (c_allgemein)), 0);
  -- keine Tabelle mit RLS außerhalb der beiden Listen (neue Tabelle ohne Einstufung)
  v_erg := v_erg || pg_temp.s112_erwarte('jede_tabelle_eingestuft',
    (SELECT coalesce(string_agg(c.relname, ',' ORDER BY c.relname), '')
       FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND c.relrowsecurity
        AND NOT c.relname = ANY (c_allgemein)
        AND NOT EXISTS (SELECT 1 FROM unnest(c_soll) s WHERE split_part(s, '=', 1) = c.relname)), '');
  v_erg := v_erg || pg_temp.s112_erwarte('policies_gesamt',
    (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.policyname = 'lesebereich'), 126);   -- +1 KAN-458 (grundstueck_recht)

  -- ── 2. Verhalten je Tabelle: Beispielzeile in B, Sicht des Mitarbeiters ohne Profil als Maßstab ───────────────
  FOR r IN SELECT * FROM pg_temp.s112_mandantentabellen() WHERE klasse IN ('T', 'K') ORDER BY tabelle LOOP
    v_ber := (SELECT split_part(s, '=', 2) FROM unnest(c_soll) s WHERE split_part(s, '=', 1) = r.tabelle);
    CONTINUE WHEN v_ber IS NULL OR r.tabelle = 'tenant_memberships';
    BEGIN
      PERFORM pg_temp.s112_als_postgres();
      v_zb := pg_temp.s112_beispiel(r.tabelle, v_b, v_bta);
      v_sql := format('SELECT count(*) FROM public.%I WHERE %s', r.tabelle, pg_temp.s112_pk_where(r.tabelle, v_zb));
    EXCEPTION WHEN OTHERS THEN
      CONTINUE;   -- nicht anlegbare Beispielzeilen meldet Test 10 (leer:<tab>)
    END;
    PERFORM pg_temp.s112_als(v_bw);
    v_ohne := pg_temp.s112_zaehle(v_sql);
    CONTINUE WHEN v_ohne <> '1';   -- auch ohne Profil nicht lesbar (Eigentümer-Tabellen, nur Betriebsleitung) – ohne Aussage
    v_aussage := v_aussage || r.tabelle;
    PERFORM pg_temp.s112_als(v_ext);
    IF v_ber = ANY (public.s112_profil_bereiche('extern')) THEN
      v_frei := v_frei + 1;
      v_erg := v_erg || pg_temp.s112_erwarte('frei:' || r.tabelle || ':extern', pg_temp.s112_zaehle(v_sql), '1');
    ELSE
      v_zu := v_zu + 1;
      v_erg := v_erg || pg_temp.s112_erwarte('gesperrt:' || r.tabelle || ':extern', pg_temp.s112_zaehle(v_sql), '0');
    END IF;
    PERFORM pg_temp.s112_als(v_ver);
    IF v_ber = ANY (public.s112_profil_bereiche('vertrieb')) THEN
      v_frei := v_frei + 1;
      v_erg := v_erg || pg_temp.s112_erwarte('frei:' || r.tabelle || ':vertrieb', pg_temp.s112_zaehle(v_sql), '1');
    ELSE
      v_zu := v_zu + 1;
      v_erg := v_erg || pg_temp.s112_erwarte('gesperrt:' || r.tabelle || ':vertrieb', pg_temp.s112_zaehle(v_sql), '0');
    END IF;
  END LOOP;
  PERFORM pg_temp.s112_als_postgres();
  -- genug Tabellen mit Aussage – sonst wäre der Sweep wertlos
  v_erg := v_erg || pg_temp.s112_erwarte('sweep_umfang', (array_length(v_aussage, 1) >= 80) AND v_zu >= 100 AND v_frei >= 40, true);
  -- Stichproben müssen dabei sein
  v_erg := v_erg || pg_temp.s112_erwarte('sweep_stichproben',
    ARRAY['kontakte', 'weingarten', 'behandlungen', 'behaelter', 'fuellungen', 'verkaufsposten', 'ea_transaktionen', 'weinjahrgaenge'] <@ v_aussage, true);

  -- ── 3. Betriebsleitung und Mitarbeiter ohne Profil: keine Sperre ────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('betriebsleitung_frei',
    (SELECT count(*) FROM unnest(ARRAY['crm', 'keller', 'ea', 'verwaltung']) b WHERE EXISTS (SELECT 1 FROM public.s112_lesegesperrte_tenants(b))), 0);

  -- ── 4. Gemeinschaft: Partnerbetrieb M gibt B frei – für Extern ist „keller“ auch im Partnerbetrieb gesperrt ────────
  PERFORM pg_temp.s112_als_postgres();
  INSERT INTO public.keller_freigaben (eigentuemer_tenant_id, nutzer_tenant_id, aktiv) VALUES (v_m, v_b, true);
  PERFORM pg_temp.s112_als(v_ext);
  v_erg := v_erg || pg_temp.s112_erwarte('partner_gesperrt',
    concat_ws('|', v_m IN (SELECT public.s112_lesegesperrte_tenants('keller')), v_m IN (SELECT public.s112_lesegesperrte_tenants('rieden'))), 't|f');
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('partner_ohne_profil_frei', (SELECT count(*) FROM public.s112_lesegesperrte_tenants('keller')), 0);
  PERFORM pg_temp.s112_als_postgres();

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 365);
END
$test$;
