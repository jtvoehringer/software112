-- Migration 218 (19.9.2026): Benutzerkonzept – Schreibrechte je Modul (Details siehe Repo-Datei)
ALTER TABLE tenant_memberships ADD COLUMN IF NOT EXISTS schreibmodule text[];
COMMENT ON COLUMN tenant_memberships.schreibmodule IS 'Nur Rolle winzer (Mitarbeiter): Module, in denen bearbeitet werden darf – rieden, kellerbuch, warenwirtschaft, crm, ea, auswertungen. Admins: immer alle, leser: keine.';

UPDATE tenant_memberships
   SET schreibmodule = ARRAY['rieden','kellerbuch','warenwirtschaft','crm','ea','auswertungen']
 WHERE role = 'winzer' AND schreibmodule IS NULL;

CREATE OR REPLACE FUNCTION s112_darf_schreiben(p_tenant uuid, VARIADIC p_module text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenant_memberships m
     WHERE m.tenant_id = p_tenant
       AND m.user_id = (SELECT auth.uid())
       AND m.aktiv
       AND (m.role IN ('system_admin','tenant_admin')
            OR (m.role = 'winzer' AND ('betrieb' = ANY (p_module) OR COALESCE(m.schreibmodule,'{}') && p_module)))
  )
$$;
REVOKE ALL ON FUNCTION s112_darf_schreiben(uuid, text[]) FROM public;
GRANT EXECUTE ON FUNCTION s112_darf_schreiben(uuid, text[]) TO authenticated, service_role;

