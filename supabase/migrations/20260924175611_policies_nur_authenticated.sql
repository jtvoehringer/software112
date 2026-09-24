-- Folge zu s112_tenant_funktionen_ohne_anon: RLS-Richtlinien der Mandanten-Tabellen nur
-- noch für angemeldete Benutzer.
--
-- 89 Tabellen hatten Richtlinien „to public“. Für „anon“ (öffentlicher Supabase-Schlüssel
-- ohne Anmeldung) endete jede Abfrage darauf mit 42501 „permission denied for function
-- user_has_role_in_tenant/get_user_tenant_ids“ – direkt oder über Unterabfragen auf
-- tenant_memberships, deren Richtlinie die Funktion aufruft. Geschlossen, aber unsauber.
--
-- Alle 263 Richtlinien „to public“ dieser Tabellen gelten jetzt nur noch für
-- „authenticated“; die Bedingungen bleiben unverändert. Für angemeldete Benutzer ändert
-- sich nichts (im Probelauf je Tabelle verglichen), anon bekommt 0 Zeilen statt eines Fehlers.
--
-- Nebeneffekt: datenschutz_consents.consent_insert („with check (true)“) ließ anon beliebige
-- Einwilligungen für jeden Betrieb anlegen – das ist damit zu. Die App schreibt
-- Einwilligungen nur über die Service-Role (src/app/newsletter/actions.ts).
--
-- Unverändert „to public“ bleiben die Tabellen, die für anon schon fehlerfrei waren
-- (u. a. rebsorten „everyone can read“, profiles, svs_parameter, user_email_connections).

alter policy "Tenant-Member können Dokumente lesen" on public.aktivitaet_dokumente to authenticated;
alter policy "Winzer können Dokumente anlegen" on public.aktivitaet_dokumente to authenticated;
alter policy "Winzer können eigene Dokumente löschen" on public.aktivitaet_dokumente to authenticated;

alter policy akt_delete on public.aktivitaeten to authenticated;
alter policy akt_insert on public.aktivitaeten to authenticated;
alter policy akt_select on public.aktivitaeten to authenticated;
alter policy akt_update on public.aktivitaeten to authenticated;

alter policy "ama: admin can delete" on public.ama_erntemeldungen to authenticated;
alter policy "ama: members can select" on public.ama_erntemeldungen to authenticated;
alter policy "ama: winzer+ can insert" on public.ama_erntemeldungen to authenticated;
alter policy "ama: winzer+ can update (nur Entwurf)" on public.ama_erntemeldungen to authenticated;

alter policy "ama_positionen: select via meldung" on public.ama_meldepositionen to authenticated;
alter policy "ama_positionen: winzer+ can update" on public.ama_meldepositionen to authenticated;
alter policy "ama_positionen: winzer+ can write" on public.ama_meldepositionen to authenticated;

alter policy assist_akt_insert on public.assistent_aktionen to authenticated;
alter policy assist_akt_select on public.assistent_aktionen to authenticated;

alter policy assist_korr_delete on public.assistent_korrekturen to authenticated;
alter policy assist_korr_insert on public.assistent_korrekturen to authenticated;
alter policy assist_korr_select on public.assistent_korrekturen to authenticated;
alter policy assist_korr_update on public.assistent_korrekturen to authenticated;

alter policy assist_nach_insert on public.assistent_nachrichten to authenticated;
alter policy assist_nach_select on public.assistent_nachrichten to authenticated;

alter policy assist_unt_delete on public.assistent_unterhaltungen to authenticated;
alter policy assist_unt_insert on public.assistent_unterhaltungen to authenticated;
alter policy assist_unt_select on public.assistent_unterhaltungen to authenticated;
alter policy assist_unt_update on public.assistent_unterhaltungen to authenticated;

alter policy behaelter_delete on public.behaelter to authenticated;
alter policy behaelter_insert on public.behaelter to authenticated;
alter policy behaelter_select on public.behaelter to authenticated;
alter policy behaelter_update on public.behaelter to authenticated;

alter policy "beh_gst: members can select" on public.behandlung_grundstuecke to authenticated;
alter policy "beh_gst: winzer+ can delete" on public.behandlung_grundstuecke to authenticated;
alter policy "beh_gst: winzer+ can insert" on public.behandlung_grundstuecke to authenticated;

