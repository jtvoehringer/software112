-- @bereich: Katalog-Invarianten (Konventionen aus CLAUDE.md)
-- @ziel: Datenunabhängige, schnelle Prüfung aller Katalogregeln ohne Rollenwechsel: RLS an, zwei_faktor_aal,
-- @ziel: genau die 6 TO-public-Policies, Plattform-Admin-Prüfabfrage, Baukasten der Mandantentabellen
-- @ziel: (mitgliedschaft_aktiv, abo_schreibsperre_*, modul_* gegen s112_soll), Klassifikation T/K/G, Rechte und
-- @ziel: Einstufung der Funktionen, Pre-Request, Geheimnis-Spalten, Views, Buckets, Protokoll- und Schutz-Trigger
-- @ziel: sowie die Härtungs-Baselines (TRUNCATE, tenant_id ohne FK, anon-EXECUTE). Bricht eine Migration eine
-- @ziel: Konvention, wird die Suite sofort rot – auch bei neuen Tabellen und Funktionen.
-- @mutation tabelle_ohne_rls: neue Tabelle mit tenant_id ohne RLS | rot: rls_an:.*|soll_fehlt:.*|truncate_neu_.*|tid_ohne_fk_neu:.*
-- @mutation tabelle_ohne_baukasten: neue RLS-Tabelle nur mit einer TO-public-Lese-Policy | rot: zfa_anzahl:.*|kan136_pruefabfrage|to_public:.*|ma_fehlt:.*|abo:.*
-- @mutation policy_system_admin: Policy prüft role = system_admin ohne Plattform-Admin-Bezug | rot: sa_ohne_bezug:.*
-- @mutation rpc_offen: SECURITY-DEFINER-Funktion mit p_tenant_id ohne search_path und ohne REVOKE | rot: search_path:.*|secdef_anon:.*|rpc_nicht_eingestuft:.*|ptz_nicht_eingestuft:.*|anon_execute:.*
-- @mutation geheimnis_grant: authenticated darf brevo_api_key lesen | rot: geheim:.*
-- @mutation view_ohne_invoker: View auf kontakte ohne security_invoker | rot: view_security_invoker:.*
-- @mutation protokoll_trigger_weg: z_protokoll_loeschen auf weinausbau entfernt | rot: protokoll_loeschen_tabellen
-- @mutation modul_policy_weg: modul_insert auf kontakte entfernt | rot: modul:.*
-- @mutation ma_oder_true: mitgliedschaft_aktiv auf kontakte RESTRICTIVE, aber USING/CHECK (… OR true) | rot: ma_fehlt:kontakte
-- @mutation abo_oder_true: abo_schreibsperre_upd auf kontakte mit (… OR true) | rot: abo:kontakte
-- @mutation modul_oder_true: modul_insert auf kontakte mit s112_darf_schreiben(tenant_id, 'crm') OR true | rot: modul:kontakte\.INSERT|modul_form:kontakte\.modul_insert
-- @mutation sa_alibi: system_admin-Policy auf rebsorten mit Alibi „m.tenant_id IS NOT NULL“ ohne Zeilenbezug | rot: sa_ohne_zeilenbezug:.*
-- @mutation aal_neutralisiert: pruefe_tenant_zugriff mit „IF false AND NOT s112_aal_ok()“ | rot: ptz_prueft_aal
-- @mutation ptz_kommentiert: get_next_liefernummer – Aufruf von pruefe_tenant_zugriff auskommentiert | rot: ptz_fehlt:.*
-- @mutation abo_kommentiert: get_next_liefernummer – Aufruf von s112_pruefe_abo_schreibsperre auskommentiert | rot: rpc_abo:.*
-- @mutation trigger_update_of: z_protokoll_aendern auf weinausbau nur noch AFTER UPDATE OF status (Argument status) | rot: protokoll_trigger_form:.*
-- @mutation trigger_when: z_protokoll_loeschen auf weinausbau mit WHEN (false) | rot: protokoll_trigger_form:.*
-- @mutation rpc_schreibt_ohne_abo: neue schreibende SECURITY-DEFINER-RPC mit p_tenant_id ohne s112_pruefe_abo_schreibsperre (Einstufung abo=false wäre grün) | rot: rpc_schreibt_ohne_abo:.*
-- @mutation invoker_ohne_ptz: neue INVOKER-Funktion mit p_tenant_id, EXECUTE für authenticated, ohne pruefe_tenant_zugriff | rot: ptz_invoker:.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 01 (Stand 28.09.2026).
-- Nur Staging. Die ganze Datei ist EINE Transaktion und endet mit pg_temp.s112_ende(…) = RAISE → nichts bleibt.
-- Kein Aufbau, kein Rollenwechsel: alles läuft als postgres gegen pg_catalog, pg_policies und storage.buckets.
--
-- Geprüft wird (Soll-Daten aus _helfer.sql: s112_soll, s112_soll_liste, s112_soll_rpc, s112_mandantentabellen):
--   1. RLS: jede Tabelle in public (relkind r/p) hat relrowsecurity (Staging fehlt der Event-Trigger ensure_rls
--      der Produktion – eine neue Tabelle ohne ENABLE ROW LEVEL SECURITY bliebe offen). FORCE RLS: Ist-Stand 0.
--   2. zwei_faktor_aal: genau eine je RLS-Tabelle in public und auf storage.objects, RESTRICTIVE, ALL,
--      TO authenticated, USING = WITH CHECK = (SELECT s112_aal_ok()); Prüfabfrage a) aus KAN-136 leer.
--   3. TO public: genau die 6 Soll-Policies (samt Kommando); alle übrigen Policies in public TO authenticated,
--      in storage ebenso (Ausnahme: „Alle: Logo lesen“ für anon+authenticated, Bucket mandant-logos).
--   4. Plattform-Admin: keine Policy mit 'system_admin' ohne plattform_admins, tenant_id oder foldername
--      (wörtliche Prüfabfrage) und – schärfer – ohne tenant_id als Vergleich mit der Zeile (=, IN, ANY,
--      Funktionsargument); ein bloßes „m.tenant_id IS NOT NULL“ zählt nicht.
--   5. Mandantentabellen (Klasse T): RESTRICTIVE mitgliedschaft_aktiv (außer system_ereignisse), die drei
--      abo_schreibsperre-Policies (Ausnahmen: s112_soll_liste('abo_ausnahmen'); tenants nur _upd), modul_* genau
--      wie in s112_soll (Module je Aktion). Die Ausdrücke müssen GENAU die kanonische Form haben (whitespace-
--      normalisiert, t01_sperrform/t01_modulform) – ein „… OR true“ fällt auf. NULL-sichere Form bei nullable
--      tenant_id (B5 seit KAN-159 Teil 2 hart; Verhalten in 13 belegt).
--   6. Klassifikation: jede Tabelle ohne tenant_id ist K (FK auf eine T-Tabelle, alle Policies außer
--      zwei_faktor_aal greifen per FROM/EXISTS auf eine Mandantentabelle) oder steht auf der G-Liste.
--      s112_soll deckt genau alle Tabellen ab.
--   7. Funktionen: search_path überall; keine SECURITY-DEFINER-Funktion für anon/PUBLIC; anon/PUBLIC-Menge = Soll
--      (B10 seit KAN-159 Teil 2 hart); SECURITY-DEFINER-Menge = s112_soll_rpc (Rechte A/U/S und Abo-Prüfung gleich); p_tenant_id
--      ohne pruefe_tenant_zugriff nur mit passender Einstufung (dieselbe Quelle wie 18), B4-Teil RPC behoben (get_behandlungen_fuer_grundstuecke entfernt, KAN-127, 30.09.2026).
--      Unabhängig vom Handflag abo: jede SECURITY-DEFINER-Funktion mit p_tenant_id, EXECUTE für authenticated und
--      einer Schreibanweisung im Quelltext (INSERT INTO, UPDATE … SET, DELETE FROM, ON CONFLICT) ruft
--      s112_pruefe_abo_schreibsperre auf oder steht begründet in s112_soll_liste('abo_rpc_ausnahmen').
--      pruefe_tenant_zugriff auch für INVOKER-Funktionen mit p_tenant_id und EXECUTE für authenticated/anon/PUBLIC
--      (Ausnahmen: s112_soll_liste('ptz_ausnahmen')).
--      Quelltextprüfungen laufen auf prosrc OHNE Kommentare und verlangen echte Aufrufe
--      („PERFORM public.pruefe_tenant_zugriff(p_tenant_id …“, „IF NOT public.s112_aal_ok() THEN RAISE …“).
--   8. Pre-Request an authenticator, s112_pre_request für anon und authenticated ausführbar.
--   9. Geheimnis-Spalten (KAN-135): kein Spaltenrecht für anon/authenticated, kein Tabellenrecht SELECT/INSERT/
--      UPDATE, jede andere Spalte beider Tabellen für authenticated lesbar; Namens-Heuristik über alle Spalten.
--  10. Views mit security_invoker, keine lesbaren materialisierten Sichten; genau 7 Buckets, nur mandant-logos
--      öffentlich.
--  11. Protokoll-Trigger (20/19/17 Tabellen, bestandsprotokoll_schreiben SECURITY DEFINER) samt Form: ohne WHEN,
--      truncate/loeschen ohne Spaltenliste und Argumente, aendern mit UPDATE OF = Argumentspalten und genau den
--      Spalten aus c_protokoll_aendern; a_schutz_plattformfelder mit den erlaubten Spalten als Argumente.
--  12. Härtung: kein TRUNCATE-Recht für authenticated/anon (seit KAN-159 hart), tenant_id ohne FK nur bestandsprotokoll/system_ereignisse (BK3, seit KAN-159 Teil 2 hart).
--
-- Neue Tabelle → s112_soll (Rollenmatrix) und ggf. g_tabellen/abo_ausnahmen; neue SECURITY-DEFINER-Funktion →
-- s112_soll_rpc; neues Geheimnis → s112_soll_liste('geheimnis_spalten') – jeweils in _helfer.sql.

-- Fehlerliste aus einer Abfrage mit den Spalten (schluessel, beleg): je Zeile 'FEHLER:<name>:<schluessel> <beleg>',
-- ohne Zeilen genau ein 'OK:<name>'.
CREATE FUNCTION pg_temp.t01_liste(p_name text, p_sql text) RETURNS text[] LANGUAGE plpgsql AS $f$
DECLARE
  v_erg text[] := '{}';
  v_schluessel text;
  v_beleg text;
BEGIN
  -- in text-Variablen lesen: schluessel ist je Abfrage name oder text, ein record-Feld behielte den ersten Typ
  -- im zwischengespeicherten Plan (42804 „type of parameter … does not match“)
  FOR v_schluessel, v_beleg IN EXECUTE 'SELECT q.schluessel::text, q.beleg::text FROM (' || p_sql || ') q' LOOP
    v_erg := v_erg || pg_temp.s112_fehler(p_name || ':' || coalesce(v_schluessel, 'NULL'), v_beleg);
  END LOOP;
  IF cardinality(v_erg) = 0 THEN
    v_erg := ARRAY[pg_temp.s112_ok(p_name)];
  END IF;
  RETURN v_erg;
END $f$;

-- Alle Funktionen in public mit den geprüften Merkmalen.
--   a/u/s = EXECUTE für anon/authenticated/service_role, pub = ausdrückliches EXECUTE für PUBLIC (grantee 0)
--   src = prosrc ohne Kommentare (/* … */ und -- bis Zeilenende): ein auskommentierter Prüfaufruf zählt nicht
CREATE FUNCTION pg_temp.t01_funktionen()
RETURNS TABLE (fn text, sig text, sd boolean, proconfig text[], prosrc text, a boolean, u boolean, s boolean, pub boolean,
               src text)
LANGUAGE sql STABLE AS $f$
  SELECT p.proname::text,
         p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         p.prosecdef, p.proconfig, p.prosrc,
         has_function_privilege('anon', p.oid, 'EXECUTE'),
         has_function_privilege('authenticated', p.oid, 'EXECUTE'),
         has_function_privilege('service_role', p.oid, 'EXECUTE'),
         EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                  WHERE x.grantee = 0 AND x.privilege_type = 'EXECUTE'),
         regexp_replace(regexp_replace(p.prosrc, '/\*.*?\*/', ' ', 'g'), '--[^\n]*', ' ', 'g')
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
$f$;