DO $$
DECLARE
  r record;
  v_expr text;
  v_mods text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('weingarten',                    ARRAY['rieden'],                          NULL, NULL),
      ('weingarten_rebsorten',          ARRAY['rieden'],                          'weingarten', 'weingarten_id'),
      ('grundstuecke',                  ARRAY['rieden','ea'],                     NULL, NULL),
      ('lagen',                         ARRAY['rieden'],                          NULL, NULL),
      ('behandlungen',                  ARRAY['rieden'],                          NULL, NULL),
      ('behandlung_grundstuecke',       ARRAY['rieden'],                          'behandlungen', 'behandlung_id'),
      ('pflanzenschutzmittel',          ARRAY['rieden'],                          NULL, NULL),
      ('duengemittel',                  ARRAY['rieden'],                          NULL, NULL),
      ('saetze_massnahmen',             ARRAY['rieden'],                          NULL, NULL),
      ('psm_lager_bewegungen',          ARRAY['rieden'],                          NULL, NULL),
      ('duengemittel_lager_bewegungen', ARRAY['rieden'],                          NULL, NULL),
      ('weinjahrgaenge',                ARRAY['rieden','kellerbuch'],             NULL, NULL),
      ('ernte_parzellen',               ARRAY['rieden','kellerbuch'],             'weinjahrgaenge', 'jahrgang_id'),
      ('ama_erntemeldungen',            ARRAY['rieden'],                          NULL, NULL),
      ('ama_meldepositionen',           ARRAY['rieden'],                          'ama_erntemeldungen', 'meldung_id'),
      ('weinbaugebiete_custom',         ARRAY['rieden'],                          NULL, NULL),
      ('traubenverkauf',                ARRAY['rieden','warenwirtschaft'],        NULL, NULL),
      ('pressungen',                    ARRAY['kellerbuch','rieden'],             NULL, NULL),
      ('pressung_behaelter',            ARRAY['kellerbuch','rieden'],             'pressungen', 'pressung_id'),
      ('pressung_weingaerten',          ARRAY['kellerbuch','rieden'],             'pressungen', 'pressung_id'),
      ('weinausbau',                    ARRAY['kellerbuch','rieden'],             NULL, NULL),
      ('weinausbau_weingaerten',        ARRAY['kellerbuch','rieden'],             NULL, NULL),
      ('behaelter',                     ARRAY['kellerbuch'],                      NULL, NULL),
      ('keller_behandlungen',           ARRAY['kellerbuch'],                      NULL, NULL),
      ('keller_behandlungstypen',       ARRAY['kellerbuch'],                      NULL, NULL),
      ('kellerplaene',                  ARRAY['kellerbuch'],                      NULL, NULL),
      ('kellerplan_positionen',         ARRAY['kellerbuch'],                      NULL, NULL),
      ('weinanalysen',                  ARRAY['kellerbuch'],                      NULL, NULL),
      ('verschneidungen',               ARRAY['kellerbuch'],                      NULL, NULL),
      ('verschneidung_quellen',         ARRAY['kellerbuch'],                      'verschneidungen', 'verschneidung_id'),
      ('dac_antrag',                    ARRAY['kellerbuch'],                      NULL, NULL),
      ('pruefnummernantraege',          ARRAY['kellerbuch'],                      NULL, NULL),
      ('transportbescheinigungen',      ARRAY['kellerbuch','warenwirtschaft'],    NULL, NULL),
      ('assistent_unterhaltungen',      ARRAY['kellerbuch'],                      NULL, NULL),
      ('assistent_korrekturen',         ARRAY['kellerbuch'],                      NULL, NULL),
      ('assistent_nachrichten',         ARRAY['kellerbuch'],                      'assistent_unterhaltungen', 'unterhaltung_id'),
      ('assistent_aktionen',            ARRAY['kellerbuch'],                      'assistent_unterhaltungen', 'unterhaltung_id'),
      ('fuellungen',                    ARRAY['kellerbuch','warenwirtschaft'],    NULL, NULL),
      ('fuellung_chargen',              ARRAY['kellerbuch','warenwirtschaft'],    NULL, NULL),
      ('keller_umzuege',                ARRAY['kellerbuch','warenwirtschaft'],    NULL, NULL),
      ('verkaufsposten',                ARRAY['warenwirtschaft'],                 NULL, NULL),
      ('verkauf_positionen',            ARRAY['warenwirtschaft'],                 NULL, NULL),
      ('zahlungen',                     ARRAY['warenwirtschaft','ea'],            NULL, NULL),
      ('bestellungen',                  ARRAY['warenwirtschaft'],                 NULL, NULL),
      ('bestellung_positionen',         ARRAY['warenwirtschaft'],                 'bestellungen', 'bestellung_id'),
      ('zukauf_posten',                 ARRAY['warenwirtschaft'],                 NULL, NULL),
      ('sonstige_artikel',              ARRAY['warenwirtschaft'],                 NULL, NULL),
      ('rabattgruppen',                 ARRAY['warenwirtschaft'],                 NULL, NULL),
      ('sumup_checkouts',               ARRAY['warenwirtschaft'],                 NULL, NULL),
      ('exportauftraege',               ARRAY['warenwirtschaft'],                 NULL, NULL),
      ('exportauftrag_positionen',      ARRAY['warenwirtschaft'],                 'exportauftraege', 'exportauftrag_id'),
      ('export_dokumente',              ARRAY['warenwirtschaft'],                 'exportauftraege', 'exportauftrag_id'),
      ('aktivitaeten',                  ARRAY['crm','warenwirtschaft'],           NULL, NULL),
      ('aktivitaet_dokumente',          ARRAY['crm','warenwirtschaft'],           NULL, NULL),
      ('kontakte',                      ARRAY['crm'],                             NULL, NULL),
      ('firmen',                        ARRAY['crm'],                             NULL, NULL),
      ('kontakt_firmen',                ARRAY['crm'],                             'kontakte', 'kontakt_id'),
      ('kontakt_praeferenzen',          ARRAY['crm'],                             'kontakte', 'kontakt_id'),
      ('pipeline_eintraege',            ARRAY['crm'],                             NULL, NULL),
      ('pipeline_verlauf',              ARRAY['crm'],                             'pipeline_eintraege', 'pipeline_id'),
      ('crm_dubletten_ignoriert',       ARRAY['crm'],                             NULL, NULL),
      ('email_lead_ignoriert',          ARRAY['crm'],                             NULL, NULL),
      ('ea_transaktionen',              ARRAY['ea'],                              NULL, NULL),
      ('ea_belege',                     ARRAY['ea'],                              NULL, NULL),
      ('ea_kategorien',                 ARRAY['ea'],                              NULL, NULL),
      ('ea_dauerauftraege',             ARRAY['ea'],                              NULL, NULL),
      ('ea_uva',                        ARRAY['ea'],                              NULL, NULL),
      ('ea_anlagen',                    ARRAY['ea'],                              NULL, NULL),
      ('ea_monatsabschluss',            ARRAY['ea'],                              NULL, NULL),
      ('buchhaltung_export_protokoll',  ARRAY['ea'],                              NULL, NULL),
      ('buchhaltung_kontenmapping',     ARRAY['ea'],                              NULL, NULL),
      ('konten',                        ARRAY['ea'],                              NULL, NULL),
      ('konto_umbuchungen',             ARRAY['ea'],                              NULL, NULL),
      ('kostenstellen',                 ARRAY['auswertungen','rieden','kellerbuch'], NULL, NULL),
      ('kostenarten',                   ARRAY['auswertungen','rieden','kellerbuch'], NULL, NULL),
      ('kosteneintraege',               ARRAY['auswertungen','rieden','kellerbuch'], NULL, NULL),
      ('kosteneintrag_behaelter',       ARRAY['auswertungen','rieden','kellerbuch'], 'kosteneintraege', 'kosteneintrag_id'),
      ('kosteneintrag_weingaerten',     ARRAY['auswertungen','rieden','kellerbuch'], 'kosteneintraege', 'kosteneintrag_id'),
      ('fristen',                       ARRAY['betrieb'],                         NULL, NULL),
      ('checklisten',                   ARRAY['betrieb'],                         NULL, NULL),
      ('checklisten_punkte',            ARRAY['betrieb'],                         NULL, NULL)
    ) AS t(tabelle, module, eltern, fk)
  LOOP
    IF to_regclass('public.' || r.tabelle) IS NULL THEN
      RAISE NOTICE 'Tabelle % fehlt – übersprungen', r.tabelle; CONTINUE;
    END IF;
    v_mods := (SELECT string_agg(quote_literal(x), ',') FROM unnest(r.module) x);
    IF r.eltern IS NULL THEN
      v_expr := format('s112_darf_schreiben(tenant_id, VARIADIC ARRAY[%s])', v_mods);
    ELSE
      v_expr := format('EXISTS (SELECT 1 FROM %I p WHERE p.id = %I.%I AND s112_darf_schreiben(p.tenant_id, VARIADIC ARRAY[%s]))', r.eltern, r.tabelle, r.fk, v_mods);
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS modul_insert ON %I', r.tabelle);
    EXECUTE format('DROP POLICY IF EXISTS modul_update ON %I', r.tabelle);
    EXECUTE format('DROP POLICY IF EXISTS modul_delete ON %I', r.tabelle);
    EXECUTE format('CREATE POLICY modul_insert ON %I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (%s)', r.tabelle, v_expr);
    EXECUTE format('CREATE POLICY modul_update ON %I AS RESTRICTIVE FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)', r.tabelle, v_expr, v_expr);
    EXECUTE format('CREATE POLICY modul_delete ON %I AS RESTRICTIVE FOR DELETE TO authenticated USING (%s)', r.tabelle, v_expr);
  END LOOP;
END $$;;
