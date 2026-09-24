-- KAN-52 Nachtrag: ki_schema_info auf die KI-Allowlist beschränken.
--
-- Bisher lieferte ki_schema_info(p_tabellen) Spaltennamen und -typen jeder public-Tabelle,
-- die der Aufrufer übergab (information_schema zeigt alles, worauf authenticated Rechte
-- hat) – per /rest/v1/rpc/ki_schema_info also auch das Schema von tenants,
-- tenant_memberships, user_email_connections, bestandsprotokoll usw. Keine Daten, aber
-- unnötige Preisgabe.
--
-- Die Tabellenliste steht jetzt an genau einer Stelle in der Datenbank:
-- ki_erlaubte_tabellen(). ki_schema_info liefert nur noch Tabellen, die übergeben UND
-- erlaubt sind; ki_readonly_query liest dieselbe Liste statt ihrer bisherigen Konstante
-- (Inhalt unverändert, sonst keine Änderung an der Funktion). ERLAUBTE_TABELLEN in
-- src/app/api/ki-abfrage/route.ts muss eine Teilmenge davon sein.

-- ── Allowlist ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ki_erlaubte_tabellen()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public
AS $function$
  -- Bewusst nicht enthalten u. a.: tenants, tenant_memberships, tenant_einstellungen,
  -- profiles, plattform_admins, user_email_connections, bestandsprotokoll, sumup_*,
  -- assistent_*.
  SELECT ARRAY[
    -- Rieden / Weingärten
    'weingarten', 'grundstuecke', 'rebsorten', 'weingarten_rebsorten', 'lagen', 'weinbaugebiete_custom',
    -- Behandlungen / Pflanzenschutz / Düngung
    'behandlungen', 'behandlung_grundstuecke', 'saetze_massnahmen', 'pflanzenschutzmittel',
    'duengemittel', 'duengemittel_lager_bewegungen', 'psm_lager_bewegungen',
    -- Ernte / Jahrgänge
    'ernte_parzellen', 'weinjahrgaenge', 'ama_erntemeldungen', 'ama_meldepositionen',
    -- Kellerbuch / Weinausbau
    'weinausbau', 'weinausbau_weingaerten', 'pressungen', 'pressung_behaelter', 'pressung_weingaerten',
    'keller_umzuege', 'keller_behandlungen', 'keller_behandlungstypen', 'weinanalysen',
    'verschneidungen', 'verschneidung_quellen', 'behaelter', 'kellerplaene', 'kellerplan_positionen',
    'dac_antrag', 'pruefnummernantraege', 'transportbescheinigungen',
    -- Füllungen / Lager
    'fuellungen', 'fuellung_chargen', 'fuellung_bewegungen',
    -- CRM
    'kontakte', 'firmen', 'kontakt_firmen', 'kontakt_praeferenzen', 'aktivitaeten',
    'aktivitaet_dokumente', 'pipeline_eintraege', 'pipeline_verlauf', 'rabattgruppen',
    -- Verkauf
    'verkaufsposten', 'verkauf_positionen', 'sonstige_artikel',
    'bestellungen', 'bestellung_positionen',
    -- Einkauf
    'zukauf_posten', 'traubenverkauf',
    -- Export
    'exportauftraege', 'exportauftrag_positionen', 'export_dokumente',
    -- Controlling
    'kostenstellen', 'kostenarten', 'kosteneintraege', 'kosteneintrag_behaelter', 'kosteneintrag_weingaerten',
    -- Buchhaltung
    'ea_transaktionen', 'ea_kategorien', 'ea_dauerauftraege', 'ea_uva', 'zahlungen',
    -- Sonstiges
    'zeiterfassung', 'release_notes'
  ]::text[]
$function$;

COMMENT ON FUNCTION public.ki_erlaubte_tabellen() IS
  'KAN-52: einzige Tabellen-Allowlist für „Frag dein Weingut“ – gelesen von ki_readonly_query (Strukturprüfung) und ki_schema_info (Schema für den Prompt). ERLAUBTE_TABELLEN in src/app/api/ki-abfrage/route.ts muss eine Teilmenge sein.';

REVOKE EXECUTE ON FUNCTION public.ki_erlaubte_tabellen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ki_erlaubte_tabellen() TO authenticated;

-- ── ki_schema_info: nur noch erlaubte Tabellen ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ki_schema_info(p_tabellen text[])
 RETURNS TABLE(tabelle text, spalte text, typ text)
 LANGUAGE sql
 STABLE
 SET search_path = public
