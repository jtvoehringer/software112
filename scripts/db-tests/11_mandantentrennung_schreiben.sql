-- @bereich: Mandantentrennung beim Schreiben (INSERT/UPDATE/DELETE/Umhängen, Fremdverweise, anon)
-- @ziel: Niemand legt in einem fremden Betrieb Zeilen an, ändert oder löscht dort Zeilen oder schiebt eigene Zeilen
-- @ziel: in einen fremden Betrieb (T- und K-Tabellen, als tenant_admin und winzer aus B, als anon, Leser als Quersumme).
-- @ziel: Positivkontrollen belegen, dass die Ablehnung vom Mandanten kommt. Verweise auf fremde Zeilen (Fremd-FK) laufen
-- @ziel: an RLS vorbei: sie zählen als bekannte Lücke B2 gegen eine feste Liste. Zahlung auf einen fremden Verkaufsposten
-- @ziel: und Umhängen von benachrichtigungen sind seit KAN-159 abgelehnt (vorher B1, B13).
-- @mutation kontakte_rls_aus: RLS auf kontakte abgeschaltet – Schreiben im Musterhof und Umhängen gehen durch | rot: schreiben_fremd_(insert|insert_min|update|delete):kontakte:.*|umhaengen:kontakte|anon_(insert|update|delete):kontakte
-- @mutation kontakt_firmen_rls_aus: RLS auf der Kindtabelle kontakt_firmen abgeschaltet | rot: schreiben_fremd_(insert|insert_min|update|delete):kontakt_firmen:.*|umhaengen:kontakt_firmen|anon_(insert|update|delete):kontakt_firmen
-- @mutation global_offen: permissive Policy auf duengemittel lässt globale Zeilen (tenant_id NULL) schreiben, die Modul-Policies (s112_darf_schreiben(NULL, …) = false) fehlen | rot: global_(insert|update|delete|veroeffentlichen):duengemittel:.*
-- @mutation gebinde_pruefung_aus: weinausbau_gebinde_pruefen prüft nichts mehr – fremder Behälter lässt sich verknüpfen | rot: neuer_fremdverweis:weinausbau\.behaelter_id
-- @mutation zeit_del_offen: zusätzliche DELETE-Policy USING (true) auf zeiterfassung – „DELETE FROM zeiterfassung“ ohne WHERE löscht fremde Zeilen, per PK bliebe es k0 | rot: schreiben_fremd_delete_policy:zeiterfassung:.*
-- @mutation terminal_upd_offen: zusätzliche UPDATE-Policy USING/WITH CHECK (true) auf sumup_terminals | rot: schreiben_fremd_update_policy:sumup_terminals:.*
--
-- software:112 – SQL-Testsuite, Datei 11 (Stand 28.09.2026). Nur Staging; die ganze Datei ist EINE Transaktion und
-- endet mit pg_temp.s112_ende(…) = RAISE → nichts bleibt zurück.
--
-- Aufbau: je T-/K-Tabelle eine vollständige Beispielzeile im Musterhof (M, Persona m_ta) und in Betrieb B (Persona
-- b_ta) über s112_beispiel; wo das im Musterhof an vorhandenen Schlüsseln scheitert (module_flags), eine vorhandene
-- M-Zeile. Dann:
--   1. je T/K-Tabelle als b_ta und b_w: INSERT-Klon der M-Zeile (tenant_id = M bzw. Eltern in M) und minimaler INSERT
--      → R/G/T (P = Tenant-Trigger), UPDATE/DELETE der M-Zeile → k0/G. k1 oder E23xxx hieße: RLS hat durchgelassen.
--      Weil „WHERE <pk>“ zusätzlich die SELECT-Policies anwendet (die M-Zeile ist für B-Personas unsichtbar → immer
--      k0), wird die UPDATE-/DELETE-Policy-Schicht für die M-Zeile zusätzlich direkt ausgewertet
--      (pg_temp.s112_policy, wie „UPDATE … SET x = <Literal>“ bzw. „DELETE FROM tab“ ohne WHERE):
--      schreiben_fremd_update_policy/_delete_policy → 'nein' (oder kein Tabellenrecht bzw. G).
--   2. Umhängen als b_ta: B-Zeile SET tenant_id = M bzw. Kindzeile SET <Eltern-FK, den die Policy prüft> = M-Elternzeile
--      → nie k1 (bekannte Ausnahmen in t11_umhaengen_bekannt; seit KAN-159 keine).
--   2b. Globale Zeilen (s112_soll_liste('tid_nullable')) als b_ta und b_w: INSERT-Klon mit tenant_id NULL → R/G/T/P,
--      UPDATE/DELETE einer globalen Zeile (als postgres belegt bzw. mit S112TEST angelegt) → k0/G, eigene B-Zeile
--      SET tenant_id = NULL („veröffentlichen“) → nie k1. Die Abo-Policies sind dort bewusst NULL-sicher; den Schutz
--      tragen die permissiven Policies (tenant_id IS NOT NULL) und die RESTRICTIVE modul_*-Policies
--      (s112_darf_schreiben(NULL, …) = false). Plattform-Admin: Ist-Stand festgehalten (globale Stammdaten pflegt
--      er über die Service-Role, nicht als Benutzer).
--   3. Positivkontrollen als b_ta, wo die Soll-Matrix dem TA Schreiben erlaubt: INSERT-Klon der eigenen B-Zeile →
--      nicht R/G/T, UPDATE der eigenen Zeile → k1.
--   4. Fremd-FK: jeder einspaltige FK von einer T/K-Tabelle auf eine T-Tabelle (außer tenant_id): B-Zeile als b_ta
--      auf die M-Zeile der Zieltabelle zeigen lassen (UPDATE, sonst INSERT-Klon). R/T/P = geschützt, aber nur wenn
--      derselbe Schreibweg mit einem EIGENEN Verweis (B-Zeile der Zieltabelle) durchgeht; lehnt auch die Kontrolle ab
--      (R/G/k0), ist die Tabelle für b_ta gar nicht schreibbar → fremd_fk_nicht_schreibbar. k1 = ungeschützt
--      → Abgleich mit der festen Liste pg_temp.t11_fremd_fk_bekannt() (B2, Baseline).
--   5. b_ta bucht eine Zahlung in B auf einen offenen Verkaufsposten des Musterhofs → abgelehnt, Posten bleibt offen (KAN-159, vorher B1).
--   6. anon: je Tabelle INSERT → R/G/T, UPDATE/DELETE einer vorhandenen Zeile → k0/G; nie k1, nie E23xxx; dazu
--      die UPDATE-/DELETE-Policy-Schicht direkt (anon_update_policy/_delete_policy → 'nein', kein Recht oder G).
--   3b. Positivkontrolle der Policy-Auswertung: b_ta auf der eigenen B-Zeile → 'ja', wo das Soll TA erlaubt.
--   7. Leser b_l: INSERT-Klon der eigenen B-Zeile → R/G/T in allen Fachtabellen (Quersumme; Einzelprüfung in 12).

