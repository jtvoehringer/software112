-- KAN-454 (13.11.2026): Rollen/Rechte R2 – Sperr-Policies „lesebereich“ auf allen Tabellen.
--
-- Grundlage ist KAN-412 R1 (Profil an der Mitgliedschaft, Lesebereich je Tabelle in scripts/lesebereiche.json, von
-- Jörgen am 13.11.2026 abgenommen). Diese Migration setzt das Lesen in der Datenbank durch:
--   * Tabelle mit tenant_id:      RESTRICTIVE-Policy „lesebereich“ – der Betrieb der Zeile darf für den Benutzer im
--                                 Bereich der Tabelle nicht gesperrt sein (eine Auswertung je Abfrage, nicht je Zeile)
--   * Kindtabelle ohne tenant_id: die Elternzeile muss sichtbar sein (sie trägt die Sperre)
--   * Freigaben (Gemeinschaften): keiner der beiden Betriebe der Freigabe darf gesperrt sein
--   * Bereich „allgemein“ und Sichten (security_invoker) bekommen keine Policy
-- Gesperrt ist ein Bereich nur für Mitglieder mit Profil (vertrieb, extern). Noch hat niemand ein Profil und die App
-- vergibt keines (KAN-457) – für alle bestehenden Benutzer liefert die Sperre eine leere Menge, es ändert sich nichts.
-- Schreiben regeln weiterhin die Schreibmodule; Service-Role und SECURITY-DEFINER-Funktionen sind nicht betroffen
-- (Lesewege an den Policies vorbei: KAN-455).
-- Die Liste unten ist die Ausgabe von scripts/lesebereich-sql.js (Test kan454-lesebereich vergleicht sie).

-- 1. Gesperrte Betriebe: auch Partnerbetriebe einer Gemeinschaft ───────────────────────────────────────────────────
--    Über Keller- und CRM-Freigaben sieht ein Benutzer Daten eines Partnerbetriebs, in dem er nicht Mitglied ist.
--    Sähe er sie nur als Mitglied eines Betriebs, in dem der Bereich für ihn gesperrt ist, ist auch der Partner gesperrt
--    – außer er ist dort selbst Mitglied mit Leserecht oder erreicht ihn über einen Betrieb ohne Sperre.
CREATE OR REPLACE FUNCTION public.s112_lesegesperrte_tenants(p_bereich text)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH meine AS (
    SELECT m.tenant_id, m.aktiv,
           (m.profil IS NOT NULL AND NOT (p_bereich = ANY (public.s112_profil_bereiche(m.profil)))) AS gesperrt
      FROM public.tenant_memberships m
     WHERE m.user_id = (SELECT auth.uid())
  ),
  freigaben AS (
    SELECT f.eigentuemer_tenant_id, f.nutzer_tenant_id FROM public.keller_freigaben f WHERE f.aktiv
    UNION
    SELECT f.eigentuemer_tenant_id, f.nutzer_tenant_id FROM public.crm_freigaben f WHERE f.aktiv
  )
  SELECT m.tenant_id FROM meine m WHERE m.gesperrt
  UNION
  SELECT f.eigentuemer_tenant_id
    FROM freigaben f
   WHERE f.nutzer_tenant_id IN (SELECT m.tenant_id FROM meine m WHERE m.gesperrt)
     AND NOT EXISTS (SELECT 1 FROM meine d WHERE d.tenant_id = f.eigentuemer_tenant_id AND d.aktiv AND NOT d.gesperrt)
     AND NOT EXISTS (SELECT 1 FROM freigaben g JOIN meine d ON d.tenant_id = g.nutzer_tenant_id AND d.aktiv AND NOT d.gesperrt
                      WHERE g.eigentuemer_tenant_id = f.eigentuemer_tenant_id)
$function$;
COMMENT ON FUNCTION public.s112_lesegesperrte_tenants(text) IS
  'KAN-412/KAN-454: Betriebe, in denen der angemeldete Benutzer den Lesebereich wegen seines Profils nicht lesen darf – samt Partnerbetrieben, die er nur über einen gesperrten Betrieb erreicht (für RESTRICTIVE-Policies)';

