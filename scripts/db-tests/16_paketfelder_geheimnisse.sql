-- @bereich: Schutz der Paket- und Systemfelder, Geheimnis-Spalten (KAN-135)
-- @ziel: Benutzer ändern an tenants und tenant_einstellungen nur die freigegebenen Felder (Trigger
-- @ziel: a_schutz_plattformfelder) und legen dort nichts an; Plattform-Admins sind ausgenommen, die Kundennummer
-- @ziel: bleibt auch für sie unveränderlich. Kein Benutzer (auch nicht anon oder der Plattform-Admin) liest je ein
-- @ziel: Geheimnis – weder die Spalte noch über SELECT *, Zeilenwert, to_jsonb/row_to_json, WHERE oder RETURNING.
-- @ziel: Jede Nicht-Geheimnis-Spalte ist lesbar (Regel für neue Spalten); user_email_connections nur eigene Zeilen.
-- @mutation trigger_plan_frei: a_schutz_plattformfelder auf tenants erlaubt zusätzlich plan | rot: tenants_upd_b_ta:plan|trigger_argumente_tenants
-- @mutation geheimnis_grant: GRANT SELECT (brevo_api_key) auf tenant_einstellungen für authenticated | rot: geheimnis_.*brevo_api_key.*|tabelle_ganz_.*
-- @mutation pa_ohne_ausnahme: schutz_plattformfelder ohne Plattform-Admin-Ausnahme | rot: pa_.*
-- @mutation uec_update_grant: GRANT UPDATE (anzeigename) auf user_email_connections für authenticated | rot: uec_.*update.*
-- @mutation pa_ueber_system_admin: Ausnahme im Trigger über tenant_memberships.role = 'system_admin' statt plattform_admins | rot: sa_ohne_pa_.*
-- @mutation insert_zweig_weg: INSERT-Zweig von schutz_plattformfelder stillgelegt (IF false) | rot: tenants_insert_.*|einst_insert_trigger_.*
-- @mutation geheimnis_view: View public.s112test_einst mit brevo_api_key, SELECT für authenticated/anon | rot: geheimnis_view:.*
-- @mutation geheimnis_rpc: SECURITY-DEFINER-Funktion gibt brevo_api_key zurück, EXECUTE für authenticated | rot: geheimnis_rpc:.*
-- @mutation geheimnis_rpc_zeile: SECURITY DEFINER RETURNS SETOF tenant_einstellungen mit SELECT *, EXECUTE für authenticated | rot: geheimnis_rpc:public\.s112test_zeile.*
-- @mutation geheimnis_rpc_jsonb: SECURITY DEFINER gibt to_jsonb(t) der ganzen tenant_einstellungen-Zeile zurück | rot: geheimnis_rpc:public\.s112test_json.*
-- @mutation geheimnis_rpc_atomic: SECURITY DEFINER mit BEGIN ATOMIC … SELECT brevo_api_key (prosrc leer) | rot: geheimnis_rpc:public\.s112test_atomic.*
-- @mutation geheimnis_rpc_dynamisch: SECURITY DEFINER mit EXECUTE format('SELECT %I …', Spalte als Parameter) | rot: geheimnis_rpc:public\.s112test_dyn.*
-- @mutation anon_revoke_nicht_geheimnis: REVOKE SELECT (anzeigename) ON tenant_einstellungen FROM anon | rot: spalte_ohne_grant_anon:tenant_einstellungen\.anzeigename
-- @mutation service_gesperrt: schutz_plattformfelder sperrt auch postgres und service_role | rot: service_.*
-- @mutation uec_delete_betrieb: DELETE-Policy von user_email_connections auf den ganzen Betrieb aufgeweicht | rot: uec_delete_policy_nur_eigene
--
-- software:112 – SQL-Testsuite gegen Staging, Datei 16 (Stand 28.09.2026).
-- Nur Staging. Die ganze Datei ist EINE Transaktion und endet mit pg_temp.s112_ende(…) = RAISE → nichts bleibt.
--
-- Geprüft wird (Regeln aus CLAUDE.md, Abschnitte „Zugangsdaten/Geheimnis-Spalten“ und „Paket- und Systemfelder“):
--   1. Katalog: Trigger-Argumente von a_schutz_plattformfelder, Tabellen- und Spaltenrechte, Geheimnisliste
--      vollständig, keine Spalte mit Geheimnis-Namensmuster ohne Eintrag.
--   2. tenants dynamisch über alle Spalten: b_ta → 42501 (T) außer bio_status/updated_at (k1), b_w → k0;
--      Test-Plattform-Admin ändert plan, stripe_status, max_benutzer; Kundennummer unveränderlich; INSERT/DELETE.
--   3. tenant_einstellungen dynamisch über alle Spalten mit UPDATE-Recht: b_ta → T außer den vier svs_*-Feldern,
--      b_w und b_l → k0, Test-Plattform-Admin → k1; INSERT, Upsert, DELETE.
--   4. Geheimnis-Spalten je Spalte für b_ta, anon und den Plattform-Admin; Umwege über ganze Zeilen.
--   5. Regel für neue Spalten: jede Nicht-Geheimnis-Spalte ist für authenticated tatsächlich lesbar und hat das
--      SELECT-Spaltenrecht auch für anon (spalte_ohne_grant_anon:*).
--   6. user_email_connections: nur eigene Zeile sichtbar/löschbar, kein INSERT/UPDATE; die DELETE-Policy wird
--      zusätzlich im Katalog geprüft (zur Laufzeit verdeckt sie die SELECT-Policy).
--   7. Service-Kontext: postgres ohne Claims und service_role passieren den Trigger (Schutz nur für Benutzer);
--      auch das Setzen der Kundennummer als postgres (Abschnitt 2) ist eine benannte Prüfung (service_postgres_*).
--   Dazu: Die Plattform-Admin-Ausnahme gilt NUR über plattform_admins – m_sa (system_admin ohne Eintrag) bleibt
--   gesperrt (sa_ohne_pa_*). Der INSERT-Zweig des Triggers wird einzeln geprüft (Meldung, dazu ein vorübergehendes
--   INSERT-Spaltenrecht auf tenant_einstellungen, damit der Trigger vor dem fehlenden Recht greift).
--   Umwege um die Spaltenrechte: Views/Materialized Views (ohne security_invoker), die eine Geheimnis-Spalte
--   lesen und für authenticated/anon lesbar sind, sowie SECURITY-DEFINER-Funktionen mit EXECUTE für
--   authenticated/anon, deren Definition eine Geheimnis-Spalte nennt, die eine ganze Zeile einer Geheimnis-Tabelle
--   zurückgibt (Zeilentyp) oder die Tabelle mit SELECT */to_jsonb/row_to_json/EXECUTE verarbeitet
--   (geheimnis_view:*, geheimnis_rpc:*). Grenze: dynamisches SQL, das auch den Tabellennamen erst zur Laufzeit
--   bildet, bleibt unsichtbar.
--   Grenze: Das Namensmuster c_muster (Abschnitt 1) läuft nur über tenants, tenant_einstellungen und
--   user_email_connections – ein Geheimnis in einer NEUEN Tabelle (z. B. ein Webhook-Secret) findet es nicht;
--   dieses gehört dann in s112_soll_liste('geheimnis_spalten') (bewusst so, siehe auch 01).

-- Test-eigene Hilfsfunktionen (Präfix t16_).