-- Bekannte ungeschützte Fremd-FKs (B2), Stand Staging 28.09.2026 (Baseline beim ersten Lauf festgelegt). Wird eine Spalte geschützt, meldet der Test
-- „fremdverweis_behoben:<tab.spalte>“ – dann hier streichen. Eine neue ungeschützte Spalte ist ein FEHLER.
CREATE FUNCTION pg_temp.t11_fremd_fk_bekannt() RETURNS text[] LANGUAGE sql IMMUTABLE AS $f$
  SELECT ARRAY[
    'aktivitaet_dokumente.aktivitaet_id', 'aktivitaeten.firma_id', 'aktivitaeten.kontakt_id',
    'behandlung_grundstuecke.grundstueck_id', 'behandlungen.duengemittel_id',
    'behandlungen.psm_id', 'behandlungen.weingarten_id', 'bestellung_positionen.weinausbau_id', 'bestellungen.firma_id',
    'bestellungen.kontakt_id', 'checklisten_punkte.checkliste_id', 'dac_antrag.weinausbau_id',
    'duengemittel_lager_bewegungen.duengemittel_id', 'ea_belege.ea_transaktion_id', 'ea_dauerauftraege.kategorie_id',
    'ea_dauerauftraege.konto_id', 'ea_transaktionen.bmd_export_id', 'ea_transaktionen.dauerauftrag_id',
    'ea_transaktionen.firma_id', 'ea_transaktionen.kategorie_id', 'ea_transaktionen.konto_id',
    'ea_transaktionen.verkaufsposten_id', 'ernte_parzellen.grundstueck_id', 'ernte_parzellen.weingarten_id',
    'exportauftraege.firma_id', 'exportauftraege.kontakt_id', 'exportauftrag_positionen.fullung_id',
    'firmen.rabattgruppe_id', 'fuellung_chargen.fuellung_id', 'fuellung_chargen.weinausbau_id',
    'fuellungen.dac_antrag_id', 'fuellungen.weinausbau_id', 'grundstuecke.weingarten_id',
    'keller_behandlungen.behaelter_id', 'keller_behandlungen.typ_id', 'keller_behandlungen.weinausbau_id',
    'keller_umzuege.nach_behaelter_id', 'keller_umzuege.nach_weinausbau_id', 'keller_umzuege.von_behaelter_id',
    'keller_umzuege.von_weinausbau_id', 'kellerplan_positionen.behaelter_id', 'kellerplan_positionen.kellerplan_id',
    'kontakt_firmen.firma_id', 'kontakte.firma_id', 'kontakte.rabattgruppe_id', 'konto_umbuchungen.nach_konto_id',
    'konto_umbuchungen.von_konto_id', 'kosteneintraege.behaelter_id', 'kosteneintraege.behandlung_id',
    'kosteneintraege.kostenart_id', 'kosteneintraege.kostenstelle_id', 'kosteneintraege.ried_id',
    'kosteneintraege.weingarten_id', 'kosteneintrag_behaelter.behaelter_id', 'kosteneintrag_weingaerten.weingarten_id',
    'pipeline_eintraege.firma_id', 'pipeline_eintraege.kontakt_id', 'pressung_behaelter.behaelter_id',
    'pressung_behaelter.weinausbau_id', 'pressung_weingaerten.grundstueck_id', 'pressung_weingaerten.weingarten_id',
    'pressung_weingaerten.zukauf_posten_id',
    'pruefnummernantraege.dac_antrag_id', 'psm_lager_bewegungen.psm_id',
    'sumup_checkouts.verkaufsposten_id', 'transportbescheinigungen.verkaufsposten_id', 'traubenverkauf.firma_id',
    'traubenverkauf.grundstueck_id', 'traubenverkauf.kontakt_id',
    'traubenverkauf.verkaufsposten_id', 'traubenverkauf.weingarten_id', 'traubenverkauf.zukauf_posten_id',
    'verkauf_positionen.fuellung_id',
    'verkauf_positionen.traubenverkauf_id', 'verkauf_positionen.verkaufsposten_id', 'verkauf_positionen.weinausbau_id',
    'verkaufsposten.bmd_export_id', 'verkaufsposten.firma_id', 'verkaufsposten.kontakt_id', 'verkaufsposten.zh_kontakt_id',
    'verschneidung_quellen.quell_weinausbau_id', 'verschneidungen.ziel_weinausbau_id', 'weinanalysen.weinausbau_id',
    'weinausbau.weingarten_id', 'weinausbau_weingaerten.weinausbau_id', 'weinausbau_weingaerten.weingarten_id',
    'weingarten.lage_id', 'zahlungen.konto_id', 'zukauf_posten.lieferant_firma_id',
    'zukauf_posten.lieferant_kontakt_id', 'zukauf_posten.zh_kontakt_id', 'zukauf_posten.ziel_weinausbau_id'
  ]::text[]
$f$;

-- Bekannte Umhänge-Lücken (Tabelle → Lücken-ID/Titel): Zeilen, die sich per UPDATE in einen fremden Betrieb schieben
-- lassen. benachrichtigungen: UPDATE-Policy prüft nur empfaenger_id = auth.uid(), nicht die tenant_id.
CREATE FUNCTION pg_temp.t11_umhaengen_bekannt() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
  SELECT '{}'::jsonb   -- benachrichtigungen (B13) seit KAN-159 geschützt: Benutzer ändern nur noch gelesen_am
$f$;

-- Spalte für No-op-UPDATE-Proben: die updatebare Spalte aus dem Katalog, sonst die erste normale Spalte (nie
-- identity/generated – SET id = id auf einer IDENTITY-ALWAYS-Spalte endet sonst vor jeder Rechteprüfung mit 428C9).
CREATE FUNCTION pg_temp.t11_upd_spalte(p_tab text, p_upd text) RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT coalesce(p_upd,
    (SELECT a.attname::text FROM pg_attribute a
      WHERE a.attrelid = to_regclass(format('public.%I', p_tab)) AND a.attnum > 0 AND NOT a.attisdropped
        AND a.attgenerated = '' AND a.attidentity = ''
      ORDER BY (a.attname = 'id') DESC, a.attnum LIMIT 1))
$f$;

