-- @bereich: SECURITY-DEFINER-RPCs und EXECUTE-Rechte
-- @ziel: Jede SECURITY-DEFINER-Funktion mit p_tenant_id ist eingestuft und lehnt einen fremden Betrieb ab
-- @ziel: (pruefe_tenant_zugriff bzw. eigene Mitgliedsprüfung), Rollenlisten und Abo-Schreibsperre greifen in den
-- @ziel: RPCs, anon führt keine SECURITY-DEFINER-Funktion aus, interne Funktionen sind für Benutzer nicht
-- @ziel: aufrufbar, schreibende RPCs prüfen das Schreibmodul (KAN-159); ki_readonly_query liest nur den aktiven Betrieb (B6 behoben). EXECUTE-Rechte
-- @ziel: nach der REVOKE-Regel (B10, B11 seit KAN-159 Teil 2 hart).
-- @mutation pruefe_offen: pruefe_tenant_zugriff prüft nichts mehr | rot: fremd_.*|rolle_.*
-- @mutation eigen_offen: get_user_role_in_tenant ohne auth.uid()-Bezug | rot: fremd_get_user_role_in_tenant
-- @mutation anon_grant: anon bekommt EXECUTE auf get_next_liefernummer | rot: anon_.*
-- @mutation intern_grant: authenticated bekommt EXECUTE auf kundennummer_vergeben | rot: intern_.*
-- @mutation rpc_neu: neue SECURITY-DEFINER-Funktion mit p_tenant_id ohne Einstufung | rot: rpc_ohne_einstufung.*|anon_.*
-- @mutation abo_weg: s112_pruefe_abo_schreibsperre prüft nichts mehr | rot: abo_.*
-- @mutation idor_fuellung: fuellung_bestand_buchen sucht die Füllung ohne tenant_id-Filter | rot: idor_fuellung_bestand_buchen
-- @mutation ki_ohne_allowlist: ki_readonly_query verwirft Verstöße der Strukturprüfung nicht mehr | rot: ki_nur_lesen_.*|ki_statisch_verstoss_abgelehnt
-- @mutation ki_ohne_read_only: ki_readonly_query setzt transaction_read_only nicht mehr | rot: ki_statisch_read_only
-- @mutation modul_fuellung_crm: fuellung_bestand_buchen prüft das Modul 'crm' statt kellerbuch/warenwirtschaft | rot: modul_fuellung_.*
-- @mutation modul_schwund_ohne_rieden: schwund_buchen verlangt beim Bestandmindern kein kellerbuch/rieden mehr | rot: modul_schwund_.*
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 18 (Stand 28.09.2026).
-- Nur Staging. Eine Transaktion, endet mit pg_temp.s112_ende(…) = RAISE → alles zurückgerollt.
--
-- Geprüft wird:
--   1. Katalog: alle Funktionen in public mit prosecdef und Argument p_tenant_id haben eine Soll-Einstufung
--      in pg_temp.s112_soll_rpc() (_helfer.sql); 17 davon rufen pruefe_tenant_zugriff auf; abo = true ⇒ Aufruf
--      von s112_pruefe_abo_schreibsperre.
--   2. 'pruefe' (Einstufung mandant + pruefe_tenant_zugriff selbst): als b_ta mit p_tenant_id = Musterhof und
--      typgerechten Dummy-Argumenten → 42501 „Kein Zugriff auf diesen Betrieb“; als m_ta kein Zugriffsfehler
--      (andere Fehler wegen der Dummy-Argumente sind zulässig). Jeder Aufruf läuft in einem Unterblock, der
--      immer scheitert (pg_temp.t18_ruf) – Seiteneffekte der Positivkontrollen werden sofort zurückgerollt.
--   3. Rollenlisten (sperre_ea_* nur SA/TA, Nummernkreise/Buchungen nicht für Leser) und Abo-Schreibsperre der
--      schreibenden RPCs in einem gekündigten Betrieb B.
--   4. 'eigen' (s112_mandant_mitglieder, get_user_role_in_tenant, user_has_role_in_tenant): fremd leer/NULL/false.
--   5. 'session_user' (crm_*, lade_*, kontakte_zusammenfuehren): erlauben bei session_user = postgres – über die
--      Management-API (session_user immer postgres) nicht dynamisch prüfbar, daher nur statisch (Mitgliedsprüfung
--      mit auth.uid() und m.aktiv, schreibende mit Abo-Prüfung). Die Laufzeitprüfung läuft über PostgREST/E2E.
--   6. EXECUTE-Rechte: anon auf keiner SECURITY-DEFINER-Funktion, tatsächlicher anon-Aufruf → 42501, Menge der
--      anon/PUBLIC-Funktionen = Soll (B10), interne Funktionen ohne EXECUTE für authenticated,
--      Triggerfunktionen ohne EXECUTE für authenticated (B11; beides seit KAN-159 Teil 2 hart).
--   7. Modulprüfung (seit KAN-159 hart, vorher B9): jede schreibende RPC für Winzer ruft s112_darf_schreiben bzw.
--      s112_pruefe_schreibmodul auf; is_locked bleibt beim Kontenabgleich bewusst ungeprüft. B6 (ki_readonly_query las bei
--      zwei Betrieben Kontakte des anderen) ist seit kan159b6_ki_aktiver_betrieb behoben und hart geprüft.
--   4b. Eigener Betrieb, fremdes Objekt (IDOR): b_ta ruft die RPCs mit p_tenant_id = B, aber mit echten Objekten
--      des Musterhofs auf (Füllung, Charge, E&A-Buchung, Grundstücke). Als postgres wird im selben Unterblock
--      belegt, dass die M-Zeile unverändert ist; die Positivkontrolle mit B-Objekten ändert die B-Zeile. Jede
--      SECURITY-DEFINER-Funktion mit p_tenant_id und weiteren uuid-Argumenten muss dort (oder begründet als intern
--      bzw. session_user mit statischer Prüfung) stehen, sonst FEHLER idor_ohne_pruefung:<fn>.
--   4c. Modulprüfung in fuellung_bestand_buchen (kellerbuch|warenwirtschaft) und schwund_buchen (kellerbuch|
--      warenwirtschaft und beim Bestandmindern zusätzlich kellerbuch|rieden) im eigenen Betrieb B ausgeführt:
--      b_w (alle Module) und Einmodul-Winzer mit passendem Modul buchen, Winzer nur mit crm, nur rieden bzw. nur
--      warenwirtschaft werden mit „Keine Schreibberechtigung …“ abgelehnt und der Bestand bleibt unverändert.
--   8. KI zuletzt: ki_readonly_query setzt app.active_tenant_id und transaction_read_only transaktionslokal – alle
--      KI-Aufrufe laufen über pg_temp.t18_ruf (zurückgerollt) und stehen am Dateiende. Nur-Lesen und Reichweite:
--      DML/DDL (auch als data-modifying CTE), Mehrfachanweisungen, set_config, Geheimnis-Spalten, auth.*,
--      plattform_admins und pg_catalog-Tabellen werden abgelehnt; statisch: transaction_read_only wird gesetzt.

-- Aufruf einer Funktion mit typgerechten Dummy-Argumenten: p_tenant_id = p_tenant, sonst ein fester Wert je Typ.
-- Ergebnis: 'SELECT count(*)::text FROM public.<fn>(…)' (funktioniert für Skalar-, void- und Mengenfunktionen).
CREATE FUNCTION pg_temp.t18_aufruf(p_fn oid, p_tenant uuid) RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT format('SELECT count(*)::text FROM public.%I(%s)', p.proname,
    coalesce(string_agg(
      CASE
        WHEN a.name = 'p_tenant_id' THEN format('%L::uuid', p_tenant)
        WHEN a.typ = 'uuid'::regtype THEN format('%L::uuid', gen_random_uuid())
        WHEN a.typ = 'uuid[]'::regtype THEN '''{}''::uuid[]'
        WHEN a.typ = 'text'::regtype THEN '''s112test''::text'
        WHEN a.typ = 'text[]'::regtype THEN 'NULL::text[]'
        WHEN a.typ = 'smallint'::regtype THEN '1::smallint'
        WHEN a.typ = 'integer'::regtype THEN '1::integer'
        WHEN a.typ = 'bigint'::regtype THEN '1::bigint'
        WHEN a.typ = 'numeric'::regtype THEN '0::numeric'
        WHEN a.typ = 'date'::regtype THEN 'pg_temp.s112_heute()'
        WHEN a.typ = 'boolean'::regtype THEN 'false'
        ELSE format('NULL::%s', format_type(a.typ, NULL))
      END, ', ' ORDER BY a.nr) FILTER (WHERE a.typ IS NOT NULL), ''))
  FROM pg_proc p
  LEFT JOIN LATERAL unnest(p.proargtypes::oid[], p.proargnames) WITH ORDINALITY AS a(typ, name, nr) ON true
  WHERE p.oid = p_fn
  GROUP BY p.proname
$f$;

