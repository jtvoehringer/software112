-- Explizite Data-API-Grants (Supabase-Änderung ab 30.10.2026).
-- Spiegelt den Grant-Stand vom 23.09.2026, damit ein Neuaufbau aus den Migrationen
-- (Branch, db reset, neues Projekt) dieselben Rechte erhält. Idempotent.
do $g$
declare t text;
begin
  foreach t in array array['aktivitaet_dokumente','aktivitaeten','ama_erntemeldungen','ama_meldepositionen','assistent_aktionen','assistent_korrekturen','assistent_nachrichten','assistent_unterhaltungen','behaelter','behandlung_grundstuecke','behandlungen','benachrichtigungen','bestellung_positionen','bestellungen','buchhaltung_export_protokoll','buchhaltung_kontenmapping','checklisten','checklisten_punkte','crm_dubletten_ignoriert','dac_antrag','datenschutz_consents','duengemittel','duengemittel_lager_bewegungen','ea_anlagen','ea_belege','ea_dauerauftraege','ea_dauerauftrag_log','ea_kategorien','ea_monatsabschluss','ea_transaktionen','ea_uva','email_lead_ignoriert','ernte_parzellen','export_dokumente','exportauftraege','exportauftrag_positionen','firmen','fristen','fuellung_chargen','fuellungen','grundstuecke','keller_behandlungen','keller_behandlungstypen','keller_freigaben','keller_umzuege','kellerplaene','kellerplan_positionen','kontakt_firmen','kontakt_praeferenzen','kontakte','konten','konto_umbuchungen','kostenarten','kosteneintraege','kosteneintrag_behaelter','kosteneintrag_weingaerten','kostenstellen','lagen','module_flags','morgenberichte','pflanzenschutzmittel','pipeline_eintraege','pipeline_verlauf','plattform_admins','pressung_behaelter','pressung_weingaerten','pressungen','profiles','pruefnummernantraege','psm_lager_bewegungen','rabattgruppen','rebsorten','release_notes','release_notes_gesehen','saetze_massnahmen','sonstige_artikel','stripe_zahlungen_log','sumup_checkouts','sumup_terminals','sumup_transaktionen','svs_parameter','system_ereignisse','tenant_einstellungen','tenant_memberships','tenants','transaktionszaehler','transportbescheinigungen','traubenverkauf','user_email_connections','v_behaelter_fuellstand','verkauf_positionen','verkaufsposten','verschneidung_quellen','verschneidungen','weinanalysen','weinausbau','weinausbau_weingaerten','weinbaugebiete_custom','weingarten','weingarten_rebsorten','weinjahrgaenge','wetter_stunden','zahlungen','zeiterfassung','zukauf_posten']::text[] loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('grant select, insert, update, delete, truncate, references, trigger on table public.%I to anon, authenticated, service_role', t);
    end if;
  end loop;
  if to_regclass('public.system_ereignisse_id_seq') is not null then
    execute 'grant select, update, usage on sequence public.system_ereignisse_id_seq to anon, authenticated, service_role';
  end if;
end $g$;;
