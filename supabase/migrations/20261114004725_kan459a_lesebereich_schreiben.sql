-- KAN-459 (14.11.2026): Wer einen Bereich nicht liest, schreibt dort auch nicht.
--
-- Befund: Die Sperr-Policy „lesebereich“ (KAN-454) galt nur für SELECT. Ein Mitglied mit Profil hat aber Schreibmodule,
-- die in Tabellen außerhalb seiner Lesebereiche reichen – „Extern“ (Modul Rieden) in 25 Tabellen (grundstueck_recht,
-- Pflanzenschutz-, Dünge- und Betriebsmittel samt Lager, Lese, Pressungen, Kostenstellen …), „Vertrieb“ in zwei. Dort
-- konnte es über die Datenschnittstelle anlegen und – ohne Filter, also ohne eine Spalte zu lesen – ändern und löschen.
--
-- Jetzt gilt jede Policy „lesebereich“ für alle Befehle: derselbe Ausdruck als USING (lesen, ändern, löschen) und als
-- WITH CHECK (anlegen, neuer Stand beim Ändern). Für Mitglieder ohne Profil ist die Sperrliste leer – es ändert sich
-- nichts. Der Ausdruck wird je Tabelle unverändert aus der bestehenden Policy übernommen (auch Kindtabellen über die
-- Elternzeile, Freigaben, storage.objects je Bucket).

DO $$
DECLARE
  r       record;
  v_n     integer := 0;
  v_rest  integer;
BEGIN
  FOR r IN
    SELECT p.schemaname, p.tablename, p.qual, obj_description(pol.oid, 'pg_policy') AS kommentar
      FROM pg_policies p
      JOIN pg_class c ON c.relname = p.tablename AND c.relnamespace = p.schemaname::regnamespace
      JOIN pg_policy pol ON pol.polrelid = c.oid AND pol.polname = p.policyname
     WHERE p.policyname = 'lesebereich' AND p.schemaname IN ('public', 'storage')
     ORDER BY p.schemaname, p.tablename
  LOOP
    EXECUTE format('DROP POLICY lesebereich ON %I.%I', r.schemaname, r.tablename);
    EXECUTE format('CREATE POLICY lesebereich ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',
                   r.schemaname, r.tablename, r.qual, r.qual);
    EXECUTE format('COMMENT ON POLICY lesebereich ON %I.%I IS %L', r.schemaname, r.tablename,
                   coalesce(r.kommentar, 'Lesebereich je Profil') || ' · KAN-459: gilt für alle Befehle (auch Anlegen, Ändern, Löschen)');
    v_n := v_n + 1;
  END LOOP;

  -- Selbstprüfung: 126 Tabellen in public und storage.objects; jede Policy RESTRICTIVE FOR ALL nur für authenticated,
  -- WITH CHECK = USING
  IF v_n <> 127 THEN RAISE EXCEPTION 'KAN-459: % Policies umgestellt (erwartet 127)', v_n; END IF;
  SELECT count(*) INTO v_rest FROM pg_policies p
   WHERE p.policyname = 'lesebereich' AND p.schemaname IN ('public', 'storage')
     AND NOT (p.cmd = 'ALL' AND p.permissive = 'RESTRICTIVE' AND p.roles = '{authenticated}'::name[] AND p.qual IS NOT NULL AND p.with_check IS NOT DISTINCT FROM p.qual);
  IF v_rest > 0 THEN RAISE EXCEPTION 'KAN-459: % Policies nicht wie erwartet', v_rest; END IF;
END $$;