alter policy "behandlungen: admin can delete" on public.behandlungen to authenticated;
alter policy "behandlungen: members can select" on public.behandlungen to authenticated;
alter policy "behandlungen: winzer+ can insert" on public.behandlungen to authenticated;
alter policy "behandlungen: winzer+ can update" on public.behandlungen to authenticated;

alter policy bestpos_delete on public.bestellung_positionen to authenticated;
alter policy bestpos_insert on public.bestellung_positionen to authenticated;
alter policy bestpos_select on public.bestellung_positionen to authenticated;
alter policy bestpos_update on public.bestellung_positionen to authenticated;

alter policy best_delete on public.bestellungen to authenticated;
alter policy best_insert on public.bestellungen to authenticated;
alter policy best_select on public.bestellungen to authenticated;
alter policy best_update on public.bestellungen to authenticated;

alter policy bep_insert on public.buchhaltung_export_protokoll to authenticated;
alter policy bep_select on public.buchhaltung_export_protokoll to authenticated;

alter policy bkm_select on public.buchhaltung_kontenmapping to authenticated;
alter policy bkm_write on public.buchhaltung_kontenmapping to authenticated;

alter policy checklisten_delete on public.checklisten to authenticated;
alter policy checklisten_insert on public.checklisten to authenticated;
alter policy checklisten_select on public.checklisten to authenticated;
alter policy checklisten_update on public.checklisten to authenticated;

alter policy checklisten_punkte_delete on public.checklisten_punkte to authenticated;
alter policy checklisten_punkte_insert on public.checklisten_punkte to authenticated;
alter policy checklisten_punkte_select on public.checklisten_punkte to authenticated;
alter policy checklisten_punkte_update on public.checklisten_punkte to authenticated;

alter policy crm_dubl_ign_select on public.crm_dubletten_ignoriert to authenticated;
alter policy crm_dubl_ign_write on public.crm_dubletten_ignoriert to authenticated;

alter policy dac_antrag_delete on public.dac_antrag to authenticated;
alter policy dac_antrag_insert on public.dac_antrag to authenticated;
alter policy dac_antrag_select on public.dac_antrag to authenticated;
alter policy dac_antrag_update on public.dac_antrag to authenticated;

alter policy consent_insert on public.datenschutz_consents to authenticated;
alter policy consent_select on public.datenschutz_consents to authenticated;

alter policy "duengemittel: admin can delete own" on public.duengemittel to authenticated;
alter policy "duengemittel: read global + own" on public.duengemittel to authenticated;
alter policy "duengemittel: winzer+ can insert own" on public.duengemittel to authenticated;
alter policy "duengemittel: winzer+ can update own" on public.duengemittel to authenticated;

alter policy ea_anlagen_select on public.ea_anlagen to authenticated;
alter policy ea_anlagen_write on public.ea_anlagen to authenticated;

alter policy ea_belege_delete on public.ea_belege to authenticated;
alter policy ea_belege_insert on public.ea_belege to authenticated;
alter policy ea_belege_select on public.ea_belege to authenticated;
alter policy ea_belege_update on public.ea_belege to authenticated;

alter policy ea_da_select on public.ea_dauerauftraege to authenticated;
alter policy ea_da_write on public.ea_dauerauftraege to authenticated;

alter policy ea_da_log_select on public.ea_dauerauftrag_log to authenticated;

alter policy ea_kat_select on public.ea_kategorien to authenticated;
alter policy ea_kat_write on public.ea_kategorien to authenticated;

alter policy ea_monatsabschluss_select on public.ea_monatsabschluss to authenticated;
alter policy ea_monatsabschluss_write on public.ea_monatsabschluss to authenticated;

alter policy ea_tx_delete on public.ea_transaktionen to authenticated;
alter policy ea_tx_insert on public.ea_transaktionen to authenticated;
alter policy ea_tx_select on public.ea_transaktionen to authenticated;
alter policy ea_tx_update on public.ea_transaktionen to authenticated;

alter policy ea_uva_select on public.ea_uva to authenticated;
alter policy ea_uva_write on public.ea_uva to authenticated;

alter policy email_lead_ignoriert_select on public.email_lead_ignoriert to authenticated;
alter policy email_lead_ignoriert_write on public.email_lead_ignoriert to authenticated;