-- 2. Sperr-Policies ───────────────────────────────────────────────────────────────────────────────────────────────
DO $kan412b$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('aktivitaet_dokumente', 'crm', 'tenant', NULL, NULL),
    ('aktivitaeten', 'crm', 'tenant', NULL, NULL),
    ('ama_erntemeldungen', 'lese', 'tenant', NULL, NULL),
    ('ama_meldepositionen', 'lese', 'kind', 'ama_erntemeldungen', 'meldung_id'),
    ('assistent_aktionen', 'ki', 'kind', 'assistent_unterhaltungen', 'unterhaltung_id'),
    ('assistent_korrekturen', 'ki', 'tenant', NULL, NULL),
    ('assistent_nachrichten', 'ki', 'kind', 'assistent_unterhaltungen', 'unterhaltung_id'),
    ('assistent_unterhaltungen', 'ki', 'tenant', NULL, NULL),
    ('auftraege', 'verkauf', 'tenant', NULL, NULL),
    ('auftrag_lieferungen', 'verkauf', 'tenant', NULL, NULL),
    ('auftrag_positionen', 'verkauf', 'tenant', NULL, NULL),
    ('behaelter', 'keller', 'tenant', NULL, NULL),
    ('behandlung_grundstuecke', 'massnahmen', 'kind', 'behandlungen', 'behandlung_id'),
    ('behandlungen', 'massnahmen', 'tenant', NULL, NULL),
    ('bestandsprotokoll', 'verwaltung', 'tenant', NULL, NULL),
    ('bestellung_positionen', 'verkauf', 'kind', 'bestellungen', 'bestellung_id'),
    ('bestellungen', 'verkauf', 'tenant', NULL, NULL),
    ('betriebsmittel', 'betriebsmittel', 'tenant', NULL, NULL),
    ('betriebsmittel_lager_bewegungen', 'betriebsmittel', 'tenant', NULL, NULL),
    ('buchhaltung_export_protokoll', 'ea', 'tenant', NULL, NULL),
    ('buchhaltung_kontenmapping', 'ea', 'tenant', NULL, NULL),
    ('charge_umstufungen', 'keller', 'tenant', NULL, NULL),
    ('checklisten', 'betrieb', 'tenant', NULL, NULL),
    ('checklisten_punkte', 'betrieb', 'tenant', NULL, NULL),
    ('crm_dubletten_ignoriert', 'crm', 'tenant', NULL, NULL),
    ('crm_freigaben', 'crm', 'freigabe', NULL, NULL),
    ('dac_antrag', 'keller', 'tenant', NULL, NULL),
    ('datenschutz_consents', 'crm', 'tenant', NULL, NULL),
    ('duengemittel', 'betriebsmittel', 'tenant', NULL, NULL),
    ('duengemittel_lager_bewegungen', 'betriebsmittel', 'tenant', NULL, NULL),
    ('ea_anlagen', 'ea', 'tenant', NULL, NULL),
    ('ea_belege', 'ea', 'tenant', NULL, NULL),
    ('ea_dauerauftraege', 'ea', 'tenant', NULL, NULL),
    ('ea_dauerauftrag_log', 'ea', 'tenant', NULL, NULL),
    ('ea_kategorien', 'ea', 'tenant', NULL, NULL),
    ('ea_monatsabschluss', 'ea', 'tenant', NULL, NULL),
    ('ea_transaktionen', 'ea', 'tenant', NULL, NULL),
    ('ea_uva', 'ea', 'tenant', NULL, NULL),
    ('elabel_umleitungen', 'lager', 'tenant', NULL, NULL),
    ('elabels', 'lager', 'tenant', NULL, NULL),
    ('email_lead_ignoriert', 'crm', 'tenant', NULL, NULL),
    ('ernte_gst_abgeschlossen', 'lese', 'tenant', NULL, NULL),
    ('ernte_parzellen', 'lese', 'kind', 'weinjahrgaenge', 'jahrgang_id'),
    ('export_dokumente', 'verkauf', 'kind', 'exportauftraege', 'exportauftrag_id'),
    ('export_nachweise', 'verkauf', 'tenant', NULL, NULL),
    ('export_registrierungen', 'verkauf', 'tenant', NULL, NULL),
    ('exportauftraege', 'verkauf', 'tenant', NULL, NULL),
    ('exportauftrag_positionen', 'verkauf', 'kind', 'exportauftraege', 'exportauftrag_id'),
    ('firmen', 'crm', 'tenant', NULL, NULL),
    ('fristen', 'betrieb', 'tenant', NULL, NULL),
    ('fuellung_bewegungen', 'lager', 'tenant', NULL, NULL),
    ('fuellung_chargen', 'lager', 'tenant', NULL, NULL),
    ('fuellung_etikettierungen', 'lager', 'tenant', NULL, NULL),
    ('fuellungen', 'lager', 'tenant', NULL, NULL),
    ('grundstuecke', 'rieden', 'tenant', NULL, NULL),
    ('keller_behandlungen', 'keller', 'tenant', NULL, NULL),
    ('keller_behandlungstypen', 'keller', 'tenant', NULL, NULL),
    ('keller_freigaben', 'keller', 'freigabe', NULL, NULL),
    ('keller_umzuege', 'keller', 'tenant', NULL, NULL),
    ('keller_verarbeitungen', 'keller', 'tenant', NULL, NULL),
    ('keller_zugangskorrekturen', 'keller', 'tenant', NULL, NULL),
    ('kellerbuch_abschluesse', 'keller', 'tenant', NULL, NULL),
    ('kellerbuch_buchungen', 'keller', 'tenant', NULL, NULL),
    ('kellermittel', 'keller', 'tenant', NULL, NULL),
    ('kellermittel_buchungen', 'keller', 'tenant', NULL, NULL),
    ('kellerplaene', 'keller', 'tenant', NULL, NULL),
    ('kellerplan_positionen', 'keller', 'tenant', NULL, NULL),
    ('kontakt_firmen', 'crm', 'kind', 'kontakte', 'kontakt_id'),
    ('kontakt_praeferenzen', 'crm', 'kind', 'kontakte', 'kontakt_id'),
    ('kontakte', 'crm', 'tenant', NULL, NULL),
    ('konten', 'ea', 'tenant', NULL, NULL),
    ('konto_umbuchungen', 'ea', 'tenant', NULL, NULL),
    ('kostenarten', 'controlling', 'tenant', NULL, NULL),
    ('kosteneintraege', 'controlling', 'tenant', NULL, NULL),
    ('kosteneintrag_behaelter', 'controlling', 'kind', 'kosteneintraege', 'kosteneintrag_id'),
    ('kosteneintrag_weingaerten', 'controlling', 'kind', 'kosteneintraege', 'kosteneintrag_id'),
    ('kostenstellen', 'controlling', 'tenant', NULL, NULL),
    ('lagen', 'rieden', 'tenant', NULL, NULL),
    ('lesen', 'lese', 'tenant', NULL, NULL),
    ('lieferadressen', 'verkauf', 'tenant', NULL, NULL),
    ('lohnversektungen', 'keller', 'tenant', NULL, NULL),
    ('meldung_abgaben', 'verwaltung', 'tenant', NULL, NULL),
    ('morgenberichte', 'ki', 'tenant', NULL, NULL),
    ('pflanzenschutzmittel', 'betriebsmittel', 'tenant', NULL, NULL),
    ('pipeline_eintraege', 'crm', 'tenant', NULL, NULL),
    ('pipeline_verlauf', 'crm', 'kind', 'pipeline_eintraege', 'pipeline_id'),
    ('pressung_behaelter', 'lese', 'kind', 'pressungen', 'pressung_id'),
    ('pressung_weingaerten', 'lese', 'kind', 'pressungen', 'pressung_id'),
    ('pressungen', 'lese', 'tenant', NULL, NULL),
    ('produktion_eingaenge', 'keller', 'tenant', NULL, NULL),
    ('produktionen', 'keller', 'tenant', NULL, NULL),
    ('pruefnummer_chargen', 'keller', 'tenant', NULL, NULL),
    ('pruefnummer_ereignisse', 'keller', 'tenant', NULL, NULL),
    ('pruefnummernantraege', 'keller', 'tenant', NULL, NULL),
    ('psm_lager_bewegungen', 'betriebsmittel', 'tenant', NULL, NULL),
    ('psm_uebermittlungen', 'betriebsmittel', 'tenant', NULL, NULL),
    ('rabattgruppen', 'verkauf', 'tenant', NULL, NULL),
    ('rechnungen', 'verkauf', 'tenant', NULL, NULL),
    ('reifemessungen', 'rieden', 'tenant', NULL, NULL),
    ('saetze_massnahmen', 'controlling', 'tenant', NULL, NULL),
    ('sonstige_artikel', 'lager', 'tenant', NULL, NULL),
    ('sonstige_artikel_bewegungen', 'lager', 'tenant', NULL, NULL),
    ('stripe_zahlungen_log', 'verwaltung', 'tenant', NULL, NULL),
    ('sumup_checkouts', 'verkauf', 'tenant', NULL, NULL),
    ('sumup_terminals', 'verkauf', 'tenant', NULL, NULL),
    ('sumup_transaktionen', 'verkauf', 'tenant', NULL, NULL),
    ('system_ereignisse', 'verwaltung', 'tenant', NULL, NULL),
    ('transaktionszaehler', 'verwaltung', 'tenant', NULL, NULL),
    ('transportbescheinigungen', 'lager', 'tenant', NULL, NULL),
    ('traubenverkauf', 'lese', 'tenant', NULL, NULL),
    ('verkauf_ki_begriffe', 'verkauf', 'tenant', NULL, NULL),
    ('verkauf_positionen', 'verkauf', 'tenant', NULL, NULL),
    ('verkaufsposten', 'verkauf', 'tenant', NULL, NULL),
    ('verschneidung_quellen', 'keller', 'kind', 'verschneidungen', 'verschneidung_id'),
    ('verschneidungen', 'keller', 'tenant', NULL, NULL),
    ('weinanalysen', 'keller', 'tenant', NULL, NULL),
    ('weinausbau', 'keller', 'tenant', NULL, NULL),
    ('weinausbau_weingaerten', 'keller', 'tenant', NULL, NULL),
    ('weinbaugebiete_custom', 'rieden', 'tenant', NULL, NULL),
    ('weingarten', 'rieden', 'tenant', NULL, NULL),
    ('weingarten_rebsorten', 'rieden', 'kind', 'weingarten', 'weingarten_id'),
    ('weinjahrgaenge', 'lese', 'tenant', NULL, NULL),
    ('zahlungen', 'verkauf', 'tenant', NULL, NULL),
    ('zeiterfassung', 'controlling', 'tenant', NULL, NULL),
    ('zukauf_posten', 'lager', 'tenant', NULL, NULL)
  ) AS t(tabelle, bereich, art, eltern, spalte) LOOP
    IF r.art = 'tenant' THEN
      EXECUTE format('CREATE POLICY lesebereich ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT (tenant_id IN (SELECT public.s112_lesegesperrte_tenants(%L))))',
                     r.tabelle, r.bereich);
    ELSIF r.art = 'kind' THEN
      EXECUTE format('CREATE POLICY lesebereich ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.%I e WHERE e.id = %I.%I))',
                     r.tabelle, r.eltern, r.tabelle, r.spalte);
    ELSE
      EXECUTE format('CREATE POLICY lesebereich ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT (eigentuemer_tenant_id IN (SELECT public.s112_lesegesperrte_tenants(%L))) AND NOT (nutzer_tenant_id IN (SELECT public.s112_lesegesperrte_tenants(%L))))',
                     r.tabelle, r.bereich, r.bereich);
    END IF;
    EXECUTE format('COMMENT ON POLICY lesebereich ON public.%I IS %L', r.tabelle, 'KAN-454: Lesebereich ' || r.bereich || ' – gesperrt für Profile ohne diesen Bereich');
  END LOOP;
END
$kan412b$;