AS $function$
  SELECT c.table_name, c.column_name, c.data_type
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.table_name = ANY (p_tabellen)
     AND c.table_name = ANY (public.ki_erlaubte_tabellen())
   ORDER BY c.table_name, c.ordinal_position
$function$;

COMMENT ON FUNCTION public.ki_schema_info(text[]) IS
  'KAN-52: Spalten und Typen der übergebenen Tabellen für den Prompt von „Frag dein Weingut“ – nur Tabellen aus ki_erlaubte_tabellen(), alle anderen werden stillschweigend ausgelassen.';

REVOKE EXECUTE ON FUNCTION public.ki_schema_info(text[]) FROM PUBLIC, anon;

-- ── ki_readonly_query: Allowlist aus ki_erlaubte_tabellen() ─────────────────────────
-- Unverändert gegenüber 20260924182941_ki_readonly_query_haertung bis auf c_tabellen.
-- Owner (ki_abfrage) und Rechte bleiben bei CREATE OR REPLACE erhalten.
CREATE OR REPLACE FUNCTION public.ki_readonly_query(p_sql text, p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  -- Einzige Tabellenliste: ki_erlaubte_tabellen() (siehe dort).
  c_tabellen CONSTANT text[] := public.ki_erlaubte_tabellen();
  -- Erlaubte Funktionen (nur pg_catalog). Typumwandlungen aus pg_cast sind zusätzlich
  -- erlaubt, alles andere wird abgelehnt.
  c_funktionen CONSTANT text[] := ARRAY[
    -- Aggregate
    'count', 'sum', 'avg', 'min', 'max', 'string_agg', 'array_agg', 'bool_and', 'bool_or', 'every',
    'json_agg', 'jsonb_agg', 'json_object_agg', 'jsonb_object_agg', 'any_value',
    'stddev', 'stddev_pop', 'stddev_samp', 'variance', 'var_pop', 'var_samp',
    'corr', 'covar_pop', 'covar_samp', 'regr_slope', 'regr_intercept', 'regr_r2',
    'percentile_cont', 'percentile_disc', 'mode',
    -- Fensterfunktionen
    'row_number', 'rank', 'dense_rank', 'percent_rank', 'cume_dist', 'ntile',
    'lag', 'lead', 'first_value', 'last_value', 'nth_value',
    -- Datum / Zeit
    'now', 'clock_timestamp', 'statement_timestamp', 'transaction_timestamp',
    'date_trunc', 'date_part', 'extract', 'age', 'date_bin', 'date_add', 'date_subtract',
    'make_date', 'make_time', 'make_timestamp', 'make_timestamptz', 'make_interval',
    'to_char', 'to_date', 'to_timestamp', 'to_number',
    'justify_days', 'justify_hours', 'justify_interval', 'isfinite', 'timezone', 'overlaps',
    -- Text
    'lower', 'upper', 'initcap', 'length', 'char_length', 'character_length', 'octet_length',
    'concat', 'concat_ws', 'substr', 'substring', 'left', 'right', 'btrim', 'ltrim', 'rtrim',
    'lpad', 'rpad', 'replace', 'translate', 'split_part', 'strpos', 'position', 'starts_with',
    'reverse', 'repeat', 'format', 'overlay', 'chr', 'ascii',
    'regexp_replace', 'regexp_match', 'regexp_matches', 'regexp_split_to_array', 'regexp_split_to_table',
    'regexp_count', 'regexp_instr', 'regexp_like', 'regexp_substr',
    'like_escape', 'similar_escape', 'similar_to_escape',
    -- Mathe
    'abs', 'round', 'ceil', 'ceiling', 'floor', 'trunc', 'mod', 'div', 'power', 'pow', 'sqrt', 'cbrt',
    'exp', 'ln', 'log', 'log10', 'sign', 'width_bucket', 'pi', 'random', 'scale', 'trim_scale',
    'gcd', 'lcm', 'num_nulls', 'num_nonnulls',
    -- Arrays / Mengen
    'array_length', 'array_upper', 'array_lower', 'cardinality', 'array_position', 'array_positions',
    'array_remove', 'array_replace', 'array_append', 'array_prepend', 'array_cat',
    'array_to_string', 'string_to_array', 'unnest', 'generate_series',
    -- JSON
    'to_json', 'to_jsonb', 'row_to_json', 'json_build_object', 'jsonb_build_object',
    'json_build_array', 'jsonb_build_array', 'json_array_length', 'jsonb_array_length',
    'json_array_elements', 'json_array_elements_text', 'jsonb_array_elements', 'jsonb_array_elements_text',
    'jsonb_each', 'jsonb_each_text', 'jsonb_object_keys', 'jsonb_typeof', 'jsonb_strip_nulls',
    'json_extract_path_text', 'jsonb_extract_path', 'jsonb_extract_path_text'
  ];
  v_sql       text;
  v_abfrage   text;
  v_view      oid;
  v_regel     oid;
  v_baum      text;
  v_verstoss  text;
  v_vorher    jsonb;
  v_nachher   jsonb;
  v_result    jsonb;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id, NULL);

  -- ── Ebene 2: Form ──
  v_sql := regexp_replace(regexp_replace(coalesce(p_sql, ''), '^\s+', ''), '[\s;]+$', '');
  IF length(v_sql) > 20000 THEN
    RAISE EXCEPTION 'Die Abfrage ist zu lang';
  END IF;
  IF v_sql !~* '^(with|select)\y' THEN
    RAISE EXCEPTION 'Nur lesende SELECT/WITH-Abfragen sind erlaubt';
  END IF;
  -- Kein Semikolon (ein abschließendes ist oben schon entfernt) → keine Mehrfach-Statements
  IF position(';' in v_sql) > 0 THEN
    RAISE EXCEPTION 'Nur ein einzelnes Statement ist erlaubt';
  END IF;
  IF v_sql ~* '(xml|u&)' THEN
    RAISE EXCEPTION 'XML und U&-Schreibweise sind für die KI-Abfrage nicht erlaubt';
  END IF;

  -- Zeilenumbruch vor der schließenden Klammer: ein abschließender „-- Kommentar“ der
  -- Abfrage darf den Rahmen nicht verschlucken.
  v_abfrage := format(
    E'SELECT coalesce(jsonb_agg(row_to_json(_q.*)), \'[]\'::jsonb) FROM (SELECT * FROM (%s\n) _i LIMIT 500) _q',
    v_sql
  );

  -- ── Ebene 3: Strukturprüfung ──
  -- Genau der später ausgeführte Text wird als temporäre View angelegt: Postgres parst
  -- und löst alle Namen auf, führt aber nichts aus. Die View lebt nur bis zum DROP unten
  -- (bei einem Fehler rollt die Transaktion sie zurück).
  EXECUTE 'CREATE TEMP VIEW ki_abfrage_pruefung AS ' || v_abfrage;
  v_view := 'pg_temp.ki_abfrage_pruefung'::regclass;
  SELECT r.oid, r.ev_action::text INTO v_regel, v_baum FROM pg_rewrite r WHERE r.ev_class = v_view;

  WITH refs (art, klasse, objid) AS (
    -- alle Tabellen/Funktionen/Operatoren im gespeicherten Abfragebaum (auch pg_catalog)
    SELECT CASE m[1] WHEN 'relid' THEN 'rel' WHEN 'opno' THEN 'op' ELSE 'fn' END, NULL::oid, m[2]::oid
      FROM regexp_matches(v_baum, ':(relid|funcid|aggfnoid|winfnoid|tsmhandler|opno) (\d+)', 'g') AS m
    UNION
    -- zusätzlich pg_depend (Typen, Operatoren, Objekte außerhalb von pg_catalog)
    SELECT CASE d.refclassid
             WHEN 'pg_class'::regclass     THEN 'rel'
             WHEN 'pg_proc'::regclass      THEN 'fn'
             WHEN 'pg_operator'::regclass  THEN 'op'
             WHEN 'pg_type'::regclass      THEN 'typ'
             WHEN 'pg_collation'::regclass THEN 'ok'
             WHEN 'pg_opfamily'::regclass  THEN 'ok'
             WHEN 'pg_opclass'::regclass   THEN 'ok'
             ELSE 'sonst' END,
           d.refclassid, d.refobjid
      FROM pg_depend d
     WHERE d.classid = 'pg_rewrite'::regclass AND d.objid = v_regel
  )
  SELECT string_agg(DISTINCT v.objekt, ', ' ORDER BY v.objekt)
    INTO v_verstoss
    FROM refs f
    CROSS JOIN LATERAL (
      SELECT CASE f.art
        WHEN 'rel' THEN
          CASE WHEN f.objid IN (0, v_view) OR EXISTS (
                 SELECT 1 FROM pg_class c
                  WHERE c.oid = f.objid
                    AND c.relnamespace = 'public'::regnamespace
                    AND c.relkind IN ('r', 'p')
                    AND c.relname = ANY (c_tabellen))
               THEN NULL ELSE 'Tabelle ' || f.objid::regclass::text END
        WHEN 'fn' THEN
          CASE WHEN f.objid = 0 OR EXISTS (
                 SELECT 1 FROM pg_proc p
                  WHERE p.oid = f.objid
                    AND p.pronamespace = 'pg_catalog'::regnamespace
                    AND (p.proname = ANY (c_funktionen)
                         OR EXISTS (SELECT 1 FROM pg_cast k WHERE k.castfunc = p.oid)))
               THEN NULL ELSE 'Funktion ' || f.objid::regproc::text END
        WHEN 'op' THEN
          CASE WHEN f.objid = 0 OR EXISTS (
                 SELECT 1 FROM pg_operator o
                  WHERE o.oid = f.objid AND o.oprnamespace = 'pg_catalog'::regnamespace)
               THEN NULL ELSE 'Operator ' || f.objid::regoperator::text END
        WHEN 'typ' THEN
          CASE WHEN EXISTS (
                 SELECT 1 FROM pg_type t
                  WHERE t.oid = f.objid
                    AND t.typnamespace IN ('pg_catalog'::regnamespace, 'public'::regnamespace))
               THEN NULL ELSE 'Typ ' || f.objid::regtype::text END
        WHEN 'ok' THEN NULL
        ELSE pg_describe_object(f.klasse, f.objid, 0)
      END AS objekt
    ) v;

  EXECUTE 'DROP VIEW pg_temp.ki_abfrage_pruefung';

  IF v_verstoss IS NOT NULL THEN
    RAISE EXCEPTION 'Für die KI-Abfrage nicht erlaubt: %', v_verstoss;
  END IF;

  -- ── Ebenen 4–6: Ausführung ──
  -- Aktiver Betrieb: get_user_tenant_ids() und damit jede RLS-Policy darauf schränkt
  -- sich auf genau diesen Mandanten ein.
  PERFORM set_config('app.active_tenant_id', p_tenant_id::text, true);
  -- Schreibschutz für die Ausführung (endet mit dem EXCEPTION-Block dieser Funktion).
  -- Statement-Timeout: 8 s aus der Rolle authenticated (PostgREST).
  PERFORM set_config('transaction_read_only', 'on', true);

  v_vorher := jsonb_build_object(
    'role',   current_setting('role', true),
    'claims', current_setting('request.jwt.claims', true),
    'sub',    current_setting('request.jwt.claim.sub', true),
    'tenant', current_setting('app.active_tenant_id', true),
    'ro',     current_setting('transaction_read_only', true),
    'user',   current_user
  );

  EXECUTE v_abfrage INTO v_result;

  v_nachher := jsonb_build_object(
    'role',   current_setting('role', true),
    'claims', current_setting('request.jwt.claims', true),
    'sub',    current_setting('request.jwt.claim.sub', true),
    'tenant', current_setting('app.active_tenant_id', true),
    'ro',     current_setting('transaction_read_only', true),
    'user',   current_user
  );
  IF v_nachher IS DISTINCT FROM v_vorher THEN
    RAISE EXCEPTION 'Die Abfrage hat Sitzungseinstellungen verändert – Ergebnis verworfen';
  END IF;

  RETURN v_result;
EXCEPTION
  WHEN raise_exception OR insufficient_privilege THEN
    RAISE;
  WHEN others THEN
    -- Ursprüngliche Postgres-Fehlermeldung (z. B. „column x does not exist“) ohne
    -- Kontext durchreichen, damit die Route sie für den Reparaturversuch an Claude
    -- zurückgeben kann.
    RAISE EXCEPTION '%', sqlerrm;
END;
$function$;

COMMENT ON FUNCTION public.ki_readonly_query(text, uuid) IS
  'KAN-52 (gehärtet 24.09.2026): führt eine KI-generierte, rein lesende SELECT/WITH-Abfrage im aktiven Betrieb aus. SECURITY DEFINER als ki_abfrage (kein BYPASSRLS, erbt authenticated → RLS greift), Strukturprüfung am geparsten Abfragebaum (temporäre View, pg_rewrite.ev_action + pg_depend; Tabellen-Allowlist aus ki_erlaubte_tabellen(), Funktions-Allowlist), transaction_read_only, Nachkontrolle von role/claims.';