-- Eltern-FK einer Kindtabelle, den ihre Policies tatsächlich prüfen (Spaltenname kommt in USING/WITH CHECK einer
-- PERMISSIVE-Policy vor), sonst wie im Katalog (CASCADE, NOT NULL). Bei kontakt_firmen z. B. kontakt_id statt
-- firma_id, bei kosteneintrag_behaelter kosteneintrag_id statt behaelter_id.
CREATE FUNCTION pg_temp.t11_policy_eltern(p_tab text) RETURNS jsonb LANGUAGE sql STABLE AS $f$
  SELECT jsonb_build_object('eltern_spalte', a.attname::text, 'eltern_tabelle', p.relname::text, 'eltern_ref', pa.attname::text)
    FROM pg_constraint k
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
    JOIN pg_class p ON p.oid = k.confrelid AND p.relnamespace = 'public'::regnamespace
    JOIN pg_attribute pa ON pa.attrelid = k.confrelid AND pa.attnum = k.confkey[1]
   WHERE k.conrelid = to_regclass(format('public.%I', p_tab)) AND k.contype = 'f' AND array_length(k.conkey, 1) = 1
     AND pg_temp.s112_klasse(p.relname::text) = 'T'
   ORDER BY EXISTS (SELECT 1 FROM pg_policies po
                     WHERE po.schemaname = 'public' AND po.tablename = p_tab AND po.permissive = 'PERMISSIVE'
                       AND coalesce(po.qual, '') || ' ' || coalesce(po.with_check, '') ~ ('\m' || a.attname || '\M')) DESC,
            (k.confdeltype = 'c') DESC, a.attnotnull DESC, k.conname
   LIMIT 1
$f$;

-- UPDATE, das die FK-Spalte p_spalte auf p_wert setzt; mit p_geschwister = true zusätzlich alle nullbaren Spalten,
-- die mit p_spalte in einem CHECK stehen, auf NULL (z. B. „weingarten_id ODER zukauf_posten_id“ → E23514).
CREATE FUNCTION pg_temp.t11_fk_update_sql(p_tab text, p_spalte text, p_wert text, p_where text, p_geschwister boolean)
RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT format('UPDATE public.%I SET %I = %L%s WHERE %s', p_tab, p_spalte, p_wert,
                CASE WHEN p_geschwister THEN coalesce((
                  SELECT ', ' || string_agg(DISTINCT format('%I = NULL', a2.attname), ', ')
                    FROM pg_constraint c
                    JOIN pg_attribute a1 ON a1.attrelid = c.conrelid AND a1.attname = p_spalte
                    JOIN pg_attribute a2 ON a2.attrelid = c.conrelid AND a2.attnum = ANY (c.conkey)
                   WHERE c.conrelid = to_regclass(format('public.%I', p_tab)) AND c.contype = 'c'
                     AND a1.attnum = ANY (c.conkey) AND a2.attnum <> a1.attnum AND NOT a2.attnotnull), '')
                ELSE '' END,
                p_where)
$f$;

