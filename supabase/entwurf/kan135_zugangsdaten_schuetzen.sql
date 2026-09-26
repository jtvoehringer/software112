-- ════════════════════════════════════════════════════════════════════════════
-- KAN-135 – Zugangsdaten in tenant_einstellungen und user_email_connections schützen
-- ENTWURF – noch nicht in supabase/migrations/. Einspielen erst nach Jörgens „OK, einspielen“
-- per Supabase-MCP apply_migration (Name: kan135_zugangsdaten_schuetzen), danach Version aus
-- list_migrations übernehmen und Datei als supabase/migrations/<version>_kan135_zugangsdaten_schuetzen.sql
-- ablegen. VORHER muss der Code-Stand aus Branch claude/kan-135-zugangsdaten-schuetzen live sein
-- (liest/schreibt die Zugangsdaten nur noch per Service-Role).
--
-- Befund:
--   * tenant_einstellungen: Policy einst_select lässt jedes Mitglied (auch Leser) alle Spalten
--     lesen – inkl. m365_*_enc, email_*_pass_enc, brevo_api_key, sumup_api_key, bawb_passwort.
--   * user_email_connections: uec_all (FOR ALL, TO public, nur user_id = auth.uid(), kein
--     WITH CHECK auf tenant_id) – Token-/IMAP-Spalten frei schreibbar. Angriff: Chiffrat des
--     Betriebs (z. B. email_imap_pass_enc) in die eigene Zeile kopieren, imap_host auf einen
--     eigenen Server setzen → /api/nachrichten/list entschlüsselt und schickt das Passwort dorthin;
--     analog M365-Token des Betriebs über getValidUserAccessToken.
--
-- Lösung:
--   1. Spaltenrechte statt Tabellenrechte für anon/authenticated. Achtung: Ein Spalten-REVOKE
--      wirkt nicht, solange ein Tabellen-GRANT besteht – deshalb Tabellenrechte ganz entziehen
--      und nur die Nicht-Geheimnis-Spalten per Spalten-GRANT wieder erlauben. Die Spaltenliste
--      entsteht dynamisch aus information_schema (läuft auf Produktion und Staging, auch wenn
--      dort unterschiedliche Spalten existieren). Neue Spalten brauchen künftig einen
--      expliziten GRANT (siehe Hinweis in CLAUDE.md).
--   2. user_email_connections: Benutzer dürfen nur noch die eigene Zeile lesen (ohne Geheimnis-
--      Spalten) und löschen (Trennen). INSERT/UPDATE nur noch per Service-Role – alle Schreib-
--      pfade der App laufen serverseitig (OAuth-Callback, Token-Refresh, geteilte Mailbox,
--      Spiegel-Stand); eine IMAP-Einrichtung durch Benutzer gibt es in der App nicht. So bleibt
--      keine Spalte (imap_host, tenant_id, email_address …) übrig, über die sich eine Zeile
--      mit fremden Zugangsdaten kombinieren ließe.
--   3. Fremde Policies (mitgliedschaft_aktiv, abo_schreibsperre_*, zwei_faktor_aal) bleiben
--      unangetastet – gelöscht werden nur die uec_*-Namensvarianten (Produktion: uec_all,
--      Alt-Stand: uec_select/insert/update/delete).
--   Kein Umbau der Verschlüsselung (AAD) – siehe Folgeempfehlung im Ticket.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. tenant_einstellungen ──────────────────────────────────────────────────
REVOKE ALL ON TABLE public.tenant_einstellungen FROM anon, authenticated;

DO $$
DECLARE
  v_geheim  text[] := ARRAY[
    'm365_access_token_enc', 'm365_refresh_token_enc', 'm365_client_secret_enc',
    'email_imap_pass_enc', 'email_smtp_pass_enc',
    'brevo_api_key', 'sumup_api_key', 'bawb_passwort'
  ];
  v_lesen   text;
  v_aendern text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_lesen
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'tenant_einstellungen'
     AND column_name <> ALL (v_geheim);

  -- UPDATE ohne tenant_id (Zeile umhängen ist nie ein Benutzer-Fall). Welche Felder ein
  -- Benutzer tatsächlich ändern darf, entscheidet weiterhin der Trigger a_schutz_plattformfelder.
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_aendern
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'tenant_einstellungen'
     AND column_name <> ALL (v_geheim || ARRAY['tenant_id']);

  -- anon bekommt dieselben Lese-Spalten, damit anonyme Abfragen mit Spaltenliste weiterhin
  -- fehlerfrei 0 Zeilen liefern (Policies gelten nur TO authenticated); Schreiben gar nicht.
  EXECUTE format('GRANT SELECT (%s) ON public.tenant_einstellungen TO authenticated, anon', v_lesen);
  EXECUTE format('GRANT UPDATE (%s) ON public.tenant_einstellungen TO authenticated', v_aendern);
