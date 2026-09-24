-- 161_ki_abfrage_tenant_scoping.sql
--
-- Schliesst die letzte offene Luecke aus dem Mandanten-Isolation-Fix (Commit
-- "Mandanten-Isolation systemweit erzwingen (nicht nur RLS)"): die "Frag dein
-- Weingut"-KI-Abfrage (Migration 155, ki_readonly_query) fuehrt vom Modell
-- generiertes, freies SQL aus und verlaesst sich dabei bewusst und
-- ausschliesslich auf RLS (security invoker, siehe Kommentar dort). Das
-- Problem: RLS selbst hatte bislang genau den Fehler, der den ganzen
-- Ausloeser dieses Fixes darstellte - get_user_tenant_ids() liefert ALLE
-- Mandanten, in denen der User Mitglied ist, nicht nur den aktiv gewaehlten
-- Betrieb. Für jede andere Abfrage in der App wurde das durch ein
-- zusaetzliches explizites .eq('tenant_id', ...) in der Anwendung geloest -
-- das geht hier nicht, weil die SQL-Abfrage selbst vom Modell (nicht von
-- unserem Code) formuliert wird und wir sie nicht zuverlaessig umschreiben
-- koennen.
--
-- LOESUNG: get_user_tenant_ids() bekommt eine zusaetzliche, rein additive
-- Einschraenkung ueber eine Postgres-Session-Variable (app.active_tenant_id).
-- Ist die Variable NICHT gesetzt (der Normalfall - das gilt fuer JEDE andere
-- Stelle der App, die get_user_tenant_ids() ueber RLS aufruft), aendert sich
-- am Verhalten NICHTS - es werden weiterhin alle Mitgliedschaften des Users
-- zurueckgegeben, exakt wie bisher. NUR wenn ki_readonly_query() diese
-- Variable fuer die Dauer der einen Abfrage explizit setzt (set_config mit
-- is_local = true, wirkt also nur innerhalb der aktuellen Transaktion/des
-- aktuellen RPC-Aufrufs und wird danach automatisch wieder verworfen), wird
-- get_user_tenant_ids() - und damit jede RLS-Policy, die sich darauf
-- stuetzt - auf genau diesen einen Mandanten eingeschraenkt.
--
-- Diese Migration aendert AUSSCHLIESSLICH das Verhalten von ki_readonly_query
-- und die (additive, standardmaessig wirkungslose) Definition von
-- get_user_tenant_ids(). Keine RLS-Policy selbst wird angefasst.

-- ── 1. get_user_tenant_ids(): additive Einschraenkung ueber Session-Variable ──
create or replace function get_user_tenant_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select tenant_id
  from tenant_memberships
  where user_id = auth.uid()
    and (
      nullif(current_setting('app.active_tenant_id', true), '') is null
      or tenant_id = nullif(current_setting('app.active_tenant_id', true), '')::uuid
    )
$$;

-- ── 2. ki_readonly_query: zusätzlicher p_tenant_id-Parameter ────────────────
-- Alte Signatur (nur p_sql) wird bewusst entfernt (drop), damit keine
-- veraltete Version ohne Tenant-Scoping erreichbar bleibt.
drop function if exists ki_readonly_query(text);
drop function if exists ki_readonly_query(text, uuid);

create function ki_readonly_query(p_sql text, p_tenant_id uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_sql    text := btrim(p_sql);
  v_result jsonb;
begin
  -- Der User MUSS Mitglied des uebergebenen Tenants sein - sonst wuerde
  -- p_tenant_id selbst zu einem Umgehungsweg der Isolation. get_user_tenant_ids()
  -- laeuft hier noch OHNE die neue Einschraenkung (die Session-Variable ist an
  -- dieser Stelle noch nicht gesetzt), prueft also ganz normal alle
  -- Mitgliedschaften des Users.
  if p_tenant_id is null or not exists (
    select 1 from get_user_tenant_ids() t(tenant_id) where t.tenant_id = p_tenant_id
  ) then
    raise exception 'Kein Zugriff auf diesen Betrieb';
  end if;

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

  -- Aktiven Mandanten NUR fuer die Dauer dieser Transaktion setzen (is_local = true) -
  -- get_user_tenant_ids() (und damit jede darauf aufbauende RLS-Policy in der
  -- nachfolgenden EXECUTE-Abfrage) schraenkt sich dadurch auf genau diesen einen
  -- Mandanten ein. Nach Ende der Transaktion/des RPC-Aufrufs ist der Wert automatisch
  -- wieder weg - beeinflusst also keine andere/spaetere Abfrage.
  perform set_config('app.active_tenant_id', p_tenant_id::text, true);

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

comment on function ki_readonly_query(text, uuid) is
  'Führt eine von "Frag dein Weingut" (Claude) generierte, rein lesende SQL-Abfrage aus, '
  'eingeschränkt auf den per p_tenant_id übergebenen aktiv gewählten Mandanten '
  '(app.active_tenant_id, siehe Migration 161). Läuft weiterhin als security invoker, '
  'RLS bleibt die eigentliche Schranke - siehe Migration 155 für die übrige '
  'Sicherheitsdokumentation (Statement-Validierung, Sperrlisten, Zeilen-/Zeitlimit).';

grant execute on function ki_readonly_query(text, uuid) to authenticated;
