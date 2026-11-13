-- software:112 – SQL-Testrahmen gegen STAGING: Hilfsfunktionen
--
-- Diese Datei setzt run.mjs vor jede Testdatei (scripts/db-tests/NN_<bereich>.sql). Sie enthält auf
-- oberster Ebene NUR „CREATE FUNCTION pg_temp.…“: temporäre Funktionen, die in derselben Transaktion
-- wie der Test entstehen und mit ihm zurückgerollt werden (belegt in 00_rahmen.sql). pg_temp liegt nie
-- im search_path – Aufrufe deshalb IMMER qualifiziert schreiben: pg_temp.s112_als(…).
-- pg_temp-Funktionen sind auch als authenticated/anon ausführbar (SECURITY INVOKER, laufen mit der
-- gerade aktiven Rolle).
--
-- Inhalt
--   1. Wächter, Datum     s112_heute(), s112_zeitzone(), s112_nur_staging()
--   2. Rollen             s112_als(uid, rolle, aal), s112_als_postgres()
--   3. Versuche           s112_fehlercode, s112_versuch, s112_zaehle, s112_fehlertext, s112_policy
--   4. Ergebnisse         s112_name, s112_text, s112_erwarte, s112_ok, s112_fehler, s112_bekannt,
--                         s112_luecke, s112_baseline, s112_mutation, s112_ausfuehrlich, s112_mutiere, s112_ende
--   5. Aufbau             s112_nur_postgres, s112_betrieb, s112_benutzer, s112_mitglied,
--                         s112_plattform_admin, s112_faktor, s112_aufbau
--   6. Katalog & Zeilen   s112_klasse, s112_mandantentabellen, s112_pk_where, s112_zeile,
--                         s112_beispiel, s112_klon_sql, s112_klon
--   7. Soll-Daten         s112_soll, s112_soll_liste, s112_soll_rpc
--
-- Ergebniseinträge (text) sammelt jede Testdatei in einer lokalen Variablen v_erg text[]:
--   'OK:<name>'  'FEHLER:<name> <beleg>'  'BEKANNT:<titel> [<beleg>]'
-- GUCs oder temporäre Tabellen taugen dafür nicht: ein scheiternder Unterblock setzt GUCs zurück, und
-- authenticated darf temporäre Tabellen von postgres nicht lesen.
--
-- Regeln für diese Datei (prüft run.mjs vor jedem Senden, ebenso scripts/tests/db-tests.test.mjs):
--   * nur CREATE FUNCTION pg_temp.* – keine DO-Blöcke, keine Transaktionssteuerung (auch nicht in Strings),
--   * die Wörter für Replikationsmodus und Trigger-Abschalten nur in Kommentaren (scripts/check-replica.js),
--   * LANGUAGE-sql-Funktionen werden beim Anlegen geprüft: nur auf weiter OBEN definierte Funktionen verweisen.
-- Die Produktions-IDs stehen ausschließlich im Wächter (Abschnitt 1); run.mjs liest sie von dort.


-- ═══ 1. Wächter, Datum ════════════════════════════════════════════════════════════════════════════════

-- „Heute“ wie in den RPCs: Wiener Datum, nie current_date (Sitzungs-Zeitzone UTC – zwischen 00:00 und 01:00
-- bzw. 02:00 Wiener Zeit einen Tag zurück). Im DO-Block: v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date
-- im DECLARE; in SQL-Texten (EXECUTE/format) und pg_temp-Hilfsfunktionen pg_temp.s112_heute(). run.mjs lehnt
-- current_date in Testdateien ab.
CREATE FUNCTION pg_temp.s112_heute() RETURNS date LANGUAGE sql STABLE AS $f$
  SELECT (now() AT TIME ZONE 'Europe/Vienna')::date
$f$;

-- Zeitzonen-Schalter (--zeitzone <IANA-Name>): run.mjs ersetzt diese Funktion – der Wächter setzt dann die
-- Sitzungs-Zeitzone transaktionslokal. Mit z. B. Etc/GMT+12 liegt current_date fast den ganzen Tag vor dem
-- Wiener Datum: so prüft die Suite jederzeit, was sonst nur nach Mitternacht (Wien) auffällt.
CREATE FUNCTION pg_temp.s112_zeitzone() RETURNS text LANGUAGE sql AS $f$
  SELECT NULL::text
$f$;

-- Erste Anweisung jedes DO-Blocks. Bricht mit 'S112GUARD|…' ab (run.mjs: Exit 4), wenn die Verbindung
-- nicht die Staging-Datenbank ist. Vier unabhängige Merkmale:
--   * current_user = postgres (Management-API; nie als Benutzerrolle),
--   * system_identifier der Staging-Datenbank (Produktion: 7642734024280108049, Projekt zwcsgnemijkpyxrqykul),
--   * keiner der drei Produktions-Betriebe existiert,
--   * das Staging-Testkonto admin@software112.test ist Plattform-Admin (auf der Produktion gibt es es nicht).
-- Wird Staging neu aufgebaut oder wiederhergestellt, ändert sich der system_identifier: dann schlägt der
-- Wächter sicher fehl und c_staging_sysid (hier UND STAGING_SYSID in run.mjs) muss nachgezogen werden.
CREATE FUNCTION pg_temp.s112_nur_staging() RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  -- Sandbox, Weingut Johannes Gebeshuber, Spaetrot Gebeshuber GmbH (Produktion). run.mjs liest genau diese Zeile.
  c_prod_betriebe constant uuid[] := ARRAY['fa22dc07-eca5-43df-af96-f7b9b09f0471', '097f67ed-381e-4bb3-952e-758aa9d3a501', '0569d025-576d-4d47-a102-17173835dc5d']::uuid[];
  c_staging_sysid constant text := '7678069749886157684';
  v_sysid text;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'S112GUARD|Wächter läuft nicht als postgres (current_user=%)', current_user USING ERRCODE = 'P0001';
  END IF;
  SELECT system_identifier::text INTO v_sysid FROM pg_control_system();
  IF v_sysid IS DISTINCT FROM c_staging_sysid THEN
    RAISE EXCEPTION 'S112GUARD|system_identifier % ist nicht Staging – Abbruch', v_sysid USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenants WHERE id = ANY (c_prod_betriebe)) THEN
    RAISE EXCEPTION 'S112GUARD|Produktions-Betrieb gefunden – Abbruch' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u JOIN public.plattform_admins p ON p.user_id = u.id
                  WHERE u.email = 'admin@software112.test') THEN
    RAISE EXCEPTION 'S112GUARD|Staging-Testkonto admin@software112.test fehlt als Plattform-Admin – Abbruch' USING ERRCODE = 'P0001';
  END IF;
  IF pg_temp.s112_zeitzone() IS NOT NULL THEN
    PERFORM set_config('TimeZone', pg_temp.s112_zeitzone(), true);
  END IF;
END $f$;


-- ═══ 2. Rollen ════════════════════════════════════════════════════════════════════════════════════════

-- Als Benutzer weiterarbeiten: s112_als(<uid>) = authenticated mit aal1, s112_als(<uid>, 'authenticated', 'aal2'),
-- s112_als(NULL, 'anon'). Setzt request.jwt.claims {sub, role, aal} (anon: nur {role}) und SET LOCAL ROLE.
-- Die Rolle wirkt nach dem Rücksprung weiter (INVOKER-Funktion ohne SET-Klausel). Setzt außerdem die
-- transaktionslokalen Schalter zurück, die ein früherer Schritt gesetzt haben kann:
--   app.active_tenant_id        (ki_readonly_query setzt ihn; danach sähe man auf GUT-Tabellen nur diesen Betrieb)
--   s112.protokoll_aus          (Protokoll-Bypass des bestandsprotokoll-Triggers)
--   storage.allow_delete_query  (Schalter für DELETE auf storage.objects)
-- Rollen- und Claim-Wechsel in einem scheiternden Unterblock werden mit zurückgerollt (belegt in 00).
CREATE FUNCTION pg_temp.s112_als(p_uid uuid, p_rolle text DEFAULT 'authenticated', p_aal text DEFAULT 'aal1')
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF p_rolle IS NULL OR p_rolle NOT IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 's112_als: Rolle % nicht vorgesehen (nur authenticated oder anon)', p_rolle;
  END IF;
  IF p_rolle = 'authenticated' AND p_uid IS NULL THEN
    RAISE EXCEPTION 's112_als: authenticated braucht eine Benutzer-ID';
  END IF;
  IF p_aal IS NULL OR p_aal NOT IN ('aal1', 'aal2') THEN
    RAISE EXCEPTION 's112_als: Stufe % nicht vorgesehen (aal1 oder aal2)', p_aal;
  END IF;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('app.active_tenant_id', '', true);
  PERFORM set_config('s112.protokoll_aus', '', true);
  PERFORM set_config('storage.allow_delete_query', '', true);
  PERFORM set_config('request.jwt.claims',
                     CASE WHEN p_rolle = 'anon' THEN json_build_object('role', 'anon')::text
                          ELSE json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text END,
                     true);
  EXECUTE format('SET LOCAL ROLE %I', p_rolle);
END $f$;

-- Zurück zu postgres. Die Claims MÜSSEN geleert werden: sonst hält ist_service_kontext() die Sitzung für
-- „authenticated“, und SECURITY-DEFINER-RPCs wie pruefe_tenant_zugriff lehnen ab.
CREATE FUNCTION pg_temp.s112_als_postgres() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('app.active_tenant_id', '', true);
  PERFORM set_config('s112.protokoll_aus', '', true);
  PERFORM set_config('storage.allow_delete_query', '', true);
END $f$;


-- ═══ 3. Versuche ══════════════════════════════════════════════════════════════════════════════════════

