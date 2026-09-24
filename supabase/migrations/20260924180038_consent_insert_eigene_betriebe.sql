-- datenschutz_consents.consent_insert hatte „with check (true)“: Jeder angemeldete Benutzer
-- konnte Einwilligungen für jeden Betrieb anlegen (bis 20260924175611 sogar anon) und dabei
-- per kontakt_id auf Kontakte fremder Betriebe verweisen (FK-Prüfungen umgehen RLS).
-- Die App schreibt Einwilligungen nur über die Service-Role (src/app/newsletter/actions.ts);
-- die Richtlinie betrifft also nur direkte API-Zugriffe mit Benutzer-Token.
--
-- Neu: nur mit Schreibrecht im CRM des Betriebs (s112_darf_schreiben: aktive Mitgliedschaft,
-- system_admin/tenant_admin oder winzer mit Modul „crm“ – Leser nicht), und ein angegebener
-- Kontakt muss zum selben Betrieb gehören. UPDATE/DELETE gibt es weiterhin nicht
-- (unveränderliches Consent-Protokoll).

alter policy consent_insert on public.datenschutz_consents
  with check (
    public.s112_darf_schreiben(tenant_id, 'crm')
    and (kontakt_id is null
         or exists (select 1 from public.kontakte k
                     where k.id = datenschutz_consents.kontakt_id
                       and k.tenant_id = datenschutz_consents.tenant_id))
  );