alter policy "ernte_parzellen: admin can delete" on public.ernte_parzellen to authenticated;
alter policy "ernte_parzellen: select via jahrgang" on public.ernte_parzellen to authenticated;
alter policy "ernte_parzellen: winzer+ can update" on public.ernte_parzellen to authenticated;
alter policy "ernte_parzellen: winzer+ can write" on public.ernte_parzellen to authenticated;

alter policy tenant_export_dokumente on public.export_dokumente to authenticated;

alter policy tenant_exportauftraege on public.exportauftraege to authenticated;

alter policy tenant_exportauftrag_positionen on public.exportauftrag_positionen to authenticated;

alter policy firmen_delete on public.firmen to authenticated;
alter policy firmen_insert on public.firmen to authenticated;
alter policy firmen_select on public.firmen to authenticated;
alter policy firmen_update on public.firmen to authenticated;

alter policy fristen_delete on public.fristen to authenticated;
alter policy fristen_insert on public.fristen to authenticated;
alter policy fristen_select on public.fristen to authenticated;
alter policy fristen_update on public.fristen to authenticated;

alter policy fuellungen_delete on public.fuellungen to authenticated;
alter policy fuellungen_insert on public.fuellungen to authenticated;
alter policy fuellungen_select on public.fuellungen to authenticated;
alter policy fuellungen_update on public.fuellungen to authenticated;

alter policy "grundstuecke: admin can delete" on public.grundstuecke to authenticated;
alter policy "grundstuecke: members can select" on public.grundstuecke to authenticated;
alter policy "grundstuecke: winzer+ can insert" on public.grundstuecke to authenticated;
alter policy "grundstuecke: winzer+ can update" on public.grundstuecke to authenticated;

alter policy behandlungen_select on public.keller_behandlungen to authenticated;
alter policy behandlungen_write on public.keller_behandlungen to authenticated;

alter policy behandlungstypen_select on public.keller_behandlungstypen to authenticated;
alter policy behandlungstypen_write on public.keller_behandlungstypen to authenticated;

alter policy keller_freigaben_select on public.keller_freigaben to authenticated;

alter policy umzuege_delete on public.keller_umzuege to authenticated;
alter policy umzuege_insert on public.keller_umzuege to authenticated;
alter policy umzuege_select on public.keller_umzuege to authenticated;
alter policy umzuege_update on public.keller_umzuege to authenticated;

alter policy kellerplaene_delete on public.kellerplaene to authenticated;
alter policy kellerplaene_insert on public.kellerplaene to authenticated;
alter policy kellerplaene_select on public.kellerplaene to authenticated;
alter policy kellerplaene_update on public.kellerplaene to authenticated;

alter policy kellerplan_positionen_delete on public.kellerplan_positionen to authenticated;
alter policy kellerplan_positionen_insert on public.kellerplan_positionen to authenticated;
alter policy kellerplan_positionen_select on public.kellerplan_positionen to authenticated;
alter policy kellerplan_positionen_update on public.kellerplan_positionen to authenticated;

alter policy kf_delete on public.kontakt_firmen to authenticated;
alter policy kf_insert on public.kontakt_firmen to authenticated;
alter policy kf_select on public.kontakt_firmen to authenticated;
alter policy kf_update on public.kontakt_firmen to authenticated;

alter policy kp_delete on public.kontakt_praeferenzen to authenticated;
alter policy kp_insert on public.kontakt_praeferenzen to authenticated;
alter policy kp_select on public.kontakt_praeferenzen to authenticated;
alter policy kp_update on public.kontakt_praeferenzen to authenticated;

alter policy kontakte_delete on public.kontakte to authenticated;
alter policy kontakte_insert on public.kontakte to authenticated;
alter policy kontakte_select on public.kontakte to authenticated;
alter policy kontakte_update on public.kontakte to authenticated;

alter policy konten_select on public.konten to authenticated;
alter policy konten_write on public.konten to authenticated;

alter policy konto_umbuchungen_delete on public.konto_umbuchungen to authenticated;
alter policy konto_umbuchungen_insert on public.konto_umbuchungen to authenticated;
alter policy konto_umbuchungen_select on public.konto_umbuchungen to authenticated;

alter policy ka_tenant on public.kostenarten to authenticated;

alter policy ke_tenant on public.kosteneintraege to authenticated;

alter policy keb_tenant on public.kosteneintrag_behaelter to authenticated;

alter policy kew_tenant on public.kosteneintrag_weingaerten to authenticated;

alter policy ks_tenant on public.kostenstellen to authenticated;