-- Wie s112_versuch (führt aus und rollt sofort zurück), zusätzlich: P0001 mit „Betrieb“ in der Meldung = 'P'
-- (Tenant-Trigger wie weinausbau_gebinde_pruefen, trg_ea_*_tenant).
CREATE FUNCTION pg_temp.t11_versuch(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v_n bigint;
  v_state text;
  v_msg text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'S1T11', MESSAGE = v_n::text;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    IF v_state = 'S1T11' THEN
      RETURN 'k' || v_msg;
    END IF;
    IF v_state = 'P0001' AND v_msg ~* 'betrieb' THEN
      RETURN 'P';
    END IF;
    RETURN pg_temp.s112_fehlercode(v_state, v_msg);
  END;
END $f$;

-- OK, wenn p_ist in p_soll liegt, sonst FEHLER mit Beleg.
CREATE FUNCTION pg_temp.t11_pruefe(p_name text, p_ist text, p_soll text[]) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN p_ist = ANY (p_soll) THEN pg_temp.s112_ok(p_name)
              ELSE pg_temp.s112_fehler(p_name, 'ist=' || coalesce(p_ist, 'NULL') || ' soll=' || array_to_string(p_soll, '|')) END
$f$;

-- Beispielzeile für Tabelle p_tab im Betrieb p_tenant: zuerst neu (s112_beispiel), sonst eine vorhandene Zeile
-- des Betriebs (T: tenant_id, K: über den Eltern-FK). NULL, wenn beides nicht geht.
CREATE FUNCTION pg_temp.t11_zeile(p_tab text, p_klasse text, p_tenant uuid, p_persona uuid, p_eltern_spalte text,
                                  p_eltern_tabelle text, p_eltern_ref text, p_werte jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v jsonb;
BEGIN
  BEGIN
    v := pg_temp.s112_beispiel(p_tab, p_tenant, p_persona, p_werte);
  EXCEPTION WHEN OTHERS THEN
    v := NULL;
  END;
  IF v IS NULL AND p_klasse = 'T' THEN
    EXECUTE format('SELECT to_jsonb(x.*) FROM public.%I x WHERE x.tenant_id = %L LIMIT 1', p_tab, p_tenant) INTO v;
  ELSIF v IS NULL AND p_klasse = 'K' THEN
    EXECUTE format('SELECT to_jsonb(x.*) FROM public.%I x JOIN public.%I e ON e.%I = x.%I WHERE e.tenant_id = %L LIMIT 1',
                   p_tab, p_eltern_tabelle, p_eltern_ref, p_eltern_spalte, p_tenant) INTO v;
  END IF;
  RETURN v;
END $f$;

-- UPDATE-/DELETE-Policy-Schicht für eine Zeile als gerade aktive Rolle, ohne SELECT-Maskierung (pg_temp.s112_policy).
-- Ohne Tabellen- bzw. Spaltenrecht für die Aktion kann die Rolle gar nicht schreiben → 'kein_recht'.
CREATE FUNCTION pg_temp.t11_policy(p_tab text, p_cmd text, p_zeile jsonb) RETURNS text LANGUAGE plpgsql AS $f$
BEGIN
  IF p_cmd = 'UPDATE' AND NOT has_any_column_privilege(format('public.%I', p_tab), 'UPDATE') THEN
    RETURN 'kein_recht';
  ELSIF p_cmd = 'DELETE' AND NOT has_table_privilege(format('public.%I', p_tab), 'DELETE') THEN
    RETURN 'kein_recht';
  END IF;
  RETURN pg_temp.s112_policy(p_tab, p_cmd, p_zeile);
END $f$;

DO $test$
DECLARE
  c_datei   constant text := '11_mandantentrennung_schreiben';
  c_pol_nein constant text[] := ARRAY['nein', 'kein_recht', 'G'];
  c_rgt     constant text[] := ARRAY['R', 'G', 'T', 'P'];
  c_k0g     constant text[] := ARRAY['k0', 'G'];
  v_t0      timestamptz := clock_timestamp();
  v_erg     text[] := '{}';
  v_a       jsonb;
  v_m       uuid;
  v_b       uuid;
  v_mz      jsonb := '{}';
  v_bz      jsonb := '{}';
  v_gz      jsonb := '{}';
  v_soll    jsonb;
  v_tabs    jsonb;
  r         record;
  v_p       text;
  v_uid     uuid;
  v_z       jsonb;
  v_zb      jsonb;
  v_zm      jsonb;
  v_sql     text;
  v_code    text;
  v_code2   text;
  v_name    text;
  v_n       int;
  v_txt     text;
  v_fehlt   text[] := '{}';
  v_liste   text[] := '{}';
  v_unges   text[] := '{}';
  v_upd     text;
  v_wert    text;
  v_vp      uuid;
  v_bez_vor boolean;
  v_bez_nach boolean;
  v_b1      text;
  v_leser_n int := 0;
  v_kontrolle text;
  v_eigen   text;
  v_glob    jsonb;
BEGIN
  PERFORM pg_temp.s112_nur_staging();

  -- ── Aufbau (als postgres) ────────────────────────────────────────────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_m := (v_a ->> 'm')::uuid;
  v_b := (v_a ->> 'b')::uuid;

  SELECT jsonb_object_agg(s.tabelle || '.' || s.aktion, to_jsonb(s.rollen)) INTO v_soll FROM pg_temp.s112_soll() s;
  -- Katalog; bei Kindtabellen der Eltern-FK, den die Policies prüfen; upd_spalte nie identity/generated
  SELECT jsonb_agg(to_jsonb(t.*)
                   || CASE WHEN t.klasse = 'K' THEN coalesce(pg_temp.t11_policy_eltern(t.tabelle), '{}'::jsonb) ELSE '{}'::jsonb END
                   || jsonb_build_object('upd_spalte', pg_temp.t11_upd_spalte(t.tabelle, t.upd_spalte))
                   ORDER BY t.tabelle)
    INTO v_tabs FROM pg_temp.s112_mandantentabellen() t;

  -- Beispielzeilen je T/K-Tabelle in M (Persona m_ta) und B (Persona b_ta), T-Tabellen zuerst; Kindzeilen hängen am
  -- Beispiel-Elternteil desselben Betriebs (z. B. assistent_aktionen an der Unterhaltung der Persona). weinausbau in B
  -- mit Menge und aktiv, damit weinausbau_gebinde_pruefen bei einem fremden Behälter überhaupt prüft.
  FOR r IN SELECT * FROM jsonb_to_recordset(v_tabs) AS x (tabelle text, klasse text, tid_nullable boolean, eltern_spalte text,
                                                            eltern_tabelle text, eltern_ref text, upd_spalte text, pk text[])
            WHERE x.klasse IN ('T', 'K') ORDER BY x.klasse DESC, x.tabelle LOOP
    v_z := pg_temp.t11_zeile(r.tabelle, r.klasse, v_m, (v_a ->> 'm_ta')::uuid, r.eltern_spalte, r.eltern_tabelle, r.eltern_ref,
                             CASE WHEN r.klasse = 'K' AND (v_mz -> r.eltern_tabelle ->> r.eltern_ref) IS NOT NULL
                                  THEN jsonb_build_object(r.eltern_spalte, v_mz -> r.eltern_tabelle ->> r.eltern_ref) ELSE '{}'::jsonb END);
    IF v_z IS NULL THEN
      v_erg := v_erg || pg_temp.s112_fehler('aufbau_m:' || r.tabelle, 'keine Beispielzeile im Musterhof');
    ELSE
      v_mz := v_mz || jsonb_build_object(r.tabelle, v_z);
    END IF;
    v_z := pg_temp.t11_zeile(r.tabelle, r.klasse, v_b, (v_a ->> 'b_ta')::uuid, r.eltern_spalte, r.eltern_tabelle, r.eltern_ref,
                             CASE WHEN r.tabelle = 'weinausbau' THEN '{"menge_liter": "100", "aktiv": "true"}'::jsonb
                                  WHEN r.klasse = 'K' AND (v_bz -> r.eltern_tabelle ->> r.eltern_ref) IS NOT NULL
                                  THEN jsonb_build_object(r.eltern_spalte, v_bz -> r.eltern_tabelle ->> r.eltern_ref)
                                  ELSE '{}'::jsonb END);
    IF v_z IS NULL THEN
      v_erg := v_erg || pg_temp.s112_fehler('aufbau_b:' || r.tabelle, 'keine Beispielzeile in Betrieb B');
    ELSE
      v_bz := v_bz || jsonb_build_object(r.tabelle, v_z);
    END IF;
  END LOOP;
  -- G-Tabellen: irgendeine vorhandene Zeile (für anon UPDATE/DELETE)
  FOR r IN SELECT x.tabelle FROM jsonb_to_recordset(v_tabs) AS x (tabelle text, klasse text, pk text[])
            WHERE x.klasse = 'G' AND x.pk IS NOT NULL LOOP
    EXECUTE format('SELECT to_jsonb(x.*) FROM public.%I x LIMIT 1', r.tabelle) INTO v_z;
    IF v_z IS NOT NULL THEN
      v_gz := v_gz || jsonb_build_object(r.tabelle, v_z);
    END IF;
  END LOOP;

  -- ── Mutationen (nach dem Aufbau, vor den Prüfungen) ──────────────────────────────────────────────────
  PERFORM pg_temp.s112_mutiere('kontakte_rls_aus', $m$ALTER TABLE public.kontakte DISABLE ROW LEVEL SECURITY$m$);
  PERFORM pg_temp.s112_mutiere('kontakt_firmen_rls_aus', $m$ALTER TABLE public.kontakt_firmen DISABLE ROW LEVEL SECURITY$m$);
  PERFORM pg_temp.s112_mutiere('global_offen',
    $m$DROP POLICY modul_insert ON public.duengemittel;
       DROP POLICY modul_update ON public.duengemittel;
       DROP POLICY modul_delete ON public.duengemittel;
       CREATE POLICY s112test_global_offen ON public.duengemittel AS PERMISSIVE FOR ALL TO authenticated
       USING (tenant_id IS NULL OR tenant_id IN (SELECT public.s112_meine_tenants()))
       WITH CHECK (tenant_id IS NULL OR tenant_id IN (SELECT public.s112_meine_tenants()))$m$);
  PERFORM pg_temp.s112_mutiere('gebinde_pruefung_aus', $m$CREATE OR REPLACE FUNCTION public.weinausbau_gebinde_pruefen()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$ BEGIN RETURN NEW; END $f$$m$);
  PERFORM pg_temp.s112_mutiere('zeit_del_offen',
    $m$CREATE POLICY s112test_zeit_del ON public.zeiterfassung AS PERMISSIVE FOR DELETE TO authenticated USING (true)$m$);
  PERFORM pg_temp.s112_mutiere('terminal_upd_offen',
    $m$CREATE POLICY s112test_terminal_upd ON public.sumup_terminals AS PERMISSIVE FOR UPDATE TO authenticated
       USING (true) WITH CHECK (true)$m$);

  -- ── 0. Beleg: die Beispielzeilen existieren (sonst wäre „0 Zeilen“ unten wertlos) ─────────────────────
  PERFORM pg_temp.s112_als_postgres();
  v_fehlt := '{}';
  v_n := 0;
  FOR v_txt IN SELECT jsonb_object_keys(v_mz) LOOP
    IF pg_temp.s112_zaehle(format('SELECT count(*) FROM public.%I WHERE %s', v_txt, pg_temp.s112_pk_where(v_txt, v_mz -> v_txt))) <> '1' THEN
      v_fehlt := v_fehlt || ('M.' || v_txt);
    END IF;
    v_n := v_n + 1;
  END LOOP;
  FOR v_txt IN SELECT jsonb_object_keys(v_bz) LOOP
    IF pg_temp.s112_zaehle(format('SELECT count(*) FROM public.%I WHERE %s', v_txt, pg_temp.s112_pk_where(v_txt, v_bz -> v_txt))) <> '1' THEN
      v_fehlt := v_fehlt || ('B.' || v_txt);
    END IF;
  END LOOP;
  v_erg := v_erg || pg_temp.s112_erwarte('beispielzeilen_vorhanden', array_to_string(v_fehlt, ','), '');
  v_erg := v_erg || pg_temp.s112_erwarte('beispielzeilen_m_anzahl_mind_90', v_n >= 90, true);

  -- ── 1. Fremder Betrieb: INSERT/UPDATE/DELETE als b_ta und b_w ────────────────────────────────────────
  FOREACH v_p IN ARRAY ARRAY['b_ta', 'b_w'] LOOP
    v_uid := (v_a ->> v_p)::uuid;
    FOR r IN SELECT * FROM jsonb_to_recordset(v_tabs) AS x (tabelle text, klasse text, eltern_spalte text, eltern_tabelle text,
                                                              eltern_ref text, upd_spalte text, pk text[])
              WHERE x.klasse IN ('T', 'K') AND v_mz ? x.tabelle LOOP
      v_zm := v_mz -> r.tabelle;
      v_upd := coalesce(r.upd_spalte, r.pk[1]);
      PERFORM pg_temp.s112_als(v_uid);
      -- INSERT-Klon der M-Zeile (neuer pk; T: tenant_id = M, K: Eltern bleiben in M)
      v_sql := pg_temp.s112_klon_sql(r.tabelle, v_zm, CASE WHEN r.klasse = 'T' THEN jsonb_build_object('tenant_id', v_m) ELSE '{}'::jsonb END);
      v_erg := v_erg || pg_temp.t11_pruefe('schreiben_fremd_insert:' || r.tabelle || ':' || v_p, pg_temp.t11_versuch(v_sql), c_rgt);
      -- minimaler INSERT (nur tenant_id bzw. Eltern-FK)
      v_sql := CASE WHEN r.klasse = 'T' THEN format('INSERT INTO public.%I (tenant_id) VALUES (%L)', r.tabelle, v_m)
                    ELSE format('INSERT INTO public.%I (%I) VALUES (%L)', r.tabelle, r.eltern_spalte, v_zm ->> r.eltern_spalte) END;
      v_erg := v_erg || pg_temp.t11_pruefe('schreiben_fremd_insert_min:' || r.tabelle || ':' || v_p, pg_temp.t11_versuch(v_sql), c_rgt);
      -- UPDATE (No-op) und DELETE der M-Zeile
      v_sql := format('UPDATE public.%I SET %I = %I WHERE %s', r.tabelle, v_upd, v_upd, pg_temp.s112_pk_where(r.tabelle, v_zm));
      v_erg := v_erg || pg_temp.t11_pruefe('schreiben_fremd_update:' || r.tabelle || ':' || v_p, pg_temp.t11_versuch(v_sql), c_k0g);
      v_sql := format('DELETE FROM public.%I WHERE %s', r.tabelle, pg_temp.s112_pk_where(r.tabelle, v_zm));
      v_erg := v_erg || pg_temp.t11_pruefe('schreiben_fremd_delete:' || r.tabelle || ':' || v_p, pg_temp.t11_versuch(v_sql), c_k0g);
      -- dieselbe M-Zeile ohne SELECT-Maskierung: UPDATE-/DELETE-Policy-Schicht direkt
      v_erg := v_erg || pg_temp.t11_pruefe('schreiben_fremd_update_policy:' || r.tabelle || ':' || v_p,
                                           pg_temp.t11_policy(r.tabelle, 'UPDATE', v_zm), c_pol_nein);
      v_erg := v_erg || pg_temp.t11_pruefe('schreiben_fremd_delete_policy:' || r.tabelle || ':' || v_p,
                                           pg_temp.t11_policy(r.tabelle, 'DELETE', v_zm), c_pol_nein);
    END LOOP;
  END LOOP;
  PERFORM pg_temp.s112_als_postgres();

  -- ── 2. Umhängen und 3. Positivkontrollen als b_ta ────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als((v_a ->> 'b_ta')::uuid);
  FOR r IN SELECT * FROM jsonb_to_recordset(v_tabs) AS x (tabelle text, klasse text, eltern_spalte text, eltern_tabelle text,
                                                            eltern_ref text, upd_spalte text, pk text[])
            WHERE x.klasse IN ('T', 'K') AND v_bz ? x.tabelle LOOP
    v_zb := v_bz -> r.tabelle;
    v_upd := coalesce(r.upd_spalte, r.pk[1]);
    -- Umhängen: eigene Zeile in den Musterhof schieben
    IF r.klasse = 'T' THEN
      v_sql := format('UPDATE public.%I SET tenant_id = %L WHERE %s', r.tabelle, v_m, pg_temp.s112_pk_where(r.tabelle, v_zb));
    ELSIF v_mz ? r.eltern_tabelle THEN
      v_sql := format('UPDATE public.%I SET %I = %L WHERE %s', r.tabelle, r.eltern_spalte, v_mz -> r.eltern_tabelle ->> r.eltern_ref,
                      pg_temp.s112_pk_where(r.tabelle, v_zb));
    ELSE
      v_sql := NULL;
      v_erg := v_erg || pg_temp.s112_fehler('umhaengen:' || r.tabelle, 'keine M-Elternzeile ' || r.eltern_tabelle);
    END IF;
    IF v_sql IS NOT NULL AND pg_temp.t11_umhaengen_bekannt() ? r.tabelle THEN
      -- bekannte Lücke als Ratsche: geschützt → FEHLER „BEHOBEN“, k1 → BEKANNT, sonst FEHLER
      v_code := pg_temp.t11_versuch(v_sql);
      v_erg := v_erg || pg_temp.s112_luecke('umhaengen:' || r.tabelle,
                                            CASE WHEN v_code IN ('R', 'G', 'T', 'P', 'k0') THEN 'geschuetzt' ELSE v_code END,
                                            'geschuetzt', 'k1', pg_temp.t11_umhaengen_bekannt() ->> r.tabelle);
    ELSIF v_sql IS NOT NULL THEN
      v_erg := v_erg || pg_temp.t11_pruefe('umhaengen:' || r.tabelle, pg_temp.t11_versuch(v_sql), ARRAY['R', 'G', 'T', 'P', 'k0']);
    END IF;
    -- Positivkontrolle INSERT: Klon der eigenen B-Zeile geht an RLS vorbei (k1 oder ein späterer Constraint)
    IF coalesce(v_soll -> (r.tabelle || '.INSERT'), '[]') ? 'TA' THEN
      v_code := pg_temp.t11_versuch(pg_temp.s112_klon_sql(r.tabelle, v_zb));
      v_erg := v_erg || CASE WHEN v_code = ANY (c_rgt) THEN pg_temp.s112_fehler('positiv_insert:' || r.tabelle, 'ist=' || v_code || ' soll=nicht R/G/T/P')
                             ELSE pg_temp.s112_ok('positiv_insert:' || r.tabelle) END;
    END IF;
    -- Positivkontrolle UPDATE: eigene Zeile → k1
    IF coalesce(v_soll -> (r.tabelle || '.UPDATE'), '[]') ? 'TA' THEN
      v_sql := format('UPDATE public.%I SET %I = %I WHERE %s', r.tabelle, v_upd, v_upd, pg_temp.s112_pk_where(r.tabelle, v_zb));
      v_erg := v_erg || pg_temp.s112_erwarte('positiv_update:' || r.tabelle, pg_temp.t11_versuch(v_sql), 'k1');
      -- 3b. die Policy-Auswertung selbst liefert für die eigene Zeile 'ja' (sonst wären die 'nein' oben wertlos)
      v_erg := v_erg || pg_temp.s112_erwarte('positiv_update_policy:' || r.tabelle, pg_temp.t11_policy(r.tabelle, 'UPDATE', v_zb), 'ja');
    END IF;
    IF coalesce(v_soll -> (r.tabelle || '.DELETE'), '[]') ? 'TA' THEN
      v_erg := v_erg || pg_temp.s112_erwarte('positiv_delete_policy:' || r.tabelle, pg_temp.t11_policy(r.tabelle, 'DELETE', v_zb), 'ja');
    END IF;
  END LOOP;
  PERFORM pg_temp.s112_als_postgres();

  -- ── 2b. Globale Zeilen (tenant_id NULL) ─────────────────────────────────────────────────────────────────
  v_n := 0;
  FOREACH v_txt IN ARRAY pg_temp.s112_soll_liste('tid_nullable') LOOP
    IF NOT (v_bz ? v_txt) THEN
      v_erg := v_erg || pg_temp.s112_fehler('global_ohne_b_zeile:' || v_txt, 'keine Beispielzeile in B');
      CONTINUE;
    END IF;
    -- globale Zeile als postgres: vorhandene nehmen, sonst Klon der B-Zeile mit tenant_id NULL anlegen
    EXECUTE format('SELECT to_jsonb(x.*) FROM public.%I x WHERE x.tenant_id IS NULL LIMIT 1', v_txt) INTO v_glob;
    IF v_glob IS NULL THEN
      BEGIN
        v_glob := pg_temp.s112_klon(v_txt, v_bz -> v_txt, jsonb_build_object('tenant_id', NULL));
      EXCEPTION WHEN OTHERS THEN
        v_erg := v_erg || pg_temp.s112_fehler('global_aufbau:' || v_txt, SQLSTATE || ' ' || SQLERRM);
        CONTINUE;
      END;
    END IF;
    v_erg := v_erg || pg_temp.s112_erwarte('global_zeile_existiert:' || v_txt,
      pg_temp.s112_zaehle(format('SELECT count(*) FROM public.%I WHERE tenant_id IS NULL AND %s', v_txt, pg_temp.s112_pk_where(v_txt, v_glob))), '1');
    v_n := v_n + 1;
    SELECT pg_temp.t11_upd_spalte(v_txt, x.upd_spalte) INTO v_upd
      FROM jsonb_to_recordset(v_tabs) AS x (tabelle text, upd_spalte text) WHERE x.tabelle = v_txt;
    FOREACH v_p IN ARRAY ARRAY['b_ta', 'b_w'] LOOP
      PERFORM pg_temp.s112_als((v_a ->> v_p)::uuid);
      v_erg := v_erg || pg_temp.t11_pruefe('global_insert:' || v_txt || ':' || v_p,
        pg_temp.t11_versuch(pg_temp.s112_klon_sql(v_txt, v_bz -> v_txt, jsonb_build_object('tenant_id', NULL))), c_rgt);
      v_erg := v_erg || pg_temp.t11_pruefe('global_update:' || v_txt || ':' || v_p,
        pg_temp.t11_versuch(format('UPDATE public.%I SET %I = %I WHERE %s', v_txt, v_upd, v_upd, pg_temp.s112_pk_where(v_txt, v_glob))), c_k0g);
      v_erg := v_erg || pg_temp.t11_pruefe('global_delete:' || v_txt || ':' || v_p,
        pg_temp.t11_versuch(format('DELETE FROM public.%I WHERE %s', v_txt, pg_temp.s112_pk_where(v_txt, v_glob))), c_k0g);
      v_erg := v_erg || pg_temp.t11_pruefe('global_veroeffentlichen:' || v_txt || ':' || v_p,
        pg_temp.t11_versuch(format('UPDATE public.%I SET tenant_id = NULL WHERE %s', v_txt, pg_temp.s112_pk_where(v_txt, v_bz -> v_txt))),
        ARRAY['R', 'G', 'T', 'P', 'k0']);
    END LOOP;
    -- Plattform-Admin als Benutzer: Ist-Stand festhalten (globale Stammdaten laufen über die Service-Role)
    PERFORM pg_temp.s112_als((v_a ->> 'pa')::uuid);
    v_erg := v_erg || pg_temp.t11_pruefe('global_update_pa:' || v_txt,
      pg_temp.t11_versuch(format('UPDATE public.%I SET %I = %I WHERE %s', v_txt, v_upd, v_upd, pg_temp.s112_pk_where(v_txt, v_glob))), c_k0g);
    PERFORM pg_temp.s112_als_postgres();
  END LOOP;
  v_erg := v_erg || pg_temp.s112_erwarte('global_tabellen_geprueft', v_n, cardinality(pg_temp.s112_soll_liste('tid_nullable')));

  -- ── 4. Fremd-FK: eigene Zeile verweist auf eine Zeile des Musterhofs (B2) ─────────────────────────────
  v_unges := '{}';
  v_n := 0;
  FOR r IN SELECT a.relname::text AS tab, att.attname::text AS spalte, p.relname::text AS ziel, patt.attname::text AS refcol
             FROM pg_constraint k
             JOIN pg_class a ON a.oid = k.conrelid AND a.relnamespace = 'public'::regnamespace
             JOIN pg_class p ON p.oid = k.confrelid AND p.relnamespace = 'public'::regnamespace
             JOIN pg_attribute att ON att.attrelid = k.conrelid AND att.attnum = k.conkey[1]
             JOIN pg_attribute patt ON patt.attrelid = k.confrelid AND patt.attnum = k.confkey[1]
            WHERE k.contype = 'f' AND array_length(k.conkey, 1) = 1 AND att.attname <> 'tenant_id'
              AND pg_temp.s112_klasse(a.relname::text) IN ('T', 'K') AND pg_temp.s112_klasse(p.relname::text) = 'T'
            ORDER BY 1, 2 LOOP
    v_name := r.tab || '.' || r.spalte;
    IF NOT (v_bz ? r.tab) OR NOT (v_mz ? r.ziel) OR (v_mz -> r.ziel ->> r.refcol) IS NULL THEN
      v_erg := v_erg || pg_temp.s112_fehler('fremd_fk_ohne_zeilen:' || v_name, 'B-Zeile oder M-Zielzeile fehlt');
      CONTINUE;
    END IF;
    v_n := v_n + 1;
    v_wert := v_mz -> r.ziel ->> r.refcol;
    PERFORM pg_temp.s112_als((v_a ->> 'b_ta')::uuid);
    v_code := pg_temp.t11_versuch(pg_temp.t11_fk_update_sql(r.tab, r.spalte, v_wert, pg_temp.s112_pk_where(r.tab, v_bz -> r.tab), false));
    IF v_code = 'E23514' THEN
      -- CHECK „entweder – oder“: die Geschwisterspalten auf NULL setzen
      v_code := pg_temp.t11_versuch(pg_temp.t11_fk_update_sql(r.tab, r.spalte, v_wert, pg_temp.s112_pk_where(r.tab, v_bz -> r.tab), true));
    END IF;
    v_code2 := NULL;
    IF v_code IN ('k0', 'G') THEN
      -- Zeile/Spalte für b_ta nicht änderbar: stattdessen eine neue Zeile mit dem fremden Verweis
      v_code2 := pg_temp.t11_versuch(pg_temp.s112_klon_sql(r.tab, v_bz -> r.tab, jsonb_build_object(r.spalte, v_wert)));
    END IF;
    v_txt := coalesce(v_code2, v_code);
    -- Kontrolle: derselbe Schreibweg mit EIGENEM Verweis (B-Zeile der Zieltabelle). Lehnt auch sie ab, kommt die
    -- Ablehnung nicht aus einer Mandantenprüfung, sondern daher, dass b_ta die Tabelle gar nicht beschreiben darf.
    v_kontrolle := NULL;
    v_eigen := v_bz -> r.ziel ->> r.refcol;
    IF v_txt IN ('R', 'T', 'P') AND v_eigen IS NOT NULL THEN
      IF v_code2 IS NOT NULL THEN
        v_kontrolle := pg_temp.t11_versuch(pg_temp.s112_klon_sql(r.tab, v_bz -> r.tab, jsonb_build_object(r.spalte, v_eigen)));
      ELSE
        v_kontrolle := pg_temp.t11_versuch(pg_temp.t11_fk_update_sql(r.tab, r.spalte, v_eigen, pg_temp.s112_pk_where(r.tab, v_bz -> r.tab), false));
        IF v_kontrolle = 'E23514' THEN
          v_kontrolle := pg_temp.t11_versuch(pg_temp.t11_fk_update_sql(r.tab, r.spalte, v_eigen, pg_temp.s112_pk_where(r.tab, v_bz -> r.tab), true));
        END IF;
      END IF;
    END IF;
    PERFORM pg_temp.s112_als_postgres();
    IF v_txt IN ('R', 'T', 'P') AND v_kontrolle IN ('R', 'G', 'k0') THEN
      v_erg := v_erg || pg_temp.s112_ok('fremd_fk_nicht_schreibbar:' || v_name);
    ELSIF v_txt IN ('R', 'T', 'P') THEN
      v_erg := v_erg || pg_temp.s112_ok('fremd_fk:' || v_name);
    ELSIF v_code2 IS NOT NULL AND v_code2 IN ('G', 'k0') THEN
      v_erg := v_erg || pg_temp.s112_ok('fremd_fk_nicht_schreibbar:' || v_name);
    ELSIF v_txt IN ('k1', 'E23505') THEN
      -- E23505 (Eindeutigkeit) kommt erst nach RLS-WITH-CHECK und BEFORE-Triggern: der fremde Verweis wäre durchgegangen
      v_unges := v_unges || v_name;
    ELSIF v_code = 'E23514' AND EXISTS (
            -- Spalte per CHECK dauerhaft NULL (z. B. verkauf_positionen_nur_charge_check): kein Verweis möglich
            SELECT 1 FROM pg_constraint c
             WHERE c.conrelid = to_regclass(format('public.%I', r.tab)) AND c.contype = 'c'
               AND pg_get_constraintdef(c.oid) ~ ('\m' || r.spalte || ' IS NULL')
               AND pg_get_constraintdef(c.oid) !~* '\mOR\M') THEN
      v_erg := v_erg || pg_temp.s112_ok('fremd_fk_immer_null:' || v_name);
    ELSIF v_txt = 'E23503' AND EXISTS (
            -- mehrspaltiger FK mit der Spalte (KAN-129: lese_id + jahrgang_id + tenant_id → lesen): der fremde
            -- Verweis passt nicht zur übrigen Zeile, die Datenbank lehnt ab
            SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attname = r.spalte
             WHERE c.conrelid = to_regclass(format('public.%I', r.tab)) AND c.contype = 'f'
               AND cardinality(c.conkey) > 1 AND a.attnum = ANY (c.conkey)) THEN
      v_erg := v_erg || pg_temp.s112_ok('fremd_fk_verbund:' || v_name);
    ELSE
      v_erg := v_erg || pg_temp.s112_fehler('fremd_fk_unklar:' || v_name, 'update=' || v_code || coalesce(' insert=' || v_code2, ''));
    END IF;
  END LOOP;
  v_erg := v_erg || pg_temp.s112_erwarte('fremd_fk_geprueft_mind_90', v_n >= 90, true);
  FOREACH v_txt IN ARRAY v_unges LOOP
    IF NOT (v_txt = ANY (pg_temp.t11_fremd_fk_bekannt())) THEN
      v_erg := v_erg || pg_temp.s112_fehler('neuer_fremdverweis:' || v_txt, 'ungeschützt, nicht in t11_fremd_fk_bekannt()');
    END IF;
  END LOOP;
  FOREACH v_txt IN ARRAY pg_temp.t11_fremd_fk_bekannt() LOOP
    IF NOT (v_txt = ANY (v_unges)) THEN
      v_erg := v_erg || pg_temp.s112_fehler('fremdverweis_behoben:' || v_txt, 'BEHOBEN – aus t11_fremd_fk_bekannt() streichen');
    END IF;
  END LOOP;
  v_erg := v_erg || pg_temp.s112_baseline('fremd_fk_ungeschuetzt', coalesce(array_length(v_unges, 1), 0),
                                          coalesce(array_length(pg_temp.t11_fremd_fk_bekannt(), 1), 0),
                                          'B2 Fremd-FK: ' || coalesce(array_length(v_unges, 1), 0) || ' Spalten ohne Mandantenprüfung',
                                          array_to_string(v_unges, ','));

  -- ── 5. Zahlung in B auf einen offenen Verkaufsposten des Musterhofs (KAN-159, vorher B1) ──────────────────────────────
  SELECT v.id, v.bezahlt INTO v_vp, v_bez_vor
    FROM public.verkaufsposten v
   WHERE v.tenant_id = v_m AND NOT v.bezahlt AND NOT coalesce(v.storniert, false)
     AND v.id::text IS DISTINCT FROM (v_mz -> 'zahlungen' ->> 'verkaufsposten_id')
     AND EXISTS (SELECT 1 FROM public.verkauf_positionen p WHERE p.verkaufsposten_id = v.id AND p.menge * coalesce(p.preis_brutto, 0) > 0)
   ORDER BY v.id LIMIT 1;
  v_erg := v_erg || pg_temp.s112_erwarte('b1_offener_m_verkaufsposten_vorhanden', v_vp IS NOT NULL AND v_bez_vor = false, true);
  v_code := NULL;
  v_bez_nach := NULL;
  BEGIN
    PERFORM pg_temp.s112_als((v_a ->> 'b_ta')::uuid);
    BEGIN
      -- vollständige Zahlung in B (Klon der B-Beispielzeile), nur Verkaufsposten und Betrag geändert
      EXECUTE pg_temp.s112_klon_sql('zahlungen', v_bz -> 'zahlungen',
                                    jsonb_build_object('tenant_id', v_b, 'verkaufsposten_id', v_vp, 'betrag', 999999));
      v_code := 'k1';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_txt = RETURNED_SQLSTATE, v_sql = MESSAGE_TEXT;
      v_code := CASE WHEN v_txt = 'P0001' THEN 'EP0001' ELSE pg_temp.s112_fehlercode(v_txt, v_sql) END;
    END;
    PERFORM pg_temp.s112_als_postgres();
    SELECT v.bezahlt INTO v_bez_nach FROM public.verkaufsposten v WHERE v.id = v_vp;
    RAISE EXCEPTION USING ERRCODE = 'S1T12', MESSAGE = 'Querwirkung zurücknehmen';
  EXCEPTION WHEN SQLSTATE 'S1T12' THEN
    NULL;
  END;
  PERFORM pg_temp.s112_als_postgres();
  v_b1 := CASE WHEN v_code IN ('R', 'EP0001', 'T') AND v_bez_nach = false THEN 'geschuetzt'
               WHEN v_code = 'k1' AND v_bez_nach = true THEN 'k1_fremd_bezahlt'
               ELSE coalesce(v_code, 'NULL') || '_bezahlt=' || coalesce(v_bez_nach::text, 'NULL') END;
  v_erg := v_erg || pg_temp.s112_erwarte('b1_zahlung_fremder_verkaufsposten', v_b1, 'geschuetzt');
  SELECT v.bezahlt INTO v_bez_nach FROM public.verkaufsposten v WHERE v.id = v_vp;
  v_erg := v_erg || pg_temp.s112_erwarte('b1_zurueckgenommen', v_bez_nach, false);

  -- ── 6. anon ──────────────────────────────────────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(NULL, 'anon');
  FOR r IN SELECT * FROM jsonb_to_recordset(v_tabs) AS x (tabelle text, klasse text, eltern_spalte text, upd_spalte text, pk text[]) LOOP
    v_zm := CASE WHEN r.klasse = 'G' THEN v_gz -> r.tabelle ELSE v_mz -> r.tabelle END;
    v_upd := coalesce(r.upd_spalte, r.pk[1]);
    IF v_zm IS NOT NULL AND r.klasse IN ('T', 'K') THEN
      v_sql := pg_temp.s112_klon_sql(r.tabelle, v_zm, CASE WHEN r.klasse = 'T' THEN jsonb_build_object('tenant_id', v_m) ELSE '{}'::jsonb END);
    ELSIF r.klasse = 'T' THEN
      v_sql := format('INSERT INTO public.%I (tenant_id) VALUES (%L)', r.tabelle, v_m);
    ELSE
      v_sql := format('INSERT INTO public.%I DEFAULT VALUES', r.tabelle);
    END IF;
    v_erg := v_erg || pg_temp.t11_pruefe('anon_insert:' || r.tabelle, pg_temp.t11_versuch(v_sql), c_rgt);
    IF v_zm IS NOT NULL AND r.pk IS NOT NULL THEN
      v_sql := format('UPDATE public.%I SET %I = %I WHERE %s', r.tabelle, v_upd, v_upd, pg_temp.s112_pk_where(r.tabelle, v_zm));
      v_erg := v_erg || pg_temp.t11_pruefe('anon_update:' || r.tabelle, pg_temp.t11_versuch(v_sql), c_k0g);
      v_sql := format('DELETE FROM public.%I WHERE %s', r.tabelle, pg_temp.s112_pk_where(r.tabelle, v_zm));
      v_erg := v_erg || pg_temp.t11_pruefe('anon_delete:' || r.tabelle, pg_temp.t11_versuch(v_sql), c_k0g);
      v_erg := v_erg || pg_temp.t11_pruefe('anon_update_policy:' || r.tabelle, pg_temp.t11_policy(r.tabelle, 'UPDATE', v_zm), c_pol_nein);
      v_erg := v_erg || pg_temp.t11_pruefe('anon_delete_policy:' || r.tabelle, pg_temp.t11_policy(r.tabelle, 'DELETE', v_zm), c_pol_nein);
    END IF;
  END LOOP;
  PERFORM pg_temp.s112_als_postgres();

  -- ── 7. Leser b_l: kein INSERT in Fachtabellen, auch nicht im eigenen Betrieb (Quersumme) ──────────────
  v_liste := '{}';
  PERFORM pg_temp.s112_als((v_a ->> 'b_l')::uuid);
  FOR r IN SELECT x.tabelle FROM jsonb_to_recordset(v_tabs) AS x (tabelle text, klasse text)
            WHERE x.klasse IN ('T', 'K') AND v_bz ? x.tabelle LOOP
    IF coalesce(v_soll -> (r.tabelle || '.INSERT'), '[]') ? 'L' THEN
      CONTINUE;
    END IF;
    v_leser_n := v_leser_n + 1;
    v_code := pg_temp.t11_versuch(pg_temp.s112_klon_sql(r.tabelle, v_bz -> r.tabelle));
    IF NOT (v_code = ANY (c_rgt)) THEN
      v_liste := v_liste || (r.tabelle || '=' || v_code);
    END IF;
  END LOOP;
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('leser_insert_eigen_abgelehnt', array_to_string(v_liste, ','), '');
  v_erg := v_erg || pg_temp.s112_erwarte('leser_insert_geprueft_mind_90', v_leser_n >= 90, true);

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 800);
END
$test$;
