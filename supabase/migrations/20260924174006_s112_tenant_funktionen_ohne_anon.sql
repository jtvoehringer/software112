-- Supabase-Lint 0028 (anon_security_definer_function_executable):
-- s112_meine_tenants() und s112_gesperrte_tenants() sind SECURITY DEFINER und waren für
-- „anon“ (über PUBLIC und direkt) per /rest/v1/rpc aufrufbar. 226 hatte sie bewusst offen
-- gelassen, weil elf RLS-Richtlinien „to public“ s112_meine_tenants() aufrufen – ein reines
-- REVOKE ließe anonyme Abfragen auf diese Tabellen mit 42501 („permission denied for
-- function“) scheitern statt leer zurückzukommen (im Probelauf bestätigt).
--
-- 1) Die elf Richtlinien gelten nur noch für „authenticated“. Für anon ändert sich am
--    Ergebnis nichts: auth.uid() ist dort NULL, die Funktion lieferte ohnehin keinen
--    Betrieb – ohne passende Richtlinie bleibt es bei 0 Zeilen bzw. RLS-Ablehnung.
-- 2) s112_gesperrte_tenants() steckt nur in den restriktiven Richtlinien
--    „mitgliedschaft_aktiv“ (to authenticated) → anon braucht sie nicht.
-- 3) EXECUTE von PUBLIC und anon entziehen; authenticated und service_role behalten es.

alter policy psm_lager_select on public.psm_lager_bewegungen to authenticated;
alter policy psm_lager_insert on public.psm_lager_bewegungen to authenticated;
alter policy psm_lager_update on public.psm_lager_bewegungen to authenticated;
alter policy psm_lager_delete on public.psm_lager_bewegungen to authenticated;

alter policy dm_lager_select on public.duengemittel_lager_bewegungen to authenticated;
alter policy dm_lager_insert on public.duengemittel_lager_bewegungen to authenticated;
alter policy dm_lager_update on public.duengemittel_lager_bewegungen to authenticated;
alter policy dm_lager_delete on public.duengemittel_lager_bewegungen to authenticated;

alter policy tenant_isolation on public.fuellung_chargen      to authenticated;
alter policy tenant_isolation on public.verschneidungen       to authenticated;
alter policy tenant_isolation on public.verschneidung_quellen to authenticated;

revoke execute on function public.s112_meine_tenants()     from public, anon;
revoke execute on function public.s112_gesperrte_tenants() from public, anon;
grant  execute on function public.s112_meine_tenants()     to authenticated, service_role;
grant  execute on function public.s112_gesperrte_tenants() to authenticated, service_role;