alter policy "lagen: admin can delete" on public.lagen to authenticated;
alter policy "lagen: members can select" on public.lagen to authenticated;
alter policy "lagen: winzer+ can insert" on public.lagen to authenticated;
alter policy "lagen: winzer+ can update" on public.lagen to authenticated;

alter policy "module_flags: members can view own tenant" on public.module_flags to authenticated;

alter policy morgenberichte_select on public.morgenberichte to authenticated;

alter policy "psm: admin can delete own" on public.pflanzenschutzmittel to authenticated;
alter policy "psm: read global + own" on public.pflanzenschutzmittel to authenticated;
alter policy "psm: winzer+ can insert own" on public.pflanzenschutzmittel to authenticated;
alter policy "psm: winzer+ can update own" on public.pflanzenschutzmittel to authenticated;

alter policy pipe_delete on public.pipeline_eintraege to authenticated;
alter policy pipe_insert on public.pipeline_eintraege to authenticated;
alter policy pipe_select on public.pipeline_eintraege to authenticated;
alter policy pipe_update on public.pipeline_eintraege to authenticated;

alter policy pipeverlauf_insert on public.pipeline_verlauf to authenticated;
alter policy pipeverlauf_select on public.pipeline_verlauf to authenticated;

alter policy pressung_beh_delete on public.pressung_behaelter to authenticated;
alter policy pressung_beh_insert on public.pressung_behaelter to authenticated;
alter policy pressung_beh_select on public.pressung_behaelter to authenticated;
alter policy pressung_beh_update on public.pressung_behaelter to authenticated;

alter policy pressung_wg_delete on public.pressung_weingaerten to authenticated;
alter policy pressung_wg_insert on public.pressung_weingaerten to authenticated;
alter policy pressung_wg_select on public.pressung_weingaerten to authenticated;
alter policy pressung_wg_update on public.pressung_weingaerten to authenticated;

alter policy pressungen_delete on public.pressungen to authenticated;
alter policy pressungen_insert on public.pressungen to authenticated;
alter policy pressungen_select on public.pressungen to authenticated;
alter policy pressungen_update on public.pressungen to authenticated;

alter policy pna_delete on public.pruefnummernantraege to authenticated;
alter policy pna_insert on public.pruefnummernantraege to authenticated;
alter policy pna_select on public.pruefnummernantraege to authenticated;
alter policy pna_update on public.pruefnummernantraege to authenticated;

alter policy rabattg_delete on public.rabattgruppen to authenticated;
alter policy rabattg_insert on public.rabattgruppen to authenticated;
alter policy rabattg_select on public.rabattgruppen to authenticated;
alter policy rabattg_update on public.rabattgruppen to authenticated;

alter policy "saetze: admin can delete own" on public.saetze_massnahmen to authenticated;
alter policy "saetze: read global + own" on public.saetze_massnahmen to authenticated;
alter policy "saetze: winzer+ can insert own" on public.saetze_massnahmen to authenticated;
alter policy "saetze: winzer+ can update own" on public.saetze_massnahmen to authenticated;

alter policy sonstige_artikel_insert on public.sonstige_artikel to authenticated;
alter policy sonstige_artikel_select on public.sonstige_artikel to authenticated;
alter policy sonstige_artikel_update on public.sonstige_artikel to authenticated;

alter policy sumup_checkouts_insert on public.sumup_checkouts to authenticated;
alter policy sumup_checkouts_select on public.sumup_checkouts to authenticated;
alter policy sumup_checkouts_update on public.sumup_checkouts to authenticated;

alter policy sumup_terminals_select on public.sumup_terminals to authenticated;
alter policy sumup_terminals_write on public.sumup_terminals to authenticated;

alter policy sumup_tx_select on public.sumup_transaktionen to authenticated;
alter policy sumup_tx_service_insert on public.sumup_transaktionen to authenticated;

alter policy einst_select on public.tenant_einstellungen to authenticated;
alter policy einst_update on public.tenant_einstellungen to authenticated;

alter policy "memberships: tenant_admin can delete" on public.tenant_memberships to authenticated;
alter policy "memberships: tenant_admin can view all in tenant" on public.tenant_memberships to authenticated;
alter policy "memberships: user can view own memberships" on public.tenant_memberships to authenticated;

alter policy "tenants: tenant_admin can update own tenant" on public.tenants to authenticated;
alter policy "tenants: user can view own tenants" on public.tenants to authenticated;

