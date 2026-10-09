-- Sweep 80 (09.10.2026): fehlende Indizes auf tenant_id und auf Fremdschlüsseln
--
-- Befund Performance-Advisor (Lint 0001 unindexed_foreign_keys) und Katalogabfrage:
--   • 7 Tabellen ohne Index, der mit tenant_id beginnt (zeiterfassung, system_ereignisse, rabattgruppen, exportauftraege,
--     kostenstellen, pruefnummernantraege, benachrichtigungen) – jede RLS- und App-Abfrage filtert nach tenant_id,
--     ohne Index liest Postgres bei wachsender Mandantenzahl die ganze Tabelle;
--   • Fremdschlüssel ohne abdeckenden Index, nach denen die App sucht (Transportbescheinigung zum Verkauf, Pressung je
--     Charge/Weingarten für die Rückverfolgung, Buchungen je Dauerauftrag, Kellermittel je Charge/Behandlung …) bzw. die
--     beim Löschen/Stornieren der Elternzeile geprüft werden.
-- Bewusst ohne Index: Verweise auf auth.users (erstellt_von, …) und auf Kataloge kat_* (land, erzeugnis, …) – dort sucht
-- Postgres nur beim seltenen Löschen der Zielzeile. DB-Test 78 hält beides fest.
-- Dazu idx_ernte_parzellen_gst: in der Produktion vorhanden, aber in keiner Migration – Staging fehlte er (Probelauf).
-- Alle Tabellen sind klein (≤ 300 Zeilen) – CREATE INDEX ohne CONCURRENTLY sperrt nur Millisekunden.
-- Rollback: DROP INDEX der unten angelegten Indizes.

BEGIN;

-- ── tenant_id ────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS benachrichtigungen_tenant_id_idx ON public.benachrichtigungen (tenant_id);
CREATE INDEX IF NOT EXISTS exportauftraege_tenant_id_idx ON public.exportauftraege (tenant_id);
CREATE INDEX IF NOT EXISTS kostenstellen_tenant_id_idx ON public.kostenstellen (tenant_id);
CREATE INDEX IF NOT EXISTS pruefnummernantraege_tenant_id_idx ON public.pruefnummernantraege (tenant_id);
CREATE INDEX IF NOT EXISTS rabattgruppen_tenant_id_idx ON public.rabattgruppen (tenant_id);
CREATE INDEX IF NOT EXISTS system_ereignisse_tenant_id_idx ON public.system_ereignisse (tenant_id);
CREATE INDEX IF NOT EXISTS zeiterfassung_tenant_id_idx ON public.zeiterfassung (tenant_id);

