-- 226: Sicherheits-Welle 1 (Befund S5) – Rechte auf SECURITY-DEFINER-Funktionen
-- Angewendet: 23.09.2026
--
-- 1) Funktionen mit erhöhten Rechten waren für „anon“ (ohne Anmeldung, nur mit dem
--    öffentlichen Supabase-Schlüssel) aufrufbar. Zwei davon prüfen den Zugriff nicht
--    (kundennummer_vergeben, behaelter_nutzbar) und werden von der App nicht direkt
--    aufgerufen → nur noch service_role. Die übrigen prüfen den Zugriff selbst, brauchen
--    „anon“ aber nicht → nur noch authenticated + service_role.
--    s112_meine_tenants() und s112_gesperrte_tenants() bleiben für anon ausführbar: sie
--    werden in RLS-Richtlinien „to public“ verwendet und liefern ohne Anmeldung ohnehin nichts.
--    Trigger-Funktionen feuern unabhängig vom EXECUTE-Recht des auslösenden Benutzers.
-- 2) Fester search_path für 8 Funktionen (Supabase-Lint 0011).

-- ── 1a) Nur Server (service_role) ────────────────────────────────────────────
revoke execute on function public.kundennummer_vergeben(uuid, integer) from public, anon, authenticated;
revoke execute on function public.behaelter_nutzbar(uuid, uuid)         from public, anon, authenticated;
grant  execute on function public.kundennummer_vergeben(uuid, integer) to service_role;
grant  execute on function public.behaelter_nutzbar(uuid, uuid)         to service_role;

-- ── 1b) Trigger-Funktionen: niemand ruft sie direkt auf ─────────────────────
revoke execute on function public.kundennummer_trg()            from public, anon, authenticated;
revoke execute on function public.weinausbau_gebinde_pruefen()  from public, anon, authenticated;
revoke execute on function public.trg_tenant_plattform_admins() from public, anon, authenticated;

-- ── 1c) Nur angemeldete Benutzer (Funktionen prüfen die Mitgliedschaft selbst) ─
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

-- ── 2) Fester Suchpfad ──────────────────────────────────────────────────────
alter function public.trg_ea_anlagen_aktualisiert()             set search_path = public, extensions;
alter function public.trg_ea_anlagen_transaktion_tenant()       set search_path = public, extensions;
alter function public.trg_ea_transaktion_anlage_tenant()        set search_path = public, extensions;
alter function public.kundennummer_unveraenderlich_trg()        set search_path = public, extensions;
alter function public.crm_norm_name(text)                       set search_path = public, extensions;
alter function public.crm_dubletten_stufe(text, jsonb)          set search_path = public, extensions;
alter function public.crm_dubletten_paar(text, jsonb, jsonb)    set search_path = public, extensions;
alter function public.tenant_memberships_schreibmodule_default() set search_path = public, extensions;