alter policy "Nur via RPC schreiben" on public.transaktionszaehler to authenticated;
alter policy "Tenant-Mitglieder können transaktionszaehler lesen" on public.transaktionszaehler to authenticated;

alter policy tb_delete on public.transportbescheinigungen to authenticated;
alter policy tb_insert on public.transportbescheinigungen to authenticated;
alter policy tb_select on public.transportbescheinigungen to authenticated;
alter policy tb_update on public.transportbescheinigungen to authenticated;

alter policy traubenverkauf_delete on public.traubenverkauf to authenticated;
alter policy traubenverkauf_insert on public.traubenverkauf to authenticated;
alter policy traubenverkauf_select on public.traubenverkauf to authenticated;
alter policy traubenverkauf_update on public.traubenverkauf to authenticated;

alter policy verkauf_pos_delete on public.verkauf_positionen to authenticated;
alter policy verkauf_pos_insert on public.verkauf_positionen to authenticated;
alter policy verkauf_pos_select on public.verkauf_positionen to authenticated;
alter policy verkauf_pos_update on public.verkauf_positionen to authenticated;

alter policy verkaufsposten_delete on public.verkaufsposten to authenticated;
alter policy verkaufsposten_insert on public.verkaufsposten to authenticated;
alter policy verkaufsposten_select on public.verkaufsposten to authenticated;
alter policy verkaufsposten_update on public.verkaufsposten to authenticated;

alter policy "analysen: admin can delete" on public.weinanalysen to authenticated;
alter policy "analysen: members can select" on public.weinanalysen to authenticated;
alter policy "analysen: winzer+ can insert" on public.weinanalysen to authenticated;
alter policy "analysen: winzer+ can update" on public.weinanalysen to authenticated;

alter policy weinausbau_delete on public.weinausbau to authenticated;
alter policy weinausbau_insert on public.weinausbau to authenticated;
alter policy weinausbau_select on public.weinausbau to authenticated;
alter policy weinausbau_update on public.weinausbau to authenticated;

alter policy waw_delete on public.weinausbau_weingaerten to authenticated;
alter policy waw_insert on public.weinausbau_weingaerten to authenticated;
alter policy waw_select on public.weinausbau_weingaerten to authenticated;
alter policy waw_update on public.weinausbau_weingaerten to authenticated;

alter policy weinbaugebiete_custom_insert on public.weinbaugebiete_custom to authenticated;
alter policy weinbaugebiete_custom_select on public.weinbaugebiete_custom to authenticated;
alter policy weinbaugebiete_custom_update on public.weinbaugebiete_custom to authenticated;

alter policy "weingarten: admin can delete" on public.weingarten to authenticated;
alter policy "weingarten: all members can select" on public.weingarten to authenticated;
alter policy "weingarten: winzer+ can insert" on public.weingarten to authenticated;
alter policy "weingarten: winzer+ can update" on public.weingarten to authenticated;

alter policy "wg_rebsorten: admin can delete" on public.weingarten_rebsorten to authenticated;
alter policy "wg_rebsorten: select via weingarten" on public.weingarten_rebsorten to authenticated;
alter policy "wg_rebsorten: winzer+ can insert" on public.weingarten_rebsorten to authenticated;
alter policy "wg_rebsorten: winzer+ can update" on public.weingarten_rebsorten to authenticated;

alter policy "jahrgaenge: admin can delete" on public.weinjahrgaenge to authenticated;
alter policy "jahrgaenge: members can select" on public.weinjahrgaenge to authenticated;
alter policy "jahrgaenge: winzer+ can insert" on public.weinjahrgaenge to authenticated;
alter policy "jahrgaenge: winzer+ can update" on public.weinjahrgaenge to authenticated;

alter policy wetter_select on public.wetter_stunden to authenticated;

alter policy zahlungen_delete on public.zahlungen to authenticated;
alter policy zahlungen_insert on public.zahlungen to authenticated;
alter policy zahlungen_select on public.zahlungen to authenticated;
alter policy zahlungen_update on public.zahlungen to authenticated;

alter policy zeiterfassung_tenant_admin on public.zeiterfassung to authenticated;

alter policy zukauf_posten_insert on public.zukauf_posten to authenticated;
alter policy zukauf_posten_select on public.zukauf_posten to authenticated;
alter policy zukauf_posten_update on public.zukauf_posten to authenticated;