-- Führt p_sql (und danach optional p_danach, dessen Wert zählt) mit der aktiven Rolle aus und rollt IMMER
-- zurück. Ergebnis 'ok|<Wert>' oder '<SQLSTATE>|<Meldung>'. Auch GUCs (app.active_tenant_id,
-- transaction_read_only aus ki_readonly_query) fallen mit dem Unterblock zurück.
CREATE FUNCTION pg_temp.t18_ruf(p_sql text, p_danach text DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v text;
  v_state text;
  v_msg text;
BEGIN
  BEGIN
    EXECUTE p_sql INTO v;
    IF p_danach IS NOT NULL THEN
      EXECUTE p_danach INTO v;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'S1T18', MESSAGE = coalesce(v, 'NULL');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    IF v_state = 'S1T18' THEN
      RETURN 'ok|' || v_msg;
    END IF;
    RETURN v_state || '|' || v_msg;
  END;
END $f$;

-- IDOR-Probe: p_sql als Benutzer p_uid, danach p_pruef als postgres – im selben Unterblock, der IMMER
-- zurückrollt. Ergebnis '<ok|SQLSTATE des Aufrufs>|<Wert von p_pruef>'. Scheitert der Aufruf, ist seine Wirkung
-- schon zurückgerollt; p_pruef zeigt dann den unveränderten Stand. Aufruf als postgres, endet als postgres.
-- p_text: statt nur des SQLSTATE '<SQLSTATE>:<Meldungsanfang>' (für Modul-Ablehnungen „Keine Schreibberechtigung …“).
CREATE FUNCTION pg_temp.t18_idor(p_uid uuid, p_sql text, p_pruef text, p_text boolean DEFAULT false) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  v_ruf   text := 'ok';
  v_wert  text;
  v_state text;
  v_msg   text;
BEGIN
  BEGIN
    PERFORM pg_temp.s112_als(p_uid);
    BEGIN
      EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
      v_ruf := CASE WHEN p_text THEN SQLSTATE || ':' || replace(left(SQLERRM, 40), '|', '/') ELSE SQLSTATE END;
    END;
    PERFORM pg_temp.s112_als_postgres();
    EXECUTE p_pruef INTO v_wert;
    RAISE EXCEPTION USING ERRCODE = 'S1T18', MESSAGE = v_ruf || '|' || coalesce(v_wert, 'NULL');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    PERFORM pg_temp.s112_als_postgres();
    IF v_state = 'S1T18' THEN
      RETURN v_msg;
    END IF;
    RETURN 'probe_fehler:' || v_state || '|' || v_msg;
  END;
END $f$;

-- Kurzform eines t18_ruf-Ergebnisses: 'kein_zugriff' (pruefe_tenant_zugriff lehnt den Betrieb ab), 'rolle'
-- ist dasselbe (Rolle nicht in der Liste liefert dieselbe Meldung), 'abo_gesperrt', 'ok', sonst der Text gekürzt.
CREATE FUNCTION pg_temp.t18_kurz(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE
    WHEN p LIKE '42501|Kein Zugriff auf diesen Betrieb%' THEN 'kein_zugriff'
    WHEN p LIKE '42501|Das Abo dieses Betriebs ist gesperrt%' THEN 'abo_gesperrt'
    WHEN p LIKE '42501|permission denied%' THEN 'recht_fehlt'
    WHEN p LIKE 'ok|%' THEN 'ok'
    ELSE left(p, 160)
  END
$f$;

-- Positivkontrolle: kein Zugriffsfehler aus pruefe_tenant_zugriff, keine Modul-/Rollen-Ablehnung der RPC
-- („Keine Schreibberechtigung …“, „Keine Berechtigung …“) und kein fehlendes Recht.
CREATE FUNCTION pg_temp.t18_zugelassen(p text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $f$
  SELECT NOT (p LIKE '42501|Kein Zugriff%' OR p LIKE '42501|Nicht angemeldet%'
              OR p LIKE '42501|Zwei-Faktor%' OR p LIKE '42501|permission denied%'
              OR p LIKE '42501|Keine Schreibberechtigung%' OR p LIKE '42501|Keine Berechtigung%')
$f$;

-- Ergebnis einer t18_idor-Probe mit p_text = true: Modul-Ablehnung als 'modul_abgelehnt', sonst SQLSTATE/ok,
-- dahinter der Wert der Prüfabfrage ('<ruf>|<wert>').
CREATE FUNCTION pg_temp.t18_modul(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN split_part(p, '|', 1) LIKE '42501:Keine Schreibberechtigung%' THEN 'modul_abgelehnt'
              ELSE split_part(split_part(p, '|', 1), ':', 1) END || '|' || split_part(p, '|', 2)
$f$;

DO $test$
DECLARE
  v_heute date := (now() AT TIME ZONE 'Europe/Vienna')::date;   -- wie die RPCs (Wiener Zeit, nicht UTC)
  c_datei constant text := '18_rpc_security_definer';
  v_t0    timestamptz := clock_timestamp();
  v_erg   text[] := '{}';
  v_a     jsonb;
  v_m     uuid;
  v_b     uuid;
  v_bta   uuid;
  v_mta   uuid;
  v_mw    uuid;
  v_ml    uuid;
  v_mwc   uuid;
  v_mbta  uuid;
  r       record;
  v_r     text;
  v_txt   text;
  v_n     bigint;
  v_n2    bigint;
  v_i     int;
  v_namen text[] := '{}';
  v_sql_m text[] := '{}';
  v_sql_b text[] := '{}';
  v_abo   boolean[] := '{}';
  v_ea    uuid;
  v_ea_abg boolean;
  v_grst  uuid[];
  v_kontakte_m bigint;
  v_weingarten_m bigint;
  -- 4b: RPCs mit Objekt-Argument, dynamisch mit fremdem Objekt geprüft
  -- s112_freeze_korrektur: IDOR (fremde Zeile, fremder Betrieb) prüft 27_freeze
  -- s112_pruefnummernantrag_status_setzen: IDOR (fremder Antrag, fremder Betrieb) prüft 28_pn_workflow
  -- s112_fuellung_nachtragen: IDOR (fremde Füllung, fremde Charge, fremder Antrag) prüft 29_fuellung_freeze
  -- s112_charge_abstufen: IDOR (fremde Charge, fremde Ausgangscharge) prüft 32_charge_abstufen; s112_charge_status_setzen (fremde Charge) 49 (KAN-41)
  -- s112_verarbeitung_buchen (fremde Charge) und s112_verarbeitung_stornieren (fremde Verarbeitung): 52 (KAN-41 Paket 3a)
  -- s112_fuellung_etikettieren (fremde Füllung) und s112_etikettierung_stornieren (fremde Etikettierung): 54 (KAN-41 Paket 3d)
  -- s112_zugangskorrektur_buchen (fremde Charge) und s112_zugangskorrektur_stornieren (fremde Korrektur): 55 (KAN-53)
  -- s112_artikel_buchen (fremdes Produkt), _bewegung_stornieren (fremde Buchung), _verkauf_buchen/_verkauf_stornieren (fremder Verkauf): 61 (KAN-115)
  -- s112_sekt_stufe_setzen (fremde Füllung): 62 (KAN-190)
  -- s112_elabel_umleiten (fremdes E-Label, fremdes Ziel): 65 (KAN-219)
  -- s112_produktion_buchen (fremde Quell-Charge) und s112_produktion_stornieren (fremde Produktion): 66 (KAN-118)
  c_idor  constant text[] := ARRAY['s112_charge_abstufen', 's112_charge_status_setzen', 's112_verarbeitung_buchen', 's112_verarbeitung_stornieren',
                                   's112_zugangskorrektur_buchen', 's112_zugangskorrektur_stornieren',
                                   's112_fuellung_etikettieren', 's112_etikettierung_stornieren', 's112_fuellung_nachtragen', 's112_pruefnummernantrag_status_setzen', 's112_freeze_korrektur', 'fuellung_bestand_buchen', 'schwund_buchen',
                                   'setze_kontobewegung_abgeglichen', 's112_storniert_loeschen',
                                   's112_schwund_minderung', 's112_pressung_stornieren', 's112_pressung_zeilen_stornieren', 's112_mostzeile_anlegen',
                                   's112_ama_korrektur_anlegen', 's112_ama_meldung_speichern', 's112_ama_status_setzen', 's112_ama_einreichen',   -- KAN-37 B
                                   's112_fuellung_verkauf_buchen', 's112_ea_stornieren', 's112_zahlung_stornieren', 's112_umbuchung_stornieren',
                                   's112_stammdaten_bezuege',   -- KAN-150 F1a
                                   's112_kontakt_historie_zu_firma',   -- KAN-150 F1c
                                   's112_herkunft_setzen',   -- KAN-150 F1d
                                   's112_betriebsmittel_einkauf', 's112_betriebsmittel_stornieren',   -- KAN-167
                                   's112_artikel_buchen', 's112_artikel_bewegung_stornieren', 's112_artikel_verkauf_buchen', 's112_artikel_verkauf_stornieren',   -- KAN-115
                                   's112_sekt_stufe_setzen',   -- KAN-190
                                   's112_elabel_umleiten',   -- KAN-219
                                   's112_produktion_buchen', 's112_produktion_stornieren'];   -- KAN-118
  v_pl_m  uuid;
  v_pl_b  uuid;
  v_kb_m  uuid;
  v_pr_m  uuid;
  v_pr_b  uuid;
  v_pz_m  uuid;
  v_pz_b  uuid;
  v_pw_m  uuid;
  v_pw_b  uuid;
  v_beh_b uuid;
  v_ajg_m uuid;   -- KAN-148 C2: Jahrgänge und AMA-Meldungen in M und B
  v_ajg_b uuid;
  v_am_m  uuid;
  v_am_b  uuid;
  v_fz_m  uuid;   -- KAN-149 D1: Füllungen in M und B
  v_fz_b  uuid;
  v_x_m   uuid;   -- KAN-149 D2: E/A-Buchung, Zahlung, Umbuchung in M und B
  v_x_b   uuid;
  v_kb_b  uuid;
  v_sd_m  uuid;   -- KAN-150 F1a: Ried in M und B
  v_sd_b  uuid;
  v_f_m   uuid;
  v_f_b   uuid;
  v_w_m   uuid;
  v_w_b   uuid;
  v_e_m   uuid;
  v_e_b   uuid;
  v_bm_m  uuid;   -- KAN-167: Betriebsmittel und Lagerbuchungen in M und B, Ausgaben-Kategorie (global)
  v_bm_b  uuid;
  v_bml_m uuid;
  v_bml_b uuid;
  v_eakat uuid;
  v_vor   text;
  v_sql   text;
  v_pruef text;
  -- 4c: Winzer in B mit einzelnen Modulen
  v_bw    uuid;
  v_bwc   uuid;
  v_bww   uuid;
  v_bwr   uuid;
  v_bwk   uuid;
BEGIN
  PERFORM pg_temp.s112_nur_staging();
  v_a := pg_temp.s112_aufbau();
  v_bw  := (v_a ->> 'b_w')::uuid;
  v_bwc := pg_temp.s112_benutzer('winzer', (v_a ->> 'b')::uuid, ARRAY['crm']);
  v_bww := pg_temp.s112_benutzer('winzer', (v_a ->> 'b')::uuid, ARRAY['warenwirtschaft']);
  v_bwr := pg_temp.s112_benutzer('winzer', (v_a ->> 'b')::uuid, ARRAY['rieden']);
  v_bwk := pg_temp.s112_benutzer('winzer', (v_a ->> 'b')::uuid, ARRAY['kellerbuch']);
  v_m := (v_a ->> 'm')::uuid;
  v_b := (v_a ->> 'b')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_mta := (v_a ->> 'm_ta')::uuid;
  v_mw := (v_a ->> 'm_w')::uuid;
  v_ml := (v_a ->> 'm_l')::uuid;
  v_mwc := (v_a ->> 'm_wc')::uuid;
  v_mbta := (v_a ->> 'mb_ta')::uuid;

  -- Mutationen (nur im Mutationsmodus von run.mjs; sonst ohne Wirkung)
  PERFORM pg_temp.s112_mutiere('pruefe_offen',
    $m$CREATE OR REPLACE FUNCTION public.pruefe_tenant_zugriff(p_tenant_id uuid, p_rollen text[] DEFAULT NULL::text[])
       RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $x$ BEGIN NULL; END $x$$m$);
  PERFORM pg_temp.s112_mutiere('eigen_offen',
    $m$CREATE OR REPLACE FUNCTION public.get_user_role_in_tenant(p_tenant_id uuid)
       RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
       AS $x$ SELECT role FROM tenant_memberships WHERE tenant_id = p_tenant_id AND aktiv LIMIT 1 $x$$m$);
  PERFORM pg_temp.s112_mutiere('anon_grant', $m$GRANT EXECUTE ON FUNCTION public.get_next_liefernummer(uuid) TO anon$m$);
  PERFORM pg_temp.s112_mutiere('intern_grant', $m$GRANT EXECUTE ON FUNCTION public.kundennummer_vergeben(uuid, integer) TO authenticated$m$);
  PERFORM pg_temp.s112_mutiere('rpc_neu',
    $m$CREATE FUNCTION public.s112test_rpc(p_tenant_id uuid) RETURNS integer LANGUAGE sql SECURITY DEFINER
       SET search_path TO 'public' AS $x$ SELECT 1 $x$$m$);
  PERFORM pg_temp.s112_mutiere('idor_fuellung',
    replace(replace(pg_get_functiondef('public.fuellung_bestand_buchen(uuid, uuid, text, date, integer, integer, text)'::regprocedure),
      'WHERE f.id = p_fuellung_id AND f.tenant_id = p_tenant_id', 'WHERE f.id = p_fuellung_id'),
      'WHERE id = p_fuellung_id AND tenant_id = p_tenant_id', 'WHERE id = p_fuellung_id'));
  PERFORM pg_temp.s112_mutiere('modul_fuellung_crm',
    replace(pg_get_functiondef('public.fuellung_bestand_buchen(uuid, uuid, text, date, integer, integer, text)'::regprocedure),
      $r$s112_darf_schreiben(p_tenant_id, 'kellerbuch', 'warenwirtschaft')$r$, $r$s112_darf_schreiben(p_tenant_id, 'crm')$r$));
  PERFORM pg_temp.s112_mutiere('modul_schwund_ohne_rieden',
    replace(pg_get_functiondef('public.schwund_buchen(uuid, uuid, numeric, date, text, boolean, boolean)'::regprocedure),
      $r$OR public.s112_darf_schreiben(p_tenant_id, 'kellerbuch', 'rieden')$r$, 'OR true'));
  PERFORM pg_temp.s112_mutiere('ki_ohne_allowlist',
    replace(pg_get_functiondef('public.ki_readonly_query(text, uuid)'::regprocedure),
      'IF v_verstoss IS NOT NULL THEN', 'IF false THEN'));
  PERFORM pg_temp.s112_mutiere('ki_ohne_read_only',
    replace(pg_get_functiondef('public.ki_readonly_query(text, uuid)'::regprocedure),
      $r$PERFORM set_config('transaction_read_only', 'on', true);$r$, 'NULL;'));
  PERFORM pg_temp.s112_mutiere('abo_weg',
    $m$CREATE OR REPLACE FUNCTION public.s112_pruefe_abo_schreibsperre(p_tenant_id uuid)
       RETURNS void LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $x$ BEGIN NULL; END $x$$m$);

  -- ── 1. Katalog: Einstufung aller SECURITY-DEFINER-Funktionen mit p_tenant_id ───────────────────────────
  v_n := 0;
  FOR r IN
    SELECT p.oid, p.proname::text AS name, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig,
           s.einstufung, s.abo, p.prosrc
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
      LEFT JOIN pg_temp.s112_soll_rpc() s ON s.funktion = p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
     WHERE p.prosecdef AND 'p_tenant_id' = ANY (p.proargnames)
     ORDER BY p.proname
  LOOP
    v_n := v_n + 1;
    IF r.einstufung IS NULL THEN
      v_erg := v_erg || pg_temp.s112_fehler('rpc_ohne_einstufung:' || r.name,
        r.sig || ' fehlt in pg_temp.s112_soll_rpc() (_helfer.sql) – einstufen');
      CONTINUE;
    END IF;
    -- Einstufung mandant ⇒ pruefe_tenant_zugriff im Rumpf
    IF r.einstufung = 'mandant' THEN
      v_erg := v_erg || pg_temp.s112_erwarte('mandant_ruft_pruefe:' || r.name, r.prosrc ~ 'pruefe_tenant_zugriff\s*\(', true);
    END IF;
    -- Soll abo = true ⇒ Abo-Schreibsperre im Rumpf
    IF r.abo THEN
      v_erg := v_erg || pg_temp.s112_erwarte('abo_statisch:' || r.name, r.prosrc ~ 's112_pruefe_abo_schreibsperre\s*\(', true);
    END IF;
    -- dynamische Liste 'pruefe' (ki_readonly_query separat am Dateiende)
    IF (r.einstufung = 'mandant' OR r.name = 'pruefe_tenant_zugriff') AND r.name <> 'ki_readonly_query' THEN
      v_namen := v_namen || r.name;
      v_sql_m := v_sql_m || pg_temp.t18_aufruf(r.oid, v_m);
      v_sql_b := v_sql_b || pg_temp.t18_aufruf(r.oid, v_b);
      v_abo := v_abo || r.abo;
    END IF;
  END LOOP;
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_liste_vollstaendig', v_n >= 30, true);   -- 30 seit KAN-127 (get_behandlungen_fuer_grundstuecke entfernt)
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
   WHERE p.prosecdef AND 'p_tenant_id' = ANY (p.proargnames) AND p.prosrc ~ 'pruefe_tenant_zugriff\s*\(';
  v_erg := v_erg || pg_temp.s112_erwarte('rpc_mit_pruefe_tenant_zugriff', v_n, 64);   -- +2 KAN-118 (s112_produktion_buchen, _stornieren)   -- +1 KAN-219 (s112_elabel_umleiten)   -- +1 KAN-190 (s112_sekt_stufe_setzen)   -- +4 KAN-115 (s112_artikel_*)   -- +2 KAN-53 (s112_zugangskorrektur_buchen, _stornieren)   -- +2 KAN-41 Paket 3d (s112_fuellung_etikettieren, _stornieren)   -- +2 KAN-41 Paket 3a (s112_verarbeitung_buchen, _stornieren)   -- +1 KAN-41 (s112_charge_status_setzen)   -- +1 KAN-17 (s112_privat_bloecke)   -- −1 KAN-88 (s112_buchung_loeschen entfällt)   -- +1 KAN-82 (s112_charge_abstufen)   -- +1 KAN-101 (s112_fuellung_nachtragen)   -- +1 KAN-97 (s112_pruefnummernantrag_status_setzen)   -- +1 KAN-96 (s112_freeze_korrektur)   -- +1 KAN-193 (s112_zukauf_buchen)   -- +1 KAN-112 (s112_verschnitte_buchen)   -- +1 KAN-112 (s112_verschnitt_buchen)   -- +1 KAN-192 (kellerbuch_abschliessen)   -- +3 KAN-40 (journal_eroeffnen, journal_abgleichen, journal_konsistenz)   -- +1 KAN-37 B (s112_ama_einreichen)   -- +2 KAN-167 (s112_betriebsmittel_einkauf, _stornieren)   -- +1 KAN-151 G1 (s112_mandant_loeschen)   -- +1 KAN-150 F1d (s112_herkunft_setzen)   -- +1 KAN-150 F1c (s112_kontakt_historie_zu_firma)   -- +1 KAN-150 F1a (s112_stammdaten_bezuege)   -- +3 KAN-149 D2   -- +1 KAN-149 D1   -- +3 KAN-148 C2 (s112_ama_*)   -- +3 KAN-148 C1c-2   -- +s112_pressung_stornieren (KAN-148 C1c)   -- +s112_schwund_minderung (KAN-145 B4)   -- +s112_storniert_loeschen (KAN-145), s112_buchung_loeschen (KAN-166)
  v_erg := v_erg || pg_temp.s112_erwarte('pruefe_liste_dynamisch', coalesce(array_length(v_namen, 1), 0), 59);   -- +2 KAN-118   -- +1 KAN-219   -- +1 KAN-190   -- +4 KAN-115   -- +2 KAN-53   -- +2 KAN-41 Paket 3d   -- +2 KAN-41 Paket 3a   -- +1 KAN-41   -- −2 KAN-22 (KI-Zähler nur Service-Role)   -- −1 KAN-21   -- +1 KAN-17   -- −1 KAN-88 (s112_buchung_loeschen entfällt)   -- +1 KAN-82   -- +1 KAN-101   -- +1 KAN-97   -- +1 KAN-96   -- +1 KAN-193 (s112_zukauf_buchen)   -- +1 KAN-112 (s112_verschnitte_buchen)   -- +1 KAN-112   -- +1 KAN-192   -- +3 KAN-40   -- +1 KAN-37 B   -- +2 KAN-167   -- +1 KAN-150 F1d   -- +1 KAN-150 F1c   -- +1 KAN-150 F1a   -- +3 KAN-149 D2   -- +1 KAN-149 D1   -- +3 KAN-148 C2
  -- Soll-Einträge mit p_tenant_id, die es nicht (mehr) gibt
  SELECT string_agg(s.funktion, ', ') INTO v_txt FROM pg_temp.s112_soll_rpc() s
   WHERE s.funktion LIKE '%p_tenant_id %'
     AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
                      WHERE p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = s.funktion);
  v_erg := v_erg || pg_temp.s112_erwarte('soll_rpc_ohne_funktion', coalesce(v_txt, ''), '');

  -- ── 2. 'pruefe': fremder Betrieb abgelehnt, eigener zugelassen ──────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bta);
  -- Ohne Claims ließe pruefe_tenant_zugriff im Service-Kontext alles durch – Claims belegen
  v_erg := v_erg || pg_temp.s112_erwarte('claims_gesetzt_b_ta',
    current_user::text || '/' || coalesce(auth.uid()::text, 'NULL') || '/' || coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'NULL'),
    'authenticated/' || v_bta || '/authenticated');
  FOR v_i IN 1 .. coalesce(array_length(v_namen, 1), 0) LOOP
    v_r := pg_temp.t18_ruf(v_sql_m[v_i]);
    v_erg := v_erg || pg_temp.s112_erwarte('fremd_' || v_namen[v_i], pg_temp.t18_kurz(v_r), 'kein_zugriff');
  END LOOP;

  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('claims_gesetzt_m_ta', coalesce(auth.uid()::text, 'NULL'), v_mta::text);
  FOR v_i IN 1 .. coalesce(array_length(v_namen, 1), 0) LOOP
    v_r := pg_temp.t18_ruf(v_sql_m[v_i]);
    IF pg_temp.t18_zugelassen(v_r) THEN
      v_erg := v_erg || pg_temp.s112_ok('eigen_' || v_namen[v_i]);
    ELSE
      v_erg := v_erg || pg_temp.s112_fehler('eigen_' || v_namen[v_i], 'als m_ta abgelehnt: ' || v_r);
    END IF;
  END LOOP;

  -- ── 3. Rollenlisten ──────────────────────────────────────────────────────────────────────────────────────
  FOR v_i IN 1 .. coalesce(array_length(v_namen, 1), 0) LOOP
    IF v_namen[v_i] IN ('sperre_ea_monat', 'sperre_ea_uva') THEN
      PERFORM pg_temp.s112_als(v_mw);
      v_erg := v_erg || pg_temp.s112_erwarte('rolle_' || v_namen[v_i] || '_winzer', pg_temp.t18_kurz(pg_temp.t18_ruf(v_sql_m[v_i])), 'kein_zugriff');
      PERFORM pg_temp.s112_als(v_mta);
      v_erg := v_erg || pg_temp.s112_erwarte('rolle_' || v_namen[v_i] || '_ta', pg_temp.t18_zugelassen(pg_temp.t18_ruf(v_sql_m[v_i])), true);
    ELSIF v_namen[v_i] LIKE 'get\_next\_%' OR v_namen[v_i] IN ('fuellung_bestand_buchen', 'schwund_buchen', 'setze_kontobewegung_abgeglichen') THEN
      PERFORM pg_temp.s112_als(v_ml);
      v_erg := v_erg || pg_temp.s112_erwarte('rolle_' || v_namen[v_i] || '_leser', pg_temp.t18_kurz(pg_temp.t18_ruf(v_sql_m[v_i])), 'kein_zugriff');
      PERFORM pg_temp.s112_als(v_mw);
      v_r := pg_temp.t18_ruf(v_sql_m[v_i]);
      IF pg_temp.t18_zugelassen(v_r) THEN
        v_erg := v_erg || pg_temp.s112_ok('rolle_' || v_namen[v_i] || '_winzer');
      ELSE
        v_erg := v_erg || pg_temp.s112_fehler('rolle_' || v_namen[v_i] || '_winzer', 'als m_w abgelehnt: ' || v_r);
      END IF;
    END IF;
  END LOOP;
  PERFORM pg_temp.s112_als_postgres();
  SELECT count(*) INTO v_n FROM unnest(v_namen) x
   WHERE x IN ('sperre_ea_monat', 'sperre_ea_uva', 'fuellung_bestand_buchen', 'schwund_buchen', 'setze_kontobewegung_abgeglichen') OR x LIKE 'get\_next\_%';
  v_erg := v_erg || pg_temp.s112_erwarte('rollenlisten_abgedeckt', v_n, 10);   -- −1 KAN-21 (get_next_rechnungsnummer intern)

  -- ── 3b. Abo-Schreibsperre der schreibenden RPCs (in B; der Musterhof ist fest ausgenommen) ─────────────
  PERFORM pg_temp.s112_als(v_bta);
  v_r := pg_temp.t18_ruf(format('SELECT public.get_next_liefernummer(%L)', v_b));
  v_erg := v_erg || pg_temp.s112_erwarte('abo_kontrolle_b_offen', pg_temp.t18_kurz(v_r), 'ok');
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.tenants SET stripe_status = 'canceled' WHERE id = v_b;
  PERFORM pg_temp.s112_als(v_bta);
  v_n := 0;
  FOR v_i IN 1 .. coalesce(array_length(v_namen, 1), 0) LOOP
    IF v_abo[v_i] THEN
      v_n := v_n + 1;
      v_erg := v_erg || pg_temp.s112_erwarte('abo_' || v_namen[v_i], pg_temp.t18_kurz(pg_temp.t18_ruf(v_sql_b[v_i])), 'abo_gesperrt');
    END IF;
  END LOOP;
  PERFORM pg_temp.s112_als_postgres();
  UPDATE public.tenants SET stripe_status = NULL WHERE id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('abo_rpcs_geprueft', v_n, 52);   -- +2 KAN-118   -- +1 KAN-219   -- +1 KAN-190   -- +4 KAN-115   -- +2 KAN-53   -- +2 KAN-41 Paket 3d   -- +2 KAN-41 Paket 3a   -- +1 KAN-41   -- −1 KAN-21   -- −1 KAN-88 (s112_buchung_loeschen entfällt)   -- +1 KAN-82   -- +1 KAN-101   -- +1 KAN-97   -- +1 KAN-96   -- +1 KAN-193 (s112_zukauf_buchen)   -- +1 KAN-112 (s112_verschnitte_buchen)   -- +1 KAN-112   -- +1 KAN-192   -- +2 KAN-40   -- +1 KAN-37 B   -- +2 KAN-167   -- +1 KAN-150 F1d   -- +1 KAN-150 F1c   -- +3 KAN-149 D2   -- +1 KAN-149 D1   -- +3 KAN-148 C2   -- +3 KAN-148 C1c-2   -- +s112_pressung_stornieren (KAN-148)

  -- ── 4. 'eigen': eigene Mitgliedsprüfung (ohne pruefe_tenant_zugriff) ──────────────────────────────────
  SELECT count(*) INTO v_n FROM public.tenant_memberships WHERE tenant_id = v_m AND aktiv;
  v_erg := v_erg || pg_temp.s112_erwarte('musterhof_hat_mitglieder', v_n > 0, true);
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('fremd_s112_mandant_mitglieder',
    pg_temp.t18_ruf(format('SELECT count(*)::text FROM public.s112_mandant_mitglieder(%L)', v_m)), 'ok|0');
  v_erg := v_erg || pg_temp.s112_erwarte('fremd_get_user_role_in_tenant',
    pg_temp.t18_ruf(format('SELECT public.get_user_role_in_tenant(%L)', v_m)), 'ok|NULL');
  v_erg := v_erg || pg_temp.s112_erwarte('fremd_user_has_role_in_tenant',
    pg_temp.t18_ruf(format('SELECT public.user_has_role_in_tenant(%L, ARRAY[''system_admin'',''tenant_admin'',''winzer'',''leser''])::text', v_m)), 'ok|false');
  PERFORM pg_temp.s112_als(v_mta);
  v_erg := v_erg || pg_temp.s112_erwarte('eigen_s112_mandant_mitglieder',
    pg_temp.t18_ruf(format('SELECT count(*)::text FROM public.s112_mandant_mitglieder(%L)', v_m)), 'ok|' || v_n);
  v_erg := v_erg || pg_temp.s112_erwarte('eigen_get_user_role_in_tenant',
    pg_temp.t18_ruf(format('SELECT public.get_user_role_in_tenant(%L)', v_m)), 'ok|tenant_admin');
  v_erg := v_erg || pg_temp.s112_erwarte('eigen_user_has_role_in_tenant',
    pg_temp.t18_ruf(format('SELECT public.user_has_role_in_tenant(%L, ARRAY[''tenant_admin''])::text', v_m)), 'ok|true');
  PERFORM pg_temp.s112_als_postgres();

  -- B4 (RPC-Teil) behoben: get_behandlungen_fuer_grundstuecke entfernt (KAN-127, 30.09.2026)
  v_erg := v_erg || pg_temp.s112_erwarte('get_behandlungen_fuer_grundstuecke_entfernt', to_regprocedure('public.get_behandlungen_fuer_grundstuecke(uuid[], uuid)') IS NULL, true);

  -- ── 4b. Eigener Betrieb, fremdes Objekt (IDOR) ─────────────────────────────────────────────────────────
  -- Katalog: jede SD-Funktion mit p_tenant_id und weiteren uuid-Argumenten ist hier abgedeckt
  FOR r IN
    SELECT p.oid, p.proname::text AS name, s.einstufung, p.prosrc,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS darf
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
      LEFT JOIN pg_temp.s112_soll_rpc() s ON s.funktion = p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
     WHERE p.prosecdef AND 'p_tenant_id' = ANY (p.proargnames)
       AND EXISTS (SELECT 1 FROM unnest(p.proargtypes::oid[], p.proargnames[1:p.pronargs]) a (t, nm)
                    WHERE nm <> 'p_tenant_id' AND t IN ('uuid'::regtype, 'uuid[]'::regtype))
     ORDER BY p.proname
  LOOP
    IF r.name = ANY (c_idor) THEN
      v_erg := v_erg || pg_temp.s112_ok('idor_katalog:' || r.name);
    ELSIF r.einstufung = 'intern' AND NOT r.darf THEN
      v_erg := v_erg || pg_temp.s112_ok('idor_katalog_intern:' || r.name);   -- für Benutzer nicht aufrufbar (Abschnitt 6)
    ELSIF r.einstufung = 'session_user' AND r.name = 'kontakte_zusammenfuehren' THEN
      -- über die Management-API nicht dynamisch prüfbar (session_user = postgres): beide Kontaktmengen mit tenant_id
      v_erg := v_erg || pg_temp.s112_erwarte('idor_statisch_kontakte_zusammenfuehren',
        r.prosrc ~ 'id\s*=\s*p_behalten\s+AND\s+tenant_id\s*=\s*p_tenant_id'
        AND r.prosrc ~ 'id\s*=\s*ANY\s*\(p_weg\)\s+AND\s+tenant_id\s*=\s*p_tenant_id', true);
    ELSE
      v_erg := v_erg || pg_temp.s112_fehler('idor_ohne_pruefung:' || r.name,
        'SECURITY DEFINER mit p_tenant_id und weiterem uuid-Argument – in 18 Abschnitt 4b (c_idor) mit fremdem Objekt prüfen');
    END IF;
  END LOOP;

  -- Objekte als postgres anlegen: je eines in M (fremd für b_ta) und in B (Positivkontrolle)
  v_f_m := (pg_temp.s112_beispiel('fuellungen', v_m, v_mw, '{"bestand_flaschen": "10"}') ->> 'id')::uuid;
  v_f_b := (pg_temp.s112_beispiel('fuellungen', v_b, (v_a ->> 'b_w')::uuid, '{"bestand_flaschen": "10"}') ->> 'id')::uuid;
  v_w_m := (pg_temp.s112_beispiel('weinausbau', v_m, v_mw, '{"menge_liter": "100"}') ->> 'id')::uuid;
  v_w_b := (pg_temp.s112_beispiel('weinausbau', v_b, (v_a ->> 'b_w')::uuid, '{"menge_liter": "100"}') ->> 'id')::uuid;
  v_e_m := (pg_temp.s112_beispiel('ea_transaktionen', v_m, v_mw) ->> 'id')::uuid;
  v_e_b := (pg_temp.s112_beispiel('ea_transaktionen', v_b, (v_a ->> 'b_w')::uuid) ->> 'id')::uuid;
  SELECT count(*) INTO v_n FROM public.fuellungen WHERE id IN (v_f_m, v_f_b) AND bestand_flaschen = 10;
  SELECT count(*) INTO v_n2 FROM public.weinausbau WHERE id IN (v_w_m, v_w_b) AND menge_liter = 100;
  v_erg := v_erg || pg_temp.s112_erwarte('idor_objekte_existieren', v_n + v_n2
    + (SELECT count(*) FROM public.ea_transaktionen WHERE id IN (v_e_m, v_e_b) AND abgeglichen IS NOT NULL), 6::bigint);
  v_erg := v_erg || pg_temp.s112_erwarte('idor_b_abo_frei', public.s112_abo_gesperrt(v_b), false);

  -- fuellung_bestand_buchen: Korrektur +1 Flasche (Bestand/Bewegungen)
  FOREACH v_txt IN ARRAY ARRAY['m', 'b'] LOOP
    v_sql := format('SELECT public.fuellung_bestand_buchen(%L, %L, %L, pg_temp.s112_heute(), 1, NULL, %L)',
      v_b, CASE v_txt WHEN 'm' THEN v_f_m ELSE v_f_b END, 'korrektur', 'S112TEST');
    v_pruef := format('SELECT f.bestand_flaschen || %L || (SELECT count(*) FROM public.fuellung_bewegungen x WHERE x.fuellung_id = f.id) FROM public.fuellungen f WHERE f.id = %L',
      '/', CASE v_txt WHEN 'm' THEN v_f_m ELSE v_f_b END);
    v_r := pg_temp.t18_idor(v_bta, v_sql, v_pruef);
    IF v_txt = 'm' THEN
      v_erg := v_erg || pg_temp.s112_erwarte('idor_fuellung_bestand_buchen',
        split_part(v_r, '|', 2), '10/0');
    ELSE
      v_erg := v_erg || pg_temp.s112_erwarte('idor_positiv_fuellung_bestand_buchen', v_r, 'ok|11/1');
    END IF;
  END LOOP;

  -- schwund_buchen: 1 L Schwund (Menge/Bewegungsbuch)
  FOREACH v_txt IN ARRAY ARRAY['m', 'b'] LOOP
    v_sql := format('SELECT public.schwund_buchen(%L, %L, 1, pg_temp.s112_heute(), %L, false, true)',
      v_b, CASE v_txt WHEN 'm' THEN v_w_m ELSE v_w_b END, 'S112TEST');
    v_pruef := format('SELECT w.menge_liter::numeric(10,2) || %L || (SELECT count(*) FROM public.keller_umzuege k WHERE k.von_weinausbau_id = w.id) FROM public.weinausbau w WHERE w.id = %L',
      '/', CASE v_txt WHEN 'm' THEN v_w_m ELSE v_w_b END);
    v_r := pg_temp.t18_idor(v_bta, v_sql, v_pruef);
    IF v_txt = 'm' THEN
      v_erg := v_erg || pg_temp.s112_erwarte('idor_schwund_buchen',
        split_part(v_r, '|', 2), '100.00/0');
    ELSE
      v_erg := v_erg || pg_temp.s112_erwarte('idor_positiv_schwund_buchen', v_r, 'ok|99.00/1');
    END IF;
  END LOOP;

  -- s112_storniert_loeschen (KAN-145): stornierte Kellerbehandlung – fremde (M) bleibt, eigene (B) wird gelöscht
  v_kb_m := (pg_temp.s112_beispiel('keller_behandlungen', v_m, v_mw,
    '{"storniert_am": "2026-09-30T10:00:00Z", "storno_grund": "S112TEST storniert"}') ->> 'id')::uuid;
  v_kb_b := (pg_temp.s112_beispiel('keller_behandlungen', v_b, (v_a ->> 'b_w')::uuid,
    '{"storniert_am": "2026-09-30T10:00:00Z", "storno_grund": "S112TEST storniert"}') ->> 'id')::uuid;
  FOREACH v_txt IN ARRAY ARRAY['m', 'b'] LOOP
    v_sql := format('SELECT public.s112_storniert_loeschen(%L, %L, %L, %L)',
      v_b, 'keller_behandlungen', CASE v_txt WHEN 'm' THEN v_kb_m ELSE v_kb_b END, 'S112TEST endgültig löschen');
    v_pruef := format('SELECT count(*)::text FROM public.keller_behandlungen WHERE id = %L', CASE v_txt WHEN 'm' THEN v_kb_m ELSE v_kb_b END);
    v_r := pg_temp.t18_idor(v_bta, v_sql, v_pruef);
    IF v_txt = 'm' THEN
      v_erg := v_erg || pg_temp.s112_erwarte('idor_s112_storniert_loeschen', split_part(v_r, '|', 2), '1');
    ELSE
      v_erg := v_erg || pg_temp.s112_erwarte('idor_positiv_s112_storniert_loeschen', v_r, 'ok|0');
    END IF;
  END LOOP;

  -- s112_pressung_stornieren (KAN-148 C1c): Pressung ohne Behälterzeilen – fremde (M) bleibt, eigene (B) storniert
  v_pr_m := (pg_temp.s112_beispiel('pressungen', v_m, v_mw) ->> 'id')::uuid;
  v_pr_b := (pg_temp.s112_beispiel('pressungen', v_b, (v_a ->> 'b_w')::uuid) ->> 'id')::uuid;
  FOREACH v_txt IN ARRAY ARRAY['m', 'b'] LOOP
    v_sql := format('SELECT public.s112_pressung_stornieren(%L, %L, %L)',
      v_b, CASE v_txt WHEN 'm' THEN v_pr_m ELSE v_pr_b END, 'S112TEST Pressung storniert');
    v_pruef := format('SELECT (storniert_am IS NOT NULL)::text FROM public.pressungen WHERE id = %L', CASE v_txt WHEN 'm' THEN v_pr_m ELSE v_pr_b END);
    v_r := pg_temp.t18_idor(v_bta, v_sql, v_pruef);
    IF v_txt = 'm' THEN
      v_erg := v_erg || pg_temp.s112_erwarte('idor_s112_pressung_stornieren', split_part(v_r, '|', 2), 'false');
    ELSE
      v_erg := v_erg || pg_temp.s112_erwarte('idor_positiv_s112_pressung_stornieren', v_r, 'ok|true');
    END IF;
  END LOOP;

  -- s112_pressung_zeilen_stornieren (KAN-148 C1c-2): Traubenzeile – fremde (M) bleibt, eigene (B) storniert
  v_pz_m := (pg_temp.s112_beispiel('pressungen', v_m, v_mw) ->> 'id')::uuid;
  v_pz_b := (pg_temp.s112_beispiel('pressungen', v_b, (v_a ->> 'b_w')::uuid) ->> 'id')::uuid;
  v_pw_m := (pg_temp.s112_beispiel('pressung_weingaerten', v_m, v_mw, jsonb_build_object('pressung_id', v_pz_m)) ->> 'id')::uuid;
  v_pw_b := (pg_temp.s112_beispiel('pressung_weingaerten', v_b, (v_a ->> 'b_w')::uuid, jsonb_build_object('pressung_id', v_pz_b)) ->> 'id')::uuid;
  FOREACH v_txt IN ARRAY ARRAY['m', 'b'] LOOP
    v_sql := format('SELECT public.s112_pressung_zeilen_stornieren(%L, %L, %L::uuid[], ARRAY[%L]::uuid[], %L)',
      v_b, CASE v_txt WHEN 'm' THEN v_pz_m ELSE v_pz_b END, '{}', CASE v_txt WHEN 'm' THEN v_pw_m ELSE v_pw_b END, 'S112TEST Bearbeiten');
    v_pruef := format('SELECT (storniert_am IS NOT NULL)::text FROM public.pressung_weingaerten WHERE id = %L', CASE v_txt WHEN 'm' THEN v_pw_m ELSE v_pw_b END);
    v_r := pg_temp.t18_idor(v_bta, v_sql, v_pruef);
    IF v_txt = 'm' THEN
      v_erg := v_erg || pg_temp.s112_erwarte('idor_s112_pressung_zeilen_stornieren', split_part(v_r, '|', 2), 'false');
    ELSE
      v_erg := v_erg || pg_temp.s112_erwarte('idor_positiv_s112_pressung_zeilen_stornieren', v_r, 'ok|true');
    END IF;
  END LOOP;

  -- s112_mostzeile_anlegen (KAN-148 C1c-2): Behälterzeile an fremder Pressung (M) – keine, an eigener (B) – eine
  v_beh_b := (pg_temp.s112_beispiel('behaelter', v_b, (v_a ->> 'b_w')::uuid) ->> 'id')::uuid;
  FOREACH v_txt IN ARRAY ARRAY['m', 'b'] LOOP
    v_sql := format('SELECT public.s112_mostzeile_anlegen(%L, %L, %L, 5, NULL, %L::jsonb)',
      v_b, CASE v_txt WHEN 'm' THEN v_pz_m ELSE v_pz_b END, v_beh_b, '{"name": "S112TEST"}');
    v_pruef := format('SELECT count(*)::text FROM public.pressung_behaelter WHERE pressung_id = %L', CASE v_txt WHEN 'm' THEN v_pz_m ELSE v_pz_b END);
    v_r := pg_temp.t18_idor(v_bta, v_sql, v_pruef);
    IF v_txt = 'm' THEN
      v_erg := v_erg || pg_temp.s112_erwarte('idor_s112_mostzeile_anlegen', split_part(v_r, '|', 2), '0');
    ELSE
      v_erg := v_erg || pg_temp.s112_erwarte('idor_positiv_s112_mostzeile_anlegen', v_r, 'ok|1');
    END IF;
  END LOOP;

  -- s112_ama_* (KAN-148 C2): Meldung bzw. Jahrgang eines fremden Betriebs (M) – unverändert, eigener (B) – wirkt
  v_ajg_m := (pg_temp.s112_beispiel('weinjahrgaenge', v_m, v_mw, jsonb_build_object('jahrgang', (SELECT coalesce(min(j.jahrgang), 2000) - 1 FROM public.weinjahrgaenge j WHERE j.tenant_id = v_m))) ->> 'id')::uuid;
  v_ajg_b := (pg_temp.s112_beispiel('weinjahrgaenge', v_b, (v_a ->> 'b_w')::uuid, jsonb_build_object('jahrgang', (SELECT coalesce(min(j.jahrgang), 2000) - 1 FROM public.weinjahrgaenge j WHERE j.tenant_id = v_b))) ->> 'id')::uuid;
  FOREACH v_txt IN ARRAY ARRAY['m', 'b'] LOOP
    v_sql := format('SELECT public.s112_ama_meldung_speichern(%L, %L, %L::jsonb, %L::jsonb)',
      v_b, CASE v_txt WHEN 'm' THEN v_ajg_m ELSE v_ajg_b END, '{}', '[{"rebsorte_name": "S112TEST"}]');
    v_pruef := format('SELECT count(*)::text FROM public.ama_erntemeldungen WHERE jahrgang_id = %L', CASE v_txt WHEN 'm' THEN v_ajg_m ELSE v_ajg_b END);
    v_r := pg_temp.t18_idor(v_bta, v_sql, v_pruef);
    IF v_txt = 'm' THEN
      v_erg := v_erg || pg_temp.s112_erwarte('idor_s112_ama_meldung_speichern', split_part(v_r, '|', 2), '0');
    ELSE
      v_erg := v_erg || pg_temp.s112_erwarte('idor_positiv_s112_ama_meldung_speichern', v_r, 'ok|1');
    END IF;
  END LOOP;
  v_am_m := (pg_temp.s112_beispiel('ama_erntemeldungen', v_m, v_mw, jsonb_build_object('jahrgang_id', v_ajg_m, 'status', 'bereit')) ->> 'id')::uuid;
  v_am_b := (pg_temp.s112_beispiel('ama_erntemeldungen', v_b, (v_a ->> 'b_w')::uuid, jsonb_build_object('jahrgang_id', v_ajg_b, 'status', 'bereit')) ->> 'id')::uuid;
  FOREACH v_txt IN ARRAY ARRAY['m', 'b'] LOOP
    -- KAN-37 B: „eingereicht“ nur noch über s112_ama_einreichen (mit Snapshot der CSV)
    v_sql := format('SELECT public.s112_ama_einreichen(%L, %L, pg_temp.s112_heute(), NULL, %L::jsonb)', v_b, CASE v_txt WHEN 'm' THEN v_am_m ELSE v_am_b END,
      jsonb_build_object('meldung', 'erntemeldung', 'parameter', jsonb_build_object('jahrgang',
        (SELECT j.jahrgang FROM public.weinjahrgaenge j WHERE j.id = CASE v_txt WHEN 'm' THEN v_ajg_m ELSE v_ajg_b END)),
        'zeilen', '[]'::jsonb, 'spalten', '[{"kopf": "S112TEST", "typ": "text"}]'::jsonb, 'profil', 'EXCEL_AT',
        'dateiname', 'S112TEST.csv', 'csv', 'S112TEST'));
    v_pruef := format('SELECT status FROM public.ama_erntemeldungen WHERE id = %L', CASE v_txt WHEN 'm' THEN v_am_m ELSE v_am_b END);
    v_r := pg_temp.t18_idor(v_bta, v_sql, v_pruef);
    IF v_txt = 'm' THEN
      v_erg := v_erg || pg_temp.s112_erwarte('idor_s112_ama_einreichen', split_part(v_r, '|', 2), 'bereit');
    ELSE
      v_erg := v_erg || pg_temp.s112_erwarte('idor_positiv_s112_ama_einreichen', v_r, 'ok|eingereicht');
    END IF;
  END LOOP;
  UPDATE public.ama_erntemeldungen SET status = 'eingereicht', eingereicht_am = v_heute WHERE id IN (v_am_m, v_am_b);
  FOREACH v_txt IN ARRAY ARRAY['m', 'b'] LOOP
    v_sql := format('SELECT public.s112_ama_korrektur_anlegen(%L, %L)', v_b, CASE v_txt WHEN 'm' THEN v_am_m ELSE v_am_b END);
    v_pruef := format('SELECT count(*)::text FROM public.ama_erntemeldungen WHERE jahrgang_id = %L', CASE v_txt WHEN 'm' THEN v_ajg_m ELSE v_ajg_b END);
    v_r := pg_temp.t18_idor(v_bta, v_sql, v_pruef);
    IF v_txt = 'm' THEN
      v_erg := v_erg || pg_temp.s112_erwarte('idor_s112_ama_korrektur_anlegen', split_part(v_r, '|', 2), '1');
    ELSE
      v_erg := v_erg || pg_temp.s112_erwarte('idor_positiv_s112_ama_korrektur_anlegen', v_r, 'ok|2');
    END IF;
  END LOOP;
  -- s112_ama_status_setzen: AMA-Rückmeldung (eingereicht → bestätigt); „eingereicht“ selbst nur über s112_ama_einreichen
  FOREACH v_txt IN ARRAY ARRAY['m', 'b'] LOOP
    v_sql := format('SELECT public.s112_ama_status_setzen(%L, %L, %L, pg_temp.s112_heute(), NULL)', v_b, CASE v_txt WHEN 'm' THEN v_am_m ELSE v_am_b END, 'bestaetigt');
    v_pruef := format('SELECT status FROM public.ama_erntemeldungen WHERE id = %L', CASE v_txt WHEN 'm' THEN v_am_m ELSE v_am_b END);
    v_r := pg_temp.t18_idor(v_bta, v_sql, v_pruef);
    IF v_txt = 'm' THEN
      v_erg := v_erg || pg_temp.s112_erwarte('idor_s112_ama_status_setzen', split_part(v_r, '|', 2), 'eingereicht');
    ELSE
      v_erg := v_erg || pg_temp.s112_erwarte('idor_positiv_s112_ama_status_setzen', v_r, 'ok|bestaetigt');
    END IF;
  END LOOP;
  v_erg := v_erg || pg_temp.s112_erwarte('kan37b_eingereicht_nur_mit_abgabe',
    pg_temp.t18_idor(v_bta, format('SELECT public.s112_ama_status_setzen(%L, %L, %L, pg_temp.s112_heute(), NULL)', v_b,
      (pg_temp.s112_beispiel('ama_erntemeldungen', v_b, (v_a ->> 'b_w')::uuid, jsonb_build_object('jahrgang_id',
        (pg_temp.s112_beispiel('weinjahrgaenge', v_b, (v_a ->> 'b_w')::uuid, jsonb_build_object('jahrgang', 1901)) ->> 'id')::uuid, 'status', 'bereit')) ->> 'id'),
      'eingereicht'), 'SELECT 1'), '42501|1');

  -- s112_fuellung_verkauf_buchen (KAN-149 D1): Flaschen einer fremden Füllung (M) – Bestand unverändert, eigene (B) – +1
  v_fz_m := (pg_temp.s112_beispiel('fuellungen', v_m, v_mw, '{"bestand_flaschen": 10}'::jsonb) ->> 'id')::uuid;
  v_fz_b := (pg_temp.s112_beispiel('fuellungen', v_b, (v_a ->> 'b_w')::uuid, '{"bestand_flaschen": 10}'::jsonb) ->> 'id')::uuid;
  FOREACH v_txt IN ARRAY ARRAY['m', 'b'] LOOP
    v_sql := format('SELECT public.s112_fuellung_verkauf_buchen(%L, %L, gen_random_uuid(), 1, pg_temp.s112_heute(), %L)',
      v_b, CASE v_txt WHEN 'm' THEN v_fz_m ELSE v_fz_b END, 'S112TEST Rückbuchung');
    v_pruef := format('SELECT bestand_flaschen::text FROM public.fuellungen WHERE id = %L', CASE v_txt WHEN 'm' THEN v_fz_m ELSE v_fz_b END);
    v_r := pg_temp.t18_idor(v_bta, v_sql, v_pruef);
    IF v_txt = 'm' THEN
      v_erg := v_erg || pg_temp.s112_erwarte('idor_s112_fuellung_verkauf_buchen', split_part(v_r, '|', 2), '10');
    ELSE
      v_erg := v_erg || pg_temp.s112_erwarte('idor_positiv_s112_fuellung_verkauf_buchen', v_r, 'ok|11');
    END IF;
  END LOOP;

  -- s112_ea_/zahlung_/umbuchung_stornieren (KAN-149 D2): fremdes Objekt (M) bleibt unstorniert, eigenes (B) storniert
  FOREACH v_txt IN ARRAY ARRAY['ea_transaktionen', 'zahlungen', 'konto_umbuchungen'] LOOP
    v_x_m := (pg_temp.s112_beispiel(v_txt, v_m, v_mw, CASE WHEN v_txt = 'ea_transaktionen' THEN jsonb_build_object('datum', v_heute) ELSE '{}'::jsonb END) ->> 'id')::uuid;
    v_x_b := (pg_temp.s112_beispiel(v_txt, v_b, (v_a ->> 'b_w')::uuid, CASE WHEN v_txt = 'ea_transaktionen' THEN jsonb_build_object('datum', v_heute) ELSE '{}'::jsonb END) ->> 'id')::uuid;
    FOREACH v_r IN ARRAY ARRAY['m', 'b'] LOOP
      v_sql := format('SELECT public.%s(%L, %L, %L)',
        CASE v_txt WHEN 'ea_transaktionen' THEN 's112_ea_stornieren' WHEN 'zahlungen' THEN 's112_zahlung_stornieren' ELSE 's112_umbuchung_stornieren' END,
        v_b, CASE v_r WHEN 'm' THEN v_x_m ELSE v_x_b END, 'S112TEST Storno fremd/eigen');
      v_pruef := format('SELECT (storniert_am IS NOT NULL)::text FROM public.%I WHERE id = %L', v_txt, CASE v_r WHEN 'm' THEN v_x_m ELSE v_x_b END);
      IF v_r = 'm' THEN
        v_erg := v_erg || pg_temp.s112_erwarte('idor_storno_' || v_txt, split_part(pg_temp.t18_idor(v_bta, v_sql, v_pruef), '|', 2), 'false');
      ELSE
        v_erg := v_erg || pg_temp.s112_erwarte('idor_positiv_storno_' || v_txt, pg_temp.t18_idor(v_bta, v_sql, v_pruef), 'ok|true');
      END IF;
    END LOOP;
  END LOOP;

  -- s112_kontakt_historie_zu_firma (KAN-150 F1c): fremder Kontakt (M) → P0002, eigener (B) ok
  v_x_m := (pg_temp.s112_zeile('kontakte', v_m, '{"nachname": "S112TEST IDOR fremd"}') ->> 'id')::uuid;
  v_x_b := (pg_temp.s112_zeile('kontakte', v_b, '{"nachname": "S112TEST IDOR eigen"}') ->> 'id')::uuid;
  v_txt := (pg_temp.s112_zeile('firmen', v_b, '{"name": "S112TEST IDOR Firma"}') ->> 'id');
  v_erg := v_erg || pg_temp.s112_erwarte('idor_s112_kontakt_historie_zu_firma',
    pg_temp.t18_idor(v_bta, format('SELECT public.s112_kontakt_historie_zu_firma(%L, %L, %L)', v_b, v_x_m, v_txt), 'SELECT 1::text'), 'P0002|1');
  v_erg := v_erg || pg_temp.s112_erwarte('idor_positiv_s112_kontakt_historie_zu_firma',
    pg_temp.t18_idor(v_bta, format('SELECT public.s112_kontakt_historie_zu_firma(%L, %L, %L)', v_b, v_x_b, v_txt), 'SELECT 1::text'), 'ok|1');

  -- s112_herkunft_setzen (KAN-150 F1d): fremde Charge (M) → P0002 und unverändert; fremde Ried an eigener Charge → P0002;
  -- eigene Charge mit eigener Ried → ok, genau diese Ried zugeordnet
  v_x_m := (pg_temp.s112_beispiel('weinausbau', v_m, v_mw, '{"menge_liter": "100"}') ->> 'id')::uuid;
  v_x_b := (pg_temp.s112_beispiel('weinausbau', v_b, (v_a ->> 'b_w')::uuid, '{"menge_liter": "100"}') ->> 'id')::uuid;
  v_sd_m := (pg_temp.s112_beispiel('weingarten', v_m, v_mw) ->> 'id')::uuid;
  v_sd_b := (pg_temp.s112_beispiel('weingarten', v_b, (v_a ->> 'b_w')::uuid) ->> 'id')::uuid;
  v_erg := v_erg || pg_temp.s112_erwarte('idor_s112_herkunft_setzen',
    pg_temp.t18_idor(v_bta, format('SELECT public.s112_herkunft_setzen(%L, %L, ARRAY[%L]::uuid[], %L)', v_b, v_x_m, v_sd_b, 'S112TEST fremde Charge'),
      format('SELECT count(*)::text FROM public.weinausbau_weingaerten WHERE weinausbau_id = %L AND weingarten_id = %L', v_x_m, v_sd_b)), 'P0002|0');
  v_erg := v_erg || pg_temp.s112_erwarte('idor_s112_herkunft_setzen_fremde_ried',
    pg_temp.t18_idor(v_bta, format('SELECT public.s112_herkunft_setzen(%L, %L, ARRAY[%L]::uuid[], %L)', v_b, v_x_b, v_sd_m, 'S112TEST fremde Ried'),
      format('SELECT count(*)::text FROM public.weinausbau_weingaerten WHERE weinausbau_id = %L AND weingarten_id = %L', v_x_b, v_sd_m)), 'P0002|0');
  v_erg := v_erg || pg_temp.s112_erwarte('idor_positiv_s112_herkunft_setzen',
    pg_temp.t18_idor(v_bta, format('SELECT public.s112_herkunft_setzen(%L, %L, ARRAY[%L]::uuid[], %L)', v_b, v_x_b, v_sd_b, 'S112TEST eigene Ried'),
      format('SELECT string_agg(weingarten_id::text, '','') FROM public.weinausbau_weingaerten WHERE weinausbau_id = %L', v_x_b)), 'ok|' || v_sd_b);

  -- s112_betriebsmittel_einkauf (KAN-167): fremdes Betriebsmittel (M) mit p_tenant_id = B → P0002, keine Lagerbuchung und
  -- keine Ausgabe; eigenes (B) → ok, genau ein Einkauf. B mit aktiver E&A-Rechnung (sonst 42501 vor der Objektprüfung).
  UPDATE public.tenant_einstellungen SET modul_ea = true, buchhaltungsart = 'ea' WHERE tenant_id = v_b;
  SELECT k.id INTO v_eakat FROM public.ea_kategorien k WHERE k.tenant_id IS NULL AND k.typ = 'ausgabe' AND k.aktiv ORDER BY k.id LIMIT 1;
  v_bm_m := (pg_temp.s112_beispiel('betriebsmittel', v_m, v_mw) ->> 'id')::uuid;
  v_bm_b := (pg_temp.s112_beispiel('betriebsmittel', v_b, (v_a ->> 'b_w')::uuid) ->> 'id')::uuid;
  FOREACH v_txt IN ARRAY ARRAY['m', 'b'] LOOP
    v_sql := format('SELECT public.s112_betriebsmittel_einkauf(%L, %L, pg_temp.s112_heute(), 2, %L, 10, 20, NULL, %L, NULL)',
      v_b, CASE v_txt WHEN 'm' THEN v_bm_m ELSE v_bm_b END, 'stk', v_eakat);
    v_pruef := format('SELECT count(*)::text FROM public.betriebsmittel_lager_bewegungen l JOIN public.ea_transaktionen e ON e.id = l.ea_transaktion_id WHERE l.betriebsmittel_id = %L AND l.typ = %L',
      CASE v_txt WHEN 'm' THEN v_bm_m ELSE v_bm_b END, 'einkauf');
    v_r := pg_temp.t18_idor(v_bta, v_sql, v_pruef);
    v_erg := v_erg || pg_temp.s112_erwarte(CASE v_txt WHEN 'm' THEN 'idor_s112_betriebsmittel_einkauf' ELSE 'idor_positiv_s112_betriebsmittel_einkauf' END,
      v_r, CASE v_txt WHEN 'm' THEN 'P0002|0' ELSE 'ok|1' END);
  END LOOP;

  -- s112_betriebsmittel_stornieren (KAN-167): fremde Lagerbuchung (M) → P0002 und unstorniert, eigene (B) → storniert
  v_bml_m := (pg_temp.s112_beispiel('betriebsmittel_lager_bewegungen', v_m, v_mw, jsonb_build_object('betriebsmittel_id', v_bm_m)) ->> 'id')::uuid;
  v_bml_b := (pg_temp.s112_beispiel('betriebsmittel_lager_bewegungen', v_b, (v_a ->> 'b_w')::uuid, jsonb_build_object('betriebsmittel_id', v_bm_b)) ->> 'id')::uuid;
  FOREACH v_txt IN ARRAY ARRAY['m', 'b'] LOOP
    v_sql := format('SELECT public.s112_betriebsmittel_stornieren(%L, %L, %L)',
      v_b, CASE v_txt WHEN 'm' THEN v_bml_m ELSE v_bml_b END, 'S112TEST Storno fremd/eigen');
    v_pruef := format('SELECT (storniert_am IS NOT NULL)::text FROM public.betriebsmittel_lager_bewegungen WHERE id = %L', CASE v_txt WHEN 'm' THEN v_bml_m ELSE v_bml_b END);
    v_r := pg_temp.t18_idor(v_bta, v_sql, v_pruef);
    v_erg := v_erg || pg_temp.s112_erwarte(CASE v_txt WHEN 'm' THEN 'idor_s112_betriebsmittel_stornieren' ELSE 'idor_positiv_s112_betriebsmittel_stornieren' END,
      v_r, CASE v_txt WHEN 'm' THEN 'P0002|false' ELSE 'ok|true' END);
  END LOOP;

  -- s112_storniert_loeschen für das PSM-Lager (KAN-88, vorher s112_buchung_loeschen): stornierte Lagerbewegung –
  -- fremde (M) bleibt, eigene (B) wird endgültig gelöscht
  v_pl_m := (pg_temp.s112_beispiel('psm_lager_bewegungen', v_m, v_mw) ->> 'id')::uuid;
  v_pl_b := (pg_temp.s112_beispiel('psm_lager_bewegungen', v_b, (v_a ->> 'b_w')::uuid) ->> 'id')::uuid;
  UPDATE public.psm_lager_bewegungen SET storniert_am = now(), storno_grund = 'S112TEST Storno für IDOR' WHERE id IN (v_pl_m, v_pl_b);
  FOREACH v_txt IN ARRAY ARRAY['m', 'b'] LOOP
    v_sql := format('SELECT public.s112_storniert_loeschen(%L, %L, %L, %L)',
      v_b, 'psm_lager_bewegungen', CASE v_txt WHEN 'm' THEN v_pl_m ELSE v_pl_b END, 'S112TEST löschen mit Grund');
    v_pruef := format('SELECT count(*)::text FROM public.psm_lager_bewegungen WHERE id = %L', CASE v_txt WHEN 'm' THEN v_pl_m ELSE v_pl_b END);
    v_r := pg_temp.t18_idor(v_bta, v_sql, v_pruef);
    IF v_txt = 'm' THEN
      v_erg := v_erg || pg_temp.s112_erwarte('idor_s112_storniert_loeschen_psm_lager', split_part(v_r, '|', 2), '1');
    ELSE
      v_erg := v_erg || pg_temp.s112_erwarte('idor_positiv_s112_storniert_loeschen_psm_lager', v_r, 'ok|0');
    END IF;
  END LOOP;

  -- s112_stammdaten_bezuege (KAN-150 F1a, lesend): Ried des Musterhofs mit p_tenant_id = B → P0002 (keine fremden
  -- IDs abfragbar), eigenes Ried in B → ok
  v_sd_m := (pg_temp.s112_beispiel('weingarten', v_m, v_mw) ->> 'id')::uuid;
  v_sd_b := (pg_temp.s112_beispiel('weingarten', v_b, (v_a ->> 'b_w')::uuid) ->> 'id')::uuid;
  FOREACH v_txt IN ARRAY ARRAY['m', 'b'] LOOP
    v_sql := format('SELECT public.s112_stammdaten_bezuege(%L, %L, %L)', v_b, 'weingarten', CASE v_txt WHEN 'm' THEN v_sd_m ELSE v_sd_b END);
    v_r := pg_temp.t18_idor(v_bta, v_sql, 'SELECT 1');
    v_erg := v_erg || pg_temp.s112_erwarte(CASE v_txt WHEN 'm' THEN 'idor_s112_stammdaten_bezuege' ELSE 'idor_positiv_s112_stammdaten_bezuege' END,
      v_r, CASE v_txt WHEN 'm' THEN 'P0002|1' ELSE 'ok|1' END);
  END LOOP;

  -- ── 4c. Modulprüfung in fuellung_bestand_buchen und schwund_buchen (eigener Betrieb B, ausgeführt) ─────
  -- Aufbau belegen: die Einmodul-Winzer haben genau ihr Modul, b_w alle sechs
  SELECT count(*) INTO v_n FROM public.tenant_memberships m
   WHERE m.tenant_id = v_b AND m.aktiv AND m.role = 'winzer'
     AND ((m.user_id = v_bwc AND m.schreibmodule = ARRAY['crm']) OR (m.user_id = v_bww AND m.schreibmodule = ARRAY['warenwirtschaft'])
       OR (m.user_id = v_bwr AND m.schreibmodule = ARRAY['rieden']) OR (m.user_id = v_bwk AND m.schreibmodule = ARRAY['kellerbuch'])
       OR (m.user_id = v_bw AND m.schreibmodule @> ARRAY['kellerbuch', 'warenwirtschaft', 'rieden', 'crm']));
  v_erg := v_erg || pg_temp.s112_erwarte('modul_aufbau_winzer_b', v_n, 5::bigint);
  -- fuellung_bestand_buchen: Korrektur +1 Flasche an der B-Füllung (Bestand vorher 10, keine Bewegung)
  v_sql := format('SELECT public.fuellung_bestand_buchen(%L, %L, %L, pg_temp.s112_heute(), 1, NULL, %L)', v_b, v_f_b, 'korrektur', 'S112TEST');
  v_pruef := format('SELECT f.bestand_flaschen || %L || (SELECT count(*) FROM public.fuellung_bewegungen x WHERE x.fuellung_id = f.id) FROM public.fuellungen f WHERE f.id = %L',
    '/', v_f_b);
  FOR r IN SELECT * FROM (VALUES ('b_w', v_bw, 'ok|11/1'), ('b_w_warenwirtschaft', v_bww, 'ok|11/1'),
                                 ('b_w_kellerbuch', v_bwk, 'ok|11/1'), ('b_w_crm', v_bwc, 'modul_abgelehnt|10/0'),
                                 ('b_w_rieden', v_bwr, 'modul_abgelehnt|10/0')) AS x (n, u, soll) LOOP
    v_erg := v_erg || pg_temp.s112_erwarte('modul_fuellung_bestand_buchen:' || r.n,
      pg_temp.t18_modul(pg_temp.t18_idor(r.u, v_sql, v_pruef, true)), r.soll);
  END LOOP;
  -- schwund_buchen mit Bestandminderung: 1 L an der B-Charge (vorher 100 L, keine Umzüge)
  v_sql := format('SELECT public.schwund_buchen(%L, %L, 1, pg_temp.s112_heute(), %L, false, true)', v_b, v_w_b, 'S112TEST');
  v_pruef := format('SELECT w.menge_liter::numeric(10,2) || %L || (SELECT count(*) FROM public.keller_umzuege k WHERE k.von_weinausbau_id = w.id) FROM public.weinausbau w WHERE w.id = %L',
    '/', v_w_b);
  FOR r IN SELECT * FROM (VALUES ('b_w', v_bw, 'ok|99.00/1'), ('b_w_kellerbuch', v_bwk, 'ok|99.00/1'),
                                 ('b_w_warenwirtschaft', v_bww, 'modul_abgelehnt|100.00/0'),
                                 ('b_w_rieden', v_bwr, 'modul_abgelehnt|100.00/0'),
                                 ('b_w_crm', v_bwc, 'modul_abgelehnt|100.00/0')) AS x (n, u, soll) LOOP
    v_erg := v_erg || pg_temp.s112_erwarte('modul_schwund_buchen:' || r.n,
      pg_temp.t18_modul(pg_temp.t18_idor(r.u, v_sql, v_pruef, true)), r.soll);
  END LOOP;

  -- setze_kontobewegung_abgeglichen: abgeglichen umschalten
  FOREACH v_txt IN ARRAY ARRAY['m', 'b'] LOOP
    SELECT abgeglichen::text INTO v_vor FROM public.ea_transaktionen WHERE id = CASE v_txt WHEN 'm' THEN v_e_m ELSE v_e_b END;
    v_sql := format('SELECT public.setze_kontobewegung_abgeglichen(%L, %L, %L, %L)',
      v_b, 'ea_transaktion', CASE v_txt WHEN 'm' THEN v_e_m ELSE v_e_b END, NOT v_vor::boolean);
    v_pruef := format('SELECT abgeglichen::text FROM public.ea_transaktionen WHERE id = %L', CASE v_txt WHEN 'm' THEN v_e_m ELSE v_e_b END);
    v_r := pg_temp.t18_idor(v_bta, v_sql, v_pruef);
    IF v_txt = 'm' THEN
      v_erg := v_erg || pg_temp.s112_erwarte('idor_setze_kontobewegung_abgeglichen',
        split_part(v_r, '|', 2), v_vor);
    ELSE
      v_erg := v_erg || pg_temp.s112_erwarte('idor_positiv_setze_kontobewegung_abgeglichen', v_r, 'ok|' || (NOT v_vor::boolean)::text);
    END IF;
  END LOOP;


  -- ── 5. 'session_user': nur statisch (Laufzeitprüfung über PostgREST/E2E, session_user = authenticator) ──
  v_n := 0;
  FOR r IN
    SELECT p.proname::text AS name, p.prosrc, s.abo
      FROM pg_temp.s112_soll_rpc() s
      JOIN pg_proc p ON p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = s.funktion
      JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
     WHERE s.einstufung = 'session_user'
     ORDER BY 1
  LOOP
    v_n := v_n + 1;
    v_erg := v_erg || pg_temp.s112_erwarte('statisch_mitglied_' || r.name,
      r.prosrc ~ 'm\.tenant_id\s*=\s*p_tenant_id' AND r.prosrc ~ 'm\.user_id\s*=\s*auth\.uid\(\)' AND r.prosrc ~ 'm\.aktiv', true);
    IF r.abo THEN
      v_erg := v_erg || pg_temp.s112_erwarte('statisch_abo_' || r.name, r.prosrc ~ 's112_pruefe_abo_schreibsperre\s*\(', true);
    END IF;
  END LOOP;
  v_erg := v_erg || pg_temp.s112_erwarte('statisch_session_user_anzahl', v_n, 7);   -- KAN-212: + lade_crmgemeinschaft

  -- ── 6. EXECUTE-Rechte ────────────────────────────────────────────────────────────────────────────────────
  -- anon: keine SECURITY-DEFINER-Funktion (hart)
  SELECT string_agg(p.proname::text, ', ' ORDER BY p.proname) INTO v_txt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
   WHERE p.prosecdef AND has_function_privilege('anon', p.oid, 'EXECUTE');
  v_erg := v_erg || pg_temp.s112_erwarte('anon_secdef_execute', coalesce(v_txt, ''), '');
  PERFORM pg_temp.s112_als(NULL, 'anon');
  v_erg := v_erg || pg_temp.s112_erwarte('anon_aufruf_get_next_liefernummer',
    pg_temp.t18_kurz(pg_temp.t18_ruf(format('SELECT public.get_next_liefernummer(%L)', v_m))), 'recht_fehlt');
  PERFORM pg_temp.s112_als_postgres();
  -- anon/PUBLIC ausführbar: nur Soll (s112_pre_request); B10 seit KAN-159 Teil 2 hart
  SELECT string_agg(x.sig, ', ' ORDER BY x.sig) FILTER (WHERE NOT x.sig = ANY (pg_temp.s112_soll_liste('anon_execute_erlaubt'))),
         count(*) FILTER (WHERE x.sig = ANY (pg_temp.s112_soll_liste('anon_execute_erlaubt')))
    INTO v_txt, v_n2
    FROM (SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
           WHERE has_function_privilege('anon', p.oid, 'EXECUTE')
              OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e
                          WHERE e.grantee = 0 AND e.privilege_type = 'EXECUTE')) x;
  v_erg := v_erg || pg_temp.s112_erwarte('anon_execute_neu', coalesce(v_txt, ''), '');
  v_erg := v_erg || pg_temp.s112_erwarte('anon_execute_erlaubt_vorhanden', v_n2, array_length(pg_temp.s112_soll_liste('anon_execute_erlaubt'), 1)::bigint);

  -- authenticated: kein EXECUTE auf interne Funktionen (hart)
  FOR r IN
    SELECT p.oid, p.proname::text AS name, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS darf,
           'p_tenant_id' = ANY (coalesce(p.proargnames, '{}')) AS mit_tenant
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
     WHERE p.proname IN ('ist_service_kontext', 'mark_verkauf_bezahlt', 'set_verkauf_storniert', 'process_ea_dauerauftraege')
        OR p.proname LIKE 'demo\_musterhof\_%'
        OR p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' IN
           (SELECT s.funktion FROM pg_temp.s112_soll_rpc() s WHERE s.einstufung = 'intern')
     ORDER BY p.proname
  LOOP
    v_erg := v_erg || pg_temp.s112_erwarte('intern_' || r.name, r.darf, false);
    IF r.mit_tenant OR r.name IN ('mark_verkauf_bezahlt', 'set_verkauf_storniert') THEN
      v_txt := pg_temp.t18_aufruf(r.oid, v_m);
      PERFORM pg_temp.s112_als(v_mta);
      v_erg := v_erg || pg_temp.s112_erwarte('intern_aufruf_' || r.name, pg_temp.t18_kurz(pg_temp.t18_ruf(v_txt)), 'recht_fehlt');
      PERFORM pg_temp.s112_als_postgres();
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM pg_temp.s112_soll_rpc() s WHERE s.einstufung = 'intern';
  v_erg := v_erg || pg_temp.s112_erwarte('intern_soll_anzahl', v_n >= 10, true);

  -- Triggerfunktionen: nie EXECUTE für authenticated (SECURITY DEFINER hart; übrige seit KAN-159 Teil 2 hart, vorher B11)
  SELECT string_agg(p.proname::text, ', ') FILTER (WHERE p.prosecdef),
         string_agg(p.proname || '()', ', ' ORDER BY p.proname) FILTER (WHERE NOT p.prosecdef)
    INTO v_txt, v_r
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
   WHERE p.prorettype = 'trigger'::regtype AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  v_erg := v_erg || pg_temp.s112_erwarte('trigger_secdef_authenticated', coalesce(v_txt, ''), '');
  v_erg := v_erg || pg_temp.s112_erwarte('trigger_execute_authenticated', coalesce(v_r, ''), '');

  -- ── 7. Modulprüfung der schreibenden RPCs (KAN-159, vorher B9) ─────────────────────────────────────────
  -- Schreibende RPCs (Soll abo = true) mit Winzer in der Rollenliste prüfen das Schreibmodul
  SELECT string_agg(p.proname::text, ', ' ORDER BY p.proname) INTO v_txt
    FROM pg_temp.s112_soll_rpc() s
    JOIN pg_proc p ON p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = s.funktion
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
   WHERE s.abo AND p.prosrc ~ 'winzer|m\.aktiv' AND p.prosrc !~ 's112_darf_schreiben|s112_pruefe_schreibmodul';
  v_erg := v_erg || pg_temp.s112_erwarte('modul_rpc_ohne_pruefung', coalesce(v_txt, ''), '');

  -- (a) Winzer nur mit crm erhält keine Liefernummer (Module rieden/kellerbuch/warenwirtschaft fehlen; KAN-21)
  PERFORM pg_temp.s112_als(v_mwc);
  v_r := pg_temp.t18_ruf(format('SELECT public.get_next_liefernummer(%L)', v_m));
  v_erg := v_erg || pg_temp.s112_erwarte('modul_get_next_liefernummer_winzer_crm', split_part(v_r, '|', 1), '42501');
  PERFORM pg_temp.s112_als_postgres();

  -- (b) Winzer nur mit crm setzt „abgeglichen“ nicht (Modul ea fehlt); gesperrte Buchung als Beispiel,
  --     is_locked selbst prüft die RPC bewusst nicht (Abgleich nach Monatsabschluss erlaubt)
  SELECT id, abgeglichen INTO v_ea, v_ea_abg FROM public.ea_transaktionen
   WHERE tenant_id = v_m AND is_locked AND abgeglichen IS NOT NULL ORDER BY id LIMIT 1;
  v_erg := v_erg || pg_temp.s112_erwarte('musterhof_gesperrte_buchung_existiert', v_ea IS NOT NULL, true);
  PERFORM pg_temp.s112_als(v_mwc);
  v_r := pg_temp.t18_ruf(
    format('SELECT count(*)::text FROM public.setze_kontobewegung_abgeglichen(%L, %L, %L, %L)', v_m, 'ea_transaktion', v_ea, NOT v_ea_abg),
    format('SELECT abgeglichen::text FROM public.ea_transaktionen WHERE id = %L', v_ea));
  v_erg := v_erg || pg_temp.s112_erwarte('modul_setze_kontobewegung_winzer_crm',
    CASE WHEN v_r = 'ok|' || (NOT v_ea_abg)::text THEN 'geaendert' ELSE split_part(v_r, '|', 1) END, '42501');
  PERFORM pg_temp.s112_als_postgres();
  SELECT count(*) INTO v_n FROM public.ea_transaktionen WHERE id = v_ea AND abgeglichen = v_ea_abg AND is_locked;
  v_erg := v_erg || pg_temp.s112_erwarte('gesperrte_buchung_unveraendert_nach_versuch', v_n, 1);

  -- ── 8. KI (zuletzt: ki_readonly_query setzt app.active_tenant_id und transaction_read_only) ─────────────
  SELECT count(*) INTO v_kontakte_m FROM public.kontakte WHERE tenant_id = v_m;
  SELECT count(*) INTO v_weingarten_m FROM public.weingarten WHERE tenant_id = v_m;
  v_erg := v_erg || pg_temp.s112_erwarte('musterhof_kontakte_weingarten_existieren', v_kontakte_m > 0 AND v_weingarten_m > 0, true);

  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('fremd_ki_readonly_query',
    pg_temp.t18_kurz(pg_temp.t18_ruf(format('SELECT public.ki_readonly_query(%L, %L)::text', 'select count(*) as n from kontakte', v_m))), 'kein_zugriff');

  PERFORM pg_temp.s112_als(v_mta);
  v_r := pg_temp.t18_ruf(format('SELECT public.ki_readonly_query(%L, %L)::text', 'select count(*) as n from kontakte', v_m));
  v_erg := v_erg || pg_temp.s112_erwarte('eigen_ki_readonly_query',
    CASE WHEN v_r LIKE 'ok|%' THEN (substr(v_r, 4)::jsonb -> 0 ->> 'n') ELSE v_r END, v_kontakte_m::text);

  -- (c) Mitglied in M und B fragt im Kontext B nach Kontakten des Musterhofs
  PERFORM pg_temp.s112_als(v_mbta);
  v_r := pg_temp.t18_ruf(format('SELECT public.ki_readonly_query(%L, %L)::text',
    format('select count(*) as n from kontakte where tenant_id = %L', v_m), v_b));
  -- B6 behoben (KAN-159, 01.10.2026): RESTRICTIVE-Policy ki_aktiver_betrieb auf allen KI-Tabellen mit tenant_id
  v_erg := v_erg || pg_temp.s112_erwarte('ki_kontext_b_liest_kontakte_m',
    CASE WHEN v_r LIKE 'ok|%' THEN (substr(v_r, 4)::jsonb -> 0 ->> 'n') ELSE v_r END, '0');
  -- GUT-Tabellen (get_user_tenant_ids) werden auf den aktiven Betrieb gefiltert
  PERFORM pg_temp.s112_als(v_mbta);
  v_r := pg_temp.t18_ruf(format('SELECT public.ki_readonly_query(%L, %L)::text',
    format('select count(*) as n from weingarten where tenant_id = %L', v_m), v_b));
  v_erg := v_erg || pg_temp.s112_erwarte('ki_kontext_b_weingarten_gefiltert',
    CASE WHEN v_r LIKE 'ok|%' THEN (substr(v_r, 4)::jsonb -> 0 ->> 'n') ELSE v_r END, '0');
  -- Nur-Lesen und Reichweite (m_ta im eigenen Betrieb): jede dieser Abfragen muss scheitern
  PERFORM pg_temp.s112_als(v_mta);
  FOR r IN SELECT * FROM (VALUES
      ('update',            'update kontakte set nachname = nachname'),
      ('delete_cte',        'with x as (delete from kontakte returning 1) select count(*) as n from x'),
      ('update_cte',        'with x as (update kontakte set nachname = nachname returning 1) select count(*) as n from x'),
      ('create',            'create table s112test_ki (id int)'),
      ('mehrfach',          'select 1 as n; update kontakte set nachname = nachname'),
      ('set_config',        'select set_config(''transaction_read_only'', ''off'', true) as x'),
      ('set_role',          'select set_config(''role'', ''postgres'', true) as x'),
      ('geheimnis_brevo',   'select brevo_api_key from tenant_einstellungen'),
      ('geheimnis_uec',     'select imap_pass_enc, m365_refresh_token_enc from user_email_connections'),
      ('auth_users',        'select count(*) as n from auth.users'),
      ('auth_mfa',          'select count(*) as n from auth.mfa_factors'),
      ('plattform_admins',  'select count(*) as n from plattform_admins'),
      ('pg_authid',         'select count(*) as n from pg_catalog.pg_authid'),
      ('advisory_lock',     'select count(*) as n from kontakte where pg_catalog.pg_advisory_xact_lock(1) is not null')
    ) AS f (fall, abfrage)
  LOOP
    v_r := pg_temp.t18_ruf(format('SELECT public.ki_readonly_query(%L, %L)::text', r.abfrage, v_m));
    v_erg := v_erg || pg_temp.s112_erwarte('ki_nur_lesen_' || r.fall,
      CASE WHEN v_r LIKE 'ok|%' THEN left(v_r, 120) ELSE 'abgelehnt' END, 'abgelehnt');
  END LOOP;
  -- Positivkontrolle im selben Rahmen: eine erlaubte Abfrage geht durch
  v_r := pg_temp.t18_ruf(format('SELECT public.ki_readonly_query(%L, %L)::text', 'select count(*) as n from weingarten', v_m));
  v_erg := v_erg || pg_temp.s112_erwarte('ki_positiv_weingarten',
    CASE WHEN v_r LIKE 'ok|%' THEN (substr(v_r, 4)::jsonb -> 0 ->> 'n') ELSE v_r END, v_weingarten_m::text);
  PERFORM pg_temp.s112_als_postgres();
  -- Daten unverändert (Belege, dass auch nichts außerhalb der zurückgerollten Unterblöcke durchsickerte)
  SELECT count(*) INTO v_n FROM public.kontakte WHERE tenant_id = v_m;
  v_erg := v_erg || pg_temp.s112_erwarte('ki_kontakte_unveraendert', v_n, v_kontakte_m);
  v_erg := v_erg || pg_temp.s112_erwarte('ki_keine_tabelle_angelegt', to_regclass('public.s112test_ki') IS NULL, true);
  -- statisch: Schreibschutz, Strukturprüfung und Ein-Statement-Regel stehen im Rumpf (Tiefenverteidigung, der
  -- Schreibschutz ist dynamisch nicht beobachtbar, solange die Strukturprüfung hält)
  SELECT p.prosrc INTO v_txt FROM pg_proc p WHERE p.oid = 'public.ki_readonly_query(text, uuid)'::regprocedure;
  v_erg := v_erg || pg_temp.s112_erwarte('ki_statisch_read_only',
    v_txt ~ 'PERFORM set_config\(''transaction_read_only'',\s*''on'',\s*true\)', true);
  v_erg := v_erg || pg_temp.s112_erwarte('ki_statisch_verstoss_abgelehnt',
    v_txt ~ 'IF v_verstoss IS NOT NULL THEN\s*RAISE EXCEPTION', true);
  v_erg := v_erg || pg_temp.s112_erwarte('ki_statisch_ein_statement', v_txt ~ 'position\('';'' in v_sql\) > 0', true);

  v_erg := v_erg || pg_temp.s112_erwarte('ki_keine_nachwirkung',
    coalesce(nullif(current_setting('app.active_tenant_id', true), ''), '-') || '/' || current_setting('transaction_read_only'), '-/off');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 80);
END
$test$;
