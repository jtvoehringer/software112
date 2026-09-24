revoke execute on function public.kundennummer_vergeben(uuid, integer) from public, anon, authenticated;
revoke execute on function public.behaelter_nutzbar(uuid, uuid)         from public, anon, authenticated;
grant  execute on function public.kundennummer_vergeben(uuid, integer) to service_role;
grant  execute on function public.behaelter_nutzbar(uuid, uuid)         to service_role;
revoke execute on function public.kundennummer_trg()            from public, anon, authenticated;
revoke execute on function public.weinausbau_gebinde_pruefen()  from public, anon, authenticated;
revoke execute on function public.trg_tenant_plattform_admins() from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'public.crm_dubletten(uuid)',
    'public.crm_filterwerte(uuid)',
    'public.crm_zaehler(uuid)',
    'public.get_next_accountnummer(uuid)',
    'public.get_next_personenkonto(uuid, text, integer)',
    'public.kontakte_zusammenfuehren(uuid, uuid, uuid[])',
    'public.lade_behaelter(uuid)',
    'public.lade_kellergemeinschaft(uuid)',
    'public.s112_darf_schreiben(uuid, text[])'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
alter function public.trg_ea_anlagen_aktualisiert()             set search_path = public, extensions;
alter function public.trg_ea_anlagen_transaktion_tenant()       set search_path = public, extensions;
alter function public.trg_ea_transaktion_anlage_tenant()        set search_path = public, extensions;
alter function public.kundennummer_unveraenderlich_trg()        set search_path = public, extensions;
alter function public.crm_norm_name(text)                       set search_path = public, extensions;
alter function public.crm_dubletten_stufe(text, jsonb)          set search_path = public, extensions;
alter function public.crm_dubletten_paar(text, jsonb, jsonb)    set search_path = public, extensions;
alter function public.tenant_memberships_schreibmodule_default() set search_path = public, extensions;;