-- Typgerechter Anderswert als SQL-Ausdruck (bezogen auf den alten Wert der Spalte). CHECK-Spalten bekommen
-- einen anderen zulässigen Wert. NULL = Typ nicht vorgesehen (die Prüfung meldet dann FEHLER).
CREATE FUNCTION pg_temp.t16_anders(p_spalte text, p_typ text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE
    WHEN p_spalte IN ('bio_status', 'plan', 'stripe_status', 'svs_option', 'buchhaltungsart', 'ea_buchung_modus',
                      'ea_uva_zeitraum', 'mostgewicht_einheit', 'newsletter_kurzname', 'newsletter_datenschutz_url',
                      'betrieb_rechtsform', 'betriebsart') THEN
      format('CASE WHEN %I IS NOT DISTINCT FROM %L THEN %L ELSE %L END', p_spalte,
             w.a, w.b, w.a)
    WHEN p_typ = 'uuid' THEN 'gen_random_uuid()'
    WHEN p_typ = 'boolean' THEN format('NOT coalesce(%I, false)', p_spalte)
    WHEN p_typ IN ('integer', 'bigint', 'smallint') OR p_typ LIKE 'numeric%' THEN format('coalesce(%I, 0) + 1', p_spalte)
    WHEN p_typ = 'timestamp with time zone' THEN format('coalesce(%I, now()) - interval ''1 day''', p_spalte)
    WHEN p_typ = 'date' THEN format('coalesce(%I, pg_temp.s112_heute()) - 1', p_spalte)
    WHEN p_typ = 'text' OR p_typ LIKE 'character varying%' THEN
      format('CASE WHEN %I IS NOT DISTINCT FROM ''s112x'' THEN ''s112y'' ELSE ''s112x'' END', p_spalte)
    ELSE NULL
  END
  FROM (SELECT CASE p_spalte
                 WHEN 'bio_status' THEN 'bio_eu' WHEN 'plan' THEN 'pro' WHEN 'stripe_status' THEN 'active'
                 WHEN 'svs_option' THEN 'option' WHEN 'buchhaltungsart' THEN 'doppik' WHEN 'ea_buchung_modus' THEN 'netto'
                 WHEN 'ea_uva_zeitraum' THEN 'monatlich' WHEN 'mostgewicht_einheit' THEN 'oechsle'
                 WHEN 'newsletter_kurzname' THEN 's112test' WHEN 'newsletter_datenschutz_url' THEN 'https://s112test.invalid/a'
                 WHEN 'betrieb_rechtsform' THEN 'kapitalgesellschaft'   -- KAN-48: CHECK tenant_einstellungen_rechtsform_check
                 WHEN 'betriebsart' THEN 'weinhaendler'   -- KAN-261: CHECK tenant_einstellungen_betriebsart_check
               END AS a,
               CASE p_spalte
                 WHEN 'bio_status' THEN 'kip' WHEN 'plan' THEN 'starter' WHEN 'stripe_status' THEN 'past_due'
                 WHEN 'svs_option' THEN 'pauschal' WHEN 'buchhaltungsart' THEN 'ea' WHEN 'ea_buchung_modus' THEN 'brutto'
                 WHEN 'ea_uva_zeitraum' THEN 'quartalsweise' WHEN 'mostgewicht_einheit' THEN 'kmw'
                 WHEN 'newsletter_kurzname' THEN 's112test-b' WHEN 'newsletter_datenschutz_url' THEN 'https://s112test.invalid/b'
                 WHEN 'betrieb_rechtsform' THEN 'natuerliche_person'
                 WHEN 'betriebsart' THEN 'weinproduzent'
               END AS b) w
$f$;

-- OK, wenn p_ist einer der erlaubten Werte ist, sonst FEHLER mit Beleg.
CREATE FUNCTION pg_temp.t16_eins_von(p_name text, p_ist text, p_soll text[]) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN p_ist = ANY (p_soll) THEN pg_temp.s112_ok(p_name)
              ELSE pg_temp.s112_fehler(p_name, 'ist=' || coalesce(p_ist, 'NULL') || ' soll∈' || array_to_string(p_soll, '|')) END
$f$;

-- Umwege um die Spaltenrechte der Geheimnis-Spalten (p_geheim = 'tabelle.spalte' in public):
--   art 'view': View/Materialized View (jedes Schema außer den Systemschemata), die laut pg_depend eine
--               Geheimnis-Spalte liest; lesbar = authenticated oder anon hat SELECT auf irgendeine Spalte und
--               die View läuft NICHT mit security_invoker (Materialized Views immer).
--   art 'rpc':  SECURITY-DEFINER-Funktion/Prozedur (ohne pg_temp, ohne Trigger-Funktionen – die sind nicht
--               direkt aufrufbar); lesbar = authenticated oder anon darf sie ausführen. Treffer, wenn
--               (spalte)  die Definition (pg_get_functiondef – deckt auch BEGIN ATOMIC ab, dort ist prosrc leer)
--                         eine Geheimnis-Spalte nennt,
--               (zeilentyp) Rückgabe- oder OUT/TABLE-Typ der Zeilentyp (oder dessen Array) einer Tabelle mit
--                         Geheimnissen ist (RETURNS SETOF tenant_einstellungen …),
--               (ganze_zeile) die Definition eine Tabelle mit Geheimnissen nennt UND ganze Zeilen bzw. dynamisches
--                         SQL verwendet: SELECT * / t.* / RETURNING *, to_json(b)/row_to_json/json(b)_agg/
--                         json(b)_populate_*/hstore, EXECUTE (Spaltenname als Parameter).
--               grund = die zutreffenden Kriterien, kommagetrennt (eine Zeile je Funktion).
CREATE FUNCTION pg_temp.t16_geheimnis_umwege(p_geheim text[])
RETURNS TABLE (art text, objekt text, lesbar boolean, grund text) LANGUAGE plpgsql AS $f$
DECLARE
  v_re     text;
  v_tab_re text;
  v_typen  oid[];
BEGIN
  SELECT '\m(' || string_agg(DISTINCT split_part(g, '.', 2), '|') || ')\M',
         '\m(' || string_agg(DISTINCT split_part(g, '.', 1), '|') || ')\M'
    INTO v_re, v_tab_re FROM unnest(p_geheim) g;
  SELECT array_agg(t.oid) INTO v_typen
    FROM pg_class c JOIN pg_namespace cn ON cn.oid = c.relnamespace AND cn.nspname = 'public'
    JOIN pg_type t ON t.oid IN (c.reltype, (SELECT ty.typarray FROM pg_type ty WHERE ty.oid = c.reltype))
   WHERE c.relname IN (SELECT DISTINCT split_part(g, '.', 1) FROM unnest(p_geheim) g);
  RETURN QUERY
    SELECT DISTINCT 'view'::text, vn.nspname || '.' || v.relname,
           (has_any_column_privilege('authenticated', v.oid, 'SELECT') OR has_any_column_privilege('anon', v.oid, 'SELECT'))
           AND (v.relkind = 'm' OR NOT coalesce((SELECT o.option_value IN ('true', 'on', '1', 'yes')
                                                  FROM pg_options_to_table(v.reloptions) o
                                                 WHERE o.option_name = 'security_invoker'), false)),
           'spalte'::text
      FROM pg_depend d
      JOIN pg_rewrite rw ON rw.oid = d.objid
      JOIN pg_class v ON v.oid = rw.ev_class
      JOIN pg_class t ON t.oid = d.refobjid
      JOIN pg_namespace tn ON tn.oid = t.relnamespace AND tn.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
      JOIN pg_namespace vn ON vn.oid = v.relnamespace
     WHERE d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass
       AND v.oid <> t.oid AND v.relkind IN ('v', 'm')
       AND vn.nspname NOT IN ('pg_catalog', 'information_schema')
       AND (t.relname || '.' || a.attname) = ANY (p_geheim);
  RETURN QUERY
    SELECT 'rpc'::text, k.objekt, k.lesbar, k.grund
      FROM (SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS objekt,
                   has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE') AS lesbar,
                   concat_ws(',',
                     CASE WHEN q.d ~ v_re THEN 'spalte' END,
                     CASE WHEN p.prorettype = ANY (v_typen) OR p.proallargtypes && v_typen THEN 'zeilentyp' END,
                     CASE WHEN q.d ~ v_tab_re
                           AND (q.d ~* '(select\s+(distinct\s+)?\*|\.\*|returning\s+\*)'
                                OR q.d ~* '(\mto_jsonb?\s*\(|\mrow_to_json\M|\mjsonb?_agg\M|\mjsonb?_populate_|\mhstore\M)'
                                OR q.d ~* '\mexecute\M') THEN 'ganze_zeile' END) AS grund
              FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             CROSS JOIN LATERAL (SELECT coalesce(pg_get_functiondef(p.oid), p.prosrc) AS d) q
             WHERE p.prosecdef AND p.prokind IN ('f', 'p')
               AND p.prorettype NOT IN ('trigger'::regtype, 'event_trigger'::regtype)
               AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\_temp\_%') k
     WHERE k.grund <> '';
END $f$;

DO $test$
DECLARE
  c_datei   constant text := '16_paketfelder_geheimnisse';
  -- Namensmuster für Geheimnis-Spalten (Token, Passwort, Schlüssel, verschlüsselt)
  c_muster  constant text := '(_enc$|passw|_pass($|_)|secret|api_?key|(^|_)token$)';
  -- Begründete Ausnahmen für geheimnis_rpc (SECURITY DEFINER mit EXECUTE für Benutzer, trifft ein Kriterium von
  -- t16_geheimnis_umwege, gibt Geheimnisse aber nachweislich nicht aus), je Eintrag 'schema.name(argumente)'
  -- mit Begründung im Kommentar – Stand 28.09.2026 keine (Staging-Katalog geprüft, auch mit den Kriterien
  -- zeilentyp/ganze_zeile). Jede Ausnahme muss ein aktueller Treffer bleiben (geheimnis_rpc_ausnahme_aktuell:*).
  c_rpc_ausnahmen constant text[] := '{}';
  v_msa     uuid;
  v_m       uuid;
  v_t0      timestamptz := clock_timestamp();
  v_erg     text[] := '{}';
  v_a       jsonb;
  v_b       uuid;
  v_bta     uuid;
  v_bw      uuid;
  v_bl      uuid;
  v_pa      uuid;
  v_uec_w   uuid;
  v_uec_ta  uuid;
  v_geheim  text[];
  v_tab     text;
  v_sp      text;
  v_ausdr   text;
  v_soll    text;
  v_sql     text;
  v_txt     text;
  v_n       bigint;
  r         record;
  v_p       text;
  v_kontr   jsonb;
BEGIN
  PERFORM pg_temp.s112_nur_staging();

  -- ── 0. Aufbau (als postgres – der Schutz-Trigger greift hier nicht) ────────────────────────────────────
  v_a := pg_temp.s112_aufbau();
  v_b := (v_a ->> 'b')::uuid;
  v_bta := (v_a ->> 'b_ta')::uuid;
  v_bw := (v_a ->> 'b_w')::uuid;
  v_bl := (v_a ->> 'b_l')::uuid;
  v_pa := (v_a ->> 'pa')::uuid;
  v_geheim := pg_temp.s112_soll_liste('geheimnis_spalten');

  -- Je eine E-Mail-Verbindung für b_w und b_ta im selben Betrieb, mit gesetzten Geheimnissen.
  INSERT INTO public.user_email_connections (tenant_id, user_id, email_address, anzeigename,
                                             m365_access_token_enc, m365_refresh_token_enc, imap_pass_enc, smtp_pass_enc)
  VALUES (v_b, v_bw, 's112test-w@software112.test', 'S112TEST W', 's112test-geheim', 's112test-geheim', 's112test-geheim', 's112test-geheim')
  RETURNING id INTO v_uec_w;
  INSERT INTO public.user_email_connections (tenant_id, user_id, email_address, anzeigename,
                                             m365_access_token_enc, m365_refresh_token_enc, imap_pass_enc, smtp_pass_enc)
  VALUES (v_b, v_bta, 's112test-ta@software112.test', 'S112TEST TA', 's112test-geheim', 's112test-geheim', 's112test-geheim', 's112test-geheim')
  RETURNING id INTO v_uec_ta;
  -- Geheimnisse in tenant_einstellungen von B setzen (als postgres, ohne betrieb_plz → keine Kundennummer)
  UPDATE public.tenant_einstellungen
     SET brevo_api_key = 's112test-geheim', sumup_api_key = 's112test-geheim', bawb_passwort = 's112test-geheim',
         m365_access_token_enc = 's112test-geheim', m365_refresh_token_enc = 's112test-geheim',
         m365_client_secret_enc = 's112test-geheim', email_imap_pass_enc = 's112test-geheim', email_smtp_pass_enc = 's112test-geheim'
   WHERE tenant_id = v_b;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_erg := v_erg || pg_temp.s112_erwarte('aufbau_geheimnisse_b_gesetzt', v_n, 1);

  -- Belege als postgres: die Zeilen existieren (sonst wären „0 Zeilen“ unten wertlos)
  SELECT count(*) INTO v_n FROM public.tenants WHERE id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_tenant_b_existiert', v_n, 1);
  SELECT count(*) INTO v_n FROM public.tenant_einstellungen WHERE tenant_id = v_b;
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_einstellungen_b_existiert', v_n, 1);
  SELECT count(*) INTO v_n FROM public.user_email_connections WHERE tenant_id = v_b AND id IN (v_uec_w, v_uec_ta);
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_uec_zwei_zeilen', v_n, 2);
  SELECT count(*) INTO v_n FROM public.tenant_memberships WHERE tenant_id = v_b AND user_id = v_pa AND role = 'system_admin' AND aktiv;
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_pa_system_admin_in_b', v_n, 1);
  -- m_sa: aktiver system_admin in M, aber KEIN Plattform-Admin (Negativprobe für die Trigger-Ausnahme)
  v_m := (v_a ->> 'm')::uuid;
  v_msa := (v_a ->> 'm_sa')::uuid;
  SELECT count(*) INTO v_n FROM public.tenant_memberships WHERE tenant_id = v_m AND user_id = v_msa AND role = 'system_admin' AND aktiv;
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_m_sa_system_admin_in_m', v_n, 1);
  SELECT count(*) INTO v_n FROM public.plattform_admins WHERE user_id = v_msa;
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_m_sa_kein_plattform_admin', v_n, 0);
  SELECT count(*) INTO v_n FROM public.tenant_einstellungen WHERE tenant_id = v_m;
  v_erg := v_erg || pg_temp.s112_erwarte('beleg_einstellungen_m_existiert', v_n, 1);

  -- ── Mutationen (nur im Mutationsmodus von run.mjs; sonst ohne Wirkung) ─────────────────────────────────
  PERFORM pg_temp.s112_mutiere('trigger_plan_frei',
    $m$CREATE OR REPLACE TRIGGER a_schutz_plattformfelder BEFORE INSERT OR UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.schutz_plattformfelder('bio_status', 'updated_at', 'plan')$m$);
  PERFORM pg_temp.s112_mutiere('geheimnis_grant',
    $m$GRANT SELECT (brevo_api_key) ON public.tenant_einstellungen TO authenticated$m$);
  PERFORM pg_temp.s112_mutiere('pa_ohne_ausnahme',
    $m$CREATE OR REPLACE FUNCTION public.schutz_plattformfelder() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  v_alt jsonb;
  v_geaendert text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Keine Berechtigung, in % neue Zeilen anzulegen', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  v_alt := to_jsonb(OLD);
  SELECT string_agg(n.key, ', ' ORDER BY n.key) INTO v_geaendert
    FROM jsonb_each(to_jsonb(NEW)) AS n
   WHERE n.key <> ALL (COALESCE(TG_ARGV, '{}'::text[])) AND n.value IS DISTINCT FROM v_alt -> n.key;
  IF v_geaendert IS NOT NULL THEN
    RAISE EXCEPTION 'Keine Berechtigung, diese Felder in % zu ändern: %', TG_TABLE_NAME, v_geaendert USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$$m$);
  PERFORM pg_temp.s112_mutiere('uec_update_grant',
    $m$GRANT UPDATE (anzeigename) ON public.user_email_connections TO authenticated$m$);
  -- Verbotenes Muster (CLAUDE.md „Plattform-Admin in RLS“): Ausnahme über die Rolle system_admin
  PERFORM pg_temp.s112_mutiere('pa_ueber_system_admin',
    $m$CREATE OR REPLACE FUNCTION public.schutz_plattformfelder() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  v_alt jsonb;
  v_geaendert text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenant_memberships m WHERE m.user_id = (SELECT auth.uid()) AND m.role = 'system_admin') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Keine Berechtigung, in % neue Zeilen anzulegen', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  v_alt := to_jsonb(OLD);
  SELECT string_agg(n.key, ', ' ORDER BY n.key) INTO v_geaendert
    FROM jsonb_each(to_jsonb(NEW)) AS n
   WHERE n.key <> ALL (COALESCE(TG_ARGV, '{}'::text[])) AND n.value IS DISTINCT FROM v_alt -> n.key;
  IF v_geaendert IS NOT NULL THEN
    RAISE EXCEPTION 'Keine Berechtigung, diese Felder in % zu ändern: %', TG_TABLE_NAME, v_geaendert USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$$m$);
  PERFORM pg_temp.s112_mutiere('insert_zweig_weg',
    $m$CREATE OR REPLACE FUNCTION public.schutz_plattformfelder() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  v_alt jsonb;
  v_geaendert text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid())) THEN
    RETURN NEW;
  END IF;
  IF false THEN
    RAISE EXCEPTION 'Keine Berechtigung, in % neue Zeilen anzulegen', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  v_alt := to_jsonb(OLD);
  SELECT string_agg(n.key, ', ' ORDER BY n.key) INTO v_geaendert
    FROM jsonb_each(to_jsonb(NEW)) AS n
   WHERE n.key <> ALL (COALESCE(TG_ARGV, '{}'::text[])) AND n.value IS DISTINCT FROM v_alt -> n.key;
  IF v_geaendert IS NOT NULL THEN
    RAISE EXCEPTION 'Keine Berechtigung, diese Felder in % zu ändern: %', TG_TABLE_NAME, v_geaendert USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$$m$);
  PERFORM pg_temp.s112_mutiere('geheimnis_view',
    $m$CREATE VIEW public.s112test_einst AS SELECT tenant_id, brevo_api_key FROM public.tenant_einstellungen$m$);
  PERFORM pg_temp.s112_mutiere('geheimnis_view',
    $m$GRANT SELECT ON public.s112test_einst TO authenticated, anon$m$);
  PERFORM pg_temp.s112_mutiere('geheimnis_rpc',
    $m$CREATE FUNCTION public.s112test_geheim(p_tenant_id uuid) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public
       AS $fn$ SELECT brevo_api_key FROM public.tenant_einstellungen WHERE tenant_id = p_tenant_id $fn$$m$);
  PERFORM pg_temp.s112_mutiere('geheimnis_rpc',
    $m$GRANT EXECUTE ON FUNCTION public.s112test_geheim(uuid) TO authenticated$m$);
  PERFORM pg_temp.s112_mutiere('geheimnis_rpc_zeile',
    $m$CREATE FUNCTION public.s112test_zeile(uuid) RETURNS SETOF public.tenant_einstellungen LANGUAGE sql SECURITY DEFINER SET search_path = public
       AS $fn$ SELECT * FROM public.tenant_einstellungen WHERE tenant_id = $1 $fn$$m$);
  PERFORM pg_temp.s112_mutiere('geheimnis_rpc_zeile',
    $m$GRANT EXECUTE ON FUNCTION public.s112test_zeile(uuid) TO authenticated$m$);
  PERFORM pg_temp.s112_mutiere('geheimnis_rpc_jsonb',
    $m$CREATE FUNCTION public.s112test_json(uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public
       AS $fn$ SELECT to_jsonb(t) FROM public.tenant_einstellungen t WHERE t.tenant_id = $1 $fn$$m$);
  PERFORM pg_temp.s112_mutiere('geheimnis_rpc_jsonb',
    $m$GRANT EXECUTE ON FUNCTION public.s112test_json(uuid) TO authenticated$m$);
  PERFORM pg_temp.s112_mutiere('geheimnis_rpc_atomic',
    $m$CREATE FUNCTION public.s112test_atomic(uuid) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public
       BEGIN ATOMIC SELECT brevo_api_key FROM public.tenant_einstellungen WHERE tenant_id = $1; END$m$);
  PERFORM pg_temp.s112_mutiere('geheimnis_rpc_atomic',
    $m$GRANT EXECUTE ON FUNCTION public.s112test_atomic(uuid) TO authenticated$m$);
  PERFORM pg_temp.s112_mutiere('geheimnis_rpc_dynamisch',
    $m$CREATE FUNCTION public.s112test_dyn(uuid, text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
       AS $fn$ DECLARE v text; BEGIN EXECUTE format('SELECT %I FROM public.tenant_einstellungen WHERE tenant_id = $1', $2) INTO v USING $1; RETURN v; END $fn$$m$);
  PERFORM pg_temp.s112_mutiere('geheimnis_rpc_dynamisch',
    $m$GRANT EXECUTE ON FUNCTION public.s112test_dyn(uuid, text) TO authenticated$m$);
  PERFORM pg_temp.s112_mutiere('anon_revoke_nicht_geheimnis',
    $m$REVOKE SELECT (anzeigename) ON public.tenant_einstellungen FROM anon$m$);
  PERFORM pg_temp.s112_mutiere('service_gesperrt',
    $m$CREATE OR REPLACE FUNCTION public.schutz_plattformfelder() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  v_alt jsonb;
  v_geaendert text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon', 'postgres', 'service_role') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid())) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Keine Berechtigung, in % neue Zeilen anzulegen', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  v_alt := to_jsonb(OLD);
  SELECT string_agg(n.key, ', ' ORDER BY n.key) INTO v_geaendert
    FROM jsonb_each(to_jsonb(NEW)) AS n
   WHERE n.key <> ALL (COALESCE(TG_ARGV, '{}'::text[])) AND n.value IS DISTINCT FROM v_alt -> n.key;
  IF v_geaendert IS NOT NULL THEN
    RAISE EXCEPTION 'Keine Berechtigung, diese Felder in % zu ändern: %', TG_TABLE_NAME, v_geaendert USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$$m$);
  PERFORM pg_temp.s112_mutiere('uec_delete_betrieb',
    $m$DROP POLICY uec_eigene_loeschen ON public.user_email_connections$m$);
  PERFORM pg_temp.s112_mutiere('uec_delete_betrieb',
    $m$CREATE POLICY uec_eigene_loeschen ON public.user_email_connections FOR DELETE TO authenticated USING (tenant_id IN (SELECT public.s112_meine_tenants()))$m$);

  -- ── 1. Katalog ────────────────────────────────────────────────────────────────────────────────────────
  SELECT string_agg(encode(t.tgargs, 'escape'), '') INTO v_txt FROM pg_trigger t
   WHERE t.tgrelid = 'public.tenants'::regclass AND t.tgname = 'a_schutz_plattformfelder' AND t.tgenabled = 'O';
  v_erg := v_erg || pg_temp.s112_erwarte('trigger_argumente_tenants', replace(v_txt, E'\\000', '|'), 'bio_status|updated_at|');
  SELECT string_agg(encode(t.tgargs, 'escape'), '') INTO v_txt FROM pg_trigger t
   WHERE t.tgrelid = 'public.tenant_einstellungen'::regclass AND t.tgname = 'a_schutz_plattformfelder' AND t.tgenabled = 'O';
  v_erg := v_erg || pg_temp.s112_erwarte('trigger_argumente_einstellungen', replace(v_txt, E'\\000', '|'),
                                         'svs_option|svs_option_seit|svs_einkuenfte_manuell|svs_kv_angehoerige|');
  SELECT count(*) INTO v_n FROM pg_trigger t
   WHERE t.tgrelid IN ('public.tenants'::regclass, 'public.tenant_einstellungen'::regclass)
     AND t.tgname = 'a_schutz_plattformfelder' AND t.tgenabled = 'O'
     AND t.tgtype & 2 = 2 AND t.tgtype & 4 = 4 AND t.tgtype & 16 = 16   -- BEFORE, INSERT, UPDATE
     AND t.tgfoid = 'public.schutz_plattformfelder()'::regprocedure;
  v_erg := v_erg || pg_temp.s112_erwarte('trigger_before_insert_update_aktiv', v_n, 2);
  SELECT count(*) INTO v_n FROM pg_trigger t
   WHERE t.tgrelid = 'public.tenants'::regclass AND t.tgname = 'kundennummer_unveraenderlich_trg' AND t.tgenabled = 'O';
  v_erg := v_erg || pg_temp.s112_erwarte('trigger_kundennummer_aktiv', v_n, 1);

  -- Tabellenrechte: tenant_einstellungen und user_email_connections ohne SELECT/INSERT/UPDATE auf Tabellenebene
  FOREACH v_tab IN ARRAY ARRAY['tenant_einstellungen', 'user_email_connections'] LOOP
    FOREACH v_p IN ARRAY ARRAY['authenticated', 'anon'] LOOP
      v_erg := v_erg || pg_temp.s112_erwarte(format('tabelle_ganz_%s_%s', v_p, v_tab),
        has_table_privilege(v_p, format('public.%I', v_tab), 'SELECT') OR has_table_privilege(v_p, format('public.%I', v_tab), 'INSERT')
        OR has_table_privilege(v_p, format('public.%I', v_tab), 'UPDATE') OR has_table_privilege(v_p, format('public.%I', v_tab), 'REFERENCES'),
        false);
    END LOOP;
  END LOOP;

  -- Geheimnisliste: jede Spalte existiert und ist für authenticated/anon weder lesbar noch schreibbar
  FOREACH v_txt IN ARRAY v_geheim LOOP
    v_tab := split_part(v_txt, '.', 1);
    v_sp := split_part(v_txt, '.', 2);
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = format('public.%I', v_tab)::regclass
                    AND a.attname = v_sp AND NOT a.attisdropped) THEN
      v_erg := v_erg || pg_temp.s112_fehler('geheimnis_spalte_fehlt:' || v_txt, 'Spalte gibt es nicht – Liste in _helfer.sql prüfen');
      CONTINUE;
    END IF;
    FOREACH v_p IN ARRAY ARRAY['authenticated', 'anon'] LOOP
      v_erg := v_erg || pg_temp.s112_erwarte(format('geheimnis_recht_%s:%s', v_p, v_txt),
        has_column_privilege(v_p, format('public.%I', v_tab), v_sp, 'SELECT')
        OR has_column_privilege(v_p, format('public.%I', v_tab), v_sp, 'INSERT')
        OR has_column_privilege(v_p, format('public.%I', v_tab), v_sp, 'UPDATE')
        OR has_column_privilege(v_p, format('public.%I', v_tab), v_sp, 'REFERENCES'),
        false);
    END LOOP;
  END LOOP;

  -- Namensmuster: keine weitere Spalte, die nach Geheimnis aussieht, ohne Eintrag in der Liste
  v_n := 0;
  FOR r IN SELECT c.relname::text AS tab, a.attname::text AS sp
             FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
            WHERE c.oid IN ('public.tenant_einstellungen'::regclass, 'public.user_email_connections'::regclass, 'public.tenants'::regclass)
              AND a.attnum > 0 AND NOT a.attisdropped AND a.attname ~ c_muster
            ORDER BY 1, 2 LOOP
    v_n := v_n + 1;
    IF NOT (r.tab || '.' || r.sp) = ANY (v_geheim) THEN
      v_erg := v_erg || pg_temp.s112_fehler('geheimnis_muster_ohne_eintrag:' || r.tab || '.' || r.sp,
                                             'sieht nach Geheimnis aus, steht aber nicht in s112_soll_liste(''geheimnis_spalten'')');
    END IF;
  END LOOP;
  v_erg := v_erg || pg_temp.s112_erwarte('geheimnis_muster_trifft_liste', v_n, cardinality(v_geheim)::bigint);

  -- Umwege um die Spaltenrechte: Views und SECURITY-DEFINER-Funktionen, die Geheimnisse ausgeben.
  -- Kontrollen zuerst (sonst wäre „keine gefunden“ wertlos): eine temporäre View und eine Funktion ohne
  -- Benutzerrechte muss die Suche finden (nicht lesbar), mit Recht muss sie sie als lesbar melden.
  EXECUTE 'CREATE TEMP VIEW t16_kontrolle_view AS SELECT tenant_id, brevo_api_key FROM public.tenant_einstellungen';
  EXECUTE 'REVOKE ALL ON pg_temp.t16_kontrolle_view FROM PUBLIC, authenticated, anon';
  EXECUTE $s$CREATE FUNCTION public.s112test_kontrolle_rpc() RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public
             AS $fn$ SELECT bawb_passwort FROM public.tenant_einstellungen LIMIT 0 $fn$$s$;
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.s112test_kontrolle_rpc() FROM PUBLIC, authenticated, anon';
  SELECT string_agg(u.art || '=' || u.lesbar, ',' ORDER BY u.art) INTO v_txt FROM pg_temp.t16_geheimnis_umwege(v_geheim) u
   WHERE u.objekt LIKE '%.t16_kontrolle_view' OR u.objekt = 'public.s112test_kontrolle_rpc()';
  v_erg := v_erg || pg_temp.s112_erwarte('geheimnis_umwege_kontrolle_ohne_recht', v_txt, 'rpc=false,view=false');
  EXECUTE 'GRANT SELECT (tenant_id) ON pg_temp.t16_kontrolle_view TO authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.s112test_kontrolle_rpc() TO anon';
  SELECT string_agg(u.art || '=' || u.lesbar, ',' ORDER BY u.art) INTO v_txt FROM pg_temp.t16_geheimnis_umwege(v_geheim) u
   WHERE u.objekt LIKE '%.t16_kontrolle_view' OR u.objekt = 'public.s112test_kontrolle_rpc()';
  v_erg := v_erg || pg_temp.s112_erwarte('geheimnis_umwege_kontrolle_mit_recht', v_txt, 'rpc=true,view=true');
  EXECUTE 'DROP VIEW pg_temp.t16_kontrolle_view';
  EXECUTE 'DROP FUNCTION public.s112test_kontrolle_rpc()';
  -- Kontrollen für die Umwege ohne Geheimnis-Spaltennamen im prosrc: ganze Zeile als Rückgabetyp, BEGIN ATOMIC
  -- (prosrc leer), to_jsonb der Zeile, dynamisches SQL mit Spaltenname als Parameter. Erst ohne Recht
  -- (gefunden, nicht lesbar), dann mit EXECUTE für authenticated bzw. anon (lesbar), jeweils mit Kriterium.
  EXECUTE $s$CREATE FUNCTION public.s112test_kontrolle_zeile() RETURNS SETOF public.tenant_einstellungen LANGUAGE sql
             SECURITY DEFINER SET search_path = public AS $fn$ SELECT e FROM public.tenant_einstellungen e LIMIT 0 $fn$$s$;
  EXECUTE $s$CREATE FUNCTION public.s112test_kontrolle_atomic() RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public
             BEGIN ATOMIC SELECT sumup_api_key FROM public.tenant_einstellungen LIMIT 0; END$s$;
  EXECUTE $s$CREATE FUNCTION public.s112test_kontrolle_json(uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public
             AS $fn$ SELECT to_jsonb(t) FROM public.tenant_einstellungen t WHERE t.tenant_id = $1 LIMIT 0 $fn$$s$;
  EXECUTE $s$CREATE FUNCTION public.s112test_kontrolle_dyn(text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
             AS $fn$ DECLARE v text; BEGIN EXECUTE format('SELECT %I FROM public.tenant_einstellungen LIMIT 0', $1) INTO v; RETURN v; END $fn$$s$;
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.s112test_kontrolle_zeile(), public.s112test_kontrolle_atomic(),
           public.s112test_kontrolle_json(uuid), public.s112test_kontrolle_dyn(text) FROM PUBLIC, authenticated, anon';
  -- Beleg, dass BEGIN ATOMIC den Text nicht in prosrc hat (sonst wäre die Kontrolle unten nicht aussagekräftig)
  SELECT count(*) INTO v_n FROM pg_proc p
   WHERE p.oid = 'public.s112test_kontrolle_atomic()'::regprocedure AND p.prosrc !~ 'sumup_api_key' AND p.prosqlbody IS NOT NULL;
  v_erg := v_erg || pg_temp.s112_erwarte('geheimnis_umwege_kontrolle_atomic_prosrc_ohne_text', v_n, 1);
  v_kontr := '{}';
  FOR v_p IN SELECT 'ohne_recht' UNION ALL SELECT 'mit_recht' LOOP
    IF v_p = 'mit_recht' THEN
      EXECUTE 'GRANT EXECUTE ON FUNCTION public.s112test_kontrolle_zeile(), public.s112test_kontrolle_json(uuid) TO authenticated';
      EXECUTE 'GRANT EXECUTE ON FUNCTION public.s112test_kontrolle_atomic(), public.s112test_kontrolle_dyn(text) TO anon';
    END IF;
    SELECT coalesce(jsonb_object_agg(u.objekt, u.lesbar::text || '/' || u.grund), '{}') INTO v_kontr
      FROM pg_temp.t16_geheimnis_umwege(v_geheim) u WHERE u.objekt LIKE 'public.s112test\_kontrolle\_%';
    FOR r IN SELECT * FROM (VALUES ('public.s112test_kontrolle_zeile()', 'zeilentyp'),
                                   ('public.s112test_kontrolle_atomic()', 'spalte'),
                                   ('public.s112test_kontrolle_json(uuid)', 'ganze_zeile'),
                                   ('public.s112test_kontrolle_dyn(text)', 'ganze_zeile')) k(obj, grund) LOOP
      v_erg := v_erg || pg_temp.s112_erwarte(format('geheimnis_umwege_kontrolle_%s:%s', v_p, r.obj), v_kontr ->> r.obj,
                                             (v_p = 'mit_recht')::text || '/' || r.grund);
    END LOOP;
  END LOOP;
  EXECUTE 'DROP FUNCTION public.s112test_kontrolle_zeile(), public.s112test_kontrolle_atomic(),
           public.s112test_kontrolle_json(uuid), public.s112test_kontrolle_dyn(text)';
  v_n := 0;
  FOR r IN SELECT u.art, u.objekt, u.grund FROM pg_temp.t16_geheimnis_umwege(v_geheim) u
            WHERE u.lesbar AND NOT (u.art = 'rpc' AND u.objekt = ANY (c_rpc_ausnahmen)) ORDER BY 1, 2 LOOP
    v_n := v_n + 1;
    v_erg := v_erg || pg_temp.s112_fehler('geheimnis_' || r.art || ':' || r.objekt,
      CASE r.art WHEN 'view' THEN 'View liest eine Geheimnis-Spalte und ist für authenticated/anon lesbar (ohne security_invoker)'
                 ELSE 'SECURITY DEFINER (Kriterium ' || r.grund || ') gibt womöglich Geheimnisse aus und ist für authenticated/anon ausführbar – c_rpc_ausnahmen?' END);
  END LOOP;
  -- Jede Ausnahme muss noch existieren und noch ein Treffer sein (sonst veraltet)
  FOREACH v_txt IN ARRAY c_rpc_ausnahmen LOOP
    SELECT count(*) INTO v_n FROM pg_temp.t16_geheimnis_umwege(v_geheim) u WHERE u.art = 'rpc' AND u.objekt = v_txt;
    v_erg := v_erg || pg_temp.s112_erwarte('geheimnis_rpc_ausnahme_aktuell:' || v_txt, v_n, 1);
  END LOOP;
  SELECT count(*) INTO v_n FROM pg_temp.t16_geheimnis_umwege(v_geheim) u
   WHERE u.lesbar AND NOT (u.art = 'rpc' AND u.objekt = ANY (c_rpc_ausnahmen));
  IF v_n = 0 THEN
    v_erg := v_erg || pg_temp.s112_ok('geheimnis_umwege_keine');
  END IF;

  -- ── 2. tenants: dynamisch über alle Spalten ───────────────────────────────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_b_w_sieht_zeile',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.tenants WHERE id = %L', v_b)), '1');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_b_ta_sieht_zeile',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.tenants WHERE id = %L', v_b)), '1');
  PERFORM pg_temp.s112_als_postgres();

  FOR r IN SELECT a.attname::text AS sp, format_type(a.atttypid, a.atttypmod) AS typ
             FROM pg_attribute a
            WHERE a.attrelid = 'public.tenants'::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
            ORDER BY a.attnum LOOP
    v_ausdr := pg_temp.t16_anders(r.sp, r.typ);
    IF v_ausdr IS NULL THEN
      v_erg := v_erg || pg_temp.s112_fehler('tenants_typ_unbekannt:' || r.sp, r.typ);
      CONTINUE;
    END IF;
    v_sql := format('UPDATE public.tenants SET %I = %s WHERE id = %L', r.sp, v_ausdr, v_b);
    v_soll := CASE WHEN r.sp IN ('bio_status', 'updated_at') THEN 'k1' ELSE 'T' END;
    PERFORM pg_temp.s112_als(v_bta);
    v_erg := v_erg || pg_temp.s112_erwarte('tenants_upd_b_ta:' || r.sp, pg_temp.s112_versuch(v_sql), v_soll);
    PERFORM pg_temp.s112_als(v_bw);
    v_erg := v_erg || pg_temp.s112_erwarte('tenants_upd_b_w:' || r.sp, pg_temp.s112_versuch(v_sql), 'k0');
  END LOOP;

  PERFORM pg_temp.s112_als(v_bta);
  -- Meldung stammt aus a_schutz_plattformfelder (nicht aus RLS oder einem Recht)
  v_txt := pg_temp.s112_fehlertext(format('UPDATE public.tenants SET plan = %L WHERE id = %L', 'enterprise', v_b));
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_meldung_trigger',
    v_txt LIKE '42501: Keine Berechtigung, diese Felder in tenants zu ändern: plan%', true);
  -- Unveränderter Wert zählt nicht als Änderung (SET plan = plan) – der Trigger vergleicht Werte
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_noop_plan_b_ta',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET plan = plan WHERE id = %L', v_b)), 'k1');
  -- Erlaubtes und gesperrtes Feld zusammen → abgelehnt
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_gemischt_b_ta',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET bio_status = %L, max_benutzer = 99 WHERE id = %L', 'bio_eu', v_b)), 'T');
  -- INSERT: nur Plattform-Admins. Der BEFORE-Trigger läuft vor der RLS-WITH-CHECK-Prüfung → T, und zwar mit
  -- der Meldung des INSERT-Zweigs (fällt der Zweig weg, meldet der UPDATE-Zweig „diese Felder … zu ändern“).
  v_sql := format('INSERT INTO public.tenants (name, slug) VALUES (%L, %L)', 'S112TEST neu', 's112test-neu-' || gen_random_uuid());
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_insert_b_ta', pg_temp.s112_versuch(v_sql), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_insert_b_ta_meldung',
    pg_temp.s112_fehlertext(v_sql) LIKE '42501: Keine Berechtigung, in tenants neue Zeilen anzulegen%', true);
  -- DELETE: authenticated hat das Recht, aber keine DELETE-Policy → 0 Zeilen (Stand 28.09.2026 genau k0)
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_delete_b_ta',
    pg_temp.s112_versuch(format('DELETE FROM public.tenants WHERE id = %L', v_b)), 'k0');
  PERFORM pg_temp.s112_als(NULL, 'anon');
  -- anon: Tabellenrechte vorhanden, Policies nur TO authenticated → 0 Zeilen; INSERT scheitert am Trigger
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_upd_anon',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET bio_status = %L WHERE id = %L', 'bio_eu', v_b)), 'k0');
  v_sql := format('INSERT INTO public.tenants (name, slug) VALUES (%L, %L)', 'S112TEST anon', 's112test-anon-' || gen_random_uuid());
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_insert_anon', pg_temp.s112_versuch(v_sql), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('tenants_insert_anon_meldung',
    pg_temp.s112_fehlertext(v_sql) LIKE '42501: Keine Berechtigung, in tenants neue Zeilen anzulegen%', true);

  -- system_admin OHNE Plattform-Admin-Eintrag (m_sa in M): die Trigger-Ausnahme gilt nur über plattform_admins.
  -- Kontrolle zuerst: m_sa kommt durch RLS (erlaubtes Feld → k1), sonst wäre das T unten wertlos.
  -- M ist der Musterhof – nur über s112_versuch (rollt sofort zurück).
  PERFORM pg_temp.s112_als(v_msa);
  v_erg := v_erg || pg_temp.s112_erwarte('sa_kontrolle_tenants_bio_status',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET bio_status = %s WHERE id = %L', pg_temp.t16_anders('bio_status', 'text'), v_m)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('sa_kontrolle_einst_svs_option',
    pg_temp.s112_versuch(format('UPDATE public.tenant_einstellungen SET svs_option = %s WHERE tenant_id = %L', pg_temp.t16_anders('svs_option', 'text'), v_m)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('sa_ohne_pa_tenants_plan',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET plan = %s WHERE id = %L', pg_temp.t16_anders('plan', 'text'), v_m)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('sa_ohne_pa_tenants_max_benutzer',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET max_benutzer = coalesce(max_benutzer, 0) + 1 WHERE id = %L', v_m)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('sa_ohne_pa_einst_zaehler',
    pg_temp.s112_versuch(format('UPDATE public.tenant_einstellungen SET rechnung_zaehler = rechnung_zaehler + 1 WHERE tenant_id = %L', v_m)), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('sa_ohne_pa_tenants_insert',
    pg_temp.s112_versuch(format('INSERT INTO public.tenants (name, slug) VALUES (%L, %L)', 'S112TEST SA', 's112test-sa-' || gen_random_uuid())), 'T');

  -- Test-Plattform-Admin (system_admin in B): Paketfelder änderbar
  PERFORM pg_temp.s112_als(v_pa);
  v_erg := v_erg || pg_temp.s112_erwarte('pa_tenants_plan',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET plan = %L WHERE id = %L', 'pro', v_b)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('pa_tenants_stripe_status',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET stripe_status = %L WHERE id = %L', 'active', v_b)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('pa_tenants_max_benutzer',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET max_benutzer = 7 WHERE id = %L', v_b)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('pa_tenants_insert',
    pg_temp.s112_versuch(format('INSERT INTO public.tenants (name, slug) VALUES (%L, %L)', 'S112TEST PA', 's112test-pa-' || gen_random_uuid())), 'k1');

  -- Kundennummer: als postgres setzen, danach unveränderlich – auch für Plattform-Admin und postgres
  PERFORM pg_temp.s112_als_postgres();
  -- Geschützt im Unterblock: sperrt eine Regression den Schutz-Trigger auch für postgres/service_role, soll das
  -- als benannter FEHLER (service_postgres_kundennummer_setzen) erscheinen, nicht als Abbruch des ganzen Laufs.
  BEGIN
    UPDATE public.tenants SET kundennummer = 'S112TEST-KN1' WHERE id = v_b;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_erg := v_erg || pg_temp.s112_erwarte('service_postgres_kundennummer_setzen', v_n, 1);
  EXCEPTION WHEN OTHERS THEN
    v_erg := v_erg || pg_temp.s112_fehler('service_postgres_kundennummer_setzen', SQLSTATE || ': ' || SQLERRM);
  END;
  v_erg := v_erg || pg_temp.s112_erwarte('kundennummer_postgres_unveraenderlich',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET kundennummer = %L WHERE id = %L', 'S112TEST-KN2', v_b)), 'EP0001');
  PERFORM pg_temp.s112_als(v_pa);
  v_txt := pg_temp.s112_fehlertext(format('UPDATE public.tenants SET kundennummer = %L WHERE id = %L', 'S112TEST-KN2', v_b));
  v_erg := v_erg || pg_temp.s112_erwarte('pa_kundennummer_unveraenderlich',
    v_txt LIKE 'P0001: Kundennummer S112TEST-KN1 kann nicht geändert werden%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('pa_kundennummer_nicht_loeschbar',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET kundennummer = NULL WHERE id = %L', v_b)), 'EP0001');
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('kundennummer_b_ta',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET kundennummer = %L WHERE id = %L', 'S112TEST-KN3', v_b)), 'T');
  PERFORM pg_temp.s112_als_postgres();

  -- ── 3. tenant_einstellungen: dynamisch über alle Spalten mit UPDATE-Recht ────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('einst_b_w_sieht_zeile',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.tenant_einstellungen WHERE tenant_id = %L', v_b)), '1');
  PERFORM pg_temp.s112_als(v_bl);
  v_erg := v_erg || pg_temp.s112_erwarte('einst_b_l_sieht_zeile',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.tenant_einstellungen WHERE tenant_id = %L', v_b)), '1');
  PERFORM pg_temp.s112_als_postgres();

  v_n := 0;
  FOR r IN SELECT a.attname::text AS sp, format_type(a.atttypid, a.atttypmod) AS typ
             FROM pg_attribute a
            WHERE a.attrelid = 'public.tenant_einstellungen'::regclass AND a.attnum > 0 AND NOT a.attisdropped
              AND a.attgenerated = '' AND has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
            ORDER BY a.attnum LOOP
    v_n := v_n + 1;
    v_ausdr := pg_temp.t16_anders(r.sp, r.typ);
    IF v_ausdr IS NULL THEN
      v_erg := v_erg || pg_temp.s112_fehler('einst_typ_unbekannt:' || r.sp, r.typ);
      CONTINUE;
    END IF;
    v_sql := format('UPDATE public.tenant_einstellungen SET %I = %s WHERE tenant_id = %L', r.sp, v_ausdr, v_b);
    v_soll := CASE WHEN r.sp IN ('svs_option', 'svs_option_seit', 'svs_einkuenfte_manuell', 'svs_kv_angehoerige') THEN 'k1' ELSE 'T' END;
    PERFORM pg_temp.s112_als(v_bta);
    v_erg := v_erg || pg_temp.s112_erwarte('einst_upd_b_ta:' || r.sp, pg_temp.s112_versuch(v_sql), v_soll);
    PERFORM pg_temp.s112_als(v_bw);
    v_erg := v_erg || pg_temp.s112_erwarte('einst_upd_b_w:' || r.sp, pg_temp.s112_versuch(v_sql), 'k0');
    PERFORM pg_temp.s112_als(v_bl);
    v_erg := v_erg || pg_temp.s112_erwarte('einst_upd_b_l:' || r.sp, pg_temp.s112_versuch(v_sql), 'k0');
    PERFORM pg_temp.s112_als(v_pa);
    -- Testbetriebe haben seit KAN-195 modul_ea und modul_sumup an: modul_ea allein ausschalten verletzt
    -- chk_sumup_bedingt_buchhaltung – CHECK, kein Schutzfehler
    v_erg := v_erg || pg_temp.s112_erwarte('pa_einst_upd:' || r.sp, pg_temp.s112_versuch(v_sql),
                                           CASE WHEN r.sp = 'modul_ea' THEN 'E23514' ELSE 'k1' END);
  END LOOP;
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('einst_update_spalten_vorhanden', v_n >= 90, true);

  PERFORM pg_temp.s112_als(v_bta);
  v_txt := pg_temp.s112_fehlertext(format('UPDATE public.tenant_einstellungen SET rechnung_zaehler = rechnung_zaehler + 100 WHERE tenant_id = %L', v_b));
  v_erg := v_erg || pg_temp.s112_erwarte('einst_meldung_trigger',
    v_txt LIKE '42501: Keine Berechtigung, diese Felder in tenant_einstellungen zu ändern: rechnung_zaehler%', true);
  v_erg := v_erg || pg_temp.s112_erwarte('einst_svs_zusammen_b_ta',
    pg_temp.s112_versuch(format('UPDATE public.tenant_einstellungen SET svs_option = %L, svs_option_seit = pg_temp.s112_heute(), svs_einkuenfte_manuell = 1234.5, svs_kv_angehoerige = true WHERE tenant_id = %L', 'option', v_b)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('einst_gemischt_b_ta',
    pg_temp.s112_versuch(format('UPDATE public.tenant_einstellungen SET svs_option = %L, ki_abfragen_paket = %L WHERE tenant_id = %L', 'option', 'unlimited', v_b)), 'T');
  -- INSERT, Upsert, DELETE: authenticated hat weder INSERT- noch DELETE-Recht (42501)
  v_erg := v_erg || pg_temp.s112_erwarte('einst_insert_b_ta',
    pg_temp.s112_versuch(format('INSERT INTO public.tenant_einstellungen (tenant_id) VALUES (%L)', v_b)), 'G');
  v_erg := v_erg || pg_temp.s112_erwarte('einst_upsert_b_ta',
    pg_temp.s112_versuch(format('INSERT INTO public.tenant_einstellungen (tenant_id, svs_option) VALUES (%L, %L) ON CONFLICT (tenant_id) DO UPDATE SET svs_option = EXCLUDED.svs_option', v_b, 'option')), 'G');
  v_erg := v_erg || pg_temp.s112_erwarte('einst_delete_b_ta',
    pg_temp.s112_versuch(format('DELETE FROM public.tenant_einstellungen WHERE tenant_id = %L', v_b)), 'G');
  PERFORM pg_temp.s112_als(v_pa);
  v_erg := v_erg || pg_temp.s112_erwarte('pa_einst_insert',
    pg_temp.s112_versuch(format('INSERT INTO public.tenant_einstellungen (tenant_id) VALUES (%L)', v_b)), 'G');
  -- Zweite Schutzschicht einzeln: mit vorübergehendem INSERT-Spaltenrecht (als postgres, wird mit allem
  -- zurückgerollt und gleich wieder entzogen) muss der Trigger den Insert ablehnen – vor RLS und Unique-Index.
  PERFORM pg_temp.s112_als_postgres();
  EXECUTE 'GRANT INSERT (tenant_id) ON public.tenant_einstellungen TO authenticated';
  PERFORM pg_temp.s112_als(v_bta);
  v_sql := format('INSERT INTO public.tenant_einstellungen (tenant_id) VALUES (%L)', gen_random_uuid());
  v_erg := v_erg || pg_temp.s112_erwarte('einst_insert_trigger_b_ta', pg_temp.s112_versuch(v_sql), 'T');
  v_erg := v_erg || pg_temp.s112_erwarte('einst_insert_trigger_b_ta_meldung',
    pg_temp.s112_fehlertext(v_sql) LIKE '42501: Keine Berechtigung, in tenant_einstellungen neue Zeilen anzulegen%', true);
  PERFORM pg_temp.s112_als_postgres();
  EXECUTE 'REVOKE INSERT (tenant_id) ON public.tenant_einstellungen FROM authenticated';
  v_erg := v_erg || pg_temp.s112_erwarte('einst_insert_recht_wieder_entzogen',
    has_column_privilege('authenticated', 'public.tenant_einstellungen', 'tenant_id', 'INSERT'), false);
  PERFORM pg_temp.s112_als(NULL, 'anon');
  v_erg := v_erg || pg_temp.s112_erwarte('einst_upd_anon',
    pg_temp.s112_versuch(format('UPDATE public.tenant_einstellungen SET svs_option = %L WHERE tenant_id = %L', 'option', v_b)), 'G');
  v_erg := v_erg || pg_temp.s112_erwarte('einst_insert_anon',
    pg_temp.s112_versuch(format('INSERT INTO public.tenant_einstellungen (tenant_id) VALUES (%L)', v_b)), 'G');
  PERFORM pg_temp.s112_als_postgres();

  -- ── 4. Geheimnis-Spalten: je Spalte lesen/schreiben, dazu ganze Zeilen ───────────────────────────────
  FOREACH v_txt IN ARRAY v_geheim LOOP
    v_tab := split_part(v_txt, '.', 1);
    v_sp := split_part(v_txt, '.', 2);
    FOREACH v_p IN ARRAY ARRAY['b_ta', 'anon', 'pa'] LOOP
      IF v_p = 'anon' THEN
        PERFORM pg_temp.s112_als(NULL, 'anon');
      ELSE
        PERFORM pg_temp.s112_als((v_a ->> v_p)::uuid);
      END IF;
      v_erg := v_erg || pg_temp.s112_erwarte(format('geheimnis_select_%s:%s', v_p, v_txt),
        pg_temp.s112_versuch(format('SELECT %I FROM public.%I WHERE tenant_id = %L', v_sp, v_tab, v_b)), 'G');
      -- Orakel über WHERE (ohne die Spalte auszugeben)
      v_erg := v_erg || pg_temp.s112_erwarte(format('geheimnis_where_%s:%s', v_p, v_txt),
        pg_temp.s112_versuch(format('SELECT count(*) FROM public.%I WHERE %I LIKE %L', v_tab, v_sp, 's112test%')), 'G');
      IF v_p <> 'pa' THEN
        v_erg := v_erg || pg_temp.s112_erwarte(format('geheimnis_update_%s:%s', v_p, v_txt),
          pg_temp.s112_versuch(format('UPDATE public.%I SET %I = NULL WHERE tenant_id = %L', v_tab, v_sp, v_b)), 'G');
      END IF;
    END LOOP;
  END LOOP;

  FOREACH v_tab IN ARRAY ARRAY['tenant_einstellungen', 'user_email_connections'] LOOP
    FOREACH v_p IN ARRAY ARRAY['b_ta', 'anon'] LOOP
      IF v_p = 'anon' THEN
        PERFORM pg_temp.s112_als(NULL, 'anon');
      ELSE
        PERFORM pg_temp.s112_als((v_a ->> v_p)::uuid);
      END IF;
      v_erg := v_erg || pg_temp.s112_erwarte(format('geheimnis_stern_%s:%s', v_p, v_tab),
        pg_temp.s112_versuch(format('SELECT * FROM public.%I', v_tab)), 'G');
      v_erg := v_erg || pg_temp.s112_erwarte(format('geheimnis_zeilenwert_%s:%s', v_p, v_tab),
        pg_temp.s112_versuch(format('SELECT t FROM public.%I t', v_tab)), 'G');
      v_erg := v_erg || pg_temp.s112_erwarte(format('geheimnis_to_jsonb_%s:%s', v_p, v_tab),
        pg_temp.s112_versuch(format('SELECT to_jsonb(t.*) FROM public.%I t', v_tab)), 'G');
      v_erg := v_erg || pg_temp.s112_erwarte(format('geheimnis_row_to_json_%s:%s', v_p, v_tab),
        pg_temp.s112_versuch(format('SELECT row_to_json(t) FROM public.%I t', v_tab)), 'G');
      v_erg := v_erg || pg_temp.s112_erwarte(format('geheimnis_count_zeilenwert_%s:%s', v_p, v_tab),
        pg_temp.s112_versuch(format('SELECT count(t) FROM public.%I t', v_tab)), 'G');
    END LOOP;
  END LOOP;
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('geheimnis_returning_stern_b_ta',
    pg_temp.s112_versuch(format('UPDATE public.tenant_einstellungen SET svs_option = svs_option WHERE tenant_id = %L RETURNING *', v_b)), 'G');
  v_erg := v_erg || pg_temp.s112_erwarte('geheimnis_returning_spalte_b_ta',
    pg_temp.s112_versuch(format('UPDATE public.tenant_einstellungen SET svs_option = svs_option WHERE tenant_id = %L RETURNING brevo_api_key', v_b)), 'G');
  v_erg := v_erg || pg_temp.s112_erwarte('geheimnis_returning_zeilenwert_b_ta',
    pg_temp.s112_versuch(format('UPDATE public.tenant_einstellungen t SET svs_option = svs_option WHERE tenant_id = %L RETURNING to_jsonb(t.*)', v_b)), 'G');
  -- Positivkontrolle: dasselbe UPDATE ohne RETURNING geht (sonst wäre das G oben wertlos)
  v_erg := v_erg || pg_temp.s112_erwarte('geheimnis_returning_kontrolle_b_ta',
    pg_temp.s112_versuch(format('UPDATE public.tenant_einstellungen SET svs_option = svs_option WHERE tenant_id = %L RETURNING svs_option', v_b)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('uec_delete_returning_stern_b_ta',
    pg_temp.s112_versuch(format('DELETE FROM public.user_email_connections WHERE id = %L RETURNING *', v_uec_ta)), 'G');
  PERFORM pg_temp.s112_als_postgres();

  -- ── 5. Regel für neue Spalten: jede Nicht-Geheimnis-Spalte ist für authenticated lesbar ──────────────
  FOR r IN SELECT c.relname::text AS tab, a.attname::text AS sp
             FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
            WHERE c.oid IN ('public.tenant_einstellungen'::regclass, 'public.user_email_connections'::regclass)
              AND a.attnum > 0 AND NOT a.attisdropped
              AND NOT (c.relname || '.' || a.attname) = ANY (v_geheim)
            ORDER BY c.relname, a.attnum LOOP
    PERFORM pg_temp.s112_als(v_bta);
    v_txt := pg_temp.s112_versuch(format('SELECT %I FROM public.%I WHERE %s', r.sp, r.tab,
               CASE WHEN r.tab = 'user_email_connections' THEN format('id = %L', v_uec_ta) ELSE format('tenant_id = %L', v_b) END));
    IF v_txt = 'k1' THEN
      v_erg := v_erg || pg_temp.s112_ok('spalte_lesbar:' || r.tab || '.' || r.sp);
    ELSE
      v_erg := v_erg || pg_temp.s112_fehler('spalte_ohne_grant:' || r.tab || '.' || r.sp,
        'ist=' || v_txt || ' – neue Spalte ohne GRANT SELECT (…) TO authenticated, anon? Geheimnis → s112_soll_liste');
    END IF;
    -- anon sieht zwar 0 Zeilen (Policies nur TO authenticated), CLAUDE.md verlangt den GRANT aber auch für anon –
    -- zur Laufzeit nicht beobachtbar, daher über das Spaltenrecht
    IF has_column_privilege('anon', format('public.%I', r.tab), r.sp, 'SELECT') THEN
      v_erg := v_erg || pg_temp.s112_ok('spalte_lesbar_anon:' || r.tab || '.' || r.sp);
    ELSE
      v_erg := v_erg || pg_temp.s112_fehler('spalte_ohne_grant_anon:' || r.tab || '.' || r.sp,
        'anon hat kein SELECT-Spaltenrecht – GRANT SELECT (…) TO authenticated, anon unvollständig?');
    END IF;
  END LOOP;
  PERFORM pg_temp.s112_als_postgres();

  -- ── 6. user_email_connections: nur eigene Zeile, kein INSERT/UPDATE ───────────────────────────────────
  PERFORM pg_temp.s112_als(v_bw);
  v_erg := v_erg || pg_temp.s112_erwarte('uec_b_w_sieht_nur_eigene',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.user_email_connections WHERE tenant_id = %L', v_b)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('uec_b_w_eigene_id',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.user_email_connections WHERE id = %L AND user_id = %L', v_uec_w, v_bw)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('uec_b_w_fremde_unsichtbar',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.user_email_connections WHERE id = %L', v_uec_ta)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('uec_b_w_insert',
    pg_temp.s112_versuch(format('INSERT INTO public.user_email_connections (tenant_id, user_id, email_address) VALUES (%L, %L, %L)', v_b, v_bw, 's112test-neu@software112.test')), 'G');
  v_erg := v_erg || pg_temp.s112_erwarte('uec_b_w_update_eigene',
    pg_temp.s112_versuch(format('UPDATE public.user_email_connections SET anzeigename = %L WHERE id = %L', 'S112TEST geändert', v_uec_w)), 'G');
  v_erg := v_erg || pg_temp.s112_erwarte('uec_b_w_update_fremde',
    pg_temp.s112_versuch(format('UPDATE public.user_email_connections SET anzeigename = %L WHERE id = %L', 'S112TEST geändert', v_uec_ta)), 'G');
  v_erg := v_erg || pg_temp.s112_erwarte('uec_b_w_delete_eigene',
    pg_temp.s112_versuch(format('DELETE FROM public.user_email_connections WHERE id = %L', v_uec_w)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('uec_b_w_delete_fremde',
    pg_temp.s112_versuch(format('DELETE FROM public.user_email_connections WHERE id = %L', v_uec_ta)), 'k0');
  -- auch der tenant_admin sieht nur die eigene Verbindung
  PERFORM pg_temp.s112_als(v_bta);
  v_erg := v_erg || pg_temp.s112_erwarte('uec_b_ta_sieht_nur_eigene',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.user_email_connections WHERE tenant_id = %L', v_b)), '1');
  v_erg := v_erg || pg_temp.s112_erwarte('uec_b_ta_delete_fremde',
    pg_temp.s112_versuch(format('DELETE FROM public.user_email_connections WHERE id = %L', v_uec_w)), 'k0');
  PERFORM pg_temp.s112_als(NULL, 'anon');
  v_erg := v_erg || pg_temp.s112_erwarte('uec_anon_sieht_nichts',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.user_email_connections WHERE tenant_id = %L', v_b)), '0');
  v_erg := v_erg || pg_temp.s112_erwarte('uec_anon_delete',
    pg_temp.s112_versuch(format('DELETE FROM public.user_email_connections WHERE id = %L', v_uec_w)), 'G');
  PERFORM pg_temp.s112_als_postgres();
  SELECT count(*) INTO v_n FROM public.user_email_connections WHERE id IN (v_uec_w, v_uec_ta);
  v_erg := v_erg || pg_temp.s112_erwarte('uec_nach_versuchen_unveraendert', v_n, 2);
  -- Zweite Schutzschicht einzeln (zur Laufzeit verdeckt: ein DELETE trifft nur Zeilen, die die SELECT-Policy
  -- zeigt): jede PERMISSIVE Policy, die DELETE erlaubt, beschränkt auf die eigene Zeile (user_id = auth.uid())
  -- und gilt nur für authenticated. Kontrolle: mindestens eine solche Policy existiert.
  SELECT count(*),
         string_agg(p.policyname, ',' ORDER BY p.policyname) FILTER (WHERE NOT (
           p.roles = '{authenticated}'::name[]
           AND regexp_replace(coalesce(p.qual, ''), '\s+', ' ', 'g')
               ~ '^\(*(user_id = \(* ?SELECT auth\.uid\(\)( AS uid)?\)*|\(* ?SELECT auth\.uid\(\)( AS uid)?\)* = user_id|user_id = auth\.uid\(\)|auth\.uid\(\) = user_id)\)*$'))
    INTO v_n, v_txt
    FROM pg_policies p
   WHERE p.schemaname = 'public' AND p.tablename = 'user_email_connections' AND p.permissive = 'PERMISSIVE'
     AND p.cmd IN ('DELETE', 'ALL');
  v_erg := v_erg || pg_temp.s112_erwarte('uec_delete_policy_vorhanden', v_n >= 1, true);
  v_erg := v_erg || pg_temp.s112_erwarte('uec_delete_policy_nur_eigene', coalesce(v_txt, '-'), '-');

  -- ── 7. Service-Kontext: der Schutz gilt nur für authenticated und anon ────────────────────────────────
  v_erg := v_erg || pg_temp.s112_erwarte('service_postgres_ohne_claims', public.ist_service_kontext(), true);
  v_erg := v_erg || pg_temp.s112_erwarte('service_postgres_tenants_plan',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET plan = %L, max_benutzer = 3 WHERE id = %L', 'enterprise', v_b)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('service_postgres_einst_zaehler',
    pg_temp.s112_versuch(format('UPDATE public.tenant_einstellungen SET rechnung_zaehler = rechnung_zaehler + 1, brevo_api_key = %L WHERE tenant_id = %L', 's112test-neu', v_b)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('service_postgres_einst_geheimnis_lesbar',
    pg_temp.s112_zaehle(format('SELECT count(*) FROM public.tenant_einstellungen WHERE tenant_id = %L AND brevo_api_key = %L', v_b, 's112test-geheim')), '1');
  EXECUTE 'SET LOCAL ROLE service_role';
  v_erg := v_erg || pg_temp.s112_erwarte('service_role_tenants_plan',
    pg_temp.s112_versuch(format('UPDATE public.tenants SET plan = %L WHERE id = %L', 'starter', v_b)), 'k1');
  v_erg := v_erg || pg_temp.s112_erwarte('service_role_tenants_insert',
    pg_temp.s112_versuch(format('INSERT INTO public.tenants (id, name, slug) VALUES (%L, %L, %L)', v_uec_w, 'S112TEST Service', 's112test-service-' || gen_random_uuid())), 'k1');
  PERFORM pg_temp.s112_als_postgres();
  v_erg := v_erg || pg_temp.s112_erwarte('rolle_zurueck_postgres', current_user::text, 'postgres');

  PERFORM pg_temp.s112_ende(c_datei, v_erg, v_t0, 550);
END
$test$;
