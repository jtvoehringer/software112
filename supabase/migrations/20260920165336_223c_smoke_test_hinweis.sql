create or replace function public.s112_smoke_test(p_user uuid, p_tenant uuid, p_rolle text, p_module text[] default null)
returns table (modul text, schritt text, erwartet boolean, tatsaechlich boolean, ok boolean, meldung text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  fremd  uuid;
  erg    jsonb := '[]'::jsonb;
  darf   boolean;
  n      int;
  claims text;
  s      record;
  tats   boolean;
  msg    text;
  schritte jsonb;
begin
  if p_rolle not in ('system_admin', 'tenant_admin', 'winzer', 'leser') then
    raise exception 'Unbekannte Rolle %', p_rolle;
  end if;
  select t.id into fremd from tenants t
    where t.id <> p_tenant and not exists (select 1 from tenant_memberships m where m.user_id = p_user and m.tenant_id = t.id)
    order by t.created_at limit 1;
  claims := json_build_object('sub', p_user, 'role', 'authenticated')::text;
  darf := p_rolle in ('system_admin', 'tenant_admin');

  schritte := jsonb_build_array(
    jsonb_build_object('modul', 'isolation', 'schritt', 'kontakt in fremdem Betrieb anlegen', 'erwartet', false,
      'sql', format('insert into kontakte (tenant_id, nachname) values (%L, %L)', fremd, 'Smoke-Test')),
    jsonb_build_object('modul', 'rieden', 'schritt', 'weingarten anlegen',
      'erwartet', darf or (p_rolle = 'winzer' and 'rieden' = any(coalesce(p_module, '{}'))),
      'sql', format('insert into weingarten (tenant_id, name) values (%L, %L)', p_tenant, 'Smoke-Test')),
    jsonb_build_object('modul', 'rieden', 'schritt', 'psm + lagerbewegung anlegen',
      'erwartet', darf or (p_rolle = 'winzer' and 'rieden' = any(coalesce(p_module, '{}'))),
      'sql', format('with p as (insert into pflanzenschutzmittel (tenant_id, name) values (%L, %L) returning id)
                     insert into psm_lager_bewegungen (tenant_id, psm_id, datum, typ, menge, einheit) select %L, id, current_date, %L, 1, %L from p',
                    p_tenant, 'Smoke-Test', p_tenant, 'anfangsbestand', 'kg')),
    jsonb_build_object('modul', 'kellerbuch', 'schritt', 'behaelter anlegen',
      'erwartet', darf or (p_rolle = 'winzer' and 'kellerbuch' = any(coalesce(p_module, '{}'))),
      'sql', format('insert into behaelter (tenant_id, name, typ) values (%L, %L, %L)', p_tenant, 'Smoke-Test', 'stahltank')),
    jsonb_build_object('modul', 'warenwirtschaft', 'schritt', 'sonstige_artikel anlegen',
      'erwartet', darf or (p_rolle = 'winzer' and 'warenwirtschaft' = any(coalesce(p_module, '{}'))),
      'sql', format('insert into sonstige_artikel (tenant_id, name) values (%L, %L)', p_tenant, 'Smoke-Test')),
    jsonb_build_object('modul', 'crm', 'schritt', 'kontakt anlegen',
      'erwartet', darf or (p_rolle = 'winzer' and 'crm' = any(coalesce(p_module, '{}'))),
      'sql', format('insert into kontakte (tenant_id, nachname) values (%L, %L)', p_tenant, 'Smoke-Test')),
    jsonb_build_object('modul', 'ea', 'schritt', 'ea_transaktion anlegen',
      'erwartet', darf or (p_rolle = 'winzer' and 'ea' = any(coalesce(p_module, '{}'))),
      'sql', format('insert into ea_transaktionen (tenant_id, typ, datum, beschreibung, betrag_netto) values (%L, %L, current_date, %L, 1)', p_tenant, 'ausgabe', 'Smoke-Test'))
  );

  begin
    insert into tenant_memberships (tenant_id, user_id, role, aktiv, schreibmodule)
      values (p_tenant, p_user, p_rolle, true, p_module)
      on conflict (tenant_id, user_id) do update set role = excluded.role, aktiv = true, schreibmodule = excluded.schreibmodule;
    perform set_config('request.jwt.claims', claims, true);
    set local role authenticated;

    select count(*) into n from kontakte k where k.tenant_id = p_tenant;
    erg := erg || jsonb_build_object('modul', 'lesen', 'schritt', 'kontakte eigener Betrieb lesbar', 'erwartet', true, 'tatsaechlich', true, 'ok', true, 'meldung', n || ' Zeilen');
    if fremd is not null then
      select count(*) into n from kontakte k where k.tenant_id = fremd;
      erg := erg || jsonb_build_object('modul', 'isolation', 'schritt', 'kontakte fremder Betrieb unsichtbar', 'erwartet', true, 'tatsaechlich', n = 0, 'ok', n = 0, 'meldung', n || ' Zeilen sichtbar');
    else
      erg := erg || jsonb_build_object('modul', 'isolation', 'schritt', 'fremder Betrieb', 'erwartet', true, 'tatsaechlich', true, 'ok', true, 'meldung', 'übersprungen – Benutzer ist in allen Betrieben Mitglied');
    end if;

    for s in select * from jsonb_to_recordset(schritte) as x(modul text, schritt text, erwartet boolean, sql text) loop
      if s.modul = 'isolation' and fremd is null then continue; end if;
      msg := '';
      begin
        execute s.sql;
        raise exception 'S112_OK';
      exception when others then
        if sqlerrm = 'S112_OK' then tats := true; else tats := false; msg := sqlerrm; end if;
      end;
      erg := erg || jsonb_build_object('modul', s.modul, 'schritt', s.schritt, 'erwartet', s.erwartet, 'tatsaechlich', tats,
                                       'ok', tats = s.erwartet, 'meldung', case when tats = s.erwartet then '' else msg end);
    end loop;
    raise exception 'S112_ROLLBACK';
  exception when others then
    if sqlerrm <> 'S112_ROLLBACK' then
      erg := erg || jsonb_build_object('modul', 'lauf', 'schritt', 'Phase 1 abgebrochen', 'erwartet', true, 'tatsaechlich', false, 'ok', false, 'meldung', sqlerrm);
    end if;
  end;

  begin
    insert into tenant_memberships (tenant_id, user_id, role, aktiv, schreibmodule)
      values (p_tenant, p_user, p_rolle, false, p_module)
      on conflict (tenant_id, user_id) do update set role = excluded.role, aktiv = false, schreibmodule = excluded.schreibmodule;
    perform set_config('request.jwt.claims', claims, true);
    set local role authenticated;
    select count(*) into n from kontakte k where k.tenant_id = p_tenant;
    erg := erg || jsonb_build_object('modul', 'sperre', 'schritt', 'gesperrte Mitgliedschaft sieht nichts', 'erwartet', true, 'tatsaechlich', n = 0, 'ok', n = 0, 'meldung', n || ' Zeilen sichtbar');
    raise exception 'S112_ROLLBACK';
  exception when others then
    if sqlerrm <> 'S112_ROLLBACK' then
      erg := erg || jsonb_build_object('modul', 'lauf', 'schritt', 'Phase 2 abgebrochen', 'erwartet', true, 'tatsaechlich', false, 'ok', false, 'meldung', sqlerrm);
    end if;
  end;

  return query
    select e->>'modul', e->>'schritt', (e->>'erwartet')::boolean, (e->>'tatsaechlich')::boolean, (e->>'ok')::boolean, e->>'meldung'
    from jsonb_array_elements(erg) e;
end $$;

revoke all on function public.s112_smoke_test(uuid, uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.s112_smoke_test(uuid, uuid, text, text[]) to service_role;;
