-- KAN-159 B6 (01.10.2026): KI-Abfrage („Frag dein Weingut“) liest nur den aktiven Betrieb.
-- ki_readonly_query setzt app.active_tenant_id (transaktionslokal), aber nur get_user_tenant_ids() beachtete die
-- Einstellung. Policies mit s112_meine_tenants(), user_has_role_in_tenant() oder einer direkten Unterabfrage auf
-- tenant_memberships ließen alle eigenen Betriebe durch: Wer in zwei Betrieben Mitglied ist (Gebeshuber/Spaetrot),
-- bekam im Kontext von Betrieb A auch Kontakte usw. von Betrieb B (DB-Test 18, bekannte Lücke B6).
-- Lösung unabhängig von der jeweiligen Policy: RESTRICTIVE SELECT-Policy „ki_aktiver_betrieb“ auf jeder KI-Tabelle mit
-- tenant_id. Ohne gesetzte Einstellung (= jede normale Abfrage der App) ist sie wirkungslos; in der KI-Abfrage lässt
-- sie nur Zeilen des aktiven Betriebs (und globale Zeilen ohne tenant_id) durch. Kind-Tabellen ohne tenant_id
-- (kontakt_firmen, behandlung_grundstuecke, ernte_parzellen …) prüfen in ihren Policies die Elterntabelle – deren RLS
-- gilt in der Unterabfrage mit, die Einschränkung wirkt also auch dort.
-- Regel für künftige Tabellen in ki_erlaubte_tabellen() mit tenant_id: Policy ebenfalls anlegen (Prüfung in DB-Test 01).

DO $ki$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT t.tab
      FROM unnest(public.ki_erlaubte_tabellen()) AS t(tab)
     WHERE EXISTS (SELECT 1 FROM information_schema.columns c
                    WHERE c.table_schema = 'public' AND c.table_name = t.tab AND c.column_name = 'tenant_id')
     ORDER BY t.tab
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS ki_aktiver_betrieb ON public.%I', r.tab);
    EXECUTE format($p$
      CREATE POLICY ki_aktiver_betrieb ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated
      USING (
        (SELECT nullif(current_setting('app.active_tenant_id', true), '')) IS NULL
        OR tenant_id IS NULL
        OR tenant_id = (SELECT nullif(current_setting('app.active_tenant_id', true), '')::uuid)
      )$p$, r.tab);
    n := n + 1;
  END LOOP;
  IF n < 50 THEN
    RAISE EXCEPTION 'KAN-159 B6: nur % KI-Tabellen mit tenant_id gefunden – Abbruch', n;
  END IF;
END
$ki$;