-- Einheitliche Kurzform eines Fehlers:
--   R = RLS lehnt die neue Zeile ab ('new row violates row-level security …', 42501)
--   G = Recht fehlt ('permission denied …', 42501: Tabellen-, Spalten- oder Funktionsrecht)
--   T = anderes 42501, z. B. aus einem Trigger oder einer RPC ('Kein Zugriff auf diesen Betrieb')
--   E<sqlstate> = alles andere, z. B. E23502 (NOT NULL), E23503 (FK), E23514 (CHECK), EP0001 (RAISE)
CREATE FUNCTION pg_temp.s112_fehlercode(p_state text, p_msg text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE
    WHEN p_state = '42501' AND p_msg LIKE 'new row violates row-level security%' THEN 'R'
    WHEN p_state = '42501' AND p_msg LIKE 'permission denied%' THEN 'G'
    WHEN p_state = '42501' THEN 'T'
    ELSE 'E' || coalesce(p_state, '?????')
  END
$f$;

-- Führt p_sql aus und rollt die Wirkung SOFORT zurück (Unterblock endet immer mit RAISE 'S1T00').
-- Ergebnis: 'k<n>' = Erfolg mit n betroffenen bzw. gelieferten Zeilen, sonst R | G | T | E<sqlstate>.
-- Läuft mit der gerade aktiven Rolle. Beispiel:
--   pg_temp.s112_erwarte('insert_fremd', pg_temp.s112_versuch(format('INSERT INTO public.kontakte (tenant_id, nachname) VALUES (%L, %L)', v_m, 'x')), 'R')
CREATE FUNCTION pg_temp.s112_versuch(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v_n bigint;
  v_state text;
  v_msg text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'S1T00', MESSAGE = v_n::text;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    IF v_state = 'S1T00' THEN
      RETURN 'k' || v_msg;
    END IF;
    RETURN pg_temp.s112_fehlercode(v_state, v_msg);
  END;
END $f$;

-- Zählt: p_sql liefert EINEN Wert (z. B. SELECT count(*) …). Ergebnis als Text: '0', '15' … oder bei
-- Fehler R | G | T | E<sqlstate> (siehe s112_fehlercode). Vergleich deshalb gegen Text: s112_erwarte(…, '0').
CREATE FUNCTION pg_temp.s112_zaehle(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v_n bigint;
  v_state text;
  v_msg text;
BEGIN
  EXECUTE p_sql INTO v_n;
  RETURN coalesce(v_n::text, 'NULL');
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  RETURN pg_temp.s112_fehlercode(v_state, v_msg);
END $f$;

-- 'ok' oder '<SQLSTATE>: <Meldung>[ | HINT: <Hinweis>]'. Anders als s112_versuch bleibt ein Erfolg bis zum
-- Ende der Datei bestehen (wie jede andere Anweisung im Test).
CREATE FUNCTION pg_temp.s112_fehlertext(p_sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v_state text;
  v_msg text;
  v_hint text;
BEGIN
  EXECUTE p_sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_hint = PG_EXCEPTION_HINT;
  RETURN v_state || ': ' || v_msg || coalesce(' | HINT: ' || nullif(v_hint, ''), '');
END $f$;

-- Wertet die RLS-Policy-Schicht einer Tabelle in public für EINE Zeile aus, als GERADE AKTIVE Rolle (nach
-- s112_als): (OR aller PERMISSIVE-Policies) AND (AND aller RESTRICTIVE-Policies) für p_cmd bzw. ALL, Rollen =
-- current_user oder public. INSERT: WITH CHECK (ohne WITH CHECK der USING-Ausdruck); SELECT/DELETE: USING;
-- UPDATE: USING der alten Zeile UND WITH CHECK (sonst USING) derselben Zeile als neue Zeile.
-- Wozu: UPDATE/DELETE mit „WHERE <pk>“ wenden zusätzlich die SELECT-Policies an – ist die Zeile für die Persona
-- unsichtbar, kommt immer k0 heraus, egal was die UPDATE-/DELETE-Policy erlaubt. Ein „DELETE FROM tab“ ohne
-- Spaltenbezug prüft dagegen NUR die DELETE-Policy. Diese Funktion bewertet genau diese Schicht, unabhängig von
-- Triggern, Tabellenrechten und der SELECT-Sichtbarkeit.
-- Ergebnis: 'ja' | 'nein' | Fehlercode (R/G/T/E…, z. B. G = Hilfsfunktion der Policy für die Rolle gesperrt – die
-- echte Anweisung scheiterte dann ebenso). Tabelle ohne RLS → 'ja' (alles geht durch).
CREATE FUNCTION pg_temp.s112_policy(p_tab text, p_cmd text, p_zeile jsonb) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v_rls   boolean;
  v_schicht text;
  v_perm  text;
  v_restr text;
  v_ok    boolean;
  v_state text;
  v_msg   text;
BEGIN
  SELECT c.relrowsecurity INTO v_rls FROM pg_class c WHERE c.oid = to_regclass(format('public.%I', p_tab));
  IF v_rls IS NULL THEN
    RETURN 'E42P01';
  ELSIF NOT v_rls THEN
    RETURN 'ja';
  END IF;
  IF p_cmd NOT IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE') THEN
    RETURN 'E22023';
  END IF;
  -- Schichten wie im Rewriter: USING = (OR PERMISSIVE qual) AND (AND RESTRICTIVE qual);
  -- CHECK = dasselbe mit coalesce(with_check, qual). UPDATE braucht beide, INSERT nur CHECK, sonst nur USING.
  FOREACH v_schicht IN ARRAY CASE p_cmd WHEN 'UPDATE' THEN ARRAY['using', 'check'] WHEN 'INSERT' THEN ARRAY['check']
                                    ELSE ARRAY['using'] END LOOP
    SELECT string_agg('(' || x.ausdruck || ')', ' OR ') FILTER (WHERE x.permissive = 'PERMISSIVE'),
           string_agg('(' || x.ausdruck || ')', ' AND ') FILTER (WHERE x.permissive = 'RESTRICTIVE')
      INTO v_perm, v_restr
      FROM (SELECT p.permissive, CASE WHEN v_schicht = 'check' THEN coalesce(p.with_check, p.qual) ELSE p.qual END AS ausdruck
              FROM pg_policies p
             WHERE p.schemaname = 'public' AND p.tablename = p_tab AND p.cmd IN (p_cmd, 'ALL')
               AND p.roles && ARRAY[current_user::name, 'public'::name]) x
     WHERE x.ausdruck IS NOT NULL;
    IF v_perm IS NULL THEN
      RETURN 'nein';
    END IF;
    EXECUTE format('SELECT (%s) AND (%s) FROM jsonb_populate_record(NULL::public.%I, $1) AS %I',
                   v_perm, coalesce(v_restr, 'true'), p_tab, p_tab)
       INTO v_ok USING p_zeile;
    IF v_ok IS NOT TRUE THEN
      RETURN 'nein';
    END IF;
  END LOOP;
  RETURN 'ja';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  RETURN pg_temp.s112_fehlercode(v_state, v_msg);
END $f$;


-- ═══ 4. Ergebnisse ════════════════════════════════════════════════════════════════════════════════════

-- Prüfnamen ohne Leerraum (run.mjs trennt den Namen am ersten Leerzeichen ab; Mutationsmuster prüfen ihn).
CREATE FUNCTION pg_temp.s112_name(p_name text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT regexp_replace(coalesce(nullif(p_name, ''), 'ohne_name'), '\s+', '_', 'g')
$f$;

-- Freitext einzeilig und ohne den Eintrags-Trenner ' ; ' (die Ergebniszeile darf keinen Umbruch enthalten).
-- NULL bleibt NULL: die Aufrufer schreiben dann 'NULL' oder lassen den Teil weg.
CREATE FUNCTION pg_temp.s112_text(p_text text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT replace(regexp_replace(p_text, '[\r\n]+', ' ⏎ ', 'g'), ' ; ', ', ')
$f$;

-- 'OK:<name>' oder 'FEHLER:<name> ist=… soll=…' (Vergleich mit IS NOT DISTINCT FROM, NULL = NULL gilt).
CREATE FUNCTION pg_temp.s112_erwarte(p_name text, p_ist anycompatible, p_soll anycompatible)
RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN p_ist IS NOT DISTINCT FROM p_soll THEN 'OK:' || pg_temp.s112_name(p_name)
              ELSE 'FEHLER:' || pg_temp.s112_name(p_name)
                   || ' ist=' || pg_temp.s112_text(coalesce(p_ist::text, 'NULL'))
                   || ' soll=' || pg_temp.s112_text(coalesce(p_soll::text, 'NULL')) END
$f$;

CREATE FUNCTION pg_temp.s112_ok(p_name text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT 'OK:' || pg_temp.s112_name(p_name)
$f$;

CREATE FUNCTION pg_temp.s112_fehler(p_name text, p_beleg text DEFAULT NULL) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT 'FEHLER:' || pg_temp.s112_name(p_name) || coalesce(' ' || pg_temp.s112_text(p_beleg), '')
$f$;

-- Bekannte Lücke: lässt die Suite NICHT scheitern (außer mit --streng), steht aber in jedem Lauf im Block
-- „Bekannte Lücken“. Titel mit der Lücken-ID beginnen (z. B. 'B1 …'), run.mjs dedupliziert über den Titel.
CREATE FUNCTION pg_temp.s112_bekannt(p_titel text, p_beleg text DEFAULT NULL) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT 'BEKANNT:' || pg_temp.s112_text(coalesce(p_titel, 'ohne Titel')) || coalesce(' [' || pg_temp.s112_text(p_beleg) || ']', '')
$f$;

-- Ratsche für eine bekannte Lücke:
--   ist = p_ist_bei_luecke  → BEKANNT (Lücke unverändert)
--   ist = p_soll_sicher     → FEHLER '… BEHOBEN – in harte Prüfung umwandeln' (bis die Prüfung verschärft ist)
--   sonst                   → FEHLER (weder der sichere noch der bekannte Zustand)
-- So kann eine behobene Lücke nicht still wieder aufgehen.
CREATE FUNCTION pg_temp.s112_luecke(p_name text, p_ist anycompatible, p_soll_sicher anycompatible,
                                    p_ist_bei_luecke anycompatible, p_titel text)
RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE
    WHEN p_ist IS NOT DISTINCT FROM p_ist_bei_luecke THEN
      'BEKANNT:' || pg_temp.s112_text(coalesce(p_titel, 'ohne Titel')) || ' [' || pg_temp.s112_name(p_name) || ' ist=' || pg_temp.s112_text(coalesce(p_ist::text, 'NULL')) || ']'
    WHEN p_ist IS NOT DISTINCT FROM p_soll_sicher THEN
      'FEHLER:' || pg_temp.s112_name(p_name) || ' BEHOBEN – in harte Prüfung umwandeln (ist=' || pg_temp.s112_text(coalesce(p_ist::text, 'NULL'))
      || ', bekannte Lücke: ' || pg_temp.s112_text(coalesce(p_titel, 'ohne Titel')) || ')'
    ELSE
      'FEHLER:' || pg_temp.s112_name(p_name) || ' ist=' || pg_temp.s112_text(coalesce(p_ist::text, 'NULL'))
      || ' soll=' || pg_temp.s112_text(coalesce(p_soll_sicher::text, 'NULL'))
      || ' (bekannte Lücke erwartete ' || pg_temp.s112_text(coalesce(p_ist_bei_luecke::text, 'NULL')) || ': ' || pg_temp.s112_text(coalesce(p_titel, 'ohne Titel')) || ')'
  END
$f$;

-- Ratsche für aggregierte Lücken mit Baseline-Zahl (Fremd-FK, TRUNCATE-Recht, tenant_id ohne FK, anon-EXECUTE):
--   ist = baseline → BEKANNT;  ist > baseline → FEHLER (neue Lücke);
--   ist < baseline → FEHLER 'BEHOBEN – Baseline senken' (bei 0: in harte Prüfung umwandeln).
CREATE FUNCTION pg_temp.s112_baseline(p_name text, p_ist bigint, p_baseline bigint, p_titel text, p_beleg text DEFAULT NULL)
RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE
    WHEN p_ist IS NULL OR p_baseline IS NULL THEN
      'FEHLER:' || pg_temp.s112_name(p_name) || ' ist=' || coalesce(p_ist::text, 'NULL') || ' Baseline=' || coalesce(p_baseline::text, 'NULL') || ' (Zählung fehlgeschlagen)'
    WHEN p_ist = p_baseline THEN
      'BEKANNT:' || pg_temp.s112_text(coalesce(p_titel, 'ohne Titel')) || ' [' || pg_temp.s112_name(p_name) || ' ' || p_ist || coalesce(': ' || pg_temp.s112_text(p_beleg), '') || ']'
    WHEN p_ist > p_baseline THEN
      'FEHLER:' || pg_temp.s112_name(p_name) || ' ist=' || p_ist || ' soll<=' || p_baseline || ' – neue Lücke (' || pg_temp.s112_text(coalesce(p_titel, 'ohne Titel')) || ')'
      || coalesce(' ' || pg_temp.s112_text(p_beleg), '')
    WHEN p_ist = 0 THEN
      'FEHLER:' || pg_temp.s112_name(p_name) || ' BEHOBEN – in harte Prüfung umwandeln (ist=0, Baseline ' || p_baseline || ')'
    ELSE
      'FEHLER:' || pg_temp.s112_name(p_name) || ' BEHOBEN – Baseline senken auf ' || p_ist || ' (bisher ' || p_baseline || ')'
      || coalesce(' ' || pg_temp.s112_text(p_beleg), '')
  END
$f$;

-- Mutationsmodus: run.mjs ersetzt diese Funktion (CREATE OR REPLACE … SELECT '<name>') – sonst NULL.
CREATE FUNCTION pg_temp.s112_mutation() RETURNS text LANGUAGE sql AS $f$
  SELECT NULL::text
$f$;

-- Ausführlich-Modus (--ausfuehrlich): run.mjs ersetzt diese Funktion durch SELECT true – dann stehen auch
-- die OK-Namen in der Ergebniszeile.
CREATE FUNCTION pg_temp.s112_ausfuehrlich() RETURNS boolean LANGUAGE sql AS $f$
  SELECT false
$f$;

-- Wendet eine Mutation an, wenn der Lauf genau sie verlangt (run.mjs --mutationen): führt p_sql als postgres
-- aus und vermerkt sie für s112_ende (Beleg 'mutation=<name>'). Aufruf NACH dem Aufbau, VOR den Prüfungen,
-- auf oberster Ebene des DO-Blocks (nicht in einem Unterblock, sonst verfällt der Vermerk):
--   PERFORM pg_temp.s112_mutiere('kontakte_select_offen', $m$CREATE POLICY … $m$);
-- Jede Mutation muss im Dateikopf als '-- @mutation <name>: <Beschreibung> | rot: <Muster>' stehen.
CREATE FUNCTION pg_temp.s112_mutiere(p_name text, p_sql text) RETURNS boolean LANGUAGE plpgsql AS $f$
BEGIN
  IF pg_temp.s112_mutation() IS DISTINCT FROM p_name THEN
    RETURN false;
  END IF;
  PERFORM pg_temp.s112_als_postgres();
  EXECUTE p_sql;
  PERFORM set_config('s112.mutation_angewendet', p_name, true);
  RETURN true;
END $f$;

-- Letzte Anweisung jeder Testdatei: zählt die Einträge und wirft IMMER
--   RAISE P0001 'S112TEST|<datei>|ok=<n>|fehler=<m>|bekannt=<k>|dauer_ms=… ; mutation=<name|-> ; FEHLER:… ; BEKANNT:… [; OK:…]'
-- → die Transaktion wird vollständig zurückgerollt. OK-Namen nur im Ausführlich-Modus; ab 50 000 Zeichen
-- wird gekürzt ('GEKUERZT:<n> weitere Einträge'), die Zähler bleiben exakt.
-- Zu wenige Prüfungen (OK + FEHLER + BEKANNT < p_min_pruefungen) zählen als FEHLER – ein leerer Test ist rot.
-- Einträge ohne bekanntes Präfix zählen als FEHLER. Eine verlangte, aber nicht angewendete Mutation auch.
CREATE FUNCTION pg_temp.s112_ende(p_datei text, p_erg text[], p_t0 timestamptz DEFAULT NULL, p_min_pruefungen int DEFAULT 1)
RETURNS void LANGUAGE plpgsql AS $f$
DECLARE
  c_max constant int := 50000;
  v_e text;
  v_fehler text[] := '{}';
  v_bekannt text[] := '{}';
  v_ok text[] := '{}';
  v_mut text := pg_temp.s112_mutation();
  v_angewendet text := nullif(current_setting('s112.mutation_angewendet', true), '');
  v_mut_text text := '-';
  v_details text;
  v_liste text[];
  v_i int;
  v_n int;
BEGIN
  FOREACH v_e IN ARRAY coalesce(p_erg, '{}'::text[]) LOOP
    v_e := coalesce(pg_temp.s112_text(v_e), 'NULL');
    IF v_e LIKE 'OK:%' THEN
      v_ok := v_ok || v_e;
    ELSIF v_e LIKE 'FEHLER:%' THEN
      v_fehler := v_fehler || v_e;
    ELSIF v_e LIKE 'BEKANNT:%' THEN
      v_bekannt := v_bekannt || v_e;
    ELSE
      v_fehler := v_fehler || ('FEHLER:unbekannter_eintrag ' || v_e);
    END IF;
  END LOOP;
  IF coalesce(array_length(v_ok, 1), 0) + coalesce(array_length(v_fehler, 1), 0) + coalesce(array_length(v_bekannt, 1), 0)
     < coalesce(p_min_pruefungen, 1) THEN
    v_fehler := v_fehler || ('FEHLER:zu_wenige_pruefungen ist='
                 || (coalesce(array_length(v_ok, 1), 0) + coalesce(array_length(v_fehler, 1), 0) + coalesce(array_length(v_bekannt, 1), 0))
                 || ' soll>=' || coalesce(p_min_pruefungen, 1));
  END IF;
  IF v_mut IS NOT NULL THEN
    IF v_angewendet IS NOT DISTINCT FROM v_mut THEN
      v_mut_text := v_mut;
    ELSE
      v_mut_text := v_mut || '(nicht_angewendet)';
      v_fehler := v_fehler || ('FEHLER:mutation_nicht_angewendet ' || v_mut || ' – kein pg_temp.s112_mutiere(''' || v_mut || ''', …) auf oberster Ebene');
    END IF;
  END IF;

  v_details := 'dauer_ms=' || round(extract(epoch FROM clock_timestamp() - coalesce(p_t0, transaction_timestamp())) * 1000)
               || ' ; mutation=' || v_mut_text;
  v_liste := v_fehler || v_bekannt || CASE WHEN pg_temp.s112_ausfuehrlich() THEN v_ok ELSE '{}'::text[] END;
  v_n := coalesce(array_length(v_liste, 1), 0);
  v_i := 0;
  WHILE v_i < v_n LOOP
    IF length(v_details) + length(v_liste[v_i + 1]) + 3 > c_max THEN
      v_details := v_details || ' ; GEKUERZT:' || (v_n - v_i) || ' weitere Einträge';
      EXIT;
    END IF;
    v_details := v_details || ' ; ' || v_liste[v_i + 1];
    v_i := v_i + 1;
  END LOOP;

  RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE =
    'S112TEST|' || pg_temp.s112_name(p_datei)
    || '|ok=' || coalesce(array_length(v_ok, 1), 0)
    || '|fehler=' || coalesce(array_length(v_fehler, 1), 0)
    || '|bekannt=' || coalesce(array_length(v_bekannt, 1), 0)
    || '|' || v_details;
END $f$;


-- ═══ 5. Aufbau (nur als postgres) ═════════════════════════════════════════════════════════════════════
--
-- Trigger-Fallen beim Anlegen (alle belegt, siehe README):
--   * trg_tenant_plattform_admins: JEDER neue Betrieb bekommt alle plattform_admins als system_admin
--     (auf Staging admin@software112.test, im Aufbau zusätzlich der Test-Plattform-Admin).
--   * tenant_memberships_schreibmodule_default: winzer mit schreibmodule NULL bekommt alle 6 Module
--     (rieden, kellerbuch, warenwirtschaft, crm, ea, auswertungen); '{}' bleibt leer; andere Rollen → NULL.
--   * handle_new_user legt profiles(id, display_name) an; create_profile_on_signup ist toter Code (42P10, verschluckt).
--   * kundennummer_trg greift nur mit betrieb_plz – s112_betrieb lässt sie leer.
--   * bestandsprotokoll_id_seq und system_ereignisse_id_seq sind nicht transaktional: Nummernlücken, harmlos.
-- Alle Test-Datensätze tragen 's112test'/'S112TEST' im Namen – run.mjs prüft vor und nach dem Lauf, dass
-- keiner übrig ist.

CREATE FUNCTION pg_temp.s112_nur_postgres(p_funktion text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION '% nur als postgres aufrufen (vorher pg_temp.s112_als_postgres()), aktiv: %', p_funktion, current_user;
  END IF;
END $f$;

-- Neuer Betrieb (tenants + tenant_einstellungen), Name beginnt mit 'S112TEST', slug 's112test-<id>'.
-- p_stripe_status z. B. 'canceled' → Abo-Schreibsperre (der Musterhof ist davon fest ausgenommen!).
CREATE FUNCTION pg_temp.s112_betrieb(p_name text DEFAULT 'Betrieb', p_stripe_status text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  PERFORM pg_temp.s112_nur_postgres('s112_betrieb');
  INSERT INTO public.tenants (id, name, slug, stripe_status)
  VALUES (v_id, CASE WHEN p_name LIKE 'S112TEST%' THEN p_name ELSE 'S112TEST ' || coalesce(p_name, 'Betrieb') END,
          's112test-' || v_id, p_stripe_status);
  -- KAN-195: Paket-Module wie Premium an (die DB sperrt sonst E&A, Export, SumUp, Kostenrechnung und Assistent);
  -- modul_ea nur zusammen mit modul_sumup abschalten (chk_sumup_bedingt_buchhaltung). Abschalten prüft 12 (Abschnitt 6).
  INSERT INTO public.tenant_einstellungen (tenant_id, modul_ea, modul_export, modul_sumup, modul_controlling, assistent_aktiv)
  VALUES (v_id, true, true, true, true, true);
  RETURN v_id;
END $f$;

-- Mitgliedschaft anlegen (Rolle system_admin | tenant_admin | winzer | leser).
CREATE FUNCTION pg_temp.s112_mitglied(p_uid uuid, p_tenant uuid, p_rolle text,
                                      p_schreibmodule text[] DEFAULT NULL, p_aktiv boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_temp.s112_nur_postgres('s112_mitglied');
  INSERT INTO public.tenant_memberships (tenant_id, user_id, role, aktiv, schreibmodule)
  VALUES (p_tenant, p_uid, p_rolle, p_aktiv, p_schreibmodule);
END $f$;

-- Neuer Benutzer 's112test-<uuid>@software112.test' (auth.users, bestätigt) und – wenn p_rolle und p_tenant
-- gesetzt sind – eine Mitgliedschaft. p_rolle NULL: angemeldet, aber ohne Betrieb.
CREATE FUNCTION pg_temp.s112_benutzer(p_rolle text, p_tenant uuid, p_schreibmodule text[] DEFAULT NULL,
                                      p_aktiv boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_uid uuid := gen_random_uuid();
BEGIN
  PERFORM pg_temp.s112_nur_postgres('s112_benutzer');
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  VALUES (v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          's112test-' || v_uid || '@software112.test',
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), now());
  IF p_rolle IS NOT NULL AND p_tenant IS NOT NULL THEN
    PERFORM pg_temp.s112_mitglied(v_uid, p_tenant, p_rolle, p_schreibmodule, p_aktiv);
  END IF;
  RETURN v_uid;
END $f$;

-- Test-Plattform-Admin: Benutzer + plattform_admins + system_admin in den angegebenen (bestehenden) Betrieben.
-- VOR neuen Betrieben anlegen – die bekommen ihn dann über trg_tenant_plattform_admins automatisch.
CREATE FUNCTION pg_temp.s112_plattform_admin(p_betriebe uuid[] DEFAULT ARRAY['33333333-3333-4333-8333-333333333333']::uuid[])
RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_uid uuid;
  v_t uuid;
BEGIN
  v_uid := pg_temp.s112_benutzer(NULL, NULL);
  INSERT INTO public.plattform_admins (user_id, hinweis) VALUES (v_uid, 'S112TEST Plattform-Admin');
  FOREACH v_t IN ARRAY coalesce(p_betriebe, '{}'::uuid[]) LOOP
    PERFORM pg_temp.s112_mitglied(v_uid, v_t, 'system_admin');
  END LOOP;
  RETURN v_uid;
END $f$;

-- Zweiter Faktor (TOTP) für einen Benutzer; status 'verified' (zählt für s112_aal_ok) oder 'unverified' (zählt nicht).
CREATE FUNCTION pg_temp.s112_faktor(p_uid uuid, p_status text DEFAULT 'verified') RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  PERFORM pg_temp.s112_nur_postgres('s112_faktor');
  INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  VALUES (v_id, p_uid, 's112test-' || left(v_id::text, 8), 'totp', p_status::auth.factor_status, now(), now());
  RETURN v_id;
END $f$;

-- Standard-Aufbau → jsonb mit allen IDs (Zugriff: (v_a ->> 'b_w')::uuid). Nur NEUE Test-Benutzer; die vier
-- Staging-Konten bleiben unberührt.
--   m      Musterhof 33333333-3333-4333-8333-333333333333 (fest von der Abo-Sperre ausgenommen → Abo-Tests in B)
--   b      neuer Betrieb B (stripe_status NULL);  c  Betrieb C nur mit p_mit_c
--   pa     Test-Plattform-Admin (plattform_admins; system_admin in M, B und C)
--   m_sa   system_admin in M, aber KEIN Plattform-Admin
--   m_ta   tenant_admin M      m_w   winzer M (alle 6 Module)   m_wc  winzer M nur 'crm'
--   m_w0   winzer M ohne Schreibmodul ('{}')                     m_l   leser M
--   m_inak winzer M, Mitgliedschaft inaktiv
--   b_ta   tenant_admin B      b_w   winzer B (alle 6 Module)   b_l   leser B
--   mb_ta  tenant_admin in M UND B (zwei aktive Betriebe)
--   mix    winzer aktiv in B, inaktiv in M
--   ohne   angemeldet, ohne Mitgliedschaft
--   c_ta   tenant_admin C (nur mit p_mit_c)
CREATE FUNCTION pg_temp.s112_aufbau(p_mit_c boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  c_m constant uuid := '33333333-3333-4333-8333-333333333333';
  v jsonb;
  v_pa uuid;
  v_b uuid;
  v_c uuid;
  v_mb uuid;
  v_mix uuid;
BEGIN
  PERFORM pg_temp.s112_nur_postgres('s112_aufbau');
  -- KAN-195: im Musterhof (Staging-Stand kann abweichen) alle Paket-Module an – Rollen-/Schreibproben setzen sie voraus
  UPDATE public.tenant_einstellungen
     SET modul_ea = true, modul_export = true, modul_sumup = true, modul_controlling = true, assistent_aktiv = true
   WHERE tenant_id = c_m;
  v_pa := pg_temp.s112_plattform_admin(ARRAY[c_m]);
  v_b := pg_temp.s112_betrieb('S112TEST Betrieb B');
  IF p_mit_c THEN
    v_c := pg_temp.s112_betrieb('S112TEST Betrieb C');
  END IF;
  v_mb := pg_temp.s112_benutzer('tenant_admin', c_m);
  PERFORM pg_temp.s112_mitglied(v_mb, v_b, 'tenant_admin');
  v_mix := pg_temp.s112_benutzer('winzer', v_b);
  PERFORM pg_temp.s112_mitglied(v_mix, c_m, 'winzer', NULL, false);
  v := jsonb_build_object(
    'm', c_m, 'b', v_b, 'c', v_c, 'pa', v_pa,
    'm_sa', pg_temp.s112_benutzer('system_admin', c_m),
    'm_ta', pg_temp.s112_benutzer('tenant_admin', c_m),
    'm_w', pg_temp.s112_benutzer('winzer', c_m),
    'm_wc', pg_temp.s112_benutzer('winzer', c_m, ARRAY['crm']),
    'm_w0', pg_temp.s112_benutzer('winzer', c_m, '{}'::text[]),
    'm_l', pg_temp.s112_benutzer('leser', c_m),
    'm_inak', pg_temp.s112_benutzer('winzer', c_m, NULL, false),
    'b_ta', pg_temp.s112_benutzer('tenant_admin', v_b),
    'b_w', pg_temp.s112_benutzer('winzer', v_b),
    'b_l', pg_temp.s112_benutzer('leser', v_b),
    'mb_ta', v_mb, 'mix', v_mix,
    'ohne', pg_temp.s112_benutzer(NULL, NULL));
  IF p_mit_c THEN
    v := v || jsonb_build_object('c_ta', pg_temp.s112_benutzer('tenant_admin', v_c));
  END IF;
  RETURN v;
END $f$;


-- ═══ 6. Katalog & Beispielzeilen ══════════════════════════════════════════════════════════════════════

-- Klasse einer Tabelle in public:
--   T = hat tenant_id (Mandantentabelle; bei nullable tenant_id gibt es zusätzlich globale Zeilen)
--   K = Kindtabelle ohne tenant_id mit einspaltigem FK auf eine T-Tabelle (Mandant über die Eltern)
--   G = global/sonderbar ohne Mandantenbezug über tenant_id (tenants selbst, rebsorten, profiles …)
CREATE FUNCTION pg_temp.s112_klasse(p_tab text) RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT CASE
    WHEN c.oid IS NULL THEN NULL
    WHEN c.relname = 'tenants' THEN 'G'
    WHEN EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped) THEN 'T'
    WHEN EXISTS (SELECT 1 FROM pg_constraint k
                   JOIN pg_class p ON p.oid = k.confrelid
                   JOIN pg_namespace pn ON pn.oid = p.relnamespace AND pn.nspname = 'public'
                  WHERE k.conrelid = c.oid AND k.contype = 'f' AND array_length(k.conkey, 1) = 1
                    AND EXISTS (SELECT 1 FROM pg_attribute t WHERE t.attrelid = p.oid AND t.attname = 'tenant_id' AND NOT t.attisdropped))
      THEN 'K'
    ELSE 'G'
  END
  FROM (SELECT to_regclass(format('public.%I', p_tab)) AS oid) x
  LEFT JOIN pg_class c ON c.oid = x.oid
$f$;

-- Alle Tabellen in public mit RLS (auch partitionierte, relkind 'p'): Klasse, nullable tenant_id, Eltern-FK (nur K: Spalte → Tabelle.Spalte,
-- bevorzugt ON DELETE CASCADE, dann NOT NULL), die erste für authenticated updatebare Spalte (tenant_id vor
-- id vor Spaltenreihenfolge – für No-op-UPDATE-Proben 'SET x = x') und die Primärschlüsselspalten.
CREATE FUNCTION pg_temp.s112_mandantentabellen()
RETURNS TABLE (tabelle text, klasse text, tid_nullable boolean, eltern_spalte text, eltern_tabelle text,
               eltern_ref text, upd_spalte text, pk text[])
LANGUAGE sql STABLE AS $f$
  SELECT c.relname::text,
         pg_temp.s112_klasse(c.relname::text),
         (SELECT NOT a.attnotnull FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped),
         e.spalte, e.tabelle, e.ref,
         (SELECT a.attname::text FROM pg_attribute a
           WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
             AND has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE')
           ORDER BY (a.attname = 'tenant_id') DESC, (a.attname = 'id') DESC, a.attnum LIMIT 1),
         (SELECT array_agg(a.attname::text ORDER BY array_position(ix.indkey::int2[], a.attnum))
            FROM pg_index ix JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = ANY (ix.indkey)
           WHERE ix.indrelid = c.oid AND ix.indisprimary)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN LATERAL (
      SELECT a.attname::text AS spalte, p.relname::text AS tabelle, pa.attname::text AS ref
        FROM pg_constraint k
        JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
        JOIN pg_class p ON p.oid = k.confrelid
        JOIN pg_namespace pn ON pn.oid = p.relnamespace AND pn.nspname = 'public'
        JOIN pg_attribute pa ON pa.attrelid = k.confrelid AND pa.attnum = k.confkey[1]
       WHERE k.conrelid = c.oid AND k.contype = 'f' AND array_length(k.conkey, 1) = 1
         AND pg_temp.s112_klasse(c.relname::text) = 'K'
         AND EXISTS (SELECT 1 FROM pg_attribute t WHERE t.attrelid = p.oid AND t.attname = 'tenant_id' AND NOT t.attisdropped)
       ORDER BY (k.confdeltype = 'c') DESC, a.attnotnull DESC, k.conname
       LIMIT 1) e ON true
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
   ORDER BY c.relname
$f$;

-- WHERE-Bedingung auf den Primärschlüssel einer Zeile (jsonb aus to_jsonb), TYPISIERT:
-- '"id" = ''…''::uuid' – nicht ::text, sonst findet man z. B. die timestamptz-Spalte in wetter_stunden nicht.
CREATE FUNCTION pg_temp.s112_pk_where(p_tab text, p_zeile jsonb) RETURNS text LANGUAGE plpgsql STABLE AS $f$
DECLARE
  v text;
  v_fehlt text;
BEGIN
  SELECT string_agg(format('%I = %L::%s', a.attname, p_zeile ->> a.attname::text, format_type(a.atttypid, a.atttypmod)),
                    ' AND ' ORDER BY array_position(ix.indkey::int2[], a.attnum)),
         string_agg(a.attname::text, ', ') FILTER (WHERE p_zeile ->> a.attname::text IS NULL)
    INTO v, v_fehlt
    FROM pg_index ix JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = ANY (ix.indkey)
   WHERE ix.indrelid = to_regclass(format('public.%I', p_tab)) AND ix.indisprimary;
  IF v IS NULL THEN
    RAISE EXCEPTION 's112_pk_where: public.% hat keinen Primärschlüssel', p_tab;
  END IF;
  IF v_fehlt IS NOT NULL THEN
    RAISE EXCEPTION 's112_pk_where: Zeile für % ohne Wert für %', p_tab, v_fehlt;
  END IF;
  RETURN v;
END $f$;

-- Zeilen, die s112_zeile/s112_beispiel NICHT als vorhandene Elternzeile wählen dürfen (Ids als Text, transaktionslokal
-- in s112test.keine_eltern). Für Probezeilen, deren Lösch-Ergebnis geprüft wird: die Wahl „vorhandene Zeile“ läuft
-- über ORDER BY id, bei zufälligen UUIDs also mal auf die Probezeile, mal nicht – hängt sich eine später angelegte
-- Zeile an sie, greift eine Löschsperre (T statt k1, Dateien 13 und 14 kippten so zwischen grün und rot). Scheitert
-- ein Unterblock mit EXCEPTION nach dem Aufruf, setzt sein Rollback die Einstellung zurück – also erst aufrufen,
-- wenn die Zeile sicher bleibt.
CREATE FUNCTION pg_temp.s112_keine_eltern_liste() RETURNS text[] LANGUAGE sql STABLE AS $f$
  SELECT string_to_array(coalesce(current_setting('s112test.keine_eltern', true), ''), ',')
$f$;

CREATE FUNCTION pg_temp.s112_keine_eltern(p_ids text[]) RETURNS void LANGUAGE sql AS $f$
  SELECT set_config('s112test.keine_eltern',
    array_to_string(pg_temp.s112_keine_eltern_liste() || coalesce(p_ids, '{}'), ','), true);
$f$;

-- Generische Beispielzeile (als postgres, INSERT … RETURNING → jsonb). p_werte setzt/überschreibt Spalten
-- (Werte als Text, typisiert gecastet; Arrays als '{a,b}'). Fehlende Pflichtspalten (NOT NULL ohne Default):
--   * FK auf auth.users → ein Mitglied des Betriebs, auf tenants → p_tenant,
--   * FK auf T-Tabelle → vorhandene Zeile DESSELBEN Betriebs (außer s112_keine_eltern_liste()), sonst rekursiv neu (Tiefe ≤ 3),
--   * FK auf K-Tabelle → rekursiv neu (hängt so am selben Betrieb), auf G-Tabelle → irgendeine Zeile,
--   * sonst ein Literal aus einem CHECK der Spalte, der erste Enum-Wert oder ein Typ-Standardwert
--     (Text 'S112TEST <tabelle> <zufall>', Zahl 1, Datum heute, false, '{}' …).
-- p_neue_eltern = true: direkte FKs auf T-Tabellen immer mit NEUEN Elternzeilen (gegen Schlüsselkonflikte in
-- Verknüpfungstabellen mit vorhandenen Daten, z. B. behandlung_grundstuecke im Musterhof).
-- Mehrspaltige CHECKs (konto_umbuchungen, traubenverkauf) und Eigentümer-/Statusspalten: s112_beispiel.
CREATE FUNCTION pg_temp.s112_zeile(p_tab text, p_tenant uuid, p_werte jsonb DEFAULT '{}', p_tiefe int DEFAULT 0,
                                   p_neue_eltern boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_oid oid := to_regclass(format('public.%I', p_tab));
  v_werte jsonb := coalesce(p_werte, '{}'::jsonb);
  r record;
  v_fk record;
  v_cols text[] := '{}';
  v_vals text[] := '{}';
  v_k text;
  v_typ text;
  v_val text;
  v_lit text;
  v_id text;
  v_len int;
  v_klasse text;
  v_erg jsonb;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 's112_zeile: Tabelle public.% gibt es nicht', p_tab;
  END IF;
  IF p_tiefe > 3 THEN
    RAISE EXCEPTION 's112_zeile: FK-Kette zu tief bei %', p_tab;
  END IF;
  FOR v_k IN SELECT jsonb_object_keys(v_werte) LOOP
    SELECT format_type(a.atttypid, a.atttypmod) INTO v_typ FROM pg_attribute a
     WHERE a.attrelid = v_oid AND a.attname = v_k AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_typ IS NULL THEN
      RAISE EXCEPTION 's112_zeile: Spalte %.% gibt es nicht', p_tab, v_k;
    END IF;
    v_cols := v_cols || v_k;
    v_vals := v_vals || (CASE WHEN jsonb_typeof(v_werte -> v_k) = 'null' THEN 'NULL' ELSE quote_literal(v_werte ->> v_k) END
                         || '::' || v_typ);
  END LOOP;
  IF p_tenant IS NOT NULL AND NOT ('tenant_id' = ANY (v_cols))
     AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_oid AND a.attname = 'tenant_id' AND NOT a.attisdropped) THEN
    v_cols := v_cols || 'tenant_id'::text;
    v_vals := v_vals || (quote_literal(p_tenant) || '::uuid');
  END IF;

  FOR r IN SELECT a.attnum, a.attname::text AS attname, a.atttypid, a.atttypmod,
                  format_type(a.atttypid, a.atttypmod) AS typ, t.typtype, t.typcategory
             FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
            WHERE a.attrelid = v_oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attnotnull
              AND NOT a.atthasdef AND a.attidentity = '' AND a.attgenerated = ''
              AND NOT (a.attname::text = ANY (v_cols))
            ORDER BY a.attnum LOOP
    v_val := NULL;
    v_id := NULL;
    v_lit := NULL;
    -- einspaltiger FK bevorzugt; sonst ein mehrspaltiger (z. B. lesen.jahrgang_id → weinjahrgaenge (id, tenant_id),
    -- die übrigen Spalten – tenant_id – kommen aus demselben Betrieb)
    SELECT pn.nspname::text AS refschema, p.relname::text AS reftab,
           (SELECT pa.attname::text FROM pg_attribute pa
             WHERE pa.attrelid = k.confrelid AND pa.attnum = k.confkey[array_position(k.conkey, r.attnum)]) AS refcol
      INTO v_fk
      FROM pg_constraint k JOIN pg_class p ON p.oid = k.confrelid JOIN pg_namespace pn ON pn.oid = p.relnamespace
     WHERE k.conrelid = v_oid AND k.contype = 'f' AND r.attnum = ANY (k.conkey)
     ORDER BY cardinality(k.conkey), k.conname
     LIMIT 1;
    IF FOUND AND v_fk.refschema = 'public' AND v_fk.reftab = 'lesen' THEN
      -- KAN-129: lese_id (FK lese_id + jahrgang_id) – die erste Lese des schon gewählten Jahrgangs; sonst setzt der
      -- Trigger a_lese_zuordnen sie. Seit KAN-148 C1d bleiben Test-Lesen mit (nicht löschbaren) Lesezeilen stehen –
      -- bei mehreren Lesen bräuchte der Trigger ein passendes Datum.
      v_val := CASE WHEN 'jahrgang_id' = ANY (v_cols)
        THEN format('(SELECT l.id FROM public.lesen l WHERE l.jahrgang_id = %s ORDER BY l.lfd_nr LIMIT 1)',
                    v_vals[array_position(v_cols, 'jahrgang_id')])
        ELSE 'NULL' END;
    ELSIF FOUND THEN
      v_klasse := CASE WHEN v_fk.refschema = 'public' THEN pg_temp.s112_klasse(v_fk.reftab) END;
      IF v_fk.refschema = 'auth' AND v_fk.reftab = 'users' THEN
        SELECT m.user_id::text INTO v_id FROM public.tenant_memberships m
         WHERE m.tenant_id = p_tenant ORDER BY m.role, m.user_id LIMIT 1;
      ELSIF v_fk.refschema = 'public' AND v_fk.reftab = 'tenants' THEN
        v_id := p_tenant::text;
      ELSIF v_klasse = 'T' THEN
        IF NOT p_neue_eltern THEN
          EXECUTE format('SELECT %I::text FROM public.%I WHERE tenant_id = %L AND %I::text <> ALL (pg_temp.s112_keine_eltern_liste()) ORDER BY 1 LIMIT 1',
                         v_fk.refcol, v_fk.reftab, p_tenant, v_fk.refcol)
            INTO v_id;
        END IF;
        IF v_id IS NULL THEN
          v_id := pg_temp.s112_zeile(v_fk.reftab, p_tenant, '{}'::jsonb, p_tiefe + 1) ->> v_fk.refcol;
        END IF;
      ELSIF v_klasse = 'K' THEN
        v_id := pg_temp.s112_zeile(v_fk.reftab, p_tenant, '{}'::jsonb, p_tiefe + 1) ->> v_fk.refcol;
      ELSE
        EXECUTE format('SELECT %I::text FROM %I.%I ORDER BY 1 LIMIT 1', v_fk.refcol, v_fk.refschema, v_fk.reftab) INTO v_id;
      END IF;
      v_val := quote_nullable(v_id);
    ELSE
      SELECT (regexp_match(pg_get_constraintdef(k.oid), '''([^'']*)'''))[1] INTO v_lit
        FROM pg_constraint k
       WHERE k.conrelid = v_oid AND k.contype = 'c' AND k.conkey = ARRAY[r.attnum]::int2[]
         AND pg_get_constraintdef(k.oid) LIKE '%''%'
       ORDER BY k.conname LIMIT 1;
      -- Jahr/Jahrgang (oft eindeutig je Betrieb, z. B. weinjahrgaenge): nächstes freies Jahr des Betriebs
      IF v_lit IS NULL AND r.attname IN ('jahr', 'jahrgang') AND r.typcategory = 'N' THEN
        IF p_tenant IS NOT NULL
           AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_oid AND a.attname = 'tenant_id' AND NOT a.attisdropped) THEN
          EXECUTE format('SELECT (coalesce(max(%I), 2025) + 1)::text FROM public.%I WHERE tenant_id = %L', r.attname, p_tab, p_tenant)
            INTO v_lit;
        ELSE
          v_lit := '2026';
        END IF;
      END IF;
      v_len := CASE WHEN r.atttypid IN ('varchar'::regtype, 'bpchar'::regtype) AND r.atttypmod > 4 THEN r.atttypmod - 4 END;
      v_val := CASE
        WHEN v_lit IS NOT NULL THEN quote_literal(v_lit)
        WHEN r.typtype = 'e' THEN (SELECT quote_literal(e.enumlabel) FROM pg_enum e WHERE e.enumtypid = r.atttypid ORDER BY e.enumsortorder LIMIT 1)
        WHEN r.attname = 'monat' THEN '1'
        WHEN r.typcategory = 'A' THEN '''{}'''
        WHEN r.typcategory = 'S' THEN quote_literal(left('S112TEST ' || p_tab || ' ' || left(gen_random_uuid()::text, 8), coalesce(v_len, 200)))
        WHEN r.typcategory = 'N' THEN '1'
        WHEN r.typ = 'date' THEN 'pg_temp.s112_heute()'
        WHEN r.typ LIKE 'timestamp%' THEN 'now()'
        WHEN r.typ LIKE 'time%' THEN 'current_time'
        WHEN r.typ = 'boolean' THEN 'false'
        WHEN r.typ IN ('jsonb', 'json') THEN '''{}'''
        WHEN r.typ = 'uuid' THEN quote_literal(gen_random_uuid())
        ELSE 'NULL'
      END;
    END IF;
    v_cols := v_cols || r.attname;
    v_vals := v_vals || (v_val || '::' || r.typ);
  END LOOP;

  IF coalesce(array_length(v_cols, 1), 0) = 0 THEN
    EXECUTE format('INSERT INTO public.%I AS x DEFAULT VALUES RETURNING to_jsonb(x.*)', p_tab) INTO v_erg;
  ELSE
    EXECUTE format('INSERT INTO public.%I AS x (%s) VALUES (%s) RETURNING to_jsonb(x.*)', p_tab,
                   (SELECT string_agg(quote_ident(c), ', ') FROM unnest(v_cols) c), array_to_string(v_vals, ', '))
      INTO v_erg;
  END IF;
  RETURN v_erg;
END $f$;

-- Vollständige Beispielzeile für Positivkontrollen (als postgres): wie s112_zeile, zusätzlich
--   * Eigentümerspalten (jeder einspaltige FK auf auth.users, z. B. user_id, erstellt_von, empfaenger_id) = p_persona
--     – nötig, wo WITH CHECK auf auth.uid() prüft (assistent_unterhaltungen, benachrichtigungen …),
--   * ama_erntemeldungen: status 'entwurf' (nur Entwürfe sind änderbar),
--   * konto_umbuchungen: zwei verschiedene Konten des Betriebs, betrag 1 (CHECK von_konto_id <> nach_konto_id),
--   * traubenverkauf, pressung_weingaerten: weingarten_id des Betriebs (CHECK: genau eine von
--     weingarten_id/zukauf_posten_id),
--   * verschneidung_quellen: menge_liter 1 (CHECK menge_liter > 0),
--   * betriebsmittel_lager_bewegungen: typ 'anfangsbestand' (Einkäufe nur per RPC, RLS lehnt typ 'einkauf' ab; KAN-167),
--   * meldung_abgaben: Abgabe einer Bestandsmeldung ohne AMA-Bezug (KAN-37 B),
--   * kellerbuch_buchungen: Korrekturzeile INV_PLUS einer erfundenen Charge mit freier Belegnummer (KAN-40),
--   * kellerbuch_abschluesse: Abschluss weit in der Vergangenheit mit freiem Datum (KAN-192),
--   * reifemessungen: kmw 17 (eine Reife-Messung braucht ein Mostgewicht; KAN-203),
--   * sonstige_artikel_bewegungen: Zugang über 1 (Vorzeichen-CHECK; KAN-115),
--   * produktion_eingaenge: Wein-Eingang über 1 L (CHECKs Wein ↔ Quell-Charge; KAN-118),
--   * lieferadressen: genau ein Partner – ein neuer Kontakt, keine Firma (CHECK lieferadressen_ein_partner; KAN-176),
--   * auftraege: ein neuer Kontakt als Kunde, eigene Nummer, offen; auftrag_positionen: Menge 1 (KAN-418),
--   * auftrag_lieferungen: eigene Auftragsposition samt ihrem Auftrag, Verkauf als freie UUID (KAN-418 Teil 2),
--   * tenant_einstellungen: die vorhandene Zeile des Betriebs (je Betrieb genau eine),
--   * tenant_memberships: neuer Test-Benutzer als leser (user_id aus p_werte, sonst neu; nie p_persona).
-- p_werte überschreibt alles. Bei einem Schlüsselkonflikt ein zweiter Versuch mit neuen Elternzeilen
-- (s112_zeile … p_neue_eltern); kollidiert ein Wert selbst (z. B. module_flags.module), ihn über p_werte setzen.
CREATE FUNCTION pg_temp.s112_beispiel(p_tab text, p_tenant uuid, p_persona uuid DEFAULT NULL, p_werte jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql AS $f$
DECLARE
  v_oid oid := to_regclass(format('public.%I', p_tab));
  v_w jsonb := '{}'::jsonb;
  r record;
  v_a text;
  v_b text;
  v_erg jsonb;
BEGIN
  PERFORM pg_temp.s112_nur_postgres('s112_beispiel');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 's112_beispiel: Tabelle public.% gibt es nicht', p_tab;
  END IF;
  IF p_tab = 'tenant_einstellungen' THEN
    SELECT to_jsonb(t.*) INTO v_erg FROM public.tenant_einstellungen t WHERE t.tenant_id = p_tenant;
    IF v_erg IS NOT NULL THEN
      RETURN v_erg;
    END IF;
  ELSIF p_tab = 'tenant_memberships' THEN
    RETURN pg_temp.s112_zeile('tenant_memberships', p_tenant,
             jsonb_build_object('user_id', coalesce(p_werte ->> 'user_id', pg_temp.s112_benutzer(NULL, NULL)::text), 'role', 'leser')
             || coalesce(p_werte, '{}'::jsonb));
  END IF;
  IF p_persona IS NOT NULL THEN
    FOR r IN SELECT a.attname::text AS spalte
               FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
              WHERE k.conrelid = v_oid AND k.contype = 'f' AND array_length(k.conkey, 1) = 1
                AND k.confrelid = 'auth.users'::regclass LOOP
      v_w := v_w || jsonb_build_object(r.spalte, p_persona);
    END LOOP;
  END IF;
  IF p_tab = 'ama_erntemeldungen' THEN
    -- KAN-37 C: eingereicht_von ist keine Eigentümerspalte – setzt nur das Einreichen
    v_w := v_w || '{"status": "entwurf", "eingereicht_von": null}'::jsonb;
  ELSIF p_tab = 'konto_umbuchungen' THEN
    SELECT k.id::text INTO v_a FROM public.konten k WHERE k.tenant_id = p_tenant AND k.id::text <> ALL (pg_temp.s112_keine_eltern_liste()) ORDER BY k.id LIMIT 1;
    IF v_a IS NULL THEN
      v_a := pg_temp.s112_zeile('konten', p_tenant) ->> 'id';
    END IF;
    SELECT k.id::text INTO v_b FROM public.konten k WHERE k.tenant_id = p_tenant AND k.id::text <> v_a AND k.id::text <> ALL (pg_temp.s112_keine_eltern_liste()) ORDER BY k.id LIMIT 1;
    IF v_b IS NULL THEN
      v_b := pg_temp.s112_zeile('konten', p_tenant) ->> 'id';
    END IF;
    v_w := v_w || jsonb_build_object('von_konto_id', v_a, 'nach_konto_id', v_b, 'betrag', 1);
  ELSIF p_tab = 'benutzer_dashboard' THEN
    v_w := v_w || '{"layout": []}'::jsonb;   -- KAN-388: CHECK Array
  ELSIF p_tab = 'sonstige_artikel_bewegungen' THEN
    v_w := v_w || '{"art": "zugang", "menge": 1}'::jsonb;   -- KAN-115: CHECK Vorzeichen/Bezug
  ELSIF p_tab = 'produktion_eingaenge' THEN   -- KAN-118: CHECK produktion_eingaenge_wein / _wein_liter
    v_w := v_w || jsonb_build_object('art', 'wein', 'menge', 1, 'einheit', 'l', 'volumen_liter', 1,
      'weinausbau_id', pg_temp.s112_zeile('weinausbau', p_tenant) ->> 'id', 'kellermittel_id', pg_temp.s112_zeile('kellermittel', p_tenant) ->> 'id');
  ELSIF p_tab = 'auftraege' THEN   -- KAN-418: CHECK auftraege_ein_kunde, Nummer je Betrieb eindeutig
    v_w := v_w || jsonb_build_object('kontakt_id', pg_temp.s112_zeile('kontakte', p_tenant) ->> 'id', 'firma_id', NULL,
      'nummer', 'S112TEST-' || left(gen_random_uuid()::text, 8), 'art', 'auftrag', 'status', 'offen', 'storniert_am', NULL,
      'abgeschlossen_am', NULL, 'abgeschlossen_von', NULL);
  ELSIF p_tab = 'auftrag_positionen' THEN   -- KAN-418: CHECK Menge und geliefert
    -- der Auftrag dazu über s112_beispiel (der allgemeine Elternweg kennt den CHECK auftraege_ein_kunde nicht)
    v_w := v_w || '{"name": "S112TEST Position", "menge": 1, "geliefert": 0}'::jsonb;
    IF NOT coalesce(p_werte, '{}'::jsonb) ? 'auftrag_id' THEN
      v_w := v_w || jsonb_build_object('auftrag_id', pg_temp.s112_beispiel('auftraege', p_tenant, p_persona) ->> 'id');
    END IF;
  ELSIF p_tab = 'auftrag_lieferungen' THEN   -- KAN-418 Teil 2: Position und Auftrag gehören zusammen, Verkauf ohne FK
    IF NOT coalesce(p_werte, '{}'::jsonb) ? 'auftrag_position_id' THEN
      v_erg := pg_temp.s112_beispiel('auftrag_positionen', p_tenant, p_persona);
      v_w := v_w || jsonb_build_object('auftrag_position_id', v_erg ->> 'id', 'auftrag_id', v_erg ->> 'auftrag_id');
      v_erg := NULL;
    END IF;
    v_w := v_w || jsonb_build_object('verkaufsposten_id', gen_random_uuid(), 'menge', 1, 'zurueckgenommen_am', NULL);
  ELSIF p_tab = 'export_registrierungen' THEN   -- KAN-437: CHECK Art (und Bezeichnung bei „sonstige“)
    v_w := v_w || jsonb_build_object('art', 'fda', 'nummer', 'S112TEST-' || left(gen_random_uuid()::text, 8), 'bezeichnung', NULL);
  ELSIF p_tab = 'export_nachweise' THEN   -- KAN-440: CHECK Ablagepfad <betrieb>/<auftrag>/…, Art
    IF NOT coalesce(p_werte, '{}'::jsonb) ? 'exportauftrag_id' THEN
      v_w := v_w || jsonb_build_object('exportauftrag_id', pg_temp.s112_beispiel('exportauftraege', p_tenant, p_persona,
        jsonb_build_object('status', 'entwurf', 'storniert_am', NULL, 'abschluss_ohne_nachweis', NULL, 'ausfuhr_mrn', NULL)) ->> 'id');
    END IF;
    v_w := v_w || jsonb_build_object('art', 'sonstiger', 'datum', pg_temp.s112_heute(), 'dateiname', 'S112TEST.pdf',
      'datei_pfad', p_tenant::text || '/' || (v_w ->> 'exportauftrag_id') || '/s112test-' || gen_random_uuid()::text || '.pdf');
  ELSIF p_tab = 'lieferadressen' THEN   -- KAN-176: CHECK lieferadressen_ein_partner
    v_w := v_w || jsonb_build_object('kontakt_id', pg_temp.s112_zeile('kontakte', p_tenant) ->> 'id', 'firma_id', NULL,
      'strasse', 'S112TEST-Gasse 1', 'plz', '1010', 'ort', 'Wien', 'land', 'AT');
  ELSIF p_tab = 'reifemessungen' THEN
    v_w := v_w || '{"kmw": 17}'::jsonb;   -- KAN-203: CHECK reifemessungen_mostgewicht_pflicht
  ELSIF p_tab IN ('traubenverkauf', 'pressung_weingaerten') THEN
    SELECT w.id::text INTO v_a FROM public.weingarten w WHERE w.tenant_id = p_tenant AND w.id::text <> ALL (pg_temp.s112_keine_eltern_liste()) ORDER BY w.id LIMIT 1;
    IF v_a IS NULL THEN
      v_a := pg_temp.s112_zeile('weingarten', p_tenant) ->> 'id';
    END IF;
    v_w := v_w || jsonb_build_object('weingarten_id', v_a);
  ELSIF p_tab IN ('assistent_nachrichten', 'assistent_aktionen') AND p_persona IS NOT NULL
        AND NOT coalesce(p_werte, '{}'::jsonb) ? 'unterhaltung_id' THEN
    -- KAN-159 B14: Verläufe sind privat – die Unterhaltung gehört derselben Person
    v_w := v_w || jsonb_build_object('unterhaltung_id', pg_temp.s112_beispiel('assistent_unterhaltungen', p_tenant, p_persona) ->> 'id');
  ELSIF p_tab = 'verschneidung_quellen' THEN
    v_w := v_w || '{"menge_liter": 1}'::jsonb;
  ELSIF p_tab = 'betriebsmittel_lager_bewegungen' THEN   -- KAN-167
    v_w := v_w || '{"typ": "anfangsbestand"}'::jsonb;
  ELSIF p_tab = 'rebsorten' THEN   -- KAN-89: Testsorte nicht amtlich (kein Kürzel), nur weiß/rot
    v_w := v_w || '{"kuerzel": null, "kuerzel_amtlich": false, "farbe": "weiss"}'::jsonb;
  ELSIF p_tab = 'meldung_abgaben' THEN   -- KAN-37 B: Abgabe ohne AMA-Bezug (CHECKs auf Meldung, jsonb-Typen, Spalten)
    v_w := v_w || jsonb_build_object('meldung', 'bestandsmeldung', 'parameter', '{}'::jsonb, 'zeilen', '[]'::jsonb, 'warnungen', '[]'::jsonb,
      'spalten', '[{"kopf": "S112TEST", "typ": "text"}]'::jsonb, 'profil', 'EXCEL_AT', 'dateiname', 'S112TEST.csv', 'csv_text', 'S112TEST',
      'eingereicht_am', pg_temp.s112_heute());
  ELSIF p_tab = 'kellerbuch_buchungen' THEN   -- KAN-40: CHECK bestand/Bezug, eindeutige Belegnummer je Betrieb
    v_w := v_w || jsonb_build_object('bestand', 'offen', 'weinausbau_id', gen_random_uuid(), 'fuellung_id', NULL, 'menge_stk', 0,
      'buchungsart_code', 'INV_PLUS', 'quelle_tabelle', 's112test', 'storno_von_id', NULL, 'pos', 1, 'datum', pg_temp.s112_heute(),
      'beleg_nr', 1 + coalesce((SELECT max(k.beleg_nr) FROM public.kellerbuch_buchungen k WHERE k.tenant_id = p_tenant), 0)
                    + (random() * 100000)::integer);
  ELSIF p_tab = 'kellerbuch_abschluesse' THEN   -- KAN-192: eindeutiges Datum je Betrieb, weit vor jeder Bewegung
    v_w := v_w || jsonb_build_object('abgeschlossen_bis', DATE '1990-01-01' - (random() * 3000)::integer, 'bemerkung', 'S112TEST');
  END IF;
  BEGIN
    RETURN pg_temp.s112_zeile(p_tab, p_tenant, v_w || coalesce(p_werte, '{}'::jsonb));
  EXCEPTION WHEN unique_violation THEN
    -- vorhandene Elternzeilen sind schon verknüpft (Musterhof): einmal mit neuen Eltern
    RETURN pg_temp.s112_zeile(p_tab, p_tenant, v_w || coalesce(p_werte, '{}'::jsonb), 0, true);
  END;
END $f$;

-- INSERT-Anweisung für eine Kopie von p_zeile mit p_aenderungen (für s112_versuch, läuft mit der aktiven
-- Rolle): per jsonb_populate_record, ohne generated/identity-always-Spalten; Primärschlüsselspalten mit
-- Default (id) werden neu vergeben, außer p_aenderungen setzt sie. Beispiel – Kopie in fremden Betrieb:
--   pg_temp.s112_versuch(pg_temp.s112_klon_sql('kontakte', v_zeile, jsonb_build_object('tenant_id', v_m)))  → 'R'
CREATE FUNCTION pg_temp.s112_klon_sql(p_tab text, p_zeile jsonb, p_aenderungen jsonb DEFAULT '{}') RETURNS text
LANGUAGE plpgsql STABLE AS $f$
DECLARE
  v_oid oid := to_regclass(format('public.%I', p_tab));
  v_aend jsonb := coalesce(p_aenderungen, '{}'::jsonb);
  v_cols text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 's112_klon_sql: Tabelle public.% gibt es nicht', p_tab;
  END IF;
  -- KAN-21: die Rechnungsnummer vergibt der Trigger a_rechnungsnummer – eine Kopie übernimmt sie nicht (API lehnt ab)
  IF p_tab = 'verkaufsposten' AND NOT v_aend ? 'rechnungsnummer' THEN
    v_aend := v_aend || '{"rechnungsnummer": null}'::jsonb;
  END IF;
  -- KAN-102: ebenso Lieferscheinnummer und Rechnung (Trigger a_lieferscheinnummer bzw. b_rechnung_anlegen)
  IF p_tab = 'verkaufsposten' AND NOT v_aend ? 'lieferscheinnummer' THEN
    v_aend := v_aend || '{"lieferscheinnummer": null}'::jsonb;
  END IF;
  IF p_tab = 'verkaufsposten' AND NOT v_aend ? 'rechnung_id' THEN
    v_aend := v_aend || '{"rechnung_id": null}'::jsonb;
  END IF;
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = v_oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '' AND a.attidentity <> 'a'
     AND NOT (a.atthasdef AND NOT (v_aend ? a.attname::text)
              AND EXISTS (SELECT 1 FROM pg_index ix WHERE ix.indrelid = v_oid AND ix.indisprimary AND a.attnum = ANY (ix.indkey)));
  RETURN format('INSERT INTO public.%I AS x (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I, %L::jsonb)',
                p_tab, v_cols, v_cols, p_tab, (coalesce(p_zeile, '{}'::jsonb) || v_aend)::text);
END $f$;

-- Kopie einfügen und als jsonb zurückgeben (RETURNING braucht SELECT-Recht – meist als postgres).
CREATE FUNCTION pg_temp.s112_klon(p_tab text, p_zeile jsonb, p_aenderungen jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql AS $f$
DECLARE
  v_erg jsonb;
BEGIN
  EXECUTE pg_temp.s112_klon_sql(p_tab, p_zeile, p_aenderungen) || ' RETURNING to_jsonb(x.*)' INTO v_erg;
  RETURN v_erg;
END $f$;


-- ═══ 7. Soll-Daten (eine Quelle für alle Testdateien) ═════════════════════════════════════════════════
--
-- Pflege (siehe README): neue Tabelle → s112_soll ergänzen (sonst 01 und 12 rot); neue SECURITY-DEFINER-RPC
-- → s112_soll_rpc (sonst 01 und 18 rot); neues Geheimnis → s112_soll_liste('geheimnis_spalten') (01, 16);
-- Lücke behoben → Liste/Baseline hier senken bzw. s112_luecke in eine harte Prüfung umwandeln.
-- Stand: Staging 28.09.2026 (106 Tabellen mit RLS, 52 SECURITY-DEFINER-Funktionen in public).

-- Rollenmatrix je Tabelle und Aktion (Stand inventar/matrix.txt, aus den Policies abgeleitet):
--   rollen: SA = system_admin, TA = tenant_admin, W = winzer, W* = winzer nur mit passendem Schreibmodul,
--           L = leser, PA = Plattform-Admin (plattform_admins); '{}' = niemand per API
--   module: Schreibmodule der RESTRICTIVE-Policies (s112_darf_schreiben, eines genügt; 'betrieb' = jeder
--           winzer); '{}' = keine Modulprüfung
--   roh:    Kurzform wie in der Matrix, z. B. 'SA,TA,W*{crm|warenwirtschaft}' oder '-{crm}'
CREATE FUNCTION pg_temp.s112_soll()
RETURNS TABLE (tabelle text, aktion text, rollen text[], module text[], roh text)
LANGUAGE sql IMMUTABLE AS $f$
  WITH m (tabelle, i, u, d) AS (VALUES
    ('aktivitaet_dokumente',          'SA,TA,W*{crm|warenwirtschaft}',          '-{crm|warenwirtschaft}',                 'SA,TA,W*{crm|warenwirtschaft}'),
    ('aktivitaeten',                  'SA,TA,W*{crm|warenwirtschaft}',          'SA,TA,W*{crm|warenwirtschaft}',          'SA,TA,W*{crm|warenwirtschaft}'),
    ('ama_erntemeldungen',            'SA,TA,W*{rieden}',                       'SA,TA,W*{rieden}',                       'SA,TA{rieden}'),
    ('ama_meldepositionen',           'SA,TA,W*{rieden}',                       'SA,TA,W*{rieden}',                       '-{rieden}'),
    ('assistent_aktionen',            'SA,TA,W*{kellerbuch}',                   '-{kellerbuch}',                          '-{kellerbuch}'),
    ('assistent_korrekturen',         'SA,TA,W*{kellerbuch}',                   'SA,TA,W*{kellerbuch}',                   'SA,TA,W*{kellerbuch}'),
    ('assistent_nachrichten',         'SA,TA,W*{kellerbuch}',                   '-{kellerbuch}',                          '-{kellerbuch}'),
    ('assistent_unterhaltungen',      'SA,TA,W*{kellerbuch}',                   'SA,TA,W*{kellerbuch}',                   'SA,TA,W*{kellerbuch}'),
    ('behaelter',                     'SA,TA,W*{kellerbuch}',                   'SA,TA,W*{kellerbuch}',                   'SA,TA{kellerbuch}'),
    ('behandlung_grundstuecke',       'SA,TA,W*{rieden}',                       '-{rieden}',                              'SA,TA,W*{rieden}'),
    ('behandlungen',                  'SA,TA,W*{rieden}',                       'SA,TA,W*{rieden}',                       '-{rieden}'),   -- KAN-88: stornieren statt löschen (endgültig nur über s112_storniert_loeschen)
    ('benutzer_dashboard',            'L,SA,TA,W',                              'L,SA,TA,W',                              'L,SA,TA,W'),   -- KAN-388: nur die eigene Zeile
    ('benachrichtigungen',            '-',                                      'L,SA,TA,W',                              'L,SA,TA,W'),
    ('bestandsprotokoll',             '-',                                      '-',                                      '-'),
    ('bestellung_positionen',         'SA,TA,W*{warenwirtschaft}',              'SA,TA,W*{warenwirtschaft}',              'SA,TA,W*{warenwirtschaft}'),
    ('bestellungen',                  'SA,TA,W*{warenwirtschaft}',              'SA,TA,W*{warenwirtschaft}',              'SA,TA,W*{warenwirtschaft}'),
    ('betriebsmittel',                'SA,TA,W*{rieden}',                       'SA,TA,W*{rieden}',                       'SA,TA{rieden}'),   -- KAN-167 (Stammdaten, Löschen nur ohne Bezug)
    ('betriebsmittel_lager_bewegungen','SA,TA,W*{rieden}',                      'SA,TA,W*{rieden}',                       '-{rieden}'),   -- KAN-167 (Einkauf nur per RPC; löschen nur über s112_storniert_loeschen)
    ('buchhaltung_export_protokoll',  'SA,TA,W*{ea}',                           '-{ea}',                                  '-{ea}'),
    ('buchhaltung_kontenmapping',     'SA,TA{ea}',                              'SA,TA{ea}',                              'SA,TA{ea}'),
    ('charge_umstufungen',            '-',                                      '-',                                      '-'),   -- KAN-82: nur per RPC s112_charge_abstufen
    ('psm_uebermittlungen',           '-',                                      '-',                                      '-'),   -- KAN-120: nur per RPC s112_psm_uebermittlung_protokollieren
    ('checklisten',                   'SA,TA,W*{betrieb}',                      'SA,TA,W*{betrieb}',                      'SA,TA,W*{betrieb}'),
    ('checklisten_punkte',            'SA,TA,W*{betrieb}',                      'SA,TA,W*{betrieb}',                      'SA,TA,W*{betrieb}'),
    ('crm_dubletten_ignoriert',       'SA,TA,W*{crm}',                          'SA,TA,W*{crm}',                          'SA,TA,W*{crm}'),
    ('dac_antrag',                    'SA,TA,W*{kellerbuch}',                   'SA,TA,W*{kellerbuch}',                   '-{kellerbuch}'),   -- KAN-150 F2a (löschen nur über s112_storniert_loeschen)
    ('datenschutz_consents',          'SA,TA,W*{crm}',                          '-',                                      '-'),
    ('duengemittel',                  'SA,TA,W*{rieden}',                       'SA,TA,W*{rieden}',                       'SA,TA{rieden}'),
    ('duengemittel_lager_bewegungen', 'SA,TA,W*{rieden}',                       'SA,TA,W*{rieden}',                       '-{rieden}'),   -- KAN-88
    ('ea_anlagen',                    'SA,TA,W*{ea}',                           'SA,TA,W*{ea}',                           'SA,TA,W*{ea}'),
    ('ea_belege',                     'SA,TA,W*{ea}',                           'SA,TA,W*{ea}',                           'SA,TA,W*{ea}'),
    ('ea_dauerauftraege',             'SA,TA,W*{ea}',                           'SA,TA,W*{ea}',                           'SA,TA,W*{ea}'),
    ('ea_dauerauftrag_log',           '-',                                      '-',                                      '-'),
    ('ea_kategorien',                 'SA,TA,W*{ea}',                           'SA,TA,W*{ea}',                           'SA,TA,W*{ea}'),
    ('ea_monatsabschluss',            'SA,TA{ea}',                              '-{ea}',                                  '-{ea}'),   -- KAN-149 D3: Abschluss unveränderlich
    ('ea_transaktionen',              'SA,TA,W*{ea}',                           'SA,TA,W*{ea}',                           '-{ea}'),   -- KAN-149 D3
    ('ea_uva',                        'SA,TA,W*{ea}',                           'SA,TA,W*{ea}',                           'SA,TA,W*{ea}'),
    ('elabel_zutaten',                'PA',                                     'PA',                                     'PA'),   -- KAN-216: globaler E-Label-Katalog
    ('elabels',                       'SA,TA,W*{kellerbuch|warenwirtschaft}',   'SA,TA,W*{kellerbuch|warenwirtschaft}',   'SA,TA,W*{kellerbuch|warenwirtschaft}'),   -- KAN-216 (freigegeben gesperrt: a_freeze)
    ('elabel_umleitungen',            '-',                                      '-',                                      '-'),   -- KAN-219: Protokoll, nur s112_elabel_umleiten schreibt
    ('email_lead_ignoriert',          'SA,TA,W*{crm}',                          'SA,TA,W*{crm}',                          'SA,TA,W*{crm}'),
    ('ernte_gst_abgeschlossen',       'SA,TA,W*{rieden|kellerbuch}',            'SA,TA,W*{rieden|kellerbuch}',            'SA,TA,W*{rieden|kellerbuch}'),   -- KAN-392: löschen = wieder öffnen
    ('auftraege',                     '-',                                      'SA,TA,W*{warenwirtschaft}',              '-'),   -- KAN-418: Aufträge – anlegen/stornieren nur über die RPCs, direkt nur Frist und Notiz
    ('auftrag_positionen',            '-',                                      '-',                                      '-'),
    ('auftrag_lieferungen',           '-',                                      '-',                                      '-'),   -- KAN-418 Teil 2: nur über s112_auftrag_liefern und den Storno-Trigger   -- KAN-418: Positionen – nur über s112_auftrag_anlegen
    ('verkauf_ki_begriffe',           'SA,TA,W*{warenwirtschaft}',              'SA,TA,W*{warenwirtschaft}',              'SA,TA,W*{warenwirtschaft}'),   -- KAN-411: gelernte Begriffe aus Bestell-Mails
    ('ernte_parzellen',               'SA,TA,W*{rieden|kellerbuch}',            'SA,TA,W*{rieden|kellerbuch}',            '-{rieden|kellerbuch}'),   -- KAN-148 C1d
    ('export_registrierungen',        'SA,TA,W*{warenwirtschaft}',              'SA,TA,W*{warenwirtschaft}',              'SA,TA,W*{warenwirtschaft}'),   -- KAN-437: Export-Registrierungen des Betriebs
    ('export_nachweise',              'SA,TA,W*{warenwirtschaft}',              '-',                                      'SA,TA,W*{warenwirtschaft}'),   -- KAN-440: Nachweise anlegen/entfernen, nie ändern
    ('export_dokumente',              'SA,TA,W*{warenwirtschaft}',              'SA,TA,W*{warenwirtschaft}',              '-{warenwirtschaft}'),   -- KAN-150 F2a (löschen nur über s112_storniert_loeschen)
    ('exportauftraege',               'SA,TA,W*{warenwirtschaft}',              'SA,TA,W*{warenwirtschaft}',              '-{warenwirtschaft}'),   -- KAN-150 F2a (löschen nur über s112_storniert_loeschen)
    ('exportauftrag_positionen',      'SA,TA,W*{warenwirtschaft}',              'SA,TA,W*{warenwirtschaft}',              '-{warenwirtschaft}'),   -- KAN-150 F2a (löschen nur über s112_storniert_loeschen)
    ('firmen',                        'SA,TA,W*{crm}',                          'SA,TA,W*{crm}',                          'SA,TA,W*{crm}'),
    ('fristen',                       'SA,TA,W*{betrieb}',                      'SA,TA,W*{betrieb}',                      'SA,TA,W*{betrieb}'),
    ('fuellung_bewegungen',           '-',                                      '-',                                      '-'),
    ('fuellung_chargen',              'SA,TA,W*{kellerbuch|warenwirtschaft}',   'SA,TA,W*{kellerbuch|warenwirtschaft}',   '-{kellerbuch|warenwirtschaft}'),   -- KAN-145 B4
    ('fuellungen',                    'SA,TA,W*{kellerbuch|warenwirtschaft}',   'SA,TA,W*{kellerbuch|warenwirtschaft}',   '-{kellerbuch|warenwirtschaft}'),   -- KAN-145 B4
    ('grundstuecke',                  'SA,TA,W*{rieden|ea}',                    'SA,TA,W*{rieden|ea}',                    'SA,TA{rieden|ea}'),
    ('keller_behandlungen',           'SA,TA,W*{kellerbuch}',                   'SA,TA,W*{kellerbuch}',                   '-{kellerbuch}'),   -- KAN-145 B4
    ('keller_behandlungstypen',       'SA,TA,W*{kellerbuch}',                   'SA,TA,W*{kellerbuch}',                   'SA,TA,W*{kellerbuch}'),
    ('keller_freigaben',              '-',                                      '-',                                      '-'),
    ('crm_freigaben',                 '-',                                      '-',                                      '-'),   -- KAN-212: nur Plattform-Admin per Service-Role
    ('keller_umzuege',                'SA,TA,W*{kellerbuch|warenwirtschaft}',   'SA,TA,W*{kellerbuch|warenwirtschaft}',   '-{kellerbuch|warenwirtschaft}'),   -- KAN-145 B4
    ('fuellung_etikettierungen',      '-',                                      '-',                                      '-'),   -- KAN-41 Paket 3d: nur per RPC s112_fuellung_etikettieren/s112_etikettierung_stornieren
    ('kellermittel',                  'SA,TA,W*{kellerbuch}',                   'SA,TA,W*{kellerbuch}',                   'SA,TA,W*{kellerbuch}'),   -- KAN-107: Stoffe des Stoffkontos
    ('kellermittel_buchungen',        'SA,TA,W*{kellerbuch}',                   '-',                                      '-'),   -- KAN-107: append-only
    ('keller_zugangskorrekturen',     '-',                                      '-',                                      '-'),   -- KAN-53: nur per RPC s112_zugangskorrektur_buchen/_stornieren
    ('keller_verarbeitungen',         '-',                                      '-',                                      '-'),   -- KAN-41 Paket 3a: nur per RPC s112_verarbeitung_buchen/_stornieren
    ('kellerbuch_buchungen',          '-',                                      '-',                                      '-'),   -- KAN-40: Bewegungsjournal, nur per Trigger/RPC, unveränderlich
    ('kellerbuch_abschluesse',        '-',                                      '-',                                      '-'),   -- KAN-192: Periodensperre, nur per RPC, unwiderruflich
    ('kellerplaene',                  'SA,TA,W*{kellerbuch}',                   'SA,TA,W*{kellerbuch}',                   'SA,TA{kellerbuch}'),
    ('kellerplan_positionen',         'SA,TA,W*{kellerbuch}',                   'SA,TA,W*{kellerbuch}',                   'SA,TA,W*{kellerbuch}'),
    ('kontakt_firmen',                'SA,TA,W*{crm}',                          'SA,TA,W*{crm}',                          'SA,TA,W*{crm}'),
    ('kontakt_praeferenzen',          'SA,TA,W*{crm}',                          'SA,TA,W*{crm}',                          'SA,TA,W*{crm}'),
    ('produktionen',                  '-',                                      '-',                                      '-'),   -- KAN-118: nur über s112_produktion_buchen/_stornieren
    ('lohnversektungen',              '-',                                      '-',                                      '-'),   -- KAN-232: nur über s112_lohnversektung_versenden/_stornieren
    ('rechnungen',                    '-',                                      '-',                                      '-'),   -- KAN-102: nur Trigger/RPC bzw. Service-Role
    ('produktion_eingaenge',          '-',                                      '-',                                      '-'),   -- KAN-118
    ('kontakte',                      'SA,TA,W*{crm}',                          'SA,TA,W*{crm}',                          'SA,TA,W*{crm}'),
    ('lieferadressen',                'SA,TA,W*{crm|warenwirtschaft}',          'SA,TA,W*{crm|warenwirtschaft}',          '-'),   -- KAN-176: nur deaktivieren
    ('konten',                        'SA,TA{ea}',                              'SA,TA{ea}',                              'SA,TA{ea}'),
    ('konto_umbuchungen',             'SA,TA,W*{ea}',                           '-{ea}',                                  '-{ea}'),   -- KAN-149 D3
    ('kostenarten',                   'SA,TA,W*{auswertungen|rieden|kellerbuch}','SA,TA,W*{auswertungen|rieden|kellerbuch}','SA,TA,W*{auswertungen|rieden|kellerbuch}'),
    ('kosteneintraege',               'SA,TA,W*{auswertungen|rieden|kellerbuch}','SA,TA,W*{auswertungen|rieden|kellerbuch}','SA,TA,W*{auswertungen|rieden|kellerbuch}'),
    ('kosteneintrag_behaelter',       'SA,TA,W*{auswertungen|rieden|kellerbuch}','SA,TA,W*{auswertungen|rieden|kellerbuch}','SA,TA,W*{auswertungen|rieden|kellerbuch}'),
    ('kosteneintrag_weingaerten',     'SA,TA,W*{auswertungen|rieden|kellerbuch}','SA,TA,W*{auswertungen|rieden|kellerbuch}','SA,TA,W*{auswertungen|rieden|kellerbuch}'),
    ('kostenstellen',                 'SA,TA,W*{auswertungen|rieden|kellerbuch}','SA,TA,W*{auswertungen|rieden|kellerbuch}','SA,TA,W*{auswertungen|rieden|kellerbuch}'),
    ('kat_buchungsart',                '-',                                      '-',                                      '-'),   -- KAN-39: Katalog, nur per Migration
    ('kat_erzeugnis',                  '-',                                      '-',                                      '-'),   -- KAN-39: Katalog, nur per Migration
    ('kat_farbe',                      '-',                                      '-',                                      '-'),   -- KAN-39: Katalog, nur per Migration
    ('kat_land',                       '-',                                      '-',                                      '-'),   -- KAN-39: Katalog, nur per Migration
    ('kat_qualitaetsstufe',            '-',                                      '-',                                      '-'),   -- KAN-39: Katalog, nur per Migration
    ('katalog_mapping',                '-',                                      '-',                                      '-'),   -- KAN-39: Katalog, nur per Migration
    ('lagen',                         'SA,TA,W*{rieden}',                       'SA,TA,W*{rieden}',                       'SA,TA{rieden}'),
    ('lesen',                         'SA,TA,W*{rieden|kellerbuch}',            'SA,TA,W*{rieden|kellerbuch}',            'SA,TA{rieden|kellerbuch}'),
    ('meldung_abgaben',               '-',                                      '-',                                      '-'),   -- KAN-37 B: nur per RPC, unveränderlich
    ('pruefnummer_chargen',           '-',                                      '-',                                      '-'),   -- KAN-99: nur per Trigger (Gültigkeit je Charge)
    ('pruefnummer_ereignisse',        '-',                                      '-',                                      '-'),   -- KAN-97: nur per RPC (Statuswechsel)
    ('module_flags',                  'PA',                                     'PA',                                     '-'),
    ('morgenberichte',                '-',                                      '-',                                      '-'),
    ('pflanzenschutzmittel',          'SA,TA,W*{rieden}',                       'SA,TA,W*{rieden}',                       'SA,TA{rieden}'),
    ('pipeline_eintraege',            'SA,TA,W*{crm}',                          'SA,TA,W*{crm}',                          'SA,TA,W*{crm}'),
    ('pipeline_verlauf',              'SA,TA,W*{crm}',                          '-{crm}',                                 '-{crm}'),
    ('plattform_admins',              '-',                                      '-',                                      '-'),
    ('pressung_behaelter',            'SA,TA,W*{kellerbuch|rieden}',            'SA,TA,W*{kellerbuch|rieden}',            '-{kellerbuch|rieden}'),   -- KAN-148 C1d
    ('pressung_weingaerten',          'SA,TA,W*{kellerbuch|rieden}',            'SA,TA,W*{kellerbuch|rieden}',            '-{kellerbuch|rieden}'),   -- KAN-148 C1d
    ('pressungen',                    'SA,TA,W*{kellerbuch|rieden}',            'SA,TA,W*{kellerbuch|rieden}',            '-{kellerbuch|rieden}'),   -- KAN-148 C1d
    ('reifemessungen',                'SA,TA,W*{rieden}',                       'SA,TA,W*{rieden}',                       'SA,TA,W*{rieden}'),   -- KAN-203: Reife-Messungen je Ried
    ('profiles',                      'L,SA,TA,W',                              'L,SA,TA,W',                              '-'),
    ('pruefnummernantraege',          'SA,TA,W*{kellerbuch}',                   'SA,TA,W*{kellerbuch}',                   '-{kellerbuch}'),   -- KAN-150 F2a (löschen nur über s112_storniert_loeschen)
    ('psm_lager_bewegungen',          'SA,TA,W*{rieden}',                       'SA,TA,W*{rieden}',                       '-{rieden}'),   -- KAN-88
    ('rabattgruppen',                 'SA,TA,W*{warenwirtschaft}',              'SA,TA,W*{warenwirtschaft}',              'SA,TA,W*{warenwirtschaft}'),
    ('rebsorten',                     'PA',                                     'PA',                                     'PA'),
    ('release_notes',                 'PA',                                     'PA',                                     'PA'),
    ('release_notes_gesehen',         'L,SA,TA,W',                              'L,SA,TA,W',                              'L,SA,TA,W'),
    ('saetze_massnahmen',             'SA,TA,W*{rieden}',                       'SA,TA,W*{rieden}',                       'SA,TA{rieden}'),
    ('sonstige_artikel',              'SA,TA,W*{warenwirtschaft}',              'SA,TA,W*{warenwirtschaft}',              'SA,TA,W*{warenwirtschaft}'),   -- KAN-242: DELETE-Policy (unbenutzte Produkte)
    ('sonstige_artikel_bewegungen',   '-',                                      '-',                                      '-'),   -- KAN-115: nur per RPC (s112_artikel_*, s112_verarbeitung_*)
    ('stripe_zahlungen_log',          '-',                                      '-',                                      '-'),
    ('sumup_checkouts',               'SA,TA,W*{warenwirtschaft}',              'SA,TA,W*{warenwirtschaft}',              '-{warenwirtschaft}'),
    ('sumup_terminals',               'SA,TA',                                  'SA,TA',                                  'SA,TA'),
    ('sumup_transaktionen',           '-',                                      '-',                                      '-'),
    ('svs_parameter',                 '-',                                      '-',                                      '-'),
    ('system_ereignisse',             '-',                                      '-',                                      '-'),
    ('tenant_einstellungen',          '-',                                      'SA,TA',                                  '-'),
    ('tenant_memberships',            'PA',                                     'PA',                                     'SA,TA'),
    ('tenants',                       'PA',                                     'SA,TA',                                  '-'),
    ('transaktionszaehler',           '-',                                      '-',                                      '-'),
    ('transportbescheinigungen',      'SA,TA,W*{kellerbuch|warenwirtschaft}',   'SA,TA,W*{kellerbuch|warenwirtschaft}',   '-{kellerbuch|warenwirtschaft}'),   -- KAN-150 F2a (löschen nur über s112_storniert_loeschen)
    ('traubenverkauf',                'SA,TA,W*{rieden|warenwirtschaft}',       'SA,TA,W*{rieden|warenwirtschaft}',       '-{rieden|warenwirtschaft}'),   -- KAN-148 C1d
    ('user_email_connections',        '-',                                      '-',                                      'L,SA,TA,W'),
    ('verkauf_positionen',            'SA,TA,W*{warenwirtschaft}',              'SA,TA,W*{warenwirtschaft}',              '-{warenwirtschaft}'),   -- KAN-149 D3
    ('verkaufsposten',                'SA,TA,W*{warenwirtschaft}',              'SA,TA,W*{warenwirtschaft}',              '-{warenwirtschaft}'),   -- KAN-149 D3
    ('verschneidung_quellen',         'SA,TA,W*{kellerbuch}',                   'SA,TA,W*{kellerbuch}',                   '-{kellerbuch}'),   -- KAN-145 B4
    ('verschneidungen',               'SA,TA,W*{kellerbuch}',                   'SA,TA,W*{kellerbuch}',                   '-{kellerbuch}'),   -- KAN-145 B4
    ('weinanalysen',                  'SA,TA,W*{kellerbuch}',                   'SA,TA,W*{kellerbuch}',                   '-{kellerbuch}'),   -- KAN-150 F2a (löschen nur über s112_storniert_loeschen)
    ('weinausbau',                    'SA,TA,W*{kellerbuch|rieden}',            'SA,TA,W*{kellerbuch|rieden}',            '-{kellerbuch|rieden}'),   -- KAN-148 C1d
    ('weinausbau_weingaerten',        'SA,TA,W*{kellerbuch|rieden}',            'SA,TA,W*{kellerbuch|rieden}',            '-{kellerbuch|rieden}'),   -- KAN-150 F1d (löschen nur über s112_herkunft_setzen)
    ('weinbaugebiete_custom',         'SA,TA,W*{rieden}',                       'SA,TA,W*{rieden}',                       '-{rieden}'),
    ('weingarten',                    'SA,TA,W*{rieden}',                       'SA,TA,W*{rieden}',                       'SA,TA{rieden}'),
    ('weingarten_rebsorten',          'SA,TA,W*{rieden}',                       'SA,TA,W*{rieden}',                       'SA,TA{rieden}'),
    ('weinjahrgaenge',                'SA,TA,W*{rieden|kellerbuch}',            'SA,TA,W*{rieden|kellerbuch}',            'SA,TA{rieden|kellerbuch}'),
    ('wetter_stunden',                '-',                                      '-',                                      '-'),
    ('zahlungen',                     'SA,TA,W*{warenwirtschaft|ea}',           'SA,TA,W*{warenwirtschaft|ea}',           '-{warenwirtschaft|ea}'),   -- KAN-149 D3
    ('zeiterfassung',                 'SA,TA',                                  'SA,TA',                                  'SA,TA'),
    ('zukauf_posten',                 'SA,TA,W*{warenwirtschaft}',              'SA,TA,W*{warenwirtschaft}',              '-{warenwirtschaft}')
  )
  SELECT m.tabelle, a.aktion,
         CASE WHEN x.r IS NULL OR x.r IN ('', '-') THEN '{}'::text[] ELSE string_to_array(x.r, ',') END,
         CASE WHEN x.mo IS NULL OR x.mo = '' THEN '{}'::text[] ELSE string_to_array(x.mo, '|') END,
         a.roh
    FROM m
   CROSS JOIN LATERAL (VALUES (1, 'INSERT', m.i), (2, 'UPDATE', m.u), (3, 'DELETE', m.d)) a (nr, aktion, roh)
   CROSS JOIN LATERAL (SELECT (regexp_match(a.roh, '^([^{]*)(?:\{([^}]*)\})?$'))[1] AS r,
                              (regexp_match(a.roh, '^([^{]*)(?:\{([^}]*)\})?$'))[2] AS mo) x
   ORDER BY m.tabelle, a.nr
$f$;

-- Benannte Soll-Listen. Unbekannter Name → Fehler.
--   geheimnis_spalten      Tabelle.Spalte ohne SELECT-Recht für authenticated/anon (KAN-135)
--   public_policies        Tabelle.Policy, die bewusst TO public gelten (CLAUDE.md: genau diese 5; profiles_read_all seit KAN-159 B3 weg)
--   g_tabellen             Klasse G (s112_klasse): ohne Mandantenbezug über tenant_id
--   protokoll_tabellen     Tabellen mit bestandsprotokoll-Triggern (z_protokoll_*, auch TRUNCATE-Sperre)
--   abo_ausnahmen          Tabellen mit RLS OHNE die drei abo_schreibsperre-Policies
--   abo_status_gesperrt    stripe_status, die sperren (zusätzlich 'trialing' mit abgelaufenem stripe_trial_ends_at)
--   anon_execute_erlaubt   Funktionen in public, die anon ausführen MUSS (PostgREST-Pre-Request)
--   tid_nullable           Tabellen mit nullable tenant_id (globale Zeilen, NULL-Falle)
--   tid_ohne_fk            tenant_id bewusst ohne FK auf tenants (Protokolle überdauern die Mandanten-Löschung; BK3 seit KAN-159 Teil 2)
--   truncate_authenticated Tabellen mit TRUNCATE-Recht für authenticated – seit KAN-159 leer (RLS greift bei TRUNCATE nicht)
--   truncate_anon          dasselbe für anon (identische Liste)
--   schreibmodule          die sechs Schreibmodule (Default für winzer mit schreibmodule NULL)
--   abo_rpc_ausnahmen      SECURITY-DEFINER-Funktionen mit p_tenant_id, EXECUTE für authenticated und Schreibanweisung
--                          im Quelltext, die BEWUSST nicht s112_pruefe_abo_schreibsperre aufrufen (01: rpc_schreibt_ohne_abo).
--                          Nur mit Begründung aufnehmen. Seit KAN-22 leer: check_und_increment_ki_abfrage und
--                          increment_ki_tokens sind nur noch für die Service-Role ausführbar (14: rpc_benutzer_*).
--   ptz_ausnahmen          INVOKER-Funktionen mit p_tenant_id und EXECUTE für authenticated/anon/PUBLIC OHNE
--                          pruefe_tenant_zugriff (01: ptz_invoker). Derzeit keine; nur mit Begründung aufnehmen.
CREATE FUNCTION pg_temp.s112_soll_liste(p_art text) RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $f$
BEGIN
  RETURN CASE p_art
    WHEN 'geheimnis_spalten' THEN ARRAY[
      'tenant_einstellungen.m365_access_token_enc', 'tenant_einstellungen.m365_refresh_token_enc',
      'tenant_einstellungen.m365_client_secret_enc', 'tenant_einstellungen.email_imap_pass_enc',
      'tenant_einstellungen.email_smtp_pass_enc', 'tenant_einstellungen.brevo_api_key',
      'tenant_einstellungen.sumup_api_key', 'tenant_einstellungen.bawb_passwort',
      'user_email_connections.m365_access_token_enc', 'user_email_connections.m365_refresh_token_enc',
      'user_email_connections.imap_pass_enc', 'user_email_connections.smtp_pass_enc']
    WHEN 'public_policies' THEN ARRAY[
      'profiles.profiles: insert own', 'profiles.profiles: update own',
      'rebsorten.rebsorten: everyone can read', 'release_notes_gesehen.rng_own', 'svs_parameter.svsp_select']
    WHEN 'g_tabellen' THEN ARRAY[
      'benutzer_dashboard', 'crm_freigaben', 'elabel_zutaten', 'keller_freigaben', 'plattform_admins', 'profiles', 'rebsorten', 'release_notes', 'release_notes_gesehen',
      'svs_parameter', 'tenants',
      'kat_buchungsart', 'kat_erzeugnis', 'kat_farbe', 'kat_land', 'kat_qualitaetsstufe', 'katalog_mapping']   -- KAN-39
    -- KAN-145 B4: Tabellen mit Löschsperre (a_loeschsperre) = "scharf" in scripts/storno-tabellen.json (Test check-storno)
    -- KAN-149 D3: + ea_transaktionen, konto_umbuchungen, verkauf_positionen, verkaufsposten, zahlungen (dort ohne Lösch-RPC)
    -- KAN-150 F2a: + dac_antrag, weinanalysen, pruefnummernantraege, transportbescheinigungen, exportauftraege (storno) und
    --              exportauftrag_positionen, export_dokumente (kind)
    -- KAN-167: + betriebsmittel_lager_bewegungen (storno)
    WHEN 'loeschsperre_tabellen' THEN ARRAY['behandlungen', 'betriebsmittel_lager_bewegungen', 'dac_antrag', 'duengemittel_lager_bewegungen', 'ea_transaktionen', 'ernte_parzellen', 'export_dokumente', 'exportauftraege', 'exportauftrag_positionen', 'fuellung_chargen', 'fuellungen', 'keller_behandlungen', 'keller_umzuege', 'keller_verarbeitungen', 'keller_zugangskorrekturen', 'konto_umbuchungen', 'lohnversektungen', 'pressung_behaelter', 'pressung_weingaerten', 'pressungen', 'produktion_eingaenge', 'produktionen', 'pruefnummernantraege', 'psm_lager_bewegungen', 'rechnungen', 'transportbescheinigungen', 'traubenverkauf', 'verkauf_positionen', 'verkaufsposten', 'verschneidung_quellen', 'verschneidungen', 'weinanalysen', 'weinausbau', 'weinausbau_weingaerten', 'zahlungen', 'zukauf_posten']
    -- KAN-150 F1a: Stammdaten mit Löschsperre bei berichtsrelevantem Bezug (a_stammdaten_loeschsperre)
    WHEN 'stammdaten_loeschsperre' THEN ARRAY['betriebsmittel', 'duengemittel', 'ea_dauerauftraege', 'ea_kategorien', 'firmen', 'grundstuecke',   -- KAN-167: + betriebsmittel
      'keller_behandlungstypen', 'kontakte', 'pflanzenschutzmittel', 'weingarten']
    WHEN 'protokoll_tabellen' THEN ARRAY[
      'ama_erntemeldungen', 'ama_meldepositionen', 'behandlung_grundstuecke', 'behandlungen', 'bestandsprotokoll', 'duengemittel_lager_bewegungen',   -- KAN-88: + behandlung_grundstuecke
      'ea_belege', 'ea_monatsabschluss', 'ea_transaktionen', 'ea_uva', 'ernte_parzellen', 'fuellung_bewegungen',
      'fuellung_chargen', 'fuellungen', 'keller_behandlungen', 'keller_umzuege', 'konto_umbuchungen', 'lesen',
      'pressung_behaelter', 'pressung_weingaerten', 'pressungen', 'psm_lager_bewegungen', 'rechnungen', 'traubenverkauf',   -- KAN-102: + rechnungen
      'verkauf_positionen', 'verkaufsposten', 'verschneidung_quellen', 'verschneidungen', 'weinausbau', 'weinjahrgaenge',
      'zahlungen', 'zukauf_posten',   -- KAN-166: behandlungen und die beiden Lagertabellen; KAN-149 D2: ea_transaktionen, zahlungen, konto_umbuchungen; KAN-149 D3: ea_belege, ea_monatsabschluss, ea_uva
      -- KAN-150 F1a: Stammdaten (Löschen/TRUNCATE; Ändern von aktiv außer keller_behandlungstypen; kontakte/firmen bewusst nicht)
      'weingarten', 'grundstuecke', 'pflanzenschutzmittel', 'duengemittel', 'ea_kategorien', 'ea_dauerauftraege',
      'keller_behandlungstypen',
      -- KAN-150 F2a: Anträge und Aufzeichnungen (Ändern, Löschen, TRUNCATE)
      'dac_antrag', 'weinanalysen', 'pruefnummernantraege', 'transportbescheinigungen', 'exportauftraege',
      -- KAN-167: Betriebsmittel (Stammdaten: Löschen/TRUNCATE, aktiv; Lagerbuchungen: Ändern, Storno, Löschen, TRUNCATE)
      'betriebsmittel', 'betriebsmittel_lager_bewegungen']
    WHEN 'abo_ausnahmen' THEN ARRAY[
      'benachrichtigungen', 'benutzer_dashboard', 'crm_freigaben', 'elabel_zutaten', 'keller_freigaben', 'plattform_admins', 'profiles', 'rebsorten', 'release_notes',
      'release_notes_gesehen', 'svs_parameter', 'system_ereignisse', 'tenant_memberships', 'user_email_connections',
      'kat_buchungsart', 'kat_erzeugnis', 'kat_farbe', 'kat_land', 'kat_qualitaetsstufe', 'katalog_mapping']   -- KAN-39: globale Kataloge
    WHEN 'abo_status_gesperrt' THEN ARRAY['unpaid', 'canceled', 'cancelled', 'incomplete', 'incomplete_expired', 'paused']
    WHEN 'anon_execute_erlaubt' THEN ARRAY['s112_pre_request()']
    WHEN 'tid_nullable' THEN ARRAY[
      'bestandsprotokoll', 'duengemittel', 'ea_kategorien', 'pflanzenschutzmittel', 'saetze_massnahmen', 'system_ereignisse']
    -- KAN-195: Tabellen mit den RESTRICTIVE-Policies paketmodul_ins/_upd/_del (Paket-Modul aus → kein Schreiben)
    WHEN 'paketmodul_tabellen' THEN ARRAY[
      'assistent_aktionen', 'assistent_korrekturen', 'assistent_nachrichten', 'assistent_unterhaltungen',
      'buchhaltung_export_protokoll', 'buchhaltung_kontenmapping', 'ea_anlagen', 'ea_belege', 'ea_dauerauftraege',
      'ea_kategorien', 'ea_monatsabschluss', 'ea_transaktionen', 'ea_uva', 'export_dokumente', 'export_nachweise', 'export_registrierungen', 'exportauftraege',
      'exportauftrag_positionen', 'konten', 'konto_umbuchungen', 'kostenarten', 'kosteneintraege',
      'kosteneintrag_behaelter', 'kosteneintrag_weingaerten', 'kostenstellen', 'sumup_checkouts', 'sumup_terminals']
    WHEN 'tid_ohne_fk' THEN ARRAY['bestandsprotokoll', 'system_ereignisse']
    WHEN 'truncate_authenticated' THEN '{}'::text[]   -- seit KAN-159 (29.09.2026) kein TRUNCATE mehr
    WHEN 'truncate_anon' THEN pg_temp.s112_soll_liste('truncate_authenticated')
    WHEN 'schreibmodule' THEN ARRAY['rieden', 'kellerbuch', 'warenwirtschaft', 'crm', 'ea', 'auswertungen']
    WHEN 'abo_rpc_ausnahmen' THEN '{}'::text[]   -- KAN-22: KI-Zähler nur Service-Role
    WHEN 'ptz_ausnahmen' THEN '{}'::text[]
    ELSE NULL
  END;
END $f$;

-- Einstufung der SECURITY-DEFINER-Funktionen in public (Signatur wie proname || '(' ||
-- pg_get_function_identity_arguments(oid) || ')'):
--   rls_hilfe     Hilfsfunktion der Policies/RPCs, liefert nur Eigenes (authenticated darf ausführen)
--   mandant       nimmt p_tenant_id und ruft public.pruefe_tenant_zugriff auf (abo = true: zusätzlich
--                 public.s112_pruefe_abo_schreibsperre, weil schreibend)
--   mandant_eigen nimmt p_tenant_id, filtert selbst über die eigene Mitgliedschaft (ohne pruefe_tenant_zugriff)
--   session_user  erlaubt bei session_user = postgres – über die Management-API nicht dynamisch prüfbar,
--                 nur statisch (crm_zaehler lieferte per CLI Zeilen eines fremden Betriebs)
--   intern        nur Service-Role (kein EXECUTE für authenticated/anon)
--   trigger       Triggerfunktion (kein EXECUTE für authenticated/anon)
--   rechte        Soll-Rechte als 'A' (anon), 'U' (authenticated), 'S' (service_role) bzw. '-'
CREATE FUNCTION pg_temp.s112_soll_rpc()
RETURNS TABLE (einstufung text, rechte text, abo boolean, funktion text)
LANGUAGE sql IMMUTABLE AS $f$
  SELECT * FROM (VALUES
    ('intern',        '--S', false, 'behaelter_nutzbar(p_behaelter_id uuid, p_tenant_id uuid)'),
    ('mandant',       '-US', false, 'berechne_ea_uva(p_tenant_id uuid, p_jahr smallint, p_zeitraum text)'),
    ('intern',        '--S', false, 'bestandsprotokoll_mandant_loeschen(p_tenant_id uuid)'),
    ('intern',        '--S', false, 's112_massnahme_geerntet(p_behandlung_id uuid, p_weingarten_id uuid, p_datum date)'),   -- KAN-169: Bedingung des Freeze-Triggers a_freeze_ernte (Maßnahme vor der Lese der Ried)
    ('intern',        '--S', false, 's112_elabel_archivieren(p_tenant_id uuid, p_jahre integer)'),   -- KAN-219: E-Labels vor der Mandanten-Löschung archivieren
    ('intern',        '--S', false, 's112_elabel_archiv_lesen(p_code text)'),   -- KAN-219: Archiv lesen (öffentliche E-Label-Seite, Service-Role)   -- KAN-219: E-Labels vor der Mandanten-Löschung archivieren
    ('intern',        '--S', false, 's112_mandant_loeschen(p_tenant_id uuid, p_bestaetigung text)'),   -- KAN-151 G1: Mandanten-Löschung (nur Service-Role)
    ('trigger',       '--S', false, 'bestandsprotokoll_schreiben()'),
    ('trigger',       '--S', false, 's112_fremdverweis_pruefen()'),
    ('trigger',       '--S', false, 's112_freeze()'),
    ('trigger',       '--S', false, 's112_bienenschutz_bestaetigung()'),   -- KAN-325: Bienenschutz-Bestätigung (Zeitpunkt, Benutzer, Name)
    ('trigger',       '--S', false, 's112_lager_einkauf_schutz()'),   -- KAN-326: Einkauf mit Ausgabe nur über die RPCs
    ('trigger',       '--S', false, 's112_journal_trg_produktion()'),   -- KAN-118: Journal AB_VERAR/ZU_PROD
    ('trigger',       '--S', false, 's112_elabel_umleitung_schutz()'),   -- KAN-219: Umleitung nur über s112_elabel_umleiten
    ('trigger',       '--S', false, 's112_elabel_pruefen()'),   -- KAN-216: Zutatenliste aus dem Katalog, Kennung unveränderlich, Freigabe stempeln   -- KAN-96: generischer Freeze-Trigger
    ('trigger',       '--S', false, 's112_auftrag_schutz()'),   -- KAN-418: am Auftrag direkt nur Frist und Notiz
    ('intern',        '--S', false, 's112_auftragsnummer_ziehen(p_tenant_id uuid)'),   -- KAN-418: Nummernkreis AB
    ('intern',        '--S', false, 's112_fuellung_reserviert(p_fuellung_id uuid)'),   -- KAN-418: reservierte Flaschen einer Füllung
    ('mandant',       '-US', true , 's112_auftrag_anlegen(p_tenant_id uuid, p_kopf jsonb, p_positionen jsonb)'),   -- KAN-418
    ('mandant',       '-US', true , 's112_auftrag_stornieren(p_tenant_id uuid, p_auftrag_id uuid, p_grund text)'),   -- KAN-418
    ('mandant',       '-US', true , 's112_auftrag_liefern(p_tenant_id uuid, p_auftrag_id uuid, p_verkaufsposten_id uuid, p_positionen jsonb)'),   -- KAN-418 Teil 2
    ('mandant',       '-US', true , 's112_auftrag_lieferung_zuruecknehmen(p_tenant_id uuid, p_verkaufsposten_id uuid)'),   -- KAN-418 Teil 2: Abbruchweg
    ('mandant',       '-US', true , 's112_auftrag_abschliessen(p_tenant_id uuid, p_auftrag_id uuid)'),   -- KAN-418 Teil 2
    ('mandant',       '-US', true , 's112_auftrag_ab_vermerken(p_tenant_id uuid, p_auftrag_id uuid, p_an text)'),   -- KAN-418 Teil 3: Versandvermerk der Auftragsbestätigung
    ('intern',        '--S', false, 's112_auftrag_status_setzen(p_auftrag_id uuid)'),   -- KAN-418 Teil 2
    ('intern',        '--S', false, 's112_auftrag_lieferung_zurueck_intern(p_verkaufsposten_id uuid, p_grund text)'),   -- KAN-418 Teil 2
    ('trigger',       '--S', false, 's112_auftrag_lieferung_storno()'),   -- KAN-418 Teil 2: Storno des Verkaufs nimmt die Lieferung zurück
    ('mandant',       '-US', true , 's112_angebot_anlegen(p_tenant_id uuid, p_kopf jsonb, p_positionen jsonb)'),   -- KAN-418 Teil 4: Angebot
    ('mandant',       '-US', true , 's112_angebot_aendern(p_tenant_id uuid, p_angebot_id uuid, p_kopf jsonb, p_positionen jsonb)'),   -- KAN-418 Teil 4
    ('mandant',       '-US', true , 's112_angebot_status_setzen(p_tenant_id uuid, p_angebot_id uuid, p_status text, p_grund text)'),   -- KAN-418 Teil 4: ablehnen/stornieren
    ('intern',        '--S', false, 's112_angebot_schreiben_intern(p_tenant_id uuid, p_angebot_id uuid, p_kopf jsonb, p_positionen jsonb)'),   -- KAN-418 Teil 4
    ('intern',        '--S', false, 's112_angebotsnummer_ziehen(p_tenant_id uuid)'),   -- KAN-418 Teil 4: Nummernkreis AN
    ('trigger',       '--S', false, 's112_kontakt_anonymisiert_schutz()'),   -- KAN-425: anonymisierter Kontakt unveränderlich
    ('mandant',       '-US', true , 's112_kontakt_personendaten_loeschen(p_tenant_id uuid, p_kontakt_id uuid, p_grund text)'),   -- KAN-425: Personendaten löschen (DSGVO)
    ('trigger',       '--S', false, 's112_kosten_buchung_schutz()'),   -- KAN-421: Kosteneinträge aus einer E&A-Buchung nur über die RPC
    ('trigger',       '--S', false, 's112_kosten_storno_spiegeln()'),   -- KAN-421: Storno der Buchung spiegelt die Kosteneinträge negativ
    ('mandant',       '-US', true , 's112_ea_kosten_zuordnen(p_tenant_id uuid, p_ea_transaktion_id uuid, p_zeilen jsonb)'),   -- KAN-421
    ('trigger',       '--S', false, 's112_rechnungstext_schutz()'),   -- KAN-416: Text auf Rechnung nach dem Erstellen der Rechnung unveränderlich
    ('trigger',       '--S', false, 's112_tb_stempel()'),
    ('trigger',       '--S', false, 's112_kellermittel_buchung_stempel()'),   -- KAN-107: Benutzer der Stoffkonto-Buchung   -- KAN-209: Zeitpunkt/Benutzer beim Ausstellen der Transportbescheinigung
    ('trigger',       '--S', false, 's112_behandlung_erfassung()'),   -- KAN-87: erfasst am/von stempeln, Anwender = Mitglied
    ('trigger',       '--S', false, 's112_pn_workflow_schutz()'),
    ('trigger',       '--S', false, 's112_pn_chargen_pflegen()'),   -- KAN-99: Gültigkeit je Charge (Einreichen, Umzug, Zugang, Storno)   -- KAN-97: Status nur per RPC, Formular nur zum Entwurf
    ('mandant',       '-US', true , 's112_charge_status_setzen(p_tenant_id uuid, p_weinausbau_id uuid, p_status text, p_datum date)'),   -- KAN-41: datierter Statuswechsel Most ↔ Wein
    ('mandant',       '-US', true , 's112_psm_uebermittlung_protokollieren(p_tenant_id uuid, p_kanal text, p_eintraege jsonb)'),   -- KAN-120: Export-Lauf der PSM-Aufzeichnungen protokollieren
    ('mandant',       '-US', true , 's112_charge_abstufen(p_tenant_id uuid, p_weinausbau_id uuid, p_datum date, p_neu jsonb, p_grund text, p_quelle_weinausbau_id uuid)'),   -- KAN-82: Charge abstufen (Datum, Grund, Protokoll)
    ('mandant',       '-US', true , 's112_fuellung_etikettieren(p_tenant_id uuid, p_fuellung_id uuid, p_datum date, p_menge_stk integer, p_notizen text)'),   -- KAN-41 Paket 3d: Etikettieren
    ('mandant',       '-US', true , 's112_etikettierung_stornieren(p_tenant_id uuid, p_id uuid, p_grund text)'),   -- KAN-41 Paket 3d: Storno der Etikettierung
    ('mandant',       '-US', true , 's112_zugangskorrektur_buchen(p_tenant_id uuid, p_weinausbau_id uuid, p_datum date, p_menge numeric, p_art text, p_grund text)'),   -- KAN-53: Zugangskorrektur
    ('mandant',       '-US', true , 's112_zugangskorrektur_stornieren(p_tenant_id uuid, p_id uuid, p_grund text)'),   -- KAN-53: Storno der Zugangskorrektur
    ('mandant',       '-US', true , 's112_verarbeitung_buchen(p_tenant_id uuid, p_weinausbau_id uuid, p_datum date, p_menge numeric, p_zweck text, p_notizen text, p_artikel_id uuid, p_stueck numeric)'),   -- KAN-41 Paket 3a: Verarbeitung (AB_VERAR); KAN-115: + Zugang beim Sonstigen Produkt
    ('mandant',       '-US', true , 's112_produktion_buchen(p_tenant_id uuid, p_kopf jsonb, p_eingaenge jsonb)'),   -- KAN-118: Produktion (Spritzer, Perlwein, Schaumwein, PetNat)
    ('mandant',       '-US', true , 's112_produktion_stornieren(p_tenant_id uuid, p_id uuid, p_grund text)'),   -- KAN-118: Storno der Produktion
    ('mandant',       '-US', true , 's112_lohnversektung_versenden(p_tenant_id uuid, p_weinausbau_id uuid, p_datum date, p_firma_id uuid, p_notizen text)'),   -- KAN-232: Versand zur Lohnversektung
    ('mandant',       '-US', true , 's112_lohnversektung_stornieren(p_tenant_id uuid, p_id uuid, p_grund text)'),   -- KAN-232: Storno des Versands
    ('trigger',       '--S', false, 's112_lohnversektung_rueckkehr_pruefen()'),   -- KAN-232: Rückkehr nur aus der versandten Charge
    ('trigger',       '--S', false, 's112_lohnversektung_stand()'),   -- KAN-232: abgeschlossen, sobald der Grundwein zurück ist
    ('mandant',       '-US', true , 's112_elabel_umleiten(p_tenant_id uuid, p_elabel_id uuid, p_ziel_id uuid, p_grund text)'),   -- KAN-219: QR-Code eines E-Labels umleiten (Protokoll)
    ('mandant',       '-US', true , 's112_sekt_stufe_setzen(p_tenant_id uuid, p_fuellung_id uuid, p_stufe text, p_degorgiert_am date, p_lagenrein boolean)'),   -- KAN-190: Sekt-Stufe / Degorgieren
    ('mandant',       '-US', true , 's112_artikel_buchen(p_tenant_id uuid, p_artikel_id uuid, p_datum date, p_art text, p_menge numeric, p_notizen text)'),   -- KAN-115: Anfangsbestand/Zugang/Inventur Sonstiger Produkte
    ('mandant',       '-US', true , 's112_artikel_bewegung_stornieren(p_tenant_id uuid, p_id uuid, p_grund text)'),   -- KAN-115: Storno einer Lagerbuchung
    ('mandant',       '-US', true , 's112_artikel_verkauf_buchen(p_tenant_id uuid, p_verkaufsposten_id uuid)'),   -- KAN-115: Verkauf mindert den Lagerstand
    ('mandant',       '-US', true , 's112_artikel_verkauf_stornieren(p_tenant_id uuid, p_verkaufsposten_id uuid, p_grund text)'),   -- KAN-115: Storno des Verkaufs bucht zurück
    ('mandant',       '-US', true , 's112_verarbeitung_stornieren(p_tenant_id uuid, p_id uuid, p_grund text)'),   -- KAN-41 Paket 3a: Storno der Verarbeitung
    ('mandant',       '-US', true , 's112_fuellung_nachtragen(p_tenant_id uuid, p_fuellung_id uuid, p_weinausbau_id uuid, p_dac_antrag_id uuid)'),   -- KAN-101: Charge/DAC-Antrag/Prüfnummer einmal nachtragen
    ('mandant',       '-US', true , 's112_fuellung_aendern(p_tenant_id uuid, p_id uuid, p_werte jsonb, p_grund text)'),   -- KAN-378: Produktname, Preise, MwSt., KN-Code, Notizen, aktiv nur mit Grund
    ('mandant',       '-US', true , 's112_pruefnummernantrag_status_setzen(p_tenant_id uuid, p_antrag_id uuid, p_status text, p_datum date, p_pruefnummer text, p_grund text)'),   -- KAN-97: Statuswechsel
    ('mandant',       '-US', true , 's112_freeze_korrektur(p_tenant_id uuid, p_tabelle text, p_id uuid, p_werte jsonb, p_grund text)'),   -- KAN-96: Korrektur durch den Betriebsleiter   -- KAN-178: Fremdverweise je FK-Spalte
    ('intern',        '--S', false, 'check_und_increment_ki_abfrage(p_tenant_id uuid)'),   -- KAN-22: nur Service-Role (Route per Admin-Client)
    ('trigger',       '--S', false, 'create_profile_on_signup()'),
    ('session_user',  '-US', false, 'crm_dubletten(p_tenant_id uuid)'),
    ('session_user',  '-US', false, 'crm_filterwerte(p_tenant_id uuid)'),
    ('session_user',  '-US', false, 'crm_zaehler(p_tenant_id uuid)'),
    ('intern',        '--S', false, 'demo_musterhof_gebiete()'),          -- KAN-165 D: Rieden in weiteren Weinbaugebieten
    ('intern',        '--S', false, 'demo_musterhof_info()'),
    ('intern',        '--S', false, 'demo_musterhof_kellerbuch()'),       -- KAN-223: Journal, Kellerbuch-Vorgänge, PN, Zukauf, Traubenverkauf, Export
    ('intern',        '--S', false, 'demo_musterhof_lese_je_gst()'),     -- KAN-394: Lese und Pressung je GST
    ('intern',        '--S', false, 'demo_musterhof_lesen()'),
    ('intern',        '--S', false, 'demo_musterhof_y2_kette()'),
    ('intern',        '--S', false, 'demo_musterhof_zuruecksetzen()'),
    ('mandant',       '-US', true , 'fuellung_bestand_buchen(p_tenant_id uuid, p_fuellung_id uuid, p_art text, p_datum date, p_menge_stk integer, p_ist_bestand integer, p_grund text)'),
    ('mandant',       '-US', true , 'get_next_accountnummer(p_tenant_id uuid)'),
    ('mandant',       '-US', true , 'get_next_chargennummer(p_tenant_id uuid)'),
    ('mandant',       '-US', true , 'get_next_liefernummer(p_tenant_id uuid)'),
    ('mandant',       '-US', true , 'get_next_personenkonto(p_tenant_id uuid, p_art text, p_basis integer)'),
    ('intern',        '--S', true , 'get_next_rechnungsnummer(p_tenant_id uuid)'),   -- KAN-21: nur Service-Role, Vergabe per Trigger a_rechnungsnummer
    ('intern',        '--S', false, 's112_rechnungsnummer_ziehen(p_tenant_id uuid)'),   -- KAN-21: Zähler ohne Zugriffsprüfung (Trigger)
    ('trigger',       '--S', false, 's112_rechnungsnummer_vergeben()'),   -- KAN-21: Rechnungsnummer im Insert, unveränderlich per API
    ('intern',        '--S', false, 's112_lieferscheinnummer_ziehen(p_tenant_id uuid)'),   -- KAN-102: Lieferschein-Zähler (Trigger)
    ('intern',        '--S', false, 's112_stornonummer_ziehen(p_tenant_id uuid, p_datum date)'),   -- KAN-379: Zähler der Stornobelege
    ('intern',        '--S', false, 's112_gutschriftnummer_ziehen(p_tenant_id uuid, p_datum date)'),   -- KAN-419: Zähler der Gutschriften
    ('intern',        '--S', false, 's112_gutschrift_summe(p_tenant_id uuid, p_rechnung_id uuid)'),   -- KAN-419: Summe der Gutschriften einer Rechnung (Abgleich „bezahlt“)
    ('mandant',       '-US', true , 's112_gutschrift_anlegen(p_tenant_id uuid, p_rechnung_id uuid, p_datum date, p_grund text, p_positionen jsonb, p_betrag numeric, p_betrag_text text)'),   -- KAN-419: Gutschrift zur Rechnung
    ('intern',        '--S', false, 's112_stornobeleg_anlegen(p_tenant_id uuid, p_rechnung_id uuid, p_grund text, p_datum date)'),   -- KAN-379: Stornobeleg (Rechnungsstorno, Verkauf samt Rechnung, Spiegel)
    ('trigger',       '--S', false, 's112_lieferscheinnummer_vergeben()'),   -- KAN-102: Lieferscheinnummer im Insert
    ('trigger',       '--S', false, 's112_rechnung_aus_lieferschein()'),   -- KAN-102: Rechnung im Insert (Übergang 1:1)
    ('trigger',       '--S', false, 's112_rechnung_id_schutz()'),   -- KAN-102: rechnung_id nicht per API
    ('trigger',       '--S', false, 's112_rechnung_spiegeln()'),   -- KAN-102: Spiegel Lieferschein → Rechnung
    ('trigger',       '--S', false, 's112_rechnung_aufraeumen()'),   -- KAN-102: Rechnung ohne Lieferschein (Wartung)
    ('trigger',       '--S', false, 's112_zahlung_rechnung()'),   -- KAN-105: Zahlung an die Rechnung des Lieferscheins
    ('trigger',       '--S', false, 's112_lieferschein_storno_sperre()'),   -- KAN-103: berechneter Lieferschein nicht stornierbar
    ('mandant',       '-US', true , 's112_rechnung_erstellen(p_tenant_id uuid, p_lieferscheine uuid[], p_datum date, p_preise jsonb, p_notizen text)'),   -- KAN-103/104: Rechnung aus Lieferscheinen
    ('mandant',       '-US', true , 's112_rechnung_stornieren(p_tenant_id uuid, p_rechnung_id uuid, p_grund text, p_datum date)'),   -- KAN-103/KAN-379: Rechnungsstorno mit Stornobeleg
    ('mandant',       '-US', true , 's112_verkauf_samt_rechnung_stornieren(p_tenant_id uuid, p_verkaufsposten_id uuid, p_grund text, p_datum date)'),   -- KAN-356/KAN-379: Verkauf samt Rechnung in einer Transaktion
    ('mandant',       '-US', true , 'get_next_transaktionsnr(p_tenant_id uuid, p_typ text)'),
    ('rls_hilfe',     '-US', false, 'get_user_role_in_tenant(p_tenant_id uuid)'),
    ('rls_hilfe',     '-US', false, 'get_user_tenant_ids()'),
    ('trigger',       '--S', false, 'handle_new_user()'),
    ('intern',        '--S', false, 'increment_ki_tokens(p_tenant_id uuid, p_input_tokens integer, p_output_tokens integer)'),   -- KAN-22: nur Service-Role
    ('mandant',       '-U-', false, 'ki_readonly_query(p_sql text, p_tenant_id uuid)'),
    ('session_user',  '-US', true , 'kontakte_zusammenfuehren(p_tenant_id uuid, p_behalten uuid, p_weg uuid[])'),
    ('trigger',       '--S', false, 'kundennummer_trg()'),
    ('intern',        '--S', false, 'kundennummer_vergeben(p_tenant_id uuid, p_kreis integer)'),
    ('session_user',  '-US', false, 'lade_behaelter(p_tenant_id uuid)'),
    ('session_user',  '-US', false, 'lade_kellergemeinschaft(p_tenant_id uuid)'),
    ('session_user',  '-US', false, 'lade_crmgemeinschaft(p_tenant_id uuid)'),
    ('mandant',       '-US', false, 's112_privat_bloecke(p_tenant_id uuid)'),   -- KAN-17: Zeitblöcke fremder privater Termine   -- KAN-212: Partner der CRM-Gemeinschaft
    ('intern',        '--S', false, 's112_momentaufnahme_fremd(p_teil jsonb, p_tabelle text, p_id uuid, p_tenant uuid)'),   -- KAN-212: Nummern fremder Betriebe nicht auf den Beleg
    ('trigger',       '--S', false, 'lese_zuordnen()'),
    ('trigger',       '--S', false, 'lesen_vor_loeschen()'),
    ('trigger',       '--S', false, 'lesen_vor_schreiben()'),
    ('trigger',       '--S', false, 'weinjahrgang_erste_lese()'),
    ('intern',        '--S', false, 'process_ea_dauerauftraege()'),
    ('mandant',       '-US', false, 'pruefe_ea_zeitraum_offen(p_tenant_id uuid, p_datum date)'),
    ('rls_hilfe',     '-US', false, 'pruefe_tenant_zugriff(p_tenant_id uuid, p_rollen text[])'),
    ('rls_hilfe',     '-US', false, 's112_aal_ok()'),
    ('rls_hilfe',     '-US', false, 's112_darf_schreiben(p_tenant uuid, VARIADIC p_module text[])'),
    ('rls_hilfe',     '-US', false, 's112_sichtbare_profile()'),
    ('rls_hilfe',     '-US', false, 's112_paketmodul_frei(p_tenant_id uuid, p_schalter text)'),   -- KAN-195: Paket-Modul frei (Policies paketmodul_*)   -- KAN-159 B3: Profile gemeinsamer Betriebe
    ('rls_hilfe',     '-US', false, 's112_gesperrte_tenants()'),
    ('mandant_eigen', '-US', false, 's112_mandant_mitglieder(p_tenant_id uuid)'),
    ('intern',        '--S', false, 's112_mandant_mitglieder_mit_email(p_tenant_id uuid)'),
    ('rls_hilfe',     '-US', false, 's112_meine_tenants()'),
    ('rls_hilfe',     '-US', false, 's112_crm_partner_tenants()'),   -- KAN-212: Eigentümer der CRM-Gemeinschaft
    ('rls_hilfe',     '-US', false, 's112_schreibgesperrte_tenants()'),
    ('mandant',       '-US', true , 's112_betriebsmittel_einkauf(p_tenant_id uuid, p_betriebsmittel_id uuid, p_datum date, p_menge numeric, p_einheit text, p_betrag_netto numeric, p_ust_satz numeric, p_lieferant_firma_id uuid, p_ea_kategorie_id uuid, p_notizen text)'),   -- KAN-167: Einkauf mit E/A-Ausgabe
    ('mandant',       '-US', true , 's112_betriebsmittel_stornieren(p_tenant_id uuid, p_id uuid, p_grund text, p_datum date)'),   -- KAN-167: Storno Lagerbuchung (Einkauf samt Ausgabe)
    ('mandant',       '-US', true , 's112_lager_einkauf(p_tenant_id uuid, p_art text, p_mittel_id uuid, p_datum date, p_menge numeric, p_einheit text, p_betrag_netto numeric, p_ust_satz numeric, p_lieferant_firma_id uuid, p_ea_kategorie_id uuid, p_notizen text)'),   -- KAN-326: PSM-/Dünger-Einkauf mit E/A-Ausgabe
    ('mandant',       '-US', true , 's112_lager_einkauf_stornieren(p_tenant_id uuid, p_art text, p_id uuid, p_grund text, p_datum date)'),   -- KAN-326: Storno PSM-/Dünger-Lagerbuchung (Einkauf samt Ausgabe)
    ('intern',        '--S', false, 's112_charge_folgebuchung(p_tenant_id uuid, p_charge_id uuid)'),   -- KAN-148 C1c-2 (Hilfsfunktion)
    ('mandant',       '-US', true , 's112_mostzeile_anlegen(p_tenant_id uuid, p_pressung_id uuid, p_behaelter_id uuid, p_menge_liter numeric, p_notizen text, p_charge jsonb)'),   -- KAN-148 C1c-2
    ('mandant',       '-US', true , 's112_pressung_anlegen(p_tenant_id uuid, p_kopf jsonb, p_trauben jsonb)'),   -- KAN-148 C1c-2
    ('mandant',       '-US', true , 's112_pressung_stornieren(p_tenant_id uuid, p_pressung_id uuid, p_grund text)'),   -- KAN-148 C1c
    ('mandant',       '-US', true , 's112_pressung_zeilen_stornieren(p_tenant_id uuid, p_pressung_id uuid, p_behaelter_zeilen uuid[], p_trauben_zeilen uuid[], p_grund text)'),   -- KAN-148 C1c-2
    ('mandant',       '-US', true , 's112_ama_korrektur_anlegen(p_tenant_id uuid, p_meldung_id uuid)'),   -- KAN-148 C2
    ('mandant',       '-US', true , 's112_ama_meldung_speichern(p_tenant_id uuid, p_jahrgang_id uuid, p_kopf jsonb, p_positionen jsonb)'),   -- KAN-148 C2
    ('trigger',       '--S', false, 's112_ama_position_schutz()'),             -- KAN-148 C2: Positionen eingereichter Meldungen
    ('trigger',       '--S', false, 's112_ama_schutz()'),                      -- KAN-148 C2: Status/Versionen nur per RPC
    ('mandant',       '-US', true , 's112_ama_status_setzen(p_tenant_id uuid, p_meldung_id uuid, p_status text, p_datum date, p_referenznr text)'),   -- KAN-148 C2
    ('mandant',       '-US', true , 's112_ama_einreichen(p_tenant_id uuid, p_meldung_id uuid, p_datum date, p_referenznr text, p_abgabe jsonb)'),   -- KAN-37 B
    ('trigger',       '--S', false, 's112_meldung_abgabe_schutz()'),           -- KAN-37 B: Abgaben unveränderlich
    ('trigger',       '--S', false, 's112_journal_schutz()'),                  -- KAN-40: Bewegungsjournal unveränderlich
    ('trigger',       '--S', false, 's112_journal_trg_charge()'),              -- KAN-40: Eröffnungsbestand Tank, Umstufung
    ('trigger',       '--S', false, 's112_journal_trg_flaschenbuchung()'),     -- KAN-40: fuellung_bewegungen
    ('trigger',       '--S', false, 's112_journal_trg_zugangskorrektur()'),    -- KAN-53: INV_PLUS
    ('trigger',       '--S', false, 's112_fuellung_herkunft_pruefen()'),       -- KAN-198: Chargenpflicht der Füllung
    ('trigger',       '--S', false, 's112_journal_trg_verarbeitung()'),        -- KAN-41 Paket 3a: AB_VERAR
    ('trigger',       '--S', false, 's112_aufwertung_sperre()'),                -- KAN-41 Paket 3e: keine Aufwertung nach Folgebuchungen
    ('trigger',       '--S', false, 's112_journal_trg_behandlung()'),          -- KAN-41 Paket 3b: ZU_BEH
    ('trigger',       '--S', false, 's112_behandlung_zugang_bestand()'),       -- KAN-41 Paket 3b: Bestand der Charge
    ('trigger',       '--S', false, 's112_journal_trg_fuellung()'),            -- KAN-40: Füllung, Flaschen-Eröffnung/-Zukauf, Umstufung
    ('trigger',       '--S', false, 's112_flaschenzukauf_storno()'),          -- KAN-41 Paket 2b: Zukauf-Storno storniert den Weinlager-Artikel mit (nur ohne Bewegung)
    ('trigger',       '--S', false, 's112_journal_trg_pressung()'),            -- KAN-40: Pressungskopf (Datum, Storno)
    ('trigger',       '--S', false, 's112_journal_trg_pressung_behaelter()'),  -- KAN-40: ERNTE/ZK_TRAUB
    ('trigger',       '--S', false, 's112_journal_trg_umzug()'),               -- KAN-40: Umzug, Filtration, Schwund
    ('trigger',       '--S', false, 's112_journal_trg_verkauf_position()'),    -- KAN-40: VK_FA_*/VK_FL_*
    ('trigger',       '--S', false, 's112_journal_trg_verkaufsposten()'),      -- KAN-40: Verkaufskopf (Datum, Storno)
    ('trigger',       '--S', false, 's112_journal_trg_verschnitt()'),          -- KAN-40: Verschnittkopf (Datum, Ziel, Storno)
    ('trigger',       '--S', false, 's112_journal_trg_verschnitt_quelle()'),   -- KAN-40: VS_AB/VS_ZU
    ('trigger',       '--S', false, 's112_journal_trg_zukauf()'),              -- KAN-40: ZK_FASS/ZK_MOST
    ('mandant',       '-US', true , 'journal_abgleichen(p_tenant_id uuid, p_mindestalter interval)'),   -- KAN-40: Korrektur INV_PLUS/INV_MIN
    ('mandant',       '-US', true , 'journal_eroeffnen(p_tenant_id uuid, p_stichtag date)'),   -- KAN-40: Journalbeginn + EROEFF
    ('intern',        '--S', false, 'journal_rueckbefuellen(p_tenant_id uuid, p_ab date)'),
    ('mandant',       '-US', true , 'kellerbuch_abschliessen(p_tenant_id uuid, p_bis date, p_bemerkung text)'),   -- KAN-192: Periodensperre (Betriebsleitung)
    ('intern',        '--S', false, 's112_naechste_weinausbau_nummer(p_tenant_id uuid, p_zeit timestamp with time zone)'),   -- KAN-192: Chargennummer
    ('trigger',       '--S', false, 's112_chargennummer_trg()'),              -- KAN-192: Chargennummer vergeben, unveränderlich
    ('trigger',       '--S', false, 's112_kellerbuch_abschluss_schutz()'),    -- KAN-192: Abschlüsse unwiderruflich
    ('trigger',       '--S', false, 's112_kellerbuch_periodensperre()'),      -- KAN-192: Bewegungen im abgeschlossenen Zeitraum   -- KAN-40 E2: Rückbefüllung nur Musterhof/Sandbox (nur Service-Role)
    ('mandant',       '-US', true , 's112_verschnitt_buchen(p_tenant_id uuid, p_kopf jsonb, p_quellen jsonb)'),   -- KAN-112: Verschnitt atomar (auch Umzug in Gebinde mit anderem Wein)
    ('mandant',       '-US', true , 's112_verschnitte_buchen(p_tenant_id uuid, p_buchungen jsonb)'),   -- KAN-112: mehrere Verschnitte eines Umzugs atomar
    ('mandant',       '-US', true , 's112_zukauf_buchen(p_tenant_id uuid, p_zukauf jsonb, p_charge jsonb, p_verschnitt jsonb, p_fuellung jsonb)'),   -- KAN-193: Zukauf samt Charge, ggf. sofort als Verschnitt   -- KAN-41 Paket 2b: p_fuellung (Flaschenzukauf → Weinlager-Artikel)
    ('trigger',       '--S', false, 's112_verschnitt_verweise_pruefen()'),    -- KAN-112: Gebinde/Schwundbuchung am Verschnitt nur aus dem eigenen Betrieb
    ('mandant',       '-US', false, 'journal_konsistenz(p_tenant_id uuid)'),   -- KAN-40 (lesend, jedes Mitglied)
    ('trigger',       '--S', false, 's112_ama_rahmen()'),                      -- KAN-37 C: Stichtag/Abgabefrist aus dem Jahrgang
    ('trigger',       '--S', false, 's112_lese_meldesperre()'),
    ('trigger',       '--S', false, 's112_fuellung_weinart()'),               -- KAN-39: Farbe der Füllung aus der Charge
    ('trigger',       '--S', false, 's112_katalog_ableiten()'),               -- KAN-186: Erzeugnis/Zusatz aus der Qualität                -- KAN-37 C: Lese-Sperre nach dem Einreichen
    ('mandant',       '-US', true , 's112_fuellung_verkauf_buchen(p_tenant_id uuid, p_fuellung_id uuid, p_verkaufsposten_id uuid, p_menge_stk integer, p_datum date, p_grund text)'),   -- KAN-149 D1
    ('trigger',       '--S', false, 's112_ea_abschluss_schutz()'),             -- KAN-149 D3: Monatsabschluss, gesperrte UVA, verbuchte Belege
    ('intern',        '--S', false, 's112_ea_gegenbuchung(p_tenant_id uuid, p_id uuid, p_grund text, p_datum date)'),   -- KAN-149 D2 (Hilfsfunktion)
    ('trigger',       '--S', false, 's112_ea_periodensperre()'),               -- KAN-149 D3: Periodensperre E/A, Zahlungen, Umbuchungen
    ('trigger',       '--S', false, 's112_rechnung_periodensperre()'),         -- KAN-355: Periodensperre Rechnungsdatum
    ('trigger',       '--S', false, 's112_rechnung_positionen_periodensperre()'),   -- KAN-355: Beträge der Positionen einer gesperrten Rechnung
    ('mandant',       '-US', true , 's112_ea_stornieren(p_tenant_id uuid, p_id uuid, p_grund text, p_datum date)'),   -- KAN-149 D2
    ('mandant',       '-US', true , 's112_ea_beleg_loesen(p_tenant_id uuid, p_beleg_id uuid, p_grund text)'),   -- KAN-415: Beleg von der Buchung lösen (offener Zeitraum)
    ('mandant',       '-US', true , 's112_export_muster_buchen(p_tenant_id uuid, p_auftrag_id uuid, p_datum date, p_zurueck boolean)'),   -- KAN-436 E1: Mustersendung aus- bzw. zurückbuchen
    ('mandant',       '-US', true , 's112_exportauftrag_status_setzen(p_tenant_id uuid, p_auftrag_id uuid, p_status text, p_grund text)'),   -- KAN-440: Statuswechsel mit Prüfung
    ('trigger',       '--S', false, 's112_export_workflow_schutz()'),
    ('trigger',       '--S', false, 's112_export_nachweis_schutz()'),   -- KAN-440 Teil 2: Nachweise ab „Abgeschlossen“ gesperrt   -- KAN-440: Status nie direkt
    ('trigger',       '--S', false, 's112_export_rechnung_schutz()'),   -- KAN-436 E1: Verknüpfung Exportauftrag–Verkauf, Storno-Sperre
    ('trigger',       '--S', false, 's112_export_rechnung_storno()'),   -- KAN-436 E1: Storno des Verkaufs gibt den Exportauftrag frei
    ('mandant',       '-US', true , 's112_exportauftrag_aendern(p_tenant_id uuid, p_auftrag_id uuid, p_kopf jsonb, p_positionen jsonb)'),   -- KAN-429: Exportauftrag bearbeiten (Entwurf/Bestätigt)
    ('trigger',       '--S', false, 's112_ea_storno_schutz()'),                -- KAN-149 D2: E/A, Zahlungen, Umbuchungen
    ('intern',        '--S', false, 's112_ea_zeitraum_sperrgrund(p_tenant_id uuid, p_datum date)'),   -- KAN-149 D3 (Hilfsfunktion ohne Zugriffsprüfung)
    ('intern',        '--S', false, 's112_storno_benutzername(p_uid uuid)'),   -- KAN-149 D2 (Hilfsfunktion)
    ('mandant',       '-US', true , 's112_umbuchung_stornieren(p_tenant_id uuid, p_id uuid, p_grund text)'),   -- KAN-149 D2
    ('mandant',       '-US', true , 's112_zahlung_stornieren(p_tenant_id uuid, p_zahlung_id uuid, p_grund text, p_datum date)'),   -- KAN-149 D2
    ('mandant',       '-US', false, 's112_schwund_minderung(p_tenant_id uuid, p_umzug_id uuid)'),   -- KAN-145 B4 (lesend)
    ('trigger',       '--S', false, 's112_verkauf_storno_schutz()'),           -- KAN-149 D1: Verkaufsstorno mit Grund, unveränderlich
    ('trigger',       '--S', false, 's112_konto_loeschsperre()'),              -- KAN-149 D3: Konto nur ohne Bewegungen
    ('trigger',       '--S', false, 's112_betriebsmittel_kategorie_pruefen()'), -- KAN-167b: E/A-Kategorie global oder eigener Betrieb
    ('intern',        '--S', false, 's112_firma_momentaufnahme(p_id uuid)'),   -- KAN-150 F1c (Hilfsfunktion)
    ('mandant',       '-US', true , 's112_kontakt_historie_zu_firma(p_tenant_id uuid, p_kontakt_id uuid, p_firma_id uuid)'),   -- KAN-150 F1c: Umwandeln
    ('mandant',       '-US', true , 's112_herkunft_setzen(p_tenant_id uuid, p_weinausbau_id uuid, p_weingarten_ids uuid[], p_grund text)'),   -- KAN-150 F1d: Herkunft der Charge
    ('intern',        '--S', false, 's112_kontakt_momentaufnahme(p_id uuid)'),   -- KAN-150 F1c (Hilfsfunktion)
    ('trigger',       '--S', false, 's112_momentaufnahme()'),                  -- KAN-150 F1c: Belege
    ('mandant',       '-US', false, 's112_stammdaten_bezuege(p_tenant_id uuid, p_tabelle text, p_id uuid)'),   -- KAN-150 F1a (lesend, jedes Mitglied)
    ('intern',        '--S', false, 's112_stammdaten_bezuege_intern(p_tabelle text, p_id uuid)'),   -- KAN-150 F1a (Hilfsfunktion ohne Zugriffsprüfung)
    ('trigger',       '--S', false, 's112_stammdaten_loeschsperre()'),         -- KAN-150 F1a: Stammdaten mit Bezug nur deaktivieren
    ('trigger',       '--S', false, 's112_jahrgang_loeschsperre()'),          -- KAN-148 C1d: Jahrgang nur ohne Bezüge
    ('trigger',       '--S', false, 's112_loeschsperre()'),                    -- KAN-145 A: BEFORE-DELETE-Sperre
    ('mandant',       '-US', true , 's112_storniert_loeschen(p_tenant_id uuid, p_tabelle text, p_id uuid, p_grund text)'),   -- KAN-145 A
    ('trigger',       '--S', false, 's112_storno_schutz()'),                   -- KAN-145 B1: Storno-Spalten
    ('trigger',       '--S', false, 's112_export_kind_schutz()'),              -- KAN-150 F2a: Kinder eines stornierten Exportauftrags
    ('mandant',       '-US', true , 'schwund_buchen(p_tenant_id uuid, p_weinausbau_id uuid, p_liter numeric, p_datum date, p_notiz text, p_abschliessen boolean, p_bestand_mindern boolean)'),
    ('mandant',       '-US', true , 'setze_kontobewegung_abgeglichen(p_tenant_id uuid, p_quelle text, p_id uuid, p_abgeglichen boolean)'),
    ('mandant',       '-US', true , 'sperre_ea_monat(p_tenant_id uuid, p_jahr smallint, p_monat smallint)'),
    ('mandant',       '-US', true , 'sperre_ea_uva(p_tenant_id uuid, p_jahr smallint, p_zeitraum text)'),
    ('trigger',       '--S', false, 'sumup_tx_zu_zahlung()'),
    ('trigger',       '--S', false, 'sync_verkaufsposten_bezahlt()'),
    ('rls_hilfe',     '-US', false, 'tenant_has_module(p_module text)'),
    ('trigger',       '--S', false, 'trg_tenant_plattform_admins()'),
    ('rls_hilfe',     '-US', false, 'user_has_role_in_tenant(p_tenant_id uuid, p_roles text[])'),
    ('trigger',       '--S', false, 'weinausbau_gebinde_pruefen()'),
    ('trigger',       '--S', false, 's112_fassung_vorher()'),                  -- KAN-381: Inhalt je Gebinde vor der ersten Änderung
    ('trigger',       '--S', false, 's112_fassungsvermoegen_pruefen()')        -- KAN-381: kein Zugang über das Fassungsvermögen
  ) v (einstufung, rechte, abo, funktion)
  ORDER BY funktion
$f$;