END $$;

-- ── 2. user_email_connections ────────────────────────────────────────────────
REVOKE ALL ON TABLE public.user_email_connections FROM anon, authenticated;

DO $$
DECLARE
  v_geheim text[] := ARRAY['m365_access_token_enc', 'm365_refresh_token_enc', 'imap_pass_enc', 'smtp_pass_enc'];
  v_lesen  text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_lesen
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'user_email_connections'
     AND column_name <> ALL (v_geheim);
  EXECUTE format('GRANT SELECT (%s) ON public.user_email_connections TO authenticated, anon', v_lesen);
END $$;

GRANT DELETE ON TABLE public.user_email_connections TO authenticated;

-- alle bekannten Namensvarianten (Produktion: uec_all; Alt-Stand: vier Einzel-Policies)
DROP POLICY IF EXISTS uec_all                ON public.user_email_connections;
DROP POLICY IF EXISTS uec_select             ON public.user_email_connections;
DROP POLICY IF EXISTS uec_insert             ON public.user_email_connections;
DROP POLICY IF EXISTS uec_update             ON public.user_email_connections;
DROP POLICY IF EXISTS uec_delete             ON public.user_email_connections;
DROP POLICY IF EXISTS uec_eigene_lesen       ON public.user_email_connections;
DROP POLICY IF EXISTS uec_eigene_loeschen    ON public.user_email_connections;

CREATE POLICY uec_eigene_lesen ON public.user_email_connections
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY uec_eigene_loeschen ON public.user_email_connections
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ── 3. Selbstprüfung (bricht die Migration ab, wenn etwas nicht greift) ──────
DO $$
DECLARE
  r record;
  v_fehler text := '';
BEGIN
  FOR r IN
    SELECT t.tab, c.col, g.rolle, p.recht
      FROM (VALUES
              ('tenant_einstellungen',   ARRAY['m365_access_token_enc','m365_refresh_token_enc','m365_client_secret_enc','email_imap_pass_enc','email_smtp_pass_enc','brevo_api_key','sumup_api_key','bawb_passwort']),
              ('user_email_connections', ARRAY['m365_access_token_enc','m365_refresh_token_enc','imap_pass_enc','smtp_pass_enc'])
           ) AS t(tab, cols)
     CROSS JOIN LATERAL unnest(t.cols) AS c(col)
     CROSS JOIN (VALUES ('anon'), ('authenticated')) AS g(rolle)
     CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE')) AS p(recht)
     WHERE EXISTS (SELECT 1 FROM information_schema.columns ic
                    WHERE ic.table_schema = 'public' AND ic.table_name = t.tab AND ic.column_name = c.col)
       AND has_column_privilege(g.rolle, format('public.%I', t.tab), c.col, p.recht)
  LOOP
    v_fehler := v_fehler || format('%s.%s %s %s; ', r.tab, r.col, r.rolle, r.recht);
  END LOOP;

  IF has_table_privilege('authenticated', 'public.user_email_connections', 'INSERT')
     OR has_table_privilege('authenticated', 'public.user_email_connections', 'UPDATE') THEN
    v_fehler := v_fehler || 'user_email_connections INSERT/UPDATE für authenticated; ';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'user_email_connections'
                AND permissive = 'PERMISSIVE' AND cmd IN ('INSERT', 'UPDATE', 'ALL')) THEN
    v_fehler := v_fehler || 'permissive Schreib-Policy auf user_email_connections; ';
  END IF;

  IF v_fehler <> '' THEN
    RAISE EXCEPTION 'KAN-135 Selbstprüfung fehlgeschlagen: %', v_fehler;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ── Rückbau (nur im Notfall, stellt den unsicheren Vorzustand wieder her) ────
-- REVOKE ALL ON TABLE public.tenant_einstellungen, public.user_email_connections FROM anon, authenticated;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_einstellungen TO anon, authenticated;
-- GRANT ALL ON public.user_email_connections TO anon, authenticated;
-- DROP POLICY IF EXISTS uec_eigene_lesen ON public.user_email_connections;
-- DROP POLICY IF EXISTS uec_eigene_loeschen ON public.user_email_connections;
-- CREATE POLICY uec_all ON public.user_email_connections FOR ALL TO public USING (user_id = (SELECT auth.uid()));
