-- 155_ki_abfrage_sql.sql
--
-- "Frag dein Weingut" (KI-Modul) wird von einer festen 10-Tabellen-Auswahl mit
-- vorprogrammierten Filtern auf echte, von Claude generierte SQL-SELECT-Abfragen
-- umgestellt - damit werden Fragen mit Verknüpfungen (JOINs) und Summenbildung
-- (SUM/COUNT/GROUP BY) möglich, die vorher grundsätzlich nicht beantwortbar waren.
--
-- SICHERHEITSDESIGN (bitte beim Lesen/Ändern beachten):
--
-- 1. ki_readonly_query() läuft bewusst OHNE "security definer" (= security
--    invoker, der Standard). Das bedeutet: die Funktion läuft mit den Rechten
--    des eingeloggten Users, wodurch die bestehenden RLS-Policies auf JEDER
--    zugrundeliegenden Tabelle automatisch greifen - exakt wie bei jeder
--    anderen Abfrage der App. Es gibt hier KEINE eigene Mandanten-Prüfung,
--    weil RLS diese Aufgabe bereits vollständig übernimmt.
--    -> NIEMALS auf "security definer" umstellen, das würde die komplette
--       Mandantentrennung für diese Funktion aushebeln.
--
-- 2. Nur ein einzelnes, lesendes Statement (SELECT oder WITH/CTE) ist erlaubt.
--    Verboten sind u.a. INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/GRANT sowie
--    SELECT ... INTO (das in Postgres eine neue Tabelle anlegen kann) - auch
--    innerhalb einer CTE (z.B. "WITH x AS (DELETE ...) SELECT * FROM x").
--
-- 3. Zusätzlich zur Tabellen-Erlaubnisliste, die der KI im Prompt mitgegeben
--    wird (siehe src/app/api/ki-abfrage/route.ts, ERLAUBTE_TABELLEN), sperrt
--    diese Funktion als zweite Sicherheitsebene explizit den Zugriff auf
--    interne/sensible Tabellen und alle Nicht-public-Schemas (auth, storage,
--    vault, extensions, pg_catalog, information_schema) - selbst wenn die KI
--    entgegen der Anweisung versuchen würde, darauf zuzugreifen.
--
-- 4. Harte Obergrenze von 500 Zeilen und 5 Sekunden Statement-Timeout pro
--    Abfrage, damit keine Abfrage die Datenbank spürbar belasten kann.
--
-- WICHTIGER HINWEIS (keine Übertreibung der Sicherheit): Dies ist eine text-
-- basierte Validierung, kein vollständiger SQL-Parser - sie deckt die
-- praktisch relevanten Angriffs-/Fehlerfälle ab (mehrere Statements, DML/DDL-
-- Schlüsselwörter, gesperrte Tabellen/Schemas), ist aber keine hundertprozentig
-- wasserdichte Sandbox. Die eigentliche, verlässliche Grenze für die
-- Mandantentrennung bleibt RLS (Punkt 1) - das UI stellt zusätzlich sicher,
-- dass nur eingeloggte User mit aktivem KI-Modul diese Funktion überhaupt
-- erreichen (siehe API-Route).

drop function if exists ki_readonly_query(text);

create function ki_readonly_query(p_sql text)
returns jsonb
language plpgsql
stable
as $$
declare
  v_sql    text := btrim(p_sql);
  v_result jsonb;
begin
  if v_sql !~* '^\s*(with|select)\y' then
    raise exception 'Nur lesende SELECT/WITH-Abfragen sind erlaubt';
  end if;

  -- Nur EIN Semikolon (optional ganz am Ende) erlauben -> keine Mehrfach-Statements
  if position(';' in rtrim(v_sql, '; ')) > 0 then
    raise exception 'Nur ein einzelnes Statement ist erlaubt';
  end if;
  v_sql := rtrim(v_sql, '; ');

  -- Verbotene Schluesselwoerter irgendwo im Text (auch innerhalb CTEs) blockieren
  if v_sql ~* '\y(insert|update|delete|drop|alter|grant|revoke|truncate|create|call|do|copy|vacuum|reindex|refresh|merge|into|lock|listen|notify|pg_sleep|pg_terminate_backend|pg_cancel_backend|dblink|lo_import|lo_export|pg_read_file|pg_read_binary_file)\y' then
    raise exception 'Nur lesende Abfragen ohne Seiteneffekte sind erlaubt';
  end if;

  -- Zugriff auf interne/sensible Tabellen und fremde Schemas sperren
  if v_sql ~* '\y(tenants|tenant_memberships|tenant_einstellungen|profiles|module_flags|assistent_nachrichten|assistent_unterhaltungen|assistent_aktionen|assistent_korrekturen|datenschutz_consents|sumup_checkouts|sumup_terminals|sumup_transaktionen|transaktionszaehler|user_email_connections|release_notes_gesehen)\y'
  then
    raise exception 'Zugriff auf diese Tabelle ist für die KI-Abfrage nicht erlaubt';
  end if;
  if v_sql ~* '\y(auth|storage|vault|extensions|pg_catalog|information_schema|net|graphql|graphql_public|pgsodium)\s*\.' then
    raise exception 'Zugriff auf dieses Schema ist für die KI-Abfrage nicht erlaubt';
  end if;

  perform set_config('statement_timeout', '5000', true);

  execute format(
    'select coalesce(jsonb_agg(row_to_json(_q.*)), ''[]''::jsonb) from (%s limit 500) _q',
    v_sql
  ) into v_result;

  return v_result;
exception
  when raise_exception then
    raise;
  when others then
    -- Ursprüngliche Postgres-Fehlermeldung (z.B. "column x does not exist")
    -- unverändert durchreichen, damit die Route sie für den Reparatur-Versuch
    -- an Claude zurückgeben kann.
    raise exception '%', sqlerrm;
end;
$$;

comment on function ki_readonly_query(text) is
  'Führt eine von "Frag dein Weingut" (Claude) generierte, rein lesende SQL-Abfrage aus. '
  'Läuft bewusst als security invoker (NICHT security definer), damit RLS greift - siehe '
  'Migration 155 für die vollständige Sicherheitsdokumentation.';

grant execute on function ki_readonly_query(text) to authenticated;

-- ── Schema-Introspektion für den Prompt-Aufbau ─────────────────────────────
-- Liefert Spalten (Name + Typ) für die übergebenen, in der App fest
-- kuratierten Tabellennamen - läuft ebenfalls als security invoker; das
-- Lesen von information_schema.columns für Tabellen, auf die der User per
-- RLS/GRANT sowieso Zugriff hat, ist unkritisch und muss nicht separat
-- geprüft werden.
drop function if exists ki_schema_info(text[]);

create function ki_schema_info(p_tabellen text[])
returns table (tabelle text, spalte text, typ text)
language sql
stable
as $$
  select c.table_name, c.column_name, c.data_type
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = any(p_tabellen)
  order by c.table_name, c.ordinal_position
$$;

grant execute on function ki_schema_info(text[]) to authenticated;