-- ── Fremdschlüssel (Ziel weder auth.users noch kat_*) ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ama_erntemeldungen_vorgaenger_id_idx ON public.ama_erntemeldungen (vorgaenger_id);
-- Produktion hat diesen Index seit jeher, aber in keiner Migration (von Hand angelegt) – Staging/Neuaufbau fehlte er
CREATE INDEX IF NOT EXISTS idx_ernte_parzellen_gst ON public.ernte_parzellen (grundstueck_id);
CREATE INDEX IF NOT EXISTS behandlungen_betriebsmittel_id_tenant_id_idx ON public.behandlungen (betriebsmittel_id, tenant_id);
CREATE INDEX IF NOT EXISTS betriebsmittel_ea_kategorie_id_idx ON public.betriebsmittel (ea_kategorie_id);
CREATE INDEX IF NOT EXISTS betriebsmittel_lager_bewegungen_betriebsmittel_id_tenant_id_idx ON public.betriebsmittel_lager_bewegungen (betriebsmittel_id, tenant_id);
CREATE INDEX IF NOT EXISTS betriebsmittel_lager_bewegungen_lieferant_firma_id_tenant_i_idx ON public.betriebsmittel_lager_bewegungen (lieferant_firma_id, tenant_id);
CREATE INDEX IF NOT EXISTS ea_dauerauftrag_log_ea_transaktion_id_idx ON public.ea_dauerauftrag_log (ea_transaktion_id);
CREATE INDEX IF NOT EXISTS ea_transaktionen_dauerauftrag_id_idx ON public.ea_transaktionen (dauerauftrag_id);
CREATE INDEX IF NOT EXISTS elabel_umleitungen_nach_elabel_id_idx ON public.elabel_umleitungen (nach_elabel_id);
CREATE INDEX IF NOT EXISTS elabel_umleitungen_von_elabel_id_idx ON public.elabel_umleitungen (von_elabel_id);
CREATE INDEX IF NOT EXISTS exportauftrag_positionen_fullung_id_idx ON public.exportauftrag_positionen (fullung_id);
CREATE INDEX IF NOT EXISTS keller_behandlungstypen_elabel_zutat_id_idx ON public.keller_behandlungstypen (elabel_zutat_id);
CREATE INDEX IF NOT EXISTS kellermittel_buchungen_behaelter_id_idx ON public.kellermittel_buchungen (behaelter_id);
CREATE INDEX IF NOT EXISTS kellermittel_buchungen_keller_behandlung_id_idx ON public.kellermittel_buchungen (keller_behandlung_id);
CREATE INDEX IF NOT EXISTS kellermittel_buchungen_weinausbau_id_idx ON public.kellermittel_buchungen (weinausbau_id);
CREATE INDEX IF NOT EXISTS lohnversektungen_behaelter_id_vorher_idx ON public.lohnversektungen (behaelter_id_vorher);
CREATE INDEX IF NOT EXISTS meldung_abgaben_tenant_id_ama_meldung_id_idx ON public.meldung_abgaben (tenant_id, ama_meldung_id);
CREATE INDEX IF NOT EXISTS pipeline_verlauf_pipeline_id_idx ON public.pipeline_verlauf (pipeline_id);
CREATE INDEX IF NOT EXISTS pressung_behaelter_behaelter_id_idx ON public.pressung_behaelter (behaelter_id);
CREATE INDEX IF NOT EXISTS pressung_behaelter_weinausbau_id_idx ON public.pressung_behaelter (weinausbau_id);
CREATE INDEX IF NOT EXISTS pressung_weingaerten_weingarten_id_idx ON public.pressung_weingaerten (weingarten_id);
CREATE INDEX IF NOT EXISTS produktion_eingaenge_kellermittel_id_idx ON public.produktion_eingaenge (kellermittel_id);
CREATE INDEX IF NOT EXISTS rechnungen_bmd_export_id_idx ON public.rechnungen (bmd_export_id);
CREATE INDEX IF NOT EXISTS rechnungen_zh_kontakt_id_idx ON public.rechnungen (zh_kontakt_id);
CREATE INDEX IF NOT EXISTS sumup_transaktionen_checkout_id_idx ON public.sumup_transaktionen (checkout_id);
CREATE INDEX IF NOT EXISTS transportbescheinigungen_verkaufsposten_id_idx ON public.transportbescheinigungen (verkaufsposten_id);
CREATE INDEX IF NOT EXISTS traubenverkauf_firma_id_idx ON public.traubenverkauf (firma_id);
CREATE INDEX IF NOT EXISTS traubenverkauf_jahrgang_id_idx ON public.traubenverkauf (jahrgang_id);
CREATE INDEX IF NOT EXISTS traubenverkauf_kontakt_id_idx ON public.traubenverkauf (kontakt_id);
CREATE INDEX IF NOT EXISTS verkaufsposten_bmd_export_id_idx ON public.verkaufsposten (bmd_export_id);
CREATE INDEX IF NOT EXISTS verkaufsposten_lieferadresse_id_idx ON public.verkaufsposten (lieferadresse_id);
CREATE INDEX IF NOT EXISTS verkaufsposten_zh_kontakt_id_idx ON public.verkaufsposten (zh_kontakt_id);
CREATE INDEX IF NOT EXISTS verschneidung_quellen_quell_behaelter_id_idx ON public.verschneidung_quellen (quell_behaelter_id);
CREATE INDEX IF NOT EXISTS verschneidungen_ziel_behaelter_id_idx ON public.verschneidungen (ziel_behaelter_id);
CREATE INDEX IF NOT EXISTS zukauf_posten_lieferant_firma_id_idx ON public.zukauf_posten (lieferant_firma_id);
CREATE INDEX IF NOT EXISTS zukauf_posten_lieferant_kontakt_id_idx ON public.zukauf_posten (lieferant_kontakt_id);
CREATE INDEX IF NOT EXISTS zukauf_posten_zh_kontakt_id_idx ON public.zukauf_posten (zh_kontakt_id);
CREATE INDEX IF NOT EXISTS zukauf_posten_ziel_weinausbau_id_idx ON public.zukauf_posten (ziel_weinausbau_id);

COMMIT;