-- Policy-Ausdruck ohne Leerraum und ohne Schema-Präfix „public.“ (für Vergleiche mit der kanonischen Form).
CREATE FUNCTION pg_temp.t01_norm(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT replace(regexp_replace(coalesce(p, ''), '\s+', '', 'g'), 'public.', '')
$f$;

-- Kanonische Form der Sperr-Policies (mitgliedschaft_aktiv mit s112_gesperrte_tenants, abo_schreibsperre_* mit
-- s112_schreibgesperrte_tenants), genau wie die Migrationen sie anlegen – sonst false (z. B. „… OR true“):
--   T:        (NOT (tenant_id IN (SELECT fn() AS fn)))
--   NULL-sicher: ((tenant_id IS NULL) OR (NOT (tenant_id IN (SELECT fn() AS fn))))
--   tenants:  (NOT (id IN (SELECT fn() AS fn)))                         – nur auf der Tabelle tenants
--   K:        (NOT (EXISTS (SELECT 1 FROM <eltern> p WHERE ((p.id = <tabelle>.<spalte>) AND (p.tenant_id IN (SELECT fn() AS fn))))))
CREATE FUNCTION pg_temp.t01_sperrform(p_tab text, p_ausdruck text, p_fn text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$
  SELECT p_ausdruck IS NOT NULL AND (
         x.n IN (x.t, '((tenant_idISNULL)OR' || x.t || ')')
      OR (p_tab = 'tenants' AND x.n = '(NOT(id' || x.kern || '))')
      OR regexp_replace(x.n, '^\(NOT\(EXISTS\(SELECT1FROM[a-z_0-9]+pWHERE\(\(p\.id=' || p_tab || '\.[a-z_0-9]+\)',
                        '(NOT(EXISTS(SELECT1FROM<E>pWHERE((p.id=<S>)')
         = '(NOT(EXISTS(SELECT1FROM<E>pWHERE((p.id=<S>)AND(p.tenant_id' || x.kern || ')))))')
    FROM (SELECT pg_temp.t01_norm(p_ausdruck) AS n,
                 '(NOT(tenant_idIN(SELECT' || p_fn || '()AS' || p_fn || ')))' AS t,
                 'IN(SELECT' || p_fn || '()AS' || p_fn || ')' AS kern) x
$f$;

-- Kanonische Form der modul_*-Policies – sonst false (z. B. „… OR true“):
--   T: s112_darf_schreiben(tenant_id, VARIADIC ARRAY['m1'::text, …])
--   K: (EXISTS (SELECT 1 FROM <eltern> p WHERE ((p.id = <tabelle>.<spalte>) AND s112_darf_schreiben(p.tenant_id, VARIADIC ARRAY[…]))))
CREATE FUNCTION pg_temp.t01_modulform(p_tab text, p_ausdruck text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$
  SELECT p_ausdruck IS NOT NULL AND (
         x.n ~ ('^\(?s112_darf_schreiben\(tenant_id,VARIADICARRAY\[' || x.m || '\]\)\)?$')
      OR x.n ~ ('^\(EXISTS\(SELECT1FROM[a-z_0-9]+pWHERE\(\(p\.id=' || p_tab || '\.[a-z_0-9]+\)ANDs112_darf_schreiben\(p\.tenant_id,VARIADICARRAY\['
                || x.m || '\]\)\)\)\)$'))
    FROM (SELECT pg_temp.t01_norm(p_ausdruck) AS n, '''[a-z_]+''::text(,''[a-z_]+''::text)*' AS m) x
$f$;

-- Nur für Mutationen: Funktionsdefinition per Regex umschreiben und neu anlegen (Muster muss vorkommen).
CREATE FUNCTION pg_temp.t01_ersetze(p_fn regprocedure, p_muster text, p_ersatz text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  v_def text := pg_get_functiondef(p_fn);
BEGIN
  IF v_def !~ p_muster THEN
    RAISE EXCEPTION 't01_ersetze: Muster % in % nicht gefunden', p_muster, p_fn;
  END IF;
  EXECUTE regexp_replace(v_def, p_muster, p_ersatz);
END $f$;

-- Tabellen (sortiert, kommagetrennt) mit einem benannten, nicht internen Trigger in public.
CREATE FUNCTION pg_temp.t01_trigger_tabellen(p_trigger text) RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT coalesce(string_agg(c.relname::text, ',' ORDER BY c.relname::text), '')
    FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
   WHERE c.relnamespace = 'public'::regnamespace AND g.tgname = p_trigger AND NOT g.tgisinternal
$f$;

-- Sortierte, kommagetrennte Liste aus einem Array (für Mengenvergleiche mit s112_erwarte). COLLATE "C" fest,
-- sonst erbt die Sortierung die Kollation des Arguments (name = C, text = Datenbank-Kollation).
CREATE FUNCTION pg_temp.t01_sortiert(p text[]) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT coalesce(string_agg(x, ',' ORDER BY x COLLATE "C"), '') FROM unnest(p) x
$f$;

DO $test$
DECLARE
  c_datei constant text := '01_katalog_invarianten';
  -- TO-public-Policies samt Kommando (CLAUDE.md, RLS-Policies); die Namen stehen auch in s112_soll_liste('public_policies')
  c_public_cmd constant text[] := ARRAY['profiles.profiles: insert own=INSERT', 'profiles.profiles: update own=UPDATE',
    'rebsorten.rebsorten: everyone can read=SELECT', 'release_notes_gesehen.rng_own=ALL',
    'svs_parameter.svsp_select=SELECT'];
  -- storage.objects: einzige Policy nicht nur TO authenticated (öffentliche Logos, Bucket mandant-logos)
  c_storage_rollen_ausnahmen constant text[] := ARRAY['Alle: Logo lesen'];
  -- Mandantentabellen ohne mitgliedschaft_aktiv: system_ereignisse (keine permissive Policy, nur Service-Zugriff)
  c_ohne_ma constant text[] := ARRAY['system_ereignisse'];
  -- Namens-Heuristik für Geheimnisse: bewusst lesbare Spalten (BK4 seit KAN-159: newsletter_token_hash, nur Hash)
  c_heuristik_bekannt constant text[] := '{}'::text[];
  c_buckets constant text := 'aktivitaet-dokumente:false,analysen:false,dokumente:false,ea-belege:false,etiketten:false,fuellung-bilder:false,mandant-logos:true';   -- +fuellung-bilder KAN-220
  c_schutz constant text := 'tenant_einstellungen={svs_option,svs_option_seit,svs_einkuenfte_manuell,svs_kv_angehoerige}/23/schutz_plattformfelder/O;'
                            'tenants={bio_status,updated_at}/23/schutz_plattformfelder/O';
  -- z_protokoll_aendern: überwachte Spalten je Tabelle (Trigger-Argumente = UPDATE OF …, alphabetisch, Stand
  -- 28.09.2026). Kommt eine Spalte per Migration dazu, hier nachziehen – fehlt eine, feuert das Protokoll nicht mehr.
  c_protokoll_aendern constant text[] := ARRAY[
    'ama_erntemeldungen=ama_referenznr,bestaetigt_am,eingereicht_am,gesamtmenge_hl,gesamtmenge_kg,jahrgang_id,status,tenant_id,version',   -- KAN-148 C2
    'ama_meldepositionen=meldung_id,menge_hl,menge_kg',
    'behandlung_grundstuecke=behandlung_id,flaeche_ha,grundstueck_id',   -- KAN-88
    'behandlungen=anwender_name,art,art_verwendung,aufwandmenge,aufwandmenge_einheit,betriebsmittel_id,datum,datum_bis,duengemittel_id,durchgefuehrt_von,ernte_fruehesteins,konzentration,menge_einheit,menge_gesamt,psm_id,storniert_am,storno_grund,tenant_id,uhrzeit_bis,uhrzeit_von,wasseraufwand_l_ha,weingarten_id',   -- KAN-167: + betriebsmittel_id; KAN-88: + Storno, Uhrzeiten, Anwender, Art der Verwendung
    'ea_transaktionen=betrag_netto,datum,is_locked,kategorie_id,storniert_am,storno_grund,tenant_id,typ,ust_satz',   -- KAN-149 D2
    'ea_belege=dateiname,ea_transaktion_id,status,storage_pfad,tenant_id',   -- KAN-149 D3
    'ea_monatsabschluss=jahr,monat,tenant_id',   -- KAN-149 D3
    'ea_uva=gesperrt,gesperrt_am,jahr,tenant_id,ust_gesamt,vst_gesamt,zahllast,zeitraum',   -- KAN-149 D3
    'duengemittel_lager_bewegungen=datum,duengemittel_id,einheit,menge,storniert_am,storno_grund,tenant_id,typ',   -- KAN-88: + Storno
    'ernte_parzellen=ernte_datum,grundstueck_id,jahrgang_id,klosterneuburger,lese_id,menge_hl,menge_kg,mostgewicht_einheit,oechsle,storniert_am,storno_grund,weingarten_id',
    'fuellung_chargen=anteil_liter,fuellung_id,tenant_id,weinausbau_id',
    'fuellungen=aktiv,anbaugebiet,anzahl_flaschen,bestand_flaschen,dac_antrag_id,datum,erzeugnis,flaschengroesse_ml,herkunft_code,jahrgang,land_iso,menge_liter_gefuellt,pruefnummer,qualitaet,rebsorte,storniert_am,storno_grund,tenant_id,weinart,weinausbau_id,zusatzbezeichnung',   -- KAN-150 F1a: + dac_antrag_id; KAN-186: + erzeugnis, land_iso, weinart, zusatzbezeichnung
    'psm_lager_bewegungen=datum,einheit,menge,psm_id,storniert_am,storno_grund,tenant_id,typ',   -- KAN-88: + Storno
    'keller_behandlungen=behaelter_id,datum,einheit,menge,storniert_am,storno_grund,tenant_id,typ_id,volumen_liter_ist,weinausbau_id',
    'lesen=art,beginn,ende,jahrgang_id,lfd_nr,tenant_id',
    'keller_umzuege=brutto_liter,datum,menge_liter,nach_behaelter_id,nach_weinausbau_id,schwund_liter,storniert_am,storno_grund,tenant_id,umzug_batch_id,umzug_typ,von_behaelter_id,von_weinausbau_id,zeilen_typ',
    'pressung_behaelter=behaelter_id,menge_liter,pressung_id,storniert_am,storno_grund,weinausbau_id',
    'pressung_weingaerten=ernte_datum,grundstueck_id,kmw,mostgewicht_einheit,oechsle,pressung_id,storniert_am,storno_grund,trauben_kg,weingarten_id,zukauf_posten_id',
    'pressungen=datum,jahrgang_id,kmw_grad,lese_id,most_liter_gesamt,mostgewicht_einheit,oechsle,storniert_am,storno_grund,tenant_id',
    'traubenverkauf=datum,firma_id,grundstueck_id,jahrgang_id,kmw_grad,kontakt_id,lese_id,menge_kg,mostgewicht_einheit,oechsle,storniert_am,storno_grund,tenant_id,verkaufsposten_id,weingarten_id,zukauf_posten_id',   -- KAN-150 F1a: + kontakt_id, firma_id
    'verkauf_positionen=einheit,fuellung_id,menge,pressung_behaelter_id,tenant_id,traubenverkauf_id,typ,verkaufsposten_id,weinausbau_id,zukauf_id',
    'verkaufsposten=aktiv,datum,firma_id,kontakt_id,storniert,storniert_am,storniert_von,storno_grund,tenant_id,zh_kontakt_id',   -- KAN-149 D1; KAN-150 F1a: + kontakt_id, firma_id, zh_kontakt_id
    'konto_umbuchungen=betrag,datum,nach_konto_id,storniert_am,storno_grund,tenant_id,von_konto_id',   -- KAN-149 D2
    'zahlungen=betrag,datum,konto_id,storniert_am,storno_grund,tenant_id,verkaufsposten_id',   -- KAN-149 D2
    'rechnungen=aktiv,datum,firma_id,kontakt_id,rechnungsnummer,storniert,storniert_am,storniert_von,storno_grund,tenant_id,zh_kontakt_id',   -- KAN-102
    'verschneidung_quellen=menge_liter,quell_weinausbau_id,verschneidung_id',
    'verschneidungen=datum,storniert_am,storno_grund,tenant_id,ziel_weinausbau_id',
    'weinausbau=aktiv,anfangsbestand_liter,behaelter_id,erzeugnis,herkunft_code,ist_eroeffnungsbestand,jahrgang,kmw,land_iso,menge_liter,mostgewicht_einheit,oechsle,qualitaetsstufe,rebsorte,status,storniert_am,storno_grund,tenant_id,weinart,weingarten_id,zusatzbezeichnung',   -- KAN-150 F1a: + weingarten_id; KAN-186: + erzeugnis, land_iso, zusatzbezeichnung
    'zukauf_posten=aktiv,art,datum,einheit,erzeugnis,kmw,land_iso,lieferant_firma_id,lieferant_kontakt_id,menge,mostgewicht_einheit,oechsle,storniert_am,storno_grund,tbs_jahr_lieferant,tbs_nummer_lieferant,tenant_id,zh_kontakt_id,ziel_weinausbau_id,zusatzbezeichnung',   -- KAN-90: + tbs_jahr_lieferant, tbs_nummer_lieferant;   -- KAN-186: + erzeugnis, land_iso, zusatzbezeichnung;   -- KAN-150 F1a: + lieferant_kontakt_id, lieferant_firma_id, zh_kontakt_id
    -- KAN-150 F1a: Stammdaten – Deaktivieren (aktiv) und Umhängen protokolliert
    'weingarten=aktiv,tenant_id', 'grundstuecke=aktiv,deaktiviert_am,tenant_id,weingarten_id', 'pflanzenschutzmittel=aktiv,tenant_id',
    'duengemittel=aktiv,tenant_id', 'ea_kategorien=aktiv,tenant_id', 'ea_dauerauftraege=aktiv,tenant_id',
    -- KAN-150 F2a: Anträge und Aufzeichnungen (Status, Prüfnummer, Mengen, Messwerte, formular_daten, EMCS, Storno)
    'dac_antrag=aktiv,alkohol_prozent,bescheid_am,dac_region,eingereicht_am,jahrgang,menge_liter,pruefnummer,rebsorte,status,storniert_am,storno_grund,tenant_id,weinausbau_id',
    'weinanalysen=alkohol_vol,analyse_datum,apfelsaeure_gl,dichte,extrakt_gl,flüchtige_saeure_gl,freie_so2_mgl,gesamt_so2_mgl,gesamtalkohol_vol,gesamtsaeure_gl,labor,milchsaeure_gl,ph_wert,probe_nr,restzucker_gl,storniert_am,storno_grund,tenant_id,weinausbau_id,weinsaeure_gl',
    'pruefnummernantraege=dac_antrag_id,formular_daten,storniert_am,storno_grund,tenant_id',
    'transportbescheinigungen=formular_daten,storniert_am,storno_grund,tenant_id,verkaufsposten_id',
    'exportauftraege=aktiv,datum,destination_land,emcs_arc_nummer,emcs_datum,emcs_status,firma_id,kontakt_id,lieferdatum,status,storniert_am,storno_grund,tenant_id',
    -- KAN-167: Betriebsmittel (Stammdaten: aktiv; Lagerbuchungen: Mengen, Einkaufsdaten, Storno)
    'betriebsmittel=aktiv,tenant_id',
    'betriebsmittel_lager_bewegungen=betrag_netto,betriebsmittel_id,datum,einheit,lieferant_firma_id,menge,storniert_am,storno_grund,tenant_id,typ,ust_satz'];
  -- echte Prüfaufrufe (auf Quelltext ohne Kommentare)
  c_re_ptz constant text := 'PERFORM\s+(public\.)?pruefe_tenant_zugriff\s*\(\s*p_tenant_id\M';
  c_re_abo constant text := 'PERFORM\s+(public\.)?s112_pruefe_abo_schreibsperre\s*\(';
  -- Schreibanweisung im Quelltext ohne Kommentare (Heuristik, Groß-/Kleinschreibung egal, Vergleich mit ~*)
  c_re_schreibt constant text := '\m(INSERT\s+INTO|UPDATE\s+[a-z_."]+(\s+(AS\s+)?[a-z_]+)?\s+SET|DELETE\s+FROM|ON\s+CONFLICT)\M';
  c_re_aal constant text := 'IF\s+NOT\s+(public\.)?s112_aal_ok\(\)\s+THEN\s+RAISE\s+EXCEPTION\s[^;]*ERRCODE\s*=\s*''42501''';
  v_t0    timestamptz := clock_timestamp();
  v_erg   text[] := '{}';
  v_r     record;
  v_n     bigint;
  v_n2    bigint;
  v_txt   text;
  v_bool  boolean;
  v_liste text[];
BEGIN
  PERFORM pg_temp.s112_nur_staging();

  -- Mutationen (nur im Mutationsmodus von run.mjs; sonst ohne Wirkung). Kein Aufbau nötig: reine Katalogprüfung.
  PERFORM pg_temp.s112_mutiere('tabelle_ohne_rls',
    $m$CREATE TABLE public.s112test_k01_ohne_rls (id uuid PRIMARY KEY, tenant_id uuid)$m$);
  PERFORM pg_temp.s112_mutiere('tabelle_ohne_baukasten',
    $m$CREATE TABLE public.s112test_k01_offen (id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES public.tenants (id));
       ALTER TABLE public.s112test_k01_offen ENABLE ROW LEVEL SECURITY;
       CREATE POLICY s112test_offen ON public.s112test_k01_offen FOR SELECT USING (true)$m$);
  PERFORM pg_temp.s112_mutiere('policy_system_admin',
    $m$CREATE POLICY s112test_sa ON public.rebsorten AS PERMISSIVE FOR UPDATE TO authenticated
       USING (EXISTS (SELECT 1 FROM public.tenant_memberships m WHERE m.user_id = auth.uid() AND m.role = 'system_admin'))$m$);
  PERFORM pg_temp.s112_mutiere('rpc_offen',
    $m$CREATE FUNCTION public.s112test_k01_rpc(p_tenant_id uuid) RETURNS integer LANGUAGE sql SECURITY DEFINER
       AS $x$ SELECT 1 $x$$m$);
  PERFORM pg_temp.s112_mutiere('geheimnis_grant',
    $m$GRANT SELECT (brevo_api_key) ON public.tenant_einstellungen TO authenticated$m$);
  PERFORM pg_temp.s112_mutiere('view_ohne_invoker',
    $m$CREATE VIEW public.s112test_k01_sicht AS SELECT id, tenant_id FROM public.kontakte$m$);
  PERFORM pg_temp.s112_mutiere('protokoll_trigger_weg',
    $m$DROP TRIGGER z_protokoll_loeschen ON public.weinausbau$m$);
  PERFORM pg_temp.s112_mutiere('modul_policy_weg',
    $m$DROP POLICY modul_insert ON public.kontakte$m$);
  PERFORM pg_temp.s112_mutiere('ma_oder_true',
    $m$DROP POLICY mitgliedschaft_aktiv ON public.kontakte;
       CREATE POLICY mitgliedschaft_aktiv ON public.kontakte AS RESTRICTIVE FOR ALL TO authenticated
         USING ((NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) OR true)
         WITH CHECK ((NOT (tenant_id IN (SELECT public.s112_gesperrte_tenants()))) OR true)$m$);
  PERFORM pg_temp.s112_mutiere('abo_oder_true',
    $m$DROP POLICY abo_schreibsperre_upd ON public.kontakte;
       CREATE POLICY abo_schreibsperre_upd ON public.kontakte AS RESTRICTIVE FOR UPDATE TO authenticated
         USING ((NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) OR true)
         WITH CHECK ((NOT (tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()))) OR true)$m$);
  PERFORM pg_temp.s112_mutiere('modul_oder_true',
    $m$DROP POLICY modul_insert ON public.kontakte;
       CREATE POLICY modul_insert ON public.kontakte AS RESTRICTIVE FOR INSERT TO authenticated
         WITH CHECK (public.s112_darf_schreiben(tenant_id, 'crm') OR true)$m$);
  PERFORM pg_temp.s112_mutiere('sa_alibi',
    $m$CREATE POLICY s112test_sa_alibi ON public.rebsorten AS PERMISSIVE FOR UPDATE TO authenticated
       USING (EXISTS (SELECT 1 FROM public.tenant_memberships m
                       WHERE m.user_id = auth.uid() AND m.role = 'system_admin' AND m.tenant_id IS NOT NULL))$m$);
  PERFORM pg_temp.s112_mutiere('aal_neutralisiert',
    $m$SELECT pg_temp.t01_ersetze('public.pruefe_tenant_zugriff(uuid,text[])',
         'IF NOT public\.s112_aal_ok\(\) THEN', 'IF false AND NOT public.s112_aal_ok() THEN')$m$);
  PERFORM pg_temp.s112_mutiere('ptz_kommentiert',
    $m$SELECT pg_temp.t01_ersetze('public.get_next_liefernummer(uuid)',
         'PERFORM\s+public\.pruefe_tenant_zugriff\([^;]*\);', '-- PERFORM public.pruefe_tenant_zugriff(p_tenant_id, …) entfernt')$m$);
  PERFORM pg_temp.s112_mutiere('abo_kommentiert',
    $m$SELECT pg_temp.t01_ersetze('public.get_next_liefernummer(uuid)',
         'PERFORM\s+public\.s112_pruefe_abo_schreibsperre\([^;]*\);', '-- PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);')$m$);
  PERFORM pg_temp.s112_mutiere('trigger_update_of',
    $m$DROP TRIGGER z_protokoll_aendern ON public.weinausbau;
       CREATE TRIGGER z_protokoll_aendern AFTER UPDATE OF status ON public.weinausbau
         FOR EACH ROW EXECUTE FUNCTION public.bestandsprotokoll_schreiben('status')$m$);
  PERFORM pg_temp.s112_mutiere('trigger_when',
    $m$DROP TRIGGER z_protokoll_loeschen ON public.weinausbau;
       CREATE TRIGGER z_protokoll_loeschen AFTER DELETE ON public.weinausbau
         FOR EACH ROW WHEN (false) EXECUTE FUNCTION public.bestandsprotokoll_schreiben()$m$);
  PERFORM pg_temp.s112_mutiere('rpc_schreibt_ohne_abo',
    $m$CREATE FUNCTION public.s112test_k01_schreibt(p_tenant_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
       SET search_path = public AS $x$
       BEGIN
         PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin', 'tenant_admin']);
         UPDATE public.tenant_einstellungen SET updated_at = now() WHERE tenant_id = p_tenant_id;
       END $x$;
       REVOKE EXECUTE ON FUNCTION public.s112test_k01_schreibt(uuid) FROM PUBLIC, anon;
       GRANT EXECUTE ON FUNCTION public.s112test_k01_schreibt(uuid) TO authenticated$m$);
  PERFORM pg_temp.s112_mutiere('invoker_ohne_ptz',
    $m$CREATE FUNCTION public.s112test_k01_invoker(p_tenant_id uuid) RETURNS bigint LANGUAGE sql STABLE
       SET search_path = public AS $x$ SELECT count(*) FROM public.kontakte WHERE tenant_id = p_tenant_id $x$;
       REVOKE EXECUTE ON FUNCTION public.s112test_k01_invoker(uuid) FROM PUBLIC, anon;
       GRANT EXECUTE ON FUNCTION public.s112test_k01_invoker(uuid) TO authenticated$m$);

  -- ── 1. RLS ──────────────────────────────────────────────────────────────────────────────────────────
  SELECT count(*), count(*) FILTER (WHERE c.relforcerowsecurity) INTO v_n, v_n2
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p');
  v_erg := v_erg || pg_temp.s112_erwarte('tabellen_plausibel', v_n >= 100, true);
  v_erg := v_erg || pg_temp.s112_erwarte('force_rls_anzahl', v_n2, 0::bigint);
  v_erg := v_erg || pg_temp.t01_liste('rls_an', $q$
    SELECT c.relname AS schluessel, 'relrowsecurity=false (ENABLE ROW LEVEL SECURITY fehlt)' AS beleg
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
     ORDER BY 1$q$);

  -- ── 2. zwei_faktor_aal ──────────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.t01_liste('zfa_anzahl', $q$
    WITH ziel AS (
      SELECT n.nspname::text AS s, c.relname::text AS t
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE (n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity)
          OR (n.nspname = 'storage' AND c.relname = 'objects'))
    SELECT z.s || '.' || z.t AS schluessel, 'Anzahl zwei_faktor_aal=' || count(p.policyname) AS beleg
      FROM ziel z
      LEFT JOIN pg_policies p ON p.schemaname = z.s AND p.tablename = z.t AND p.policyname = 'zwei_faktor_aal'
     GROUP BY z.s, z.t HAVING count(p.policyname) <> 1
     ORDER BY 1$q$);
  v_erg := v_erg || pg_temp.t01_liste('zfa_form', $q$
    SELECT p.schemaname || '.' || p.tablename AS schluessel,
           format('%s %s %s USING=%s CHECK=%s', p.permissive, p.cmd, p.roles, p.qual, p.with_check) AS beleg
      FROM pg_policies p
     WHERE p.policyname = 'zwei_faktor_aal'
       AND NOT (p.permissive = 'RESTRICTIVE' AND p.cmd = 'ALL' AND p.roles = '{authenticated}'::name[]
                AND regexp_replace(coalesce(p.qual, ''), '\s+', '', 'g') ~ '^\(SELECT(public\.)?s112_aal_ok\(\)ASs112_aal_ok\)$'
                AND regexp_replace(coalesce(p.with_check, ''), '\s+', '', 'g') ~ '^\(SELECT(public\.)?s112_aal_ok\(\)ASs112_aal_ok\)$')
     ORDER BY 1$q$);
  SELECT count(*) INTO v_n FROM pg_policies p WHERE p.policyname = 'zwei_faktor_aal';
  v_erg := v_erg || pg_temp.s112_erwarte('zfa_plausibel', v_n >= 100, true);
  -- Prüfabfrage a) aus 20260926154515_kan136_zwei_faktor_datenbank (wörtlich)
  SELECT count(*) INTO v_n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND c.relrowsecurity
     AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public'
                      AND p.tablename = c.relname AND p.policyname = 'zwei_faktor_aal');
  v_erg := v_erg || pg_temp.s112_erwarte('kan136_pruefabfrage', v_n, 0::bigint);
  SELECT count(*) INTO v_n FROM pg_policies p WHERE p.schemaname = 'storage' AND p.tablename = 'objects' AND p.policyname = 'zwei_faktor_aal';
  v_erg := v_erg || pg_temp.s112_erwarte('zfa_storage_objects', v_n, 1::bigint);

  -- ── 3. TO public und Rollen der Policies ────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.t01_liste('to_public', format($q$
    SELECT p.tablename || '.' || p.policyname AS schluessel, 'zusätzliche Policy mit Rolle public: ' || p.roles::text || ' ' || p.cmd AS beleg
      FROM pg_policies p
     WHERE p.schemaname = 'public' AND 'public' = ANY (p.roles::text[])
       AND NOT (p.tablename || '.' || p.policyname = ANY (%L::text[]))
    UNION ALL
    SELECT x, 'Soll-Policy TO public fehlt'
      FROM unnest(%L::text[]) x
     WHERE NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public'
                        AND p.tablename || '.' || p.policyname = x AND 'public' = ANY (p.roles::text[]))
     ORDER BY 1$q$, pg_temp.s112_soll_liste('public_policies'), pg_temp.s112_soll_liste('public_policies')));
  SELECT pg_temp.t01_sortiert(array_agg(p.tablename || '.' || p.policyname || '=' || p.cmd)) INTO v_txt
    FROM pg_policies p WHERE p.schemaname = 'public' AND 'public' = ANY (p.roles::text[]);
  v_erg := v_erg || pg_temp.s112_erwarte('to_public_kommandos', v_txt, pg_temp.t01_sortiert(c_public_cmd));
  v_erg := v_erg || pg_temp.s112_erwarte('to_public_liste_konsistent',
    pg_temp.t01_sortiert(pg_temp.s112_soll_liste('public_policies')),
    pg_temp.t01_sortiert(ARRAY(SELECT split_part(x, '=', 1) FROM unnest(c_public_cmd) x)));
  v_erg := v_erg || pg_temp.t01_liste('policy_rolle', format($q$
    SELECT p.schemaname || '.' || p.tablename || '.' || p.policyname AS schluessel, 'Rollen ' || p.roles::text || ' statt {authenticated}' AS beleg
      FROM pg_policies p
     WHERE p.schemaname IN ('public', 'storage') AND p.roles <> '{authenticated}'::name[]
       AND NOT (p.schemaname = 'public' AND p.tablename || '.' || p.policyname = ANY (%L::text[]))
       AND NOT (p.schemaname = 'storage' AND p.tablename = 'objects' AND p.policyname = ANY (%L::text[]))
     ORDER BY 1$q$, pg_temp.s112_soll_liste('public_policies'), c_storage_rollen_ausnahmen));

  -- ── 4. Plattform-Admin (Prüfabfrage aus CLAUDE.md, public und storage) ──────────────────────────────
  v_erg := v_erg || pg_temp.t01_liste('sa_ohne_bezug', $q$
    SELECT p.schemaname || '.' || p.tablename || '.' || p.policyname AS schluessel,
           'system_admin ohne plattform_admins/tenant_id/foldername' AS beleg
      FROM pg_policies p
     WHERE p.schemaname IN ('public', 'storage')
       AND coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') LIKE '%system_admin%'
       AND coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') NOT LIKE '%plattform_admins%'
       AND coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') NOT LIKE '%tenant_id%'
       AND coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') NOT LIKE '%foldername%'
     ORDER BY 1$q$);
  -- schärfer: tenant_id zählt nur als Vergleich mit der Zeile – „tenant_id =/IN …“, „= / IN ( / ANY ( … tenant_id“
  -- oder als erstes Funktionsargument (user_has_role_in_tenant(tenant_id, …)); „m.tenant_id IS NOT NULL“ nicht
  v_erg := v_erg || pg_temp.t01_liste('sa_ohne_zeilenbezug', $q$
    SELECT p.schemaname || '.' || p.tablename || '.' || p.policyname AS schluessel,
           'system_admin ohne plattform_admins/foldername und ohne tenant_id-Vergleich: ' || left(x.a, 200) AS beleg
      FROM pg_policies p
     CROSS JOIN LATERAL (SELECT regexp_replace(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''), '\s+', ' ', 'g') AS a) x
     WHERE p.schemaname IN ('public', 'storage')
       AND x.a ~ 'system_admin' AND x.a !~ 'plattform_admins' AND x.a !~ 'foldername'
       AND x.a !~ '\mtenant_id\s*(=|IN\M)'
       AND x.a !~ '(=|\mIN\s*\(|ANY\s*\()\s*(SELECT\s+)?(\w+\.)?tenant_id\M'
       AND x.a !~ '\(\s*(\w+\.)?tenant_id\s*,'
     ORDER BY 1$q$);
  SELECT count(*) INTO v_n FROM pg_policies p
   WHERE p.schemaname IN ('public', 'storage') AND coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') ~ 'system_admin';
  v_erg := v_erg || pg_temp.s112_erwarte('sa_plausibel', v_n >= 100, true);

  -- ── 5. Baukasten der Mandantentabellen ──────────────────────────────────────────────────────────────
  -- 5a. mitgliedschaft_aktiv: genau eine korrekte RESTRICTIVE-Policy auf jeder T-Tabelle (außer c_ohne_ma)
  v_erg := v_erg || pg_temp.t01_liste('ma_fehlt', format($q$
    SELECT m.tabelle AS schluessel,
           coalesce((SELECT string_agg(p.permissive || ' ' || p.cmd || ' ' || p.roles::text || ' USING=' || left(pg_temp.t01_norm(p.qual), 120)
                                       || ' CHECK=' || left(pg_temp.t01_norm(p.with_check), 120), '; ') FROM pg_policies p
                      WHERE p.schemaname = 'public' AND p.tablename = m.tabelle AND p.policyname = 'mitgliedschaft_aktiv'),
                    'keine Policy mitgliedschaft_aktiv') AS beleg
      FROM pg_temp.s112_mandantentabellen() m
     WHERE m.klasse = 'T' AND NOT (m.tabelle = ANY (%L::text[]))
       AND (SELECT count(*) FROM pg_policies p
             WHERE p.schemaname = 'public' AND p.tablename = m.tabelle AND p.policyname = 'mitgliedschaft_aktiv'
               AND p.permissive = 'RESTRICTIVE' AND p.cmd = 'ALL' AND p.roles = '{authenticated}'::name[]
               AND pg_temp.t01_sperrform(p.tablename, p.qual, 's112_gesperrte_tenants')
               AND pg_temp.t01_norm(p.with_check) = pg_temp.t01_norm(p.qual)) <> 1
     ORDER BY 1$q$, c_ohne_ma));
  v_erg := v_erg || pg_temp.t01_liste('ma_unerwartet', format($q$
    SELECT p.tablename AS schluessel, 'mitgliedschaft_aktiv auf einer Tabelle ohne Soll (Klasse ≠ T oder Ausnahme)' AS beleg
      FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.policyname = 'mitgliedschaft_aktiv'
       AND (pg_temp.s112_klasse(p.tablename) IS DISTINCT FROM 'T' OR p.tablename = ANY (%L::text[]))
     ORDER BY 1$q$, c_ohne_ma));
  SELECT count(*) INTO v_n FROM pg_policies p WHERE p.schemaname = 'public' AND p.policyname = 'mitgliedschaft_aktiv';
  v_erg := v_erg || pg_temp.s112_erwarte('ma_plausibel', v_n >= 70, true);
  -- 5b. nullable tenant_id: Liste und NULL-sichere Form
  SELECT pg_temp.t01_sortiert(array_agg(m.tabelle)) INTO v_txt FROM pg_temp.s112_mandantentabellen() m WHERE m.tid_nullable;
  v_erg := v_erg || pg_temp.s112_erwarte('tid_nullable_liste', v_txt, pg_temp.t01_sortiert(pg_temp.s112_soll_liste('tid_nullable')));
  FOR v_r IN
    SELECT m.tabelle, bool_and(p.qual ~ 'tenant_id IS NULL' AND p.with_check ~ 'tenant_id IS NULL') AS null_sicher
      FROM pg_temp.s112_mandantentabellen() m
      JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = m.tabelle AND p.policyname = 'mitgliedschaft_aktiv'
     WHERE m.tid_nullable
     GROUP BY m.tabelle ORDER BY m.tabelle
  LOOP
    -- B5 seit KAN-159 Teil 2 hart (vorher NULL-Falle bei duengemittel, ea_kategorien, pflanzenschutzmittel, saetze_massnahmen)
    v_erg := v_erg || pg_temp.s112_erwarte('ma_null_sicher:' || v_r.tabelle, v_r.null_sicher, true);
  END LOOP;
  -- 5c. abo_schreibsperre_ins/_upd/_del (RESTRICTIVE, TO authenticated, s112_schreibgesperrte_tenants)
  v_erg := v_erg || pg_temp.t01_liste('abo', format($q$
    WITH soll AS (
      SELECT m.tabelle,
             CASE WHEN m.tabelle = ANY (%L::text[]) THEN ''
                  WHEN m.tabelle = 'tenants' THEN 'UPDATE'
                  ELSE 'DELETE,INSERT,UPDATE' END AS s
        FROM pg_temp.s112_mandantentabellen() m),
    ist AS (
      SELECT p.tablename::text AS tabelle, string_agg(p.cmd, ',' ORDER BY p.cmd) AS i
        FROM pg_policies p
       WHERE p.schemaname = 'public' AND p.policyname IN ('abo_schreibsperre_ins', 'abo_schreibsperre_upd', 'abo_schreibsperre_del')
         AND p.permissive = 'RESTRICTIVE' AND p.roles = '{authenticated}'::name[]
         AND p.cmd = CASE p.policyname WHEN 'abo_schreibsperre_ins' THEN 'INSERT' WHEN 'abo_schreibsperre_upd' THEN 'UPDATE' ELSE 'DELETE' END
         -- kanonische Form: INSERT nur WITH CHECK, DELETE nur USING, UPDATE beide gleich
         AND CASE p.cmd
               WHEN 'INSERT' THEN p.qual IS NULL AND pg_temp.t01_sperrform(p.tablename, p.with_check, 's112_schreibgesperrte_tenants')
               WHEN 'DELETE' THEN p.with_check IS NULL AND pg_temp.t01_sperrform(p.tablename, p.qual, 's112_schreibgesperrte_tenants')
               ELSE pg_temp.t01_sperrform(p.tablename, p.qual, 's112_schreibgesperrte_tenants')
                    AND pg_temp.t01_norm(p.with_check) = pg_temp.t01_norm(p.qual) END
       GROUP BY p.tablename)
    SELECT soll.tabelle AS schluessel, 'ist=' || coalesce(ist.i, '-') || ' soll=' || coalesce(nullif(soll.s, ''), '-') AS beleg
      FROM soll LEFT JOIN ist USING (tabelle)
     WHERE coalesce(ist.i, '') <> soll.s
    UNION ALL
    SELECT DISTINCT p.tablename, 'Policy ' || p.policyname || ' auf einer Tabelle ohne RLS-Soll'
      FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.policyname LIKE 'abo\_%%'
       AND NOT EXISTS (SELECT 1 FROM pg_temp.s112_mandantentabellen() m WHERE m.tabelle = p.tablename)
     ORDER BY 1$q$, pg_temp.s112_soll_liste('abo_ausnahmen')));
  v_erg := v_erg || pg_temp.t01_liste('abo_null_sicher', $q$
    SELECT m.tabelle || '.' || p.policyname AS schluessel, 'nullable tenant_id ohne „tenant_id IS NULL OR …“' AS beleg
      FROM pg_temp.s112_mandantentabellen() m
      JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = m.tabelle AND p.policyname LIKE 'abo\_schreibsperre\_%'
     WHERE m.tid_nullable AND coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') !~ 'tenant_id IS NULL'
     ORDER BY 1$q$);
  -- 5d. modul_insert/_update/_delete genau wie s112_soll (Module je Aktion, eines genügt)
  v_erg := v_erg || pg_temp.t01_liste('modul', $q$
    WITH s AS (
      SELECT tabelle, aktion, (SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM unnest(module) x) AS module
        FROM pg_temp.s112_soll()),
    i AS (
      SELECT p.tablename::text AS tabelle, p.cmd::text AS aktion,
             (SELECT coalesce(array_agg(DISTINCT m[1] ORDER BY m[1]), '{}')
                FROM regexp_matches(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''), '''([a-z_]+)''::text', 'g') m) AS module
        FROM pg_policies p
       WHERE p.schemaname = 'public' AND p.policyname = 'modul_' || lower(p.cmd)
         AND p.permissive = 'RESTRICTIVE' AND p.roles = '{authenticated}'::name[]
         AND CASE p.cmd
               WHEN 'INSERT' THEN p.qual IS NULL AND pg_temp.t01_modulform(p.tablename, p.with_check)
               WHEN 'DELETE' THEN p.with_check IS NULL AND pg_temp.t01_modulform(p.tablename, p.qual)
               ELSE pg_temp.t01_modulform(p.tablename, p.qual) AND pg_temp.t01_norm(p.with_check) = pg_temp.t01_norm(p.qual) END),
    -- ohne modul_*-Policy: Modulbeschränkung direkt in den PERMISSIVE-Policies des Kommandos (z. B.
    -- datenschutz_consents INSERT) – zählt nur, wenn JEDE davon s112_darf_schreiben aufruft (sonst Umgehung)
    ip AS (
      SELECT p.tablename::text AS tabelle, a.aktion,
             (SELECT coalesce(array_agg(DISTINCT m[1] ORDER BY m[1]), '{}')
                FROM pg_policies q,
                     regexp_matches(coalesce(q.qual, '') || ' ' || coalesce(q.with_check, ''), 's112_darf_schreiben\(([^)]*)\)', 'g') d,
                     regexp_matches(d[1], '''([a-z_]+)''::text', 'g') m
               WHERE q.schemaname = 'public' AND q.tablename = p.tablename AND q.permissive = 'PERMISSIVE'
                 AND q.cmd IN (a.aktion, 'ALL')) AS module
        FROM pg_policies p CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) a (aktion)
       WHERE p.schemaname = 'public' AND p.permissive = 'PERMISSIVE' AND p.cmd IN (a.aktion, 'ALL')
         AND NOT EXISTS (SELECT 1 FROM i WHERE i.tabelle = p.tablename AND i.aktion = a.aktion)
       GROUP BY p.tablename, a.aktion
      HAVING bool_and(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') ~ 's112_darf_schreiben')),
    ia AS (SELECT * FROM i UNION ALL SELECT * FROM ip)
    SELECT coalesce(s.tabelle, i.tabelle) || '.' || coalesce(s.aktion, i.aktion) AS schluessel,
           'ist=' || coalesce(i.module::text, 'keine modul-Policy') || ' soll=' || coalesce(nullif(s.module, '{}')::text, 'keine') AS beleg
      FROM s FULL JOIN ia i ON i.tabelle = s.tabelle AND i.aktion = s.aktion
     WHERE (coalesce(s.module, '{}') = '{}' AND i.module IS NOT NULL)
        OR (coalesce(s.module, '{}') <> '{}' AND (i.module IS NULL OR i.module <> s.module))
     ORDER BY 1$q$);
  v_erg := v_erg || pg_temp.t01_liste('modul_form', $q$
    SELECT p.tablename || '.' || p.policyname AS schluessel,
           format('%s %s %s USING=%s CHECK=%s', p.permissive, p.cmd, p.roles, left(pg_temp.t01_norm(p.qual), 150),
                  left(pg_temp.t01_norm(p.with_check), 150)) AS beleg
      FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.policyname IN ('modul_insert', 'modul_update', 'modul_delete')
       AND NOT (p.policyname = 'modul_' || lower(p.cmd) AND p.permissive = 'RESTRICTIVE' AND p.roles = '{authenticated}'::name[]
                AND CASE p.cmd
                      WHEN 'INSERT' THEN p.qual IS NULL AND pg_temp.t01_modulform(p.tablename, p.with_check)
                      WHEN 'DELETE' THEN p.with_check IS NULL AND pg_temp.t01_modulform(p.tablename, p.qual)
                      ELSE pg_temp.t01_modulform(p.tablename, p.qual) AND pg_temp.t01_norm(p.with_check) = pg_temp.t01_norm(p.qual) END)
     ORDER BY 1$q$);
  SELECT count(*) INTO v_n FROM pg_policies p WHERE p.schemaname = 'public' AND p.policyname IN ('modul_insert', 'modul_update', 'modul_delete');
  v_erg := v_erg || pg_temp.s112_erwarte('modul_plausibel', v_n >= 200, true);

  -- ── 6. Klassifikation und Abdeckung von s112_soll ───────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.t01_liste('klasse', format($q$
    SELECT m.tabelle AS schluessel, 'ohne tenant_id und ohne FK auf eine Mandantentabelle, nicht in g_tabellen' AS beleg
      FROM pg_temp.s112_mandantentabellen() m
     WHERE m.klasse = 'G' AND NOT (m.tabelle = ANY (%L::text[]))
    UNION ALL
    SELECT x, 'steht in g_tabellen, Klasse ist ' || coalesce(pg_temp.s112_klasse(x), 'unbekannt (Tabelle fehlt)')
      FROM unnest(%L::text[]) x
     WHERE pg_temp.s112_klasse(x) IS DISTINCT FROM 'G'
     ORDER BY 1$q$, pg_temp.s112_soll_liste('g_tabellen'), pg_temp.s112_soll_liste('g_tabellen')));
  -- K: jede Policy außer zwei_faktor_aal greift per FROM (EXISTS/IN) auf eine Mandantentabelle (ohne tenant_memberships)
  v_erg := v_erg || pg_temp.t01_liste('k_eltern', $q$
    WITH tt AS (
      SELECT '\mFROM\s+(public\.)?(' || string_agg(m.tabelle, '|') || ')\M' AS re
        FROM pg_temp.s112_mandantentabellen() m WHERE m.klasse = 'T' AND m.tabelle <> 'tenant_memberships')
    SELECT p.tablename || '.' || p.policyname AS schluessel, 'kein Bezug auf eine Eltern-Mandantentabelle' AS beleg
      FROM pg_policies p CROSS JOIN tt
     WHERE p.schemaname = 'public' AND pg_temp.s112_klasse(p.tablename) = 'K' AND p.policyname <> 'zwei_faktor_aal'
       -- KAN-145 B4: keine_direktloeschung (RESTRICTIVE, USING false) gibt nie Zeilen frei – kein Elternbezug nötig
       AND NOT (p.policyname = 'keine_direktloeschung' AND p.permissive = 'RESTRICTIVE' AND p.qual = 'false')
       AND NOT (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') ~ tt.re)
     ORDER BY 1$q$);
  v_erg := v_erg || pg_temp.t01_liste('k_lesepfad', $q$
    SELECT m.tabelle AS schluessel, 'keine PERMISSIVE-Policy für SELECT/ALL' AS beleg
      FROM pg_temp.s112_mandantentabellen() m
     WHERE m.klasse = 'K'
       AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = m.tabelle
                        AND p.permissive = 'PERMISSIVE' AND p.cmd IN ('SELECT', 'ALL'))
     ORDER BY 1$q$);
  SELECT count(*) FILTER (WHERE klasse = 'T'), count(*) FILTER (WHERE klasse = 'K') INTO v_n, v_n2 FROM pg_temp.s112_mandantentabellen();
  v_erg := v_erg || pg_temp.s112_erwarte('klassen_plausibel', v_n >= 70 AND v_n2 >= 10, true);
  v_erg := v_erg || pg_temp.t01_liste('soll_fehlt', $q$
    SELECT c.relname AS schluessel, 'Tabelle fehlt in pg_temp.s112_soll() (_helfer.sql)' AS beleg
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_temp.s112_soll() s WHERE s.tabelle = c.relname)
     ORDER BY 1$q$);
  v_erg := v_erg || pg_temp.t01_liste('soll_ueberzaehlig', $q$
    SELECT DISTINCT s.tabelle AS schluessel, 'in s112_soll(), aber keine Tabelle in public' AS beleg
      FROM pg_temp.s112_soll() s
     WHERE to_regclass(format('public.%I', s.tabelle)) IS NULL
     ORDER BY 1$q$);

  -- ── 7. Funktionen ───────────────────────────────────────────────────────────────────────────────────
  SELECT count(*), count(*) FILTER (WHERE f.sd) INTO v_n, v_n2 FROM pg_temp.t01_funktionen() f;
  v_erg := v_erg || pg_temp.s112_erwarte('funktionen_plausibel', v_n >= 60 AND v_n2 >= 40, true);
  -- search_path: hart für SECURITY DEFINER (Lint 0011), nach CLAUDE.md für jede Funktion in public
  v_erg := v_erg || pg_temp.t01_liste('search_path', $q$
    SELECT f.sig AS schluessel, CASE WHEN f.sd THEN 'SECURITY DEFINER ' ELSE '' END || 'ohne SET search_path' AS beleg
      FROM pg_temp.t01_funktionen() f
     WHERE NOT EXISTS (SELECT 1 FROM unnest(coalesce(f.proconfig, '{}')) c WHERE c LIKE 'search_path=%')
     ORDER BY 1$q$);
  v_erg := v_erg || pg_temp.t01_liste('secdef_anon', $q$
    SELECT f.sig AS schluessel, 'SECURITY DEFINER ausführbar für ' || concat_ws('+', CASE WHEN f.a THEN 'anon' END, CASE WHEN f.pub THEN 'PUBLIC' END) AS beleg
      FROM pg_temp.t01_funktionen() f
     WHERE f.sd AND (f.a OR f.pub)
     ORDER BY 1$q$);
  v_erg := v_erg || pg_temp.t01_liste('anon_execute', format($q$
    SELECT f.sig AS schluessel, 'EXECUTE für ' || concat_ws('+', CASE WHEN f.a THEN 'anon' END, CASE WHEN f.pub THEN 'PUBLIC' END)
           || ' – REVOKE EXECUTE … FROM PUBLIC, anon fehlt' AS beleg
      FROM pg_temp.t01_funktionen() f
     WHERE (f.a OR f.pub) AND NOT (f.sig = ANY (%L::text[]))
     ORDER BY 1$q$, pg_temp.s112_soll_liste('anon_execute_erlaubt')));   -- B10 seit KAN-159 Teil 2 hart
  -- SECURITY-DEFINER-Menge = s112_soll_rpc (dieselbe Einstufung nutzt 18), Rechte und Abo-Prüfung gleich
  v_erg := v_erg || pg_temp.t01_liste('rpc_nicht_eingestuft', $q$
    SELECT f.sig AS schluessel, 'SECURITY DEFINER ohne Eintrag in pg_temp.s112_soll_rpc() (_helfer.sql)' AS beleg
      FROM pg_temp.t01_funktionen() f
     WHERE f.sd AND NOT EXISTS (SELECT 1 FROM pg_temp.s112_soll_rpc() s WHERE s.funktion = f.sig)
     ORDER BY 1$q$);
  v_erg := v_erg || pg_temp.t01_liste('rpc_soll_ohne_funktion', $q$
    SELECT s.funktion AS schluessel, 'Einstufung ohne SECURITY-DEFINER-Funktion (entfernt, umbenannt oder INVOKER)' AS beleg
      FROM pg_temp.s112_soll_rpc() s
     WHERE NOT EXISTS (SELECT 1 FROM pg_temp.t01_funktionen() f WHERE f.sd AND f.sig = s.funktion)
     ORDER BY 1$q$);
  v_erg := v_erg || pg_temp.t01_liste('rpc_rechte', $q$
    SELECT f.sig AS schluessel,
           'ist=' || CASE WHEN f.a THEN 'A' ELSE '-' END || CASE WHEN f.u THEN 'U' ELSE '-' END || CASE WHEN f.s THEN 'S' ELSE '-' END
           || ' soll=' || s.rechte || ' (' || s.einstufung || ')' AS beleg
      FROM pg_temp.t01_funktionen() f JOIN pg_temp.s112_soll_rpc() s ON s.funktion = f.sig
     WHERE f.sd AND CASE WHEN f.a THEN 'A' ELSE '-' END || CASE WHEN f.u THEN 'U' ELSE '-' END || CASE WHEN f.s THEN 'S' ELSE '-' END <> s.rechte
     ORDER BY 1$q$);
  v_erg := v_erg || pg_temp.t01_liste('rpc_abo', format($q$
    SELECT f.sig AS schluessel,
           CASE WHEN s.abo THEN 'schreibende RPC ohne „PERFORM public.s112_pruefe_abo_schreibsperre(…)“ (Kommentare zählen nicht)'
                ELSE 'ruft s112_pruefe_abo_schreibsperre auf, Soll abo=false – s112_soll_rpc nachziehen' END AS beleg
      FROM pg_temp.t01_funktionen() f JOIN pg_temp.s112_soll_rpc() s ON s.funktion = f.sig
     WHERE f.sd AND s.abo IS DISTINCT FROM (f.src ~ %L)
     ORDER BY 1$q$, c_re_abo));
  SELECT count(*) INTO v_n FROM pg_temp.s112_soll_rpc() s WHERE s.abo;
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_abo_anzahl', v_n, 57::bigint);   -- +1 KAN-120 (s112_psm_uebermittlung_protokollieren)   -- +2 KAN-103 (s112_rechnung_erstellen, _stornieren)   -- +2 KAN-118 (s112_produktion_buchen, _stornieren)   -- +1 KAN-219 (s112_elabel_umleiten)   -- +1 KAN-190 (s112_sekt_stufe_setzen)   -- +4 KAN-115 (s112_artikel_buchen, _bewegung_stornieren, _verkauf_buchen, _verkauf_stornieren)   -- +2 KAN-53 (s112_zugangskorrektur_buchen, _stornieren)   -- +2 KAN-41 Paket 3d (s112_fuellung_etikettieren, s112_etikettierung_stornieren)   -- +2 KAN-41 Paket 3a (s112_verarbeitung_buchen, _stornieren)   -- +1 KAN-41 (s112_charge_status_setzen)   -- −1 KAN-88 (s112_buchung_loeschen entfällt)   -- +1 KAN-82 (s112_charge_abstufen)   -- +1 KAN-101 (s112_fuellung_nachtragen)   -- +1 KAN-97 (s112_pruefnummernantrag_status_setzen)   -- +1 KAN-96 (s112_freeze_korrektur)   -- +1 KAN-193 (s112_zukauf_buchen)   -- +1 KAN-112 (s112_verschnitte_buchen)   -- +1 KAN-112 (s112_verschnitt_buchen)   -- +1 KAN-192 (kellerbuch_abschliessen)   -- +2 KAN-40 (journal_eroeffnen, journal_abgleichen)   -- +1 KAN-37 B (s112_ama_einreichen)   -- +2 KAN-167 (s112_betriebsmittel_einkauf, s112_betriebsmittel_stornieren)   -- +1 KAN-150 F1d   -- +1 KAN-150 F1c   -- +3 KAN-149 D2   -- +1 KAN-149 D1   -- +3 KAN-148 C2 (s112_ama_*)   -- +s112_storniert_loeschen (KAN-145), s112_buchung_loeschen (KAN-166), s112_pressung_stornieren (KAN-148)
  -- Unabhängig vom Handflag: schreibende SECURITY-DEFINER-RPC (p_tenant_id, EXECUTE für authenticated, Schreib-
  -- anweisung im Quelltext) ohne Abo-Prüfung → FEHLER, außer begründet in s112_soll_liste('abo_rpc_ausnahmen').
  v_erg := v_erg || pg_temp.t01_liste('rpc_schreibt_ohne_abo', format($q$
    SELECT f.sig AS schluessel,
           'schreibende SECURITY-DEFINER-RPC ohne „PERFORM public.s112_pruefe_abo_schreibsperre(…)“ – Aufruf ergänzen oder '
           || 'begründet in s112_soll_liste(''abo_rpc_ausnahmen'') aufnehmen (abo in s112_soll_rpc: '
           || coalesce((SELECT s.abo::text FROM pg_temp.s112_soll_rpc() s WHERE s.funktion = f.sig), 'fehlt') || ')' AS beleg
      FROM pg_temp.t01_funktionen() f
     WHERE f.sd AND f.u AND f.sig ~ '\mp_tenant_id\M' AND f.src ~* %L AND f.src !~ %L
       AND NOT (f.sig = ANY (%L::text[]))
     ORDER BY 1$q$, c_re_schreibt, c_re_abo, pg_temp.s112_soll_liste('abo_rpc_ausnahmen')));
  v_erg := v_erg || pg_temp.t01_liste('rpc_abo_ausnahme_veraltet', format($q$
    SELECT x.aus AS schluessel, 'steht in s112_soll_liste(''abo_rpc_ausnahmen''), ist aber keine schreibende RPC ohne Abo-Prüfung mehr' AS beleg
      FROM unnest(%L::text[]) x (aus)
     WHERE NOT EXISTS (SELECT 1 FROM pg_temp.t01_funktionen() f
                        WHERE f.sig = x.aus AND f.sd AND f.u AND f.src ~* %L AND f.src !~ %L)
     ORDER BY 1$q$, pg_temp.s112_soll_liste('abo_rpc_ausnahmen'), c_re_schreibt, c_re_abo));
  -- Plausibilität der Heuristik: sie erkennt alle 12 RPCs mit Abo-Prüfung als schreibend
  SELECT count(*) INTO v_n FROM pg_temp.t01_funktionen() f JOIN pg_temp.s112_soll_rpc() s ON s.funktion = f.sig
   WHERE s.abo AND f.src ~* c_re_schreibt;
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_schreibt_heuristik_abo_rpcs', v_n, 52::bigint);   -- +1 KAN-120   -- +2 KAN-103   -- +2 KAN-118   -- +1 KAN-219   -- +1 KAN-190   -- +4 KAN-115 (s112_artikel_*)   -- +2 KAN-53   -- +2 KAN-41 Paket 3d   -- +2 KAN-41 Paket 3a (s112_verarbeitung_buchen, _stornieren)   -- +1 KAN-41 (s112_charge_status_setzen)   -- −1 KAN-21 (get_next_rechnungsnummer nur Service-Role)   -- −1 KAN-88 (s112_buchung_loeschen entfällt)   -- +1 KAN-82 (s112_charge_abstufen)   -- +1 KAN-101 (s112_fuellung_nachtragen)   -- +1 KAN-97 (s112_pruefnummernantrag_status_setzen)   -- +1 KAN-96 (s112_freeze_korrektur: UPDATE per EXECUTE format)   -- +1 KAN-193 (s112_zukauf_buchen: INSERT per EXECUTE format)   -- s112_verschnitte_buchen zählt nicht (schreibt nur über s112_verschnitt_buchen)   -- +1 KAN-112   -- +1 KAN-192 (kellerbuch_abschliessen)   -- +1 KAN-40 (journal_eroeffnen; journal_abgleichen schreibt über s112_journal_schreiben)   -- +1 KAN-37 B   -- +2 KAN-167 (s112_betriebsmittel_einkauf, s112_betriebsmittel_stornieren)   -- +1 KAN-150 F1d (s112_herkunft_setzen)   -- +2 KAN-149 D2 (s112_ea_stornieren schreibt über s112_ea_gegenbuchung)   -- +1 KAN-149 D1   -- +3 KAN-148 C2   -- +3 KAN-148 C1c-2
  -- p_tenant_id ohne pruefe_tenant_zugriff: nur mit Einstufung mandant_eigen, session_user, intern oder rls_hilfe
  v_erg := v_erg || pg_temp.t01_liste('ptz_nicht_eingestuft', format($q$
    SELECT f.sig AS schluessel,
           'p_tenant_id ohne pruefe_tenant_zugriff, Einstufung ' || coalesce(s.einstufung, 'fehlt') AS beleg
      FROM pg_temp.t01_funktionen() f LEFT JOIN pg_temp.s112_soll_rpc() s ON s.funktion = f.sig
     WHERE f.sd AND f.sig ~ '\mp_tenant_id\M' AND f.src !~ %L AND f.fn <> 'pruefe_tenant_zugriff'
       AND coalesce(s.einstufung, '') NOT IN ('mandant_eigen', 'session_user', 'intern', 'rls_hilfe')
     ORDER BY 1$q$, c_re_ptz));
  v_erg := v_erg || pg_temp.t01_liste('ptz_fehlt', format($q$
    SELECT f.sig AS schluessel,
           'Einstufung mandant ohne „PERFORM public.pruefe_tenant_zugriff(p_tenant_id, …)“ (Kommentare zählen nicht)' AS beleg
      FROM pg_temp.t01_funktionen() f JOIN pg_temp.s112_soll_rpc() s ON s.funktion = f.sig
     WHERE s.einstufung = 'mandant' AND f.src !~ %L
     ORDER BY 1$q$, c_re_ptz));
  -- INVOKER-Funktionen: CLAUDE.md verlangt pruefe_tenant_zugriff für JEDE Funktion mit p_tenant_id (RLS fängt viel
  -- ab, aber weder die Rollenliste noch die Zwei-Faktor-Prüfung der Funktion). Ausnahmen nur benannt in s112_soll_liste.
  v_erg := v_erg || pg_temp.t01_liste('ptz_invoker', format($q$
    SELECT f.sig AS schluessel,
           'INVOKER-Funktion mit p_tenant_id und EXECUTE für ' || concat_ws('+', CASE WHEN f.u THEN 'authenticated' END,
             CASE WHEN f.a THEN 'anon' END, CASE WHEN f.pub THEN 'PUBLIC' END)
           || ' ohne „PERFORM public.pruefe_tenant_zugriff(p_tenant_id, …)“ (Kommentare zählen nicht)' AS beleg
      FROM pg_temp.t01_funktionen() f
     WHERE NOT f.sd AND f.sig ~ '\mp_tenant_id\M' AND (f.u OR f.a OR f.pub) AND f.src !~ %L
       AND NOT (f.sig = ANY (%L::text[]))
     ORDER BY 1$q$, c_re_ptz, pg_temp.s112_soll_liste('ptz_ausnahmen')));
  v_erg := v_erg || pg_temp.t01_liste('ptz_ausnahme_veraltet', format($q$
    SELECT x.aus AS schluessel, 'steht in s112_soll_liste(''ptz_ausnahmen''), ist aber keine ausführbare INVOKER-Funktion ohne Prüfung mehr' AS beleg
      FROM unnest(%L::text[]) x (aus)
     WHERE NOT EXISTS (SELECT 1 FROM pg_temp.t01_funktionen() f
                        WHERE f.sig = x.aus AND NOT f.sd AND (f.u OR f.a OR f.pub) AND f.src !~ %L)
     ORDER BY 1$q$, pg_temp.s112_soll_liste('ptz_ausnahmen'), c_re_ptz));
  -- Plausibilität: die Menge der INVOKER-Funktionen mit p_tenant_id ist nicht leer (sonst prüfte ptz_invoker nichts)
  SELECT count(*) INTO v_n FROM pg_temp.t01_funktionen() f WHERE NOT f.sd AND f.sig ~ '\mp_tenant_id\M';
  v_erg := v_erg || pg_temp.s112_erwarte('ptz_invoker_kandidaten_vorhanden', v_n >= 1, true);
  -- eigene Mitgliedsprüfung muss die aktive Mitgliedschaft prüfen
  v_erg := v_erg || pg_temp.t01_liste('ptz_eigen_aktiv', $q$
    SELECT f.sig AS schluessel, 'eigene Mitgliedsprüfung ohne Bezug auf aktiv' AS beleg
      FROM pg_temp.t01_funktionen() f JOIN pg_temp.s112_soll_rpc() s ON s.funktion = f.sig
     WHERE s.einstufung IN ('mandant_eigen', 'session_user')
       AND f.src !~ '\maktiv\M'
     ORDER BY 1$q$);
  -- B4 (RPC-Teil) behoben: get_behandlungen_fuer_grundstuecke entfernt (KAN-127, 30.09.2026) – darf nicht wiederkommen
  v_erg := v_erg || pg_temp.s112_erwarte('get_behandlungen_fuer_grundstuecke_entfernt', to_regprocedure('public.get_behandlungen_fuer_grundstuecke(uuid[], uuid)') IS NULL, true);
  -- echte Stufenprüfung „IF NOT public.s112_aal_ok() THEN RAISE EXCEPTION … ERRCODE = '42501'“ (ohne Kommentare);
  -- ein neutralisiertes „IF false AND NOT s112_aal_ok()“ zählt nicht
  SELECT bool_and(f.src ~ c_re_aal) INTO v_bool FROM pg_temp.t01_funktionen() f WHERE f.fn = 'pruefe_tenant_zugriff';
  v_erg := v_erg || pg_temp.s112_erwarte('ptz_prueft_aal', v_bool, true);

  -- ── 8. PostgREST-Pre-Request ────────────────────────────────────────────────────────────────────────
  SELECT EXISTS (SELECT 1 FROM pg_roles r, unnest(r.rolconfig) c
                  WHERE r.rolname = 'authenticator' AND c = 'pgrst.db_pre_request=public.s112_pre_request') INTO v_bool;
  v_erg := v_erg || pg_temp.s112_erwarte('pre_request_authenticator', v_bool, true);
  v_erg := v_erg || pg_temp.s112_erwarte('pre_request_anon',
    has_function_privilege('anon', 'public.s112_pre_request()', 'EXECUTE'), true);
  v_erg := v_erg || pg_temp.s112_erwarte('pre_request_authenticated',
    has_function_privilege('authenticated', 'public.s112_pre_request()', 'EXECUTE'), true);

  -- ── 9. Geheimnis-Spalten (KAN-135) ──────────────────────────────────────────────────────────────────
  SELECT count(*) INTO v_n
    FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
   WHERE c.relnamespace = 'public'::regnamespace AND c.relname || '.' || a.attname = ANY (pg_temp.s112_soll_liste('geheimnis_spalten'));
  v_erg := v_erg || pg_temp.s112_erwarte('geheim_spalten_vorhanden', v_n, cardinality(pg_temp.s112_soll_liste('geheimnis_spalten'))::bigint);
  v_erg := v_erg || pg_temp.t01_liste('geheim', format($q$
    SELECT c.relname || '.' || a.attname || ':' || r || ':' || pr AS schluessel, 'Spaltenrecht vorhanden' AS beleg
      FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     CROSS JOIN unnest(ARRAY['anon', 'authenticated']) r
     CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE']) pr
     WHERE c.relnamespace = 'public'::regnamespace AND c.relname || '.' || a.attname = ANY (%L::text[])
       AND has_column_privilege(r, c.oid, a.attnum, pr)
     ORDER BY 1$q$, pg_temp.s112_soll_liste('geheimnis_spalten')));
  v_erg := v_erg || pg_temp.t01_liste('tabrecht', $q$
    SELECT t || ':' || r || ':' || pr AS schluessel, 'Tabellenrecht vorhanden – nur Spaltenrechte erlaubt' AS beleg
      FROM unnest(ARRAY['tenant_einstellungen', 'user_email_connections']) t
     CROSS JOIN unnest(ARRAY['anon', 'authenticated']) r
     CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE']) pr
     WHERE has_table_privilege(r, format('public.%I', t)::regclass, pr)
     ORDER BY 1$q$);
  v_erg := v_erg || pg_temp.t01_liste('spalte_ohne_grant', format($q$
    SELECT c.relname || '.' || a.attname AS schluessel, 'kein SELECT für authenticated (GRANT SELECT (<spalte>) fehlt)' AS beleg
      FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('tenant_einstellungen', 'user_email_connections')
       AND NOT (c.relname || '.' || a.attname = ANY (%L::text[]))
       AND NOT has_column_privilege('authenticated', c.oid, a.attnum, 'SELECT')
     ORDER BY 1$q$, pg_temp.s112_soll_liste('geheimnis_spalten')));
  v_erg := v_erg || pg_temp.t01_liste('geheim_heuristik', format($q$
    SELECT c.relname || '.' || a.attname AS schluessel, 'geheimnisartiger Spaltenname, lesbar für anon/authenticated' AS beleg
      FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm')
       AND a.attname ~* '(_enc|passwort|password|secret|api_key|token)$'
       AND (has_column_privilege('authenticated', c.oid, a.attnum, 'SELECT') OR has_column_privilege('anon', c.oid, a.attnum, 'SELECT'))
       AND NOT (c.relname || '.' || a.attname = ANY (%L::text[]))
     ORDER BY 1$q$, c_heuristik_bekannt));
  -- BK4 behoben (KAN-159): Klartext-Token nicht mehr gespeichert, nur noch der SHA-256-Hash (newsletter_token_hash)
  v_erg := v_erg || pg_temp.s112_erwarte('newsletter_token_klartext_weg',
    (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.kontakte'::regclass AND attname = 'newsletter_token' AND NOT attisdropped), 0::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('newsletter_token_hash_vorhanden',
    (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.kontakte'::regclass AND attname = 'newsletter_token_hash' AND NOT attisdropped), 1::bigint);

  -- ── 10. Views und Buckets ───────────────────────────────────────────────────────────────────────────
  v_erg := v_erg || pg_temp.t01_liste('view_security_invoker', $q$
    SELECT c.relname AS schluessel, 'View ohne security_invoker=true (umginge RLS), reloptions=' || coalesce(c.reloptions::text, 'NULL') AS beleg
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v'
       AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(c.reloptions, '{}')) o
                        WHERE lower(o) IN ('security_invoker=true', 'security_invoker=on', 'security_invoker=1', 'security_invoker=yes'))
    UNION ALL
    SELECT c.relname, 'materialisierte Sicht (ohne RLS) lesbar für anon/authenticated'
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'm'
       AND (has_table_privilege('authenticated', c.oid, 'SELECT') OR has_table_privilege('anon', c.oid, 'SELECT'))
     ORDER BY 1$q$);
  SELECT count(*) INTO v_n FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v' AND c.relname = 'v_behaelter_fuellstand';
  v_erg := v_erg || pg_temp.s112_erwarte('view_v_behaelter_fuellstand_vorhanden', v_n, 1::bigint);
  SELECT string_agg(b.id || ':' || b.public, ',' ORDER BY b.id) INTO v_txt FROM storage.buckets b;
  v_erg := v_erg || pg_temp.s112_erwarte('buckets', v_txt, c_buckets);

  -- ── 11. Protokoll- und Schutz-Trigger ───────────────────────────────────────────────────────────────
  v_liste := pg_temp.s112_soll_liste('protokoll_tabellen');
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_truncate_tabellen',
    pg_temp.t01_trigger_tabellen('z_protokoll_truncate'), pg_temp.t01_sortiert(v_liste));
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_loeschen_tabellen',
    pg_temp.t01_trigger_tabellen('z_protokoll_loeschen'), pg_temp.t01_sortiert(array_remove(v_liste, 'bestandsprotokoll')));
  -- KAN-150 F1a: keller_behandlungstypen nur Löschen/TRUNCATE (keine aktiv-Spalte)
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_aendern_tabellen',
    pg_temp.t01_trigger_tabellen('z_protokoll_aendern'),
    pg_temp.t01_sortiert(ARRAY(SELECT x FROM unnest(v_liste) x WHERE x NOT IN ('bestandsprotokoll', 'fuellung_bewegungen', 'weinjahrgaenge', 'keller_behandlungstypen'))));
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_liste_plausibel', cardinality(v_liste) >= 17, true);
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_aendern_soll_konsistent',
    pg_temp.t01_sortiert(ARRAY(SELECT split_part(x, '=', 1) FROM unnest(c_protokoll_aendern) x)),
    pg_temp.t01_sortiert(ARRAY(SELECT x FROM unnest(v_liste) x WHERE x NOT IN ('bestandsprotokoll', 'fuellung_bewegungen', 'weinjahrgaenge', 'keller_behandlungstypen'))));
  -- truncate = BEFORE TRUNCATE (34), loeschen = AFTER DELETE FOR EACH ROW (9), aendern = AFTER UPDATE FOR EACH ROW (17);
  -- tgtype allein genügt nicht: WHEN (tgqual) und UPDATE OF (tgattr) ändern tgtype nicht. Daher: nie WHEN;
  -- truncate/loeschen ohne Spaltenliste und ohne Argumente; aendern mit UPDATE OF = genau den Argumentspalten
  -- (die Funktion vergleicht diese Spalten) und genau den Spalten aus c_protokoll_aendern.
  v_erg := v_erg || pg_temp.t01_liste('protokoll_trigger_form', format($q$
    WITH g AS (
      SELECT c.relname::text AS tabelle, g.tgname::text AS tgname, g.tgtype, g.tgfoid, g.tgenabled, g.tgnargs,
             pg_get_expr(g.tgqual, g.tgrelid) AS wenn,
             (SELECT coalesce(string_agg(x::text, ',' ORDER BY x), '') FROM unnest(g.tgattr::int2[]) x) AS attr,
             -- KAN-150 F2a: Argumente zurück nach UTF-8 (encode … 'escape' liefert Umlaute als \ooo, z. B. flüchtige_saeure_gl)
             (SELECT coalesce(string_agg(convert_from(decode(u.a, 'escape'), 'UTF8'), ',' ORDER BY convert_from(decode(u.a, 'escape'), 'UTF8') COLLATE "C"), '')
                FROM unnest(string_to_array(encode(g.tgargs, 'escape'), '\000')) u (a) WHERE u.a <> '') AS args,
             (SELECT coalesce(string_agg(a.attnum::text, ',' ORDER BY a.attnum), '')
                FROM unnest(string_to_array(encode(g.tgargs, 'escape'), '\000')) u (a)
                JOIN pg_attribute a ON a.attrelid = g.tgrelid AND a.attname = convert_from(decode(u.a, 'escape'), 'UTF8')
                 AND a.attnum > 0 AND NOT a.attisdropped) AS args_attnum
        FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
       WHERE c.relnamespace = 'public'::regnamespace AND NOT g.tgisinternal
         AND g.tgname IN ('z_protokoll_truncate', 'z_protokoll_loeschen', 'z_protokoll_aendern'))
    SELECT g.tabelle || '.' || g.tgname AS schluessel,
           format('tgtype=%%s funktion=%%s aktiviert=%%s WHEN=%%s UPDATE OF (attnum)=%%s Argumente=%%s',
                  g.tgtype, g.tgfoid::regprocedure, g.tgenabled, coalesce(g.wenn, '-'), coalesce(nullif(g.attr, ''), '-'),
                  coalesce(nullif(g.args, ''), '-')) AS beleg
      FROM g
     WHERE NOT (g.tgfoid = 'public.bestandsprotokoll_schreiben()'::regprocedure AND g.tgenabled IN ('O', 'A') AND g.wenn IS NULL
                AND CASE g.tgname
                      WHEN 'z_protokoll_aendern' THEN g.tgtype = 17 AND g.args <> '' AND g.attr = g.args_attnum
                                                      AND g.tabelle || '=' || g.args = ANY (%L::text[])
                      ELSE g.tgtype = CASE g.tgname WHEN 'z_protokoll_truncate' THEN 34 ELSE 9 END
                           AND g.tgnargs = 0 AND g.attr = '' END)
     ORDER BY 1$q$, c_protokoll_aendern));
  SELECT p.prosecdef INTO v_bool FROM pg_proc p WHERE p.oid = 'public.bestandsprotokoll_schreiben()'::regprocedure;
  v_erg := v_erg || pg_temp.s112_erwarte('bestandsprotokoll_schreiben_security_definer', v_bool, true);
  -- a_schutz_plattformfelder: BEFORE INSERT OR UPDATE FOR EACH ROW (23), Argumente = erlaubte Spalten
  SELECT string_agg(x.eintrag, ';' ORDER BY x.eintrag) INTO v_txt
    FROM (SELECT c.relname || '='
                 || (SELECT coalesce(array_agg(u.a ORDER BY u.o), '{}') FROM unnest(string_to_array(encode(g.tgargs, 'escape'), '\000')) WITH ORDINALITY u (a, o) WHERE u.a <> '')::text
                 || '/' || g.tgtype || '/' || p.proname || '/' || g.tgenabled::text AS eintrag
            FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_proc p ON p.oid = g.tgfoid
           WHERE g.tgname = 'a_schutz_plattformfelder' AND NOT g.tgisinternal) x;
  v_erg := v_erg || pg_temp.s112_erwarte('schutz_plattformfelder_trigger', v_txt, c_schutz);

  -- ── 12. Härtung als Ratsche ─────────────────────────────────────────────────────────────────────────
  -- TRUNCATE unterliegt keiner RLS (über PostgREST nicht erreichbar). Die Protokolltabellen (42, s112_soll_liste) haben das Recht nicht
  -- und sind zusätzlich durch z_protokoll_truncate gesperrt.
  FOR v_r IN SELECT unnest(ARRAY['authenticated', 'anon']) AS rolle LOOP
    v_erg := v_erg || pg_temp.t01_liste('truncate_neu_' || v_r.rolle, format($q$
      SELECT c.relname AS schluessel, 'TRUNCATE-Recht für %s, nicht in der Baseline' AS beleg
        FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
         AND has_table_privilege(%L, c.oid, 'TRUNCATE') AND NOT (c.relname = ANY (%L::text[]))
       ORDER BY 1$q$, v_r.rolle, v_r.rolle, pg_temp.s112_soll_liste('truncate_' || v_r.rolle)));
    -- KAN-159: auch Sichten/Fremdtabellen ohne TRUNCATE (REVOKE … ON ALL TABLES)
    SELECT count(*) INTO v_n FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND has_table_privilege(v_r.rolle, c.oid, 'TRUNCATE');
    v_erg := v_erg || pg_temp.s112_erwarte('truncate_recht_' || v_r.rolle, v_n, 0::bigint);
  END LOOP;
  SELECT count(*) INTO v_n FROM pg_class c
   WHERE c.relname = ANY (pg_temp.s112_soll_liste('protokoll_tabellen')) AND c.relnamespace = 'public'::regnamespace
     AND (has_table_privilege('authenticated', c.oid, 'TRUNCATE') OR has_table_privilege('anon', c.oid, 'TRUNCATE'));
  v_erg := v_erg || pg_temp.s112_erwarte('protokoll_tabellen_ohne_truncate_recht', v_n, 0::bigint);
  -- KAN-159 B6: jede KI-Tabelle (ki_erlaubte_tabellen) mit tenant_id hat die RESTRICTIVE-Policy ki_aktiver_betrieb –
  -- sonst liest die KI-Abfrage bei mehreren Mitgliedschaften auch andere Betriebe
  v_erg := v_erg || pg_temp.t01_liste('ki_tabelle_ohne_aktiven_betrieb', $q$
    SELECT t.tab AS schluessel, 'KI-Tabelle mit tenant_id ohne RESTRICTIVE-Policy ki_aktiver_betrieb' AS beleg
      FROM unnest(public.ki_erlaubte_tabellen()) AS t(tab)
     WHERE EXISTS (SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema = 'public' AND c.table_name = t.tab AND c.column_name = 'tenant_id')
       AND NOT EXISTS (SELECT 1 FROM pg_policies p
                        WHERE p.schemaname = 'public' AND p.tablename = t.tab AND p.policyname = 'ki_aktiver_betrieb'
                          AND p.permissive = 'RESTRICTIVE' AND p.cmd = 'SELECT')
  $q$);
  -- tenant_id ohne FK auf tenants
  v_erg := v_erg || pg_temp.t01_liste('tid_ohne_fk_neu', format($q$
    SELECT c.relname AS schluessel, 'tenant_id ohne FK auf tenants, nicht in der Baseline' AS beleg
      FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'f'
                        AND k.confrelid = 'public.tenants'::regclass AND k.conkey = ARRAY[a.attnum])
       AND NOT (c.relname = ANY (%L::text[]))
     ORDER BY 1$q$, pg_temp.s112_soll_liste('tid_ohne_fk')));
  SELECT count(*), string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_n, v_txt
    FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'f'
                      AND k.confrelid = 'public.tenants'::regclass AND k.conkey = ARRAY[a.attnum])
     AND c.relname = ANY (pg_temp.s112_soll_liste('tid_ohne_fk'));
  -- BK3 seit KAN-159 Teil 2 behoben: ohne FK bleiben nur die Protokolle (überdauern die Mandanten-Löschung)
  v_erg := v_erg || pg_temp.s112_erwarte('tid_ohne_fk_soll', coalesce(v_txt, ''), 'bestandsprotokoll, system_ereignisse');
  -- KAN-195: Paket-Module – genau die Soll-Tabellen haben die drei RESTRICTIVE-Policies paketmodul_* (TO authenticated)
  SELECT pg_temp.t01_sortiert(array_agg(p.tablename::text)) INTO v_txt FROM (
    SELECT p.tablename FROM pg_policies p
     WHERE p.schemaname = 'public' AND p.policyname IN ('paketmodul_ins', 'paketmodul_upd', 'paketmodul_del')
       AND p.permissive = 'RESTRICTIVE' AND p.roles = '{authenticated}'::name[] AND (coalesce(p.qual, p.with_check) ~ 's112_paketmodul_frei')
     GROUP BY p.tablename HAVING count(*) = 3) p;
  v_erg := v_erg || pg_temp.s112_erwarte('paketmodul_tabellen', v_txt, pg_temp.t01_sortiert(pg_temp.s112_soll_liste('paketmodul_tabellen')));

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 75);
END
$test$;
