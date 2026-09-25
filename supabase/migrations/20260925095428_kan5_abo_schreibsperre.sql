-- ════════════════════════════════════════════════════════════════════════════════════════════
-- KAN-5 · Nur-Lesen-Modus bei gesperrtem Abo – DB-Ebene (Abo-Schreibsperre)
-- Stand 25.09.2026 (2. Stand nach Review), von Jörgen freigegeben und am 25.09.2026 eingespielt.
-- Einspielen per Supabase-MCP apply_migration, Name: kan5_abo_schreibsperre
-- danach Version aus list_migrations übernehmen → supabase/migrations/<version>_kan5_abo_schreibsperre.sql
-- und Security Advisor prüfen (Lint 0028/0029, search_path).
--
-- REIHENFOLGE (Review-Befund „hoch“): Diese Migration gehört ins SELBE Release wie die App-Schicht
-- (Branch claude/kan-5-abo-nurlesen) und wird VOR dem App-Deploy (spätestens gleichzeitig)
-- eingespielt. Ohne sie wirkt die Sperre nur in der Next-Schicht – jeder Benutzer eines gesperrten
-- Betriebs könnte mit seinem eigenen Sitzungs-Token direkt über PostgREST, die RPCs oder Storage
-- schreiben. KAN-5 erst nach dem Einspielen schließen. Die Migration ist auch ohne neue App
-- rückwärtsverträglich (die alte App leitet gesperrte Betriebe ohnehin auf /abo um).
-- ════════════════════════════════════════════════════════════════════════════════════════════
--
-- ZWECK
--   Ein Betrieb mit gesperrtem Abo darf alles ANSEHEN, DRUCKEN und EXPORTIEREN (SELECT bleibt
--   unberührt), aber nichts SPEICHERN. Diese Migration ist die zweite Verteidigungslinie hinter der
--   App-Schicht (Server Actions, /api-Routen, Hinweisleiste im (dashboard)-Layout): sie greift auch
--   bei direkten PostgREST-Zugriffen mit dem Benutzer-JWT – Tabellen, schreibende RPCs und Storage –
--   und bei Browser-Schreibzugriffen (z. B. kellerbuch/behaelter/[id]/behandlungen/page.tsx schreibt
--   keller_behandlungen/-typen direkt aus dem Client).
--
-- REGEL (identisch mit aboStandBerechnen() in src/lib/abo/regeln.ts)
--   gesperrt, wenn stripe_status (nicht leer) in ABO_GESPERRTE_STATUS
--     ('unpaid','canceled','cancelled','incomplete','incomplete_expired','paused')
--   oder istTrialAbgelaufen: stripe_status = 'trialing' und stripe_trial_ends_at < jetzt.
--   stripe_status NULL/'' → nie gesperrt; 'past_due' → nur Warnung (nicht gesperrt).
--   Die Statusliste steht zweimal (TS + hier) – Änderungen immer an BEIDEN Stellen.
--
-- AUSNAHMEN (gleich wie in der App)
--   · Mitgliedschaften mit role = 'system_admin' – je Betrieb (App: aboStandBerechnen)
--   · Plattform-Admins (plattform_admins) – für alle Betriebe. Deckt sich heute mit der App-Regel:
--     der Trigger tenants_plattform_admins gibt jedem Plattform-Admin in jedem Betrieb system_admin.
--   · Sandbox  fa22dc07-eca5-43df-af96-f7b9b09f0471 (feste ID wie SANDBOX_TENANT_ID; stripe_status
--     ist dort heute 'incomplete' → ohne diese Ausnahme wäre die Sandbox gesperrt!)
--   · Demo     33333333-3333-4333-8333-333333333333 („Weingut Musterhof (Demo)“, DEMO_TENANT_ID)
--
-- WIRKUNG
--   · Neue Funktionen: s112_abo_gesperrt(uuid)            [intern, nur postgres/service_role]
--                      s112_schreibgesperrte_tenants()    [für RLS, authenticated]
--                      s112_pruefe_abo_schreibsperre(uuid) [intern, von den RPCs aufgerufen]
--   · RESTRICTIVE Policies abo_schreibsperre_ins/_upd/_del (TO authenticated) auf
--       77 Tabellen mit tenant_id  (alle 80 mit 'mitgliedschaft_aktiv' außer 3 Ausnahmen)
--     + 17 Kindtabellen ohne tenant_id (Prüfung über die Elternzeile, wie die modul_*-Policies)
--     + tenants (nur UPDATE: bio_status durch tenant_admin)
--     = 283 Policies in public
--     + storage.objects (INSERT/UPDATE/DELETE, erster Ordner = gesperrter Betrieb) = 3 Policies.
--   · 12 schreibende SECURITY-DEFINER-RPCs rufen direkt nach ihrer Zugriffsprüfung
--     s112_pruefe_abo_schreibsperre(p_tenant_id) auf → RAISE 42501, HINT 'abo_gesperrt'.
--   · check_und_increment_ki_abfrage: RAISE 42501 (HINT 'abo_gesperrt') bei gesperrtem Abo – auch
--     im Service-Kontext (Morgenbericht über den Admin-Client).
--   Service-Role und postgres haben BYPASSRLS – Webhooks, Crons und Admin-Client sind von den
--   Policies NICHT betroffen (siehe Lücken); die RPC-Sperre greift nur mit Benutzer-JWT.
--
-- VERHALTEN FÜR DIE APP (wichtig für Fehlermeldungen)
--   · INSERT / Upsert in gesperrten Betrieb → Fehler 42501 „new row violates row-level security…“
--   · UPDATE / DELETE auf Zeilen des gesperrten Betriebs → KEIN Fehler, sondern 0 Zeilen (USING
--     filtert still). Die App-Schicht sperrt deshalb VOR dem Schreiben mit klarer Meldung
--     (lib/auth/sperren.ts); die DB verhindert nur, dass trotzdem etwas geändert wird.
--   · RPCs und check_und_increment_ki_abfrage → Fehler 42501, hint = 'abo_gesperrt', Meldung wie
--     SCHREIBSPERRE_MELDUNG der App (der Browser-Hinweis erkennt sie). Beide Aufrufer der KI-RPC
--     werten den Fehler seit dem Review aus (fail-closed): api/ki-abfrage/route.ts → 403 mit
--     KI-Meldung bzw. 503, lib/morgenbericht/ki.ts → grund 'gesperrt' bzw. 'fehler'.
--
-- BEWUSST AUSGENOMMENE TABELLEN (v_ausnahmen in Abschnitt 3a; decken sich mit den App-Ausnahmen)
--   · tenant_memberships: Anlegen/Ändern per API dürfen ohnehin nur Plattform-Admins (ausgenommen);
--     betroffen wäre nur das ENTFERNEN (removeMember). Ein gesperrter Betrieb muss ehemaligen
--     Mitarbeitern weiterhin den Zugang entziehen können (Sicherheit/DSGVO) – und ein still
--     wirkungsloses DELETE (0 Zeilen) wäre hier gefährlich.
--   · user_email_connections: persönliche Postfach-Zugangsdaten, keine Betriebsdaten. Lesen der
--     Nachrichten erneuert das M365-Token per User-Client (src/lib/m365/graph.ts:154); „Postfach
--     trennen“ (api/nachrichten/disconnect) löscht per User-Client – mit Sperre bliebe das Token
--     still gespeichert (Datenschutz).
--   · benachrichtigungen: je Empfänger (Policies benachr_*: empfaenger_id = auth.uid(), kein
--     Benutzer-INSERT) – „als gelesen markieren“ ist reiner Lesestatus, die App gibt
--     /api/benachrichtigungen im Nur-Lesen-Modus ausdrücklich frei. Ohne Ausnahme träfe das UPDATE
--     still 0 Zeilen und die Glocke bliebe ungelesen.
--   Soll eine davon doch gesperrt werden: aus v_ausnahmen streichen und die erwarteten Zahlen in den
--   NOTICE-Texten von 3a und 5 anpassen (je Tabelle +3 Policies).
--
-- LÜCKEN (DB-Ebene greift nicht – App-Schicht sperrt zusätzlich bzw. gewollt)
--   1. increment_ki_tokens bleibt ungesperrt: bucht Tokens einer bereits bezahlten
--      Anthropic-Antwort nach; eine Sperre würde nur die Kostenerfassung verfälschen (Abo-Wechsel
--      zwischen den beiden Aufrufen). Alle anderen schreibenden SECURITY-DEFINER-RPCs mit
--      EXECUTE für authenticated sind gesperrt (Abschnitt 4b; Anhang A2 listet sie).
--   2. Service-Role-Pfade (BYPASSRLS): Stripe-/SumUp-/M365-Webhooks, Vercel-Crons
--      (/api/cron/taeglich: process_ea_dauerauftraege bucht Daueraufträge in ea_transaktionen;
--      laufMorgenberichte überspringt gesperrte Betriebe; /api/m365/subscribe), Admin-Client-
--      Schreibzugriffe in Server Actions (/abo, signup, newsletter, BMD-Markierung – im
--      Nur-Lesen-Modus unterlassen). Das ist gewollt (Stripe-Webhook muss die Sperre wieder
--      aufheben können); ob Daueraufträge für gesperrte Betriebe weiterlaufen, entscheidet die
--      App-Schicht (offener Punkt).
--   3. Kein Schutz nötig (keine Benutzer-Schreibpolicies bzw. nicht betriebsbezogen):
--      profiles, release_notes_gesehen (eigene Zeile), rebsorten, release_notes, plattform_admins
--      (nur Plattform-Admins), keller_freigaben, svs_parameter, system_ereignisse (RLS an, keine
--      Schreib-Policy für authenticated). Storage-Bucket mandant-logos: nur Plattform-Admins.
--   4. Zeitversatz: Die App liest den Abo-Stand aus einem 60-s-Cache (lib/tenant/kopf.ts), den der
--      Stripe-Webhook sofort ablaufen lässt ({ expire: 0 }); vor jeder Ablehnung lädt sie ungecacht
--      nach. Die DB-Sperre wirkt ohnehin sofort.
--   5. Neue Tabellen: wer künftig eine betriebsbezogene Tabelle mit 'mitgliedschaft_aktiv' anlegt,
--      muss auch die drei abo_schreibsperre-Policies anlegen (Abschnitt 3a erneut ausführen) –
--      Kindtabellen ohne tenant_id zusätzlich in Abschnitt 3b eintragen; neue schreibende
--      SECURITY-DEFINER-RPCs rufen s112_pruefe_abo_schreibsperre(p_tenant_id) selbst auf.
--
-- WIRKUNGSANALYSE (SELECT, 25.09.2026, Anhang A)
--   Heute gesperrt: KEIN Mandant, 0 betroffene Mitgliedschaften.
--     Sandbox                      stripe_status 'incomplete' → roh gesperrt, aber feste Ausnahme
--                                  (sonst 2 Mitgliedschaften betroffen)
--     Weingut Johannes Gebeshuber  stripe_status NULL → offen
--     Spaetrot Gebeshuber GmbH     stripe_status NULL → offen
--     Weingut Musterhof (Demo)     stripe_status NULL → offen (+ feste Ausnahme)
--   Plattform-Admins: 1; system_admin-Mitgliedschaften: 4 (eine je Betrieb, Trigger
--   tenants_plattform_admins).
--   Demo-Reset: demo_musterhof_zuruecksetzen()/demo_musterhof_y2_kette() sind SECURITY DEFINER
--   (Owner postgres), für authenticated nicht ausführbar, laufen im SQL-Editor als postgres
--   (BYPASSRLS, kein JWT → s112_schreibgesperrte_tenants() leer) → nicht betroffen; Demo zusätzlich
--   fest ausgenommen.
--   pg_cron ist nicht installiert (cron.job existiert nicht) – alle Crons laufen über Vercel.
--   Storage: 5 Buckets mit Betriebsordner (aktivitaet-dokumente, analysen, dokumente, ea-belege,
--   etiketten) – alle Benutzer-Policies prüfen (storage.foldername(name))[1] gegen die eigenen
--   Betriebe; die Abo-Sperre nutzt denselben ersten Ordner.
-- ════════════════════════════════════════════════════════════════════════════════════════════

-- Nicht ewig auf Tabellensperren warten (CREATE POLICY braucht ACCESS EXCLUSIVE auf ~100 Tabellen):
-- lieber sauber abbrechen und später erneut einspielen, als laufende App-Abfragen zu blockieren.
SET LOCAL lock_timeout = '5s';


-- ── 1. Mandantenregel (intern) ───────────────────────────────────────────────────────────────
-- Reine Mandantenregel ohne Benutzer-Ausnahmen. SECURITY INVOKER und nur für postgres/service_role
-- ausführbar: Aufrufer sind die SECURITY-DEFINER-Funktionen unten (laufen als postgres) und der
-- Service-Kontext. Deshalb kein pruefe_tenant_zugriff (authenticated kann sie gar nicht aufrufen –
-- sonst ließe sich der Abo-Stand fremder Betriebe abfragen).
CREATE OR REPLACE FUNCTION public.s112_abo_gesperrt(p_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT p_tenant NOT IN ('fa22dc07-eca5-43df-af96-f7b9b09f0471'::uuid,   -- Sandbox (KAN-10: feste ID)
                            '33333333-3333-4333-8333-333333333333'::uuid)   -- Demo „Weingut Musterhof“
       AND NULLIF(t.stripe_status, '') IS NOT NULL
       AND (
             -- Muss mit ABO_GESPERRTE_STATUS in src/lib/abo/regeln.ts übereinstimmen.
             t.stripe_status = ANY (ARRAY['unpaid', 'canceled', 'cancelled', 'incomplete', 'incomplete_expired', 'paused'])
             -- istTrialAbgelaufen(): Testphase abgelaufen
          OR (t.stripe_status = 'trialing' AND t.stripe_trial_ends_at IS NOT NULL AND t.stripe_trial_ends_at < now())
           )
      FROM tenants t
     WHERE t.id = p_tenant
  ), false)
$$;

REVOKE EXECUTE ON FUNCTION public.s112_abo_gesperrt(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.s112_abo_gesperrt(uuid) TO service_role;

COMMENT ON FUNCTION public.s112_abo_gesperrt(uuid) IS
  'KAN-5: true, wenn das Abo des Betriebs gesperrt ist (Regel wie aboStandBerechnen() in src/lib/abo/regeln.ts; Sandbox und Demo fest ausgenommen). Intern – nur postgres/service_role.';


-- ── 2. Schreibgesperrte Betriebe des angemeldeten Benutzers (für RLS) ─────────────────────────
-- Gegenstück zu s112_gesperrte_tenants() (deaktivierte Mitgliedschaften, sperrt auch Lesen):
-- liefert die Betriebe der AKTIVEN Mitgliedschaften von auth.uid(), deren Abo gesperrt ist –
-- ausgenommen Plattform-Admins und Mitgliedschaften mit role system_admin.
-- Ohne JWT (Service-Role, SQL-Editor) ist auth.uid() NULL → leere Menge.
CREATE OR REPLACE FUNCTION public.s112_schreibgesperrte_tenants()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.tenant_id
    FROM tenant_memberships m
   WHERE m.user_id = (SELECT auth.uid())
     AND m.aktiv
     AND m.role <> 'system_admin'
     AND NOT EXISTS (SELECT 1 FROM plattform_admins p WHERE p.user_id = m.user_id)
     AND public.s112_abo_gesperrt(m.tenant_id)
$$;

REVOKE EXECUTE ON FUNCTION public.s112_schreibgesperrte_tenants() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.s112_schreibgesperrte_tenants() TO authenticated, service_role;

COMMENT ON FUNCTION public.s112_schreibgesperrte_tenants() IS
  'KAN-5 Nur-Lesen-Modus: Betriebe des angemeldeten Benutzers mit gesperrtem Abo (ohne Plattform-Admins/system_admin). Grundlage der RESTRICTIVE Policies abo_schreibsperre_ins/_upd/_del.';


-- ── 3a. Policies auf allen Tabellen mit 'mitgliedschaft_aktiv' und tenant_id ─────────────────
-- Stand 25.09.2026: 80 Tabellen mit 'mitgliedschaft_aktiv', alle mit tenant_id (5 davon nullable:
-- bestandsprotokoll, duengemittel, ea_kategorien, pflanzenschutzmittel, saetze_massnahmen – dort
-- sind tenant_id-NULL-Zeilen globale Stammdaten, die per Permissive-Policy ohnehin kein Benutzer
-- schreiben darf; NULL wird daher durchgelassen statt durch NOT IN versehentlich NULL zu ergeben).
DO $abo$
DECLARE
  -- Bewusst ausgenommen – Begründung im Kopf („BEWUSST AUSGENOMMENE TABELLEN“).
  v_ausnahmen constant text[] := ARRAY['tenant_memberships', 'user_email_connections', 'benachrichtigungen'];
  v_ohne_tenant text;
  v_unvollstaendig text;
  v_bed    text;
  v_anzahl int := 0;
  r        record;
BEGIN
  -- Vorbedingung: jede Tabelle mit 'mitgliedschaft_aktiv' hat tenant_id (sonst erst prüfen)
  SELECT string_agg(DISTINCT p.tablename::text, ', ') INTO v_ohne_tenant
    FROM pg_policies p
   WHERE p.schemaname = 'public' AND p.policyname = 'mitgliedschaft_aktiv'
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns c
                      WHERE c.table_schema = 'public' AND c.table_name = p.tablename AND c.column_name = 'tenant_id');
  IF v_ohne_tenant IS NOT NULL THEN
    RAISE EXCEPTION 'KAN-5: Tabellen mit mitgliedschaft_aktiv ohne tenant_id – bitte zuerst prüfen: %', v_ohne_tenant;
  END IF;

  FOR r IN
    SELECT DISTINCT p.tablename::text AS tablename, c.is_nullable::text AS is_nullable
      FROM pg_policies p
      JOIN information_schema.columns c
        ON c.table_schema = 'public' AND c.table_name = p.tablename AND c.column_name = 'tenant_id'
     WHERE p.schemaname = 'public' AND p.policyname = 'mitgliedschaft_aktiv'
     ORDER BY 1
  LOOP
    -- idempotent; bei Ausnahmen werden Policies eines früheren Laufs entfernt
    EXECUTE format('DROP POLICY IF EXISTS abo_schreibsperre_ins ON public.%I', r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS abo_schreibsperre_upd ON public.%I', r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS abo_schreibsperre_del ON public.%I', r.tablename);
    CONTINUE WHEN r.tablename = ANY (v_ausnahmen);

    v_bed := CASE WHEN r.is_nullable = 'YES'
                  THEN '(tenant_id IS NULL OR tenant_id NOT IN (SELECT public.s112_schreibgesperrte_tenants()))'
                  ELSE '(tenant_id NOT IN (SELECT public.s112_schreibgesperrte_tenants()))'
             END;

    EXECUTE format('CREATE POLICY abo_schreibsperre_ins ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK %s',
                   r.tablename, v_bed);
    EXECUTE format('CREATE POLICY abo_schreibsperre_upd ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING %s WITH CHECK %s',
                   r.tablename, v_bed, v_bed);
    EXECUTE format('CREATE POLICY abo_schreibsperre_del ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING %s',
                   r.tablename, v_bed);
    v_anzahl := v_anzahl + 1;
  END LOOP;

  -- Selbstprüfung: jede nicht ausgenommene Tabelle hat genau die drei RESTRICTIVE Policies
  SELECT string_agg(t.tablename::text, ', ') INTO v_unvollstaendig
    FROM (SELECT DISTINCT tablename FROM pg_policies
           WHERE schemaname = 'public' AND policyname = 'mitgliedschaft_aktiv'
             AND tablename::text <> ALL (v_ausnahmen)) t
   WHERE (SELECT count(*) FROM pg_policies p
           WHERE p.schemaname = 'public' AND p.tablename = t.tablename AND p.permissive = 'RESTRICTIVE'
             AND p.policyname IN ('abo_schreibsperre_ins', 'abo_schreibsperre_upd', 'abo_schreibsperre_del')) <> 3;
  IF v_unvollstaendig IS NOT NULL THEN
    RAISE EXCEPTION 'KAN-5: Abo-Schreibsperre unvollständig auf: %', v_unvollstaendig;
  END IF;

  RAISE NOTICE 'KAN-5: Abo-Schreibsperre auf % Tabellen mit tenant_id (erwartet 77; ausgenommen: %)',
    v_anzahl, array_to_string(v_ausnahmen, ', ');
END
$abo$;


-- ── 3b. Kindtabellen ohne tenant_id: Prüfung über die Elternzeile ────────────────────────────
-- Zuordnung wie in den vorhandenen RESTRICTIVE modul_insert/_update/_delete-Policies (dort
-- verifiziert: FK vorhanden, Elterntabelle mit tenant_id + mitgliedschaft_aktiv).
-- NOT EXISTS statt EXISTS: gesperrt wird nur, wenn die Elternzeile sichtbar zu einem
-- schreibgesperrten Betrieb gehört – alles andere entscheiden die bestehenden Policies wie bisher.
-- (Lesen bleibt erlaubt, die Elternzeile ist für den Benutzer also sichtbar.)
DO $abo_kind$
DECLARE
  v_bed text;
  r     record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('ama_meldepositionen',       'meldung_id',       'ama_erntemeldungen'),
      ('assistent_aktionen',        'unterhaltung_id',  'assistent_unterhaltungen'),
      ('assistent_nachrichten',     'unterhaltung_id',  'assistent_unterhaltungen'),
      ('behandlung_grundstuecke',   'behandlung_id',    'behandlungen'),
      ('bestellung_positionen',     'bestellung_id',    'bestellungen'),
      ('ernte_parzellen',           'jahrgang_id',      'weinjahrgaenge'),
      ('export_dokumente',          'exportauftrag_id', 'exportauftraege'),
      ('exportauftrag_positionen',  'exportauftrag_id', 'exportauftraege'),
      ('kontakt_firmen',            'kontakt_id',       'kontakte'),
      ('kontakt_praeferenzen',      'kontakt_id',       'kontakte'),
      ('kosteneintrag_behaelter',   'kosteneintrag_id', 'kosteneintraege'),
      ('kosteneintrag_weingaerten', 'kosteneintrag_id', 'kosteneintraege'),
      ('pipeline_verlauf',          'pipeline_id',      'pipeline_eintraege'),
      ('pressung_behaelter',        'pressung_id',      'pressungen'),
      ('pressung_weingaerten',      'pressung_id',      'pressungen'),
      ('verschneidung_quellen',     'verschneidung_id', 'verschneidungen'),
      ('weingarten_rebsorten',      'weingarten_id',    'weingarten')
    ) AS k(kind, fk, eltern)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = r.kind AND column_name = r.fk)
       OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = r.eltern AND column_name = 'tenant_id') THEN
      RAISE EXCEPTION 'KAN-5: Zuordnung %.% → %.tenant_id passt nicht (mehr) zum Schema', r.kind, r.fk, r.eltern;
    END IF;

    v_bed := format('(NOT EXISTS (SELECT 1 FROM public.%1$I p WHERE p.id = %2$I.%3$I AND p.tenant_id IN (SELECT public.s112_schreibgesperrte_tenants())))',
                    r.eltern, r.kind, r.fk);

    EXECUTE format('DROP POLICY IF EXISTS abo_schreibsperre_ins ON public.%I', r.kind);
    EXECUTE format('DROP POLICY IF EXISTS abo_schreibsperre_upd ON public.%I', r.kind);
    EXECUTE format('DROP POLICY IF EXISTS abo_schreibsperre_del ON public.%I', r.kind);
    EXECUTE format('CREATE POLICY abo_schreibsperre_ins ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK %s',
                   r.kind, v_bed);
    EXECUTE format('CREATE POLICY abo_schreibsperre_upd ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING %s WITH CHECK %s',
                   r.kind, v_bed, v_bed);
    EXECUTE format('CREATE POLICY abo_schreibsperre_del ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING %s',
                   r.kind, v_bed);
  END LOOP;
  RAISE NOTICE 'KAN-5: Abo-Schreibsperre auf 17 Kindtabellen (über die Elternzeile)';
END
$abo_kind$;


-- ── 3c. tenants: nur UPDATE (bio_status durch tenant_admin, betrieb/einstellungen) ──────────
-- INSERT dürfen nur Plattform-Admins (ausgenommen), DELETE hat keine Benutzer-Policy.
-- /abo, Signup und Stripe-Webhook schreiben tenants per Service-Role → nicht betroffen.
DROP POLICY IF EXISTS abo_schreibsperre_upd ON public.tenants;
CREATE POLICY abo_schreibsperre_upd ON public.tenants
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING      (id NOT IN (SELECT public.s112_schreibgesperrte_tenants()))
  WITH CHECK (id NOT IN (SELECT public.s112_schreibgesperrte_tenants()));

-- ── 3d. Storage: Hochladen, Ersetzen, Löschen in Ordnern gesperrter Betriebe ────────────────
-- Alle Benutzer-Buckets legen Dateien unter <tenant_id>/… ab (aktivitaet-dokumente, analysen,
-- dokumente, ea-belege, etiketten – ihre Policies prüfen (storage.foldername(name))[1]). Eine
-- RESTRICTIVE Policy ohne Bucket-Filter deckt auch künftige Buckets mit demselben Schema ab;
-- Dateien ohne Ordner bzw. mit anderem erstem Ordner entscheiden die bestehenden Policies wie
-- bisher (mandant-logos: nur Plattform-Admins, die ohnehin ausgenommen sind).
-- Textvergleich statt ::uuid – ein Ordnername, der keine UUID ist, darf keinen Fehler auslösen.
DROP POLICY IF EXISTS abo_schreibsperre_ins ON storage.objects;
DROP POLICY IF EXISTS abo_schreibsperre_upd ON storage.objects;
DROP POLICY IF EXISTS abo_schreibsperre_del ON storage.objects;

CREATE POLICY abo_schreibsperre_ins ON storage.objects
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((storage.foldername(name))[1] IS NULL
              OR (storage.foldername(name))[1] NOT IN (SELECT g::text FROM public.s112_schreibgesperrte_tenants() AS g));

CREATE POLICY abo_schreibsperre_upd ON storage.objects
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING      ((storage.foldername(name))[1] IS NULL
              OR (storage.foldername(name))[1] NOT IN (SELECT g::text FROM public.s112_schreibgesperrte_tenants() AS g))
  WITH CHECK ((storage.foldername(name))[1] IS NULL
              OR (storage.foldername(name))[1] NOT IN (SELECT g::text FROM public.s112_schreibgesperrte_tenants() AS g));

CREATE POLICY abo_schreibsperre_del ON storage.objects
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING      ((storage.foldername(name))[1] IS NULL
              OR (storage.foldername(name))[1] NOT IN (SELECT g::text FROM public.s112_schreibgesperrte_tenants() AS g));


-- ── 4. KI-Kontingent: keine Abfrage bei gesperrtem Abo (Kosten) ──────────────────────────────
-- Vollständiger Nachbau von pg_get_functiondef (Stand 25.09.2026), einzige Änderung: der mit
-- „KAN-5“ markierte IF-Block nach pruefe_tenant_zugriff (erst Zugriff prüfen, damit Nicht-Mitglieder
-- nichts über den Abo-Stand fremder Betriebe erfahren). CREATE OR REPLACE behält Owner und Rechte
-- (heute: postgres, authenticated, service_role – kein PUBLIC/anon).
-- Benutzerkontext (ki-abfrage): dieselbe Regel samt Ausnahmen wie die RLS-Sperre.
-- Service-Kontext (Morgenbericht über den Admin-Client, Cron und „Jetzt aktualisieren“): nur die
-- Mandantenregel – es gibt keinen Benutzer, dessen Ausnahme gelten könnte.
CREATE OR REPLACE FUNCTION public.check_und_increment_ki_abfrage(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Muss mit kiLimit in src/lib/pakete.ts übereinstimmen.
  limit_map jsonb := '{"basic":50,"standard":100,"unlimited":9999999}'::jsonb;
  rec record;
BEGIN
  PERFORM public.pruefe_tenant_zugriff(p_tenant_id);

  -- KAN-5 Nur-Lesen-Modus: gesperrtes Abo → keine KI-Abfrage (HINT für die App: 'abo_gesperrt')
  IF (public.ist_service_kontext() AND public.s112_abo_gesperrt(p_tenant_id))
     OR p_tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()) THEN
    RAISE EXCEPTION 'Das Abo dieses Betriebs ist gesperrt (Nur-Lesen-Modus) – KI-Abfragen sind erst nach Klärung unter /abo wieder möglich.'
      USING ERRCODE = '42501', HINT = 'abo_gesperrt';
  END IF;

  SELECT ki_abfragen_aktiv, ki_abfragen_paket, ki_abfragen_zaehler, ki_abfragen_reset_datum
  INTO rec FROM tenant_einstellungen WHERE tenant_id = p_tenant_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('erlaubt', false, 'fehler', 'Mandant nicht gefunden');
  END IF;

  IF NOT COALESCE(rec.ki_abfragen_aktiv, false) THEN
    RETURN jsonb_build_object(
      'erlaubt', false,
      'verbraucht', COALESCE(rec.ki_abfragen_zaehler, 0),
      'limit', 0,
      'paket', COALESCE(rec.ki_abfragen_paket, 'basic'),
      'fehler', 'Frag dein Weingut ist in Ihrem Paket nicht enthalten.'
    );
  END IF;

  IF rec.ki_abfragen_reset_datum IS NULL OR rec.ki_abfragen_reset_datum < date_trunc('month', current_date) THEN
    UPDATE tenant_einstellungen
    SET ki_abfragen_zaehler = 0, ki_abfragen_reset_datum = current_date
    WHERE tenant_id = p_tenant_id;
    rec.ki_abfragen_zaehler := 0;
  END IF;

  IF COALESCE(rec.ki_abfragen_zaehler, 0) >= COALESCE((limit_map->>rec.ki_abfragen_paket)::int, 50) THEN
    RETURN jsonb_build_object(
      'erlaubt', false,
      'verbraucht', COALESCE(rec.ki_abfragen_zaehler, 0),
      'limit', COALESCE((limit_map->>rec.ki_abfragen_paket)::int, 50),
      'paket', rec.ki_abfragen_paket
    );
  END IF;

  UPDATE tenant_einstellungen
  SET ki_abfragen_zaehler = COALESCE(ki_abfragen_zaehler, 0) + 1
  WHERE tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'erlaubt', true,
    'verbraucht', COALESCE(rec.ki_abfragen_zaehler, 0) + 1,
    'limit', COALESCE((limit_map->>rec.ki_abfragen_paket)::int, 50),
    'paket', rec.ki_abfragen_paket
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.check_und_increment_ki_abfrage(uuid) FROM PUBLIC, anon;

-- increment_ki_tokens(uuid,int,int): bewusst unverändert (siehe Kopf, Lücke 1).

-- ── 4b. Schreibende SECURITY-DEFINER-RPCs: Abo-Sperre direkt nach der Zugriffsprüfung ────────
-- Diese Funktionen laufen als postgres (BYPASSRLS) – die Policies aus Abschnitt 3 greifen dort
-- nicht. Ohne diesen Abschnitt könnte ein Benutzer eines gesperrten Betriebs per
-- POST /rest/v1/rpc/<name> weiter Kontakte zusammenführen, Monate sperren, Bestände buchen oder
-- Nummernkreise hochzählen.
--
-- Hilfsfunktion: SECURITY INVOKER, nur für postgres/service_role ausführbar – Aufrufer sind die
-- SECURITY-DEFINER-RPCs (laufen als postgres). Ohne JWT (Service-Role, Cron, SQL-Editor) ist
-- s112_schreibgesperrte_tenants() leer → keine Sperre (wie bei den Policies).
CREATE OR REPLACE FUNCTION public.s112_pruefe_abo_schreibsperre(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF p_tenant_id IN (SELECT public.s112_schreibgesperrte_tenants()) THEN
    -- Text wie SCHREIBSPERRE_MELDUNG in src/lib/abo/regeln.ts (der Browser-Hinweis erkennt ihn)
    RAISE EXCEPTION 'Das Abo dieses Betriebs ist gesperrt – Änderungen sind im Nur-Lesen-Modus nicht möglich. Bitte unter „Abo“ klären.'
      USING ERRCODE = '42501', HINT = 'abo_gesperrt';
  END IF;
END
$$;

REVOKE EXECUTE ON FUNCTION public.s112_pruefe_abo_schreibsperre(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.s112_pruefe_abo_schreibsperre(uuid) TO service_role;

COMMENT ON FUNCTION public.s112_pruefe_abo_schreibsperre(uuid) IS
  'KAN-5 Nur-Lesen-Modus: RAISE 42501 (HINT abo_gesperrt), wenn p_tenant_id für den angemeldeten Benutzer abo-gesperrt ist. Aufruf in jeder schreibenden SECURITY-DEFINER-RPC direkt nach der Zugriffsprüfung.';

-- Einbau in die bestehenden RPCs: statt 12 Funktionsrümpfe abzuschreiben (die sich seither ändern
-- können), wird die AKTUELLE Definition (pg_get_functiondef) um genau eine Zeile ergänzt – direkt
-- nach der ersten Zugriffsprüfung (erst prüfen, ob der Benutzer überhaupt Mitglied ist, damit
-- Fremde nichts über den Abo-Stand erfahren). CREATE OR REPLACE behält Owner, Rechte und alle
-- übrigen Attribute. Idempotent: schon ergänzte Funktionen werden übersprungen. Fehlt die
-- Einbaustelle, bricht die Migration ab (Funktion hat sich geändert → bitte prüfen).
-- Rückbau: Anhang B.
DO $abo_rpc$
DECLARE
  c_zeile   constant text := E'\n  PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);   -- KAN-5 Nur-Lesen-Modus';
  c_zugriff constant text := '(PERFORM\s+(public\.)?pruefe_tenant_zugriff\s*\([^;]*\);)';
  c_darf    constant text := '(IF NOT v_darf THEN RAISE EXCEPTION ''Keine Berechtigung''; END IF;)';
  v_def  text;
  v_neu  text;
  v_n    int := 0;
  v_fehlt text;
  r      record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- Fachdaten
      ('public.kontakte_zusammenfuehren(uuid,uuid,uuid[])',                          c_darf),
      ('public.fuellung_bestand_buchen(uuid,uuid,text,date,integer,integer,text)',   c_zugriff),
      ('public.schwund_buchen(uuid,uuid,numeric,date,text,boolean,boolean)',          c_zugriff),
      ('public.sperre_ea_uva(uuid,smallint,text)',                                    c_zugriff),
      ('public.sperre_ea_monat(uuid,smallint,smallint)',                              c_zugriff),
      ('public.setze_kontobewegung_abgeglichen(uuid,text,uuid,boolean)',              c_zugriff),
      -- Nummernkreise (schreiben tenant_einstellungen/transaktionszaehler)
      ('public.get_next_rechnungsnummer(uuid)',                                       c_zugriff),
      ('public.get_next_chargennummer(uuid)',                                         c_zugriff),
      ('public.get_next_transaktionsnr(uuid,text)',                                   c_zugriff),
      ('public.get_next_liefernummer(uuid)',                                          c_zugriff),
      ('public.get_next_accountnummer(uuid)',                                         c_zugriff),
      ('public.get_next_personenkonto(uuid,text,integer)',                            c_zugriff)
    ) AS f(sig, anker)
  LOOP
    v_def := pg_get_functiondef(r.sig::regprocedure);
    CONTINUE WHEN position('s112_pruefe_abo_schreibsperre' IN v_def) > 0;   -- schon ergänzt
    v_neu := regexp_replace(v_def, r.anker, '\1' || c_zeile);             -- nur der erste Treffer
    IF v_neu = v_def THEN
      RAISE EXCEPTION 'KAN-5: Einbaustelle in % nicht gefunden – Funktion hat sich geändert, bitte prüfen', r.sig;
    END IF;
    EXECUTE v_neu;
    v_n := v_n + 1;
  END LOOP;

  -- Selbstprüfung: jede schreibende SECURITY-DEFINER-Funktion mit EXECUTE für authenticated und
  -- p_tenant_id ruft die Sperre auf – außer den bewusst ausgenommenen (Kopf, Lücke 1)
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_fehlt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND p.prosrc ~* '\m(insert\s+into|update\s+\w|delete\s+from)'
     AND p.proname NOT IN ('increment_ki_tokens', 'check_und_increment_ki_abfrage')
     AND position('s112_pruefe_abo_schreibsperre' IN p.prosrc) = 0;
  IF v_fehlt IS NOT NULL THEN
    RAISE EXCEPTION 'KAN-5: schreibende RPCs ohne Abo-Sperre: %', v_fehlt;
  END IF;

  RAISE NOTICE 'KAN-5: Abo-Sperre in % RPCs eingebaut (erwartet 12 beim ersten Einspielen, 0 bei Wiederholung)', v_n;
END
$abo_rpc$;


-- ── 5. Selbstprüfung Rechte / Stand ──────────────────────────────────────────────────────────
DO $pruefung$
DECLARE
  v_n int;
  v_s int;
BEGIN
  IF has_function_privilege('anon', 'public.s112_schreibgesperrte_tenants()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.s112_schreibgesperrte_tenants()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.s112_abo_gesperrt(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.s112_abo_gesperrt(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.s112_pruefe_abo_schreibsperre(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.s112_pruefe_abo_schreibsperre(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.check_und_increment_ki_abfrage(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.check_und_increment_ki_abfrage(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.kontakte_zusammenfuehren(uuid,uuid,uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.kontakte_zusammenfuehren(uuid,uuid,uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'KAN-5: Funktionsrechte nicht wie erwartet';
  END IF;

  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'public' AND policyname LIKE 'abo\_schreibsperre\_%' AND permissive = 'RESTRICTIVE';
  SELECT count(*) INTO v_s FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'abo\_schreibsperre\_%' AND permissive = 'RESTRICTIVE';
  IF v_s <> 3 THEN
    RAISE EXCEPTION 'KAN-5: Storage-Policies unvollständig (% statt 3)', v_s;
  END IF;
  RAISE NOTICE 'KAN-5: % abo_schreibsperre-Policies in public (erwartet 283 = 77×3 + 17×3 + 1), % in storage (erwartet 3)', v_n, v_s;

  SELECT count(*) INTO v_n FROM tenants t WHERE public.s112_abo_gesperrt(t.id);
  RAISE NOTICE 'KAN-5: aktuell abo-gesperrte Betriebe: % (Stand 25.09.2026 erwartet: 0)', v_n;
END
$pruefung$;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- ANHANG A – Wirkungsanalyse (nur SELECT; vor dem Einspielen erneut ausführen)
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- A1: Welche Betriebe wären heute gesperrt? (Regel inline, funktioniert auch VOR der Migration)
--   WITH regel AS (
--     SELECT t.id, t.name, t.stripe_status, t.stripe_trial_ends_at,
--       (NULLIF(t.stripe_status,'') IS NOT NULL
--         AND (t.stripe_status = ANY (ARRAY['unpaid','canceled','cancelled','incomplete','incomplete_expired','paused'])
--              OR (t.stripe_status = 'trialing' AND t.stripe_trial_ends_at IS NOT NULL AND t.stripe_trial_ends_at < now()))) AS roh_gesperrt,
--       t.id IN ('fa22dc07-eca5-43df-af96-f7b9b09f0471'::uuid, '33333333-3333-4333-8333-333333333333'::uuid) AS feste_ausnahme
--     FROM tenants t)
--   SELECT r.name, r.stripe_status, r.stripe_trial_ends_at, r.roh_gesperrt, r.feste_ausnahme,
--          r.roh_gesperrt AND NOT r.feste_ausnahme AS abo_gesperrt,
--          (SELECT count(*) FROM tenant_memberships m
--            WHERE m.tenant_id = r.id AND m.aktiv AND m.role <> 'system_admin'
--              AND NOT EXISTS (SELECT 1 FROM plattform_admins p WHERE p.user_id = m.user_id)
--              AND r.roh_gesperrt AND NOT r.feste_ausnahme) AS betroffene_mitgliedschaften
--   FROM regel r ORDER BY r.name;
--   Ergebnis 25.09.2026: 0 gesperrt (Sandbox 'incomplete' nur durch feste Ausnahme offen).
--
-- A2: SECURITY-DEFINER-Funktionen, die authenticated ausführen darf und die schreiben (umgehen RLS)
--   SELECT p.oid::regprocedure, position('s112_pruefe_abo_schreibsperre' IN p.prosrc) > 0 AS gesperrt
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.prosecdef
--      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
--      AND p.prosrc ~* '\m(insert\s+into|update\s+\w|delete\s+from)';
--   Ergebnis 25.09.2026 (vor dem Einspielen): 14 – nach dem Einspielen 12 mit gesperrt = true,
--   dazu check_und_increment_ki_abfrage (eigene Prüfung, Abschnitt 4) und increment_ki_tokens (Lücke 1).
--
-- A3: Tabellen mit mitgliedschaft_aktiv ohne abo_schreibsperre (nach dem Einspielen: nur die 3 Ausnahmen)
--   SELECT DISTINCT p.tablename FROM pg_policies p
--    WHERE p.schemaname = 'public' AND p.policyname = 'mitgliedschaft_aktiv'
--      AND NOT EXISTS (SELECT 1 FROM pg_policies q WHERE q.schemaname = 'public'
--                        AND q.tablename = p.tablename AND q.policyname = 'abo_schreibsperre_ins');
--
-- A4: Benutzer-Tabellen mit RLS ohne tenant_id (Kindtabellen/Plattformtabellen)
--   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
--      AND NOT EXISTS (SELECT 1 FROM information_schema.columns ic
--                       WHERE ic.table_schema = 'public' AND ic.table_name = c.relname AND ic.column_name = 'tenant_id');
--
-- A5: Storage – Dateien je Bucket, deren erster Ordner ein Betrieb ist
--   SELECT b.id, count(o.*) AS dateien,
--          count(o.*) FILTER (WHERE EXISTS (SELECT 1 FROM tenants t WHERE t.id::text = (storage.foldername(o.name))[1])) AS im_betriebsordner
--     FROM storage.buckets b LEFT JOIN storage.objects o ON o.bucket_id = b.id GROUP BY b.id ORDER BY b.id;


-- ════════════════════════════════════════════════════════════════════════════════════════════
-- ANHANG B – Rückbau (nur im Notfall; Reihenfolge: Policies → RPCs → Funktionen)
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- DO $rueck$ DECLARE r record; v_def text; BEGIN
--   FOR r IN SELECT DISTINCT tablename FROM pg_policies
--             WHERE schemaname = 'public' AND policyname LIKE 'abo\_schreibsperre\_%' LOOP
--     EXECUTE format('DROP POLICY IF EXISTS abo_schreibsperre_ins ON public.%I', r.tablename);
--     EXECUTE format('DROP POLICY IF EXISTS abo_schreibsperre_upd ON public.%I', r.tablename);
--     EXECUTE format('DROP POLICY IF EXISTS abo_schreibsperre_del ON public.%I', r.tablename);
--   END LOOP;
--   DROP POLICY IF EXISTS abo_schreibsperre_ins ON storage.objects;
--   DROP POLICY IF EXISTS abo_schreibsperre_upd ON storage.objects;
--   DROP POLICY IF EXISTS abo_schreibsperre_del ON storage.objects;
--   -- RPCs: die eingefügte Zeile wieder entfernen
--   FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--             WHERE n.nspname = 'public' AND position('s112_pruefe_abo_schreibsperre(p_tenant_id)' IN p.prosrc) > 0 LOOP
--     v_def := regexp_replace(pg_get_functiondef(r.oid), E'\\n  PERFORM public\\.s112_pruefe_abo_schreibsperre\\(p_tenant_id\\);   -- KAN-5 Nur-Lesen-Modus', '');
--     EXECUTE v_def;
--   END LOOP;
-- END $rueck$;
-- -- check_und_increment_ki_abfrage: Abschnitt 4 OHNE den „KAN-5“-IF-Block erneut ausführen
-- -- (= Original laut pg_get_functiondef vom 25.09.2026), danach:
-- DROP FUNCTION IF EXISTS public.s112_pruefe_abo_schreibsperre(uuid);
-- DROP FUNCTION IF EXISTS public.s112_schreibgesperrte_tenants();
-- DROP FUNCTION IF EXISTS public.s112_abo_gesperrt(uuid);


-- ════════════════════════════════════════════════════════════════════════════════════════════
-- ANHANG C – Test (erst NACH dem Einspielen ausführen; rollt am Ende per RAISE EXCEPTION alles
-- zurück – das Testergebnis steht in der Fehlermeldung „KAN5-Testergebnis …“).
-- Die Sandbox eignet sich nicht (feste Ausnahme), daher ein Fake-Betrieb im selben Block.
-- Testkonto: erstes Konto, das KEIN Plattform-Admin ist (bekommt im Fake-Betrieb tenant_admin).
-- Jede Zeile beginnt mit OK oder FEHLER.
-- ════════════════════════════════════════════════════════════════════════════════════════════
/*
DO $test$
DECLARE
  v_user    uuid;
  v_tenant  uuid := gen_random_uuid();
  v_kontakt uuid;
  v_neu     uuid;
  v_claims  text;
  v_n       int;
  v_b       boolean;
  v_t       text;
  v_msg     text;
  v_hint    text;
  v_erg     text[] := ARRAY[]::text[];
BEGIN
  SELECT u.id INTO v_user FROM auth.users u
   WHERE NOT EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = u.id)
   ORDER BY u.created_at LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'KAN5-Test: kein Konto ohne Plattform-Admin-Recht gefunden'; END IF;
  v_claims := json_build_object('sub', v_user, 'role', 'authenticated')::text;

  -- Fixtures als postgres (BYPASSRLS): Fake-Betrieb mit gekündigtem Abo, Mitgliedschaft, ein Kontakt,
  -- eine ungelesene Benachrichtigung
  INSERT INTO public.tenants (id, name, slug, stripe_status)
       VALUES (v_tenant, 'KAN-5 Testbetrieb', 'kan5-test-' || left(v_tenant::text, 8), 'canceled');
  INSERT INTO public.tenant_memberships (tenant_id, user_id, role, aktiv) VALUES (v_tenant, v_user, 'tenant_admin', true);
  INSERT INTO public.kontakte (tenant_id, nachname) VALUES (v_tenant, 'KAN5-Bestand') RETURNING id INTO v_kontakt;
  INSERT INTO public.benachrichtigungen (tenant_id, empfaenger_id, art, titel) VALUES (v_tenant, v_user, 'system', 'KAN5');

  -- ── Phase A: Abo 'canceled' → lesen ja, schreiben nein ──
  BEGIN
    PERFORM set_config('request.jwt.claims', v_claims, true);
    SET LOCAL ROLE authenticated;

    SELECT count(*) INTO v_n FROM public.kontakte WHERE tenant_id = v_tenant;
    v_erg := v_erg || format('%s A1 Lesen kontakte: %s Zeile(n), erwartet 1', CASE WHEN v_n = 1 THEN 'OK    ' ELSE 'FEHLER' END, v_n);

    SELECT count(*) INTO v_n FROM public.s112_schreibgesperrte_tenants() AS g(id) WHERE g.id = v_tenant;
    v_erg := v_erg || format('%s A2 s112_schreibgesperrte_tenants enthält Testbetrieb: %s, erwartet 1', CASE WHEN v_n = 1 THEN 'OK    ' ELSE 'FEHLER' END, v_n);

    BEGIN
      INSERT INTO public.kontakte (tenant_id, nachname) VALUES (v_tenant, 'KAN5-neu');
      v_erg := v_erg || text 'FEHLER A3 INSERT kontakte ging durch';
    EXCEPTION WHEN insufficient_privilege THEN
      v_erg := v_erg || text 'OK     A3 INSERT kontakte abgelehnt (42501)';
    END;

    UPDATE public.kontakte SET nachname = 'KAN5-geaendert' WHERE id = v_kontakt;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_erg := v_erg || format('%s A4 UPDATE kontakte: %s Zeile(n), erwartet 0 (still gefiltert)', CASE WHEN v_n = 0 THEN 'OK    ' ELSE 'FEHLER' END, v_n);

    DELETE FROM public.kontakte WHERE id = v_kontakt;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_erg := v_erg || format('%s A5 DELETE kontakte: %s Zeile(n), erwartet 0', CASE WHEN v_n = 0 THEN 'OK    ' ELSE 'FEHLER' END, v_n);

    BEGIN
      INSERT INTO public.kontakt_praeferenzen (kontakt_id, notizen) VALUES (v_kontakt, 'KAN5');
      v_erg := v_erg || text 'FEHLER A6 INSERT Kindtabelle kontakt_praeferenzen ging durch';
    EXCEPTION WHEN insufficient_privilege THEN
      v_erg := v_erg || text 'OK     A6 INSERT Kindtabelle kontakt_praeferenzen abgelehnt (42501)';
    END;

    UPDATE public.tenants SET bio_status = bio_status WHERE id = v_tenant;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_erg := v_erg || format('%s A7 UPDATE tenants (bio_status): %s Zeile(n), erwartet 0', CASE WHEN v_n = 0 THEN 'OK    ' ELSE 'FEHLER' END, v_n);

    BEGIN
      PERFORM public.check_und_increment_ki_abfrage(v_tenant);
      v_erg := v_erg || text 'FEHLER A8 KI-Abfrage ging durch';
    EXCEPTION WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_hint = PG_EXCEPTION_HINT;
      v_erg := v_erg || format('%s A8 KI-Abfrage abgelehnt: hint=%s', CASE WHEN v_hint = 'abo_gesperrt' THEN 'OK    ' ELSE 'FEHLER' END, v_hint);
    END;

    BEGIN
      PERFORM public.get_next_accountnummer(v_tenant);
      v_erg := v_erg || text 'FEHLER A9 RPC get_next_accountnummer ging durch';
    EXCEPTION WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
      v_erg := v_erg || format('%s A9 RPC get_next_accountnummer abgelehnt: hint=%s', CASE WHEN v_hint = 'abo_gesperrt' THEN 'OK    ' ELSE 'FEHLER' END, v_hint);
    END;

    BEGIN
      PERFORM public.kontakte_zusammenfuehren(v_tenant, v_kontakt, ARRAY[gen_random_uuid()]);
      v_erg := v_erg || text 'FEHLER A10 RPC kontakte_zusammenfuehren ging durch';
    EXCEPTION WHEN insufficient_privilege THEN
      GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
      v_erg := v_erg || format('%s A10 RPC kontakte_zusammenfuehren abgelehnt: hint=%s', CASE WHEN v_hint = 'abo_gesperrt' THEN 'OK    ' ELSE 'FEHLER' END, v_hint);
    END;

    BEGIN
      INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('dokumente', v_tenant::text || '/kan5-test.txt', v_user);
      v_erg := v_erg || text 'FEHLER A11 Storage-Upload in den Betriebsordner ging durch';
    EXCEPTION WHEN insufficient_privilege THEN
      v_erg := v_erg || text 'OK     A11 Storage-Upload in den Betriebsordner abgelehnt (42501)';
    END;

    UPDATE public.benachrichtigungen SET gelesen_am = now() WHERE tenant_id = v_tenant AND empfaenger_id = v_user;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_erg := v_erg || format('%s A12 Benachrichtigung als gelesen (Ausnahme): %s Zeile(n), erwartet 1', CASE WHEN v_n = 1 THEN 'OK    ' ELSE 'FEHLER' END, v_n);

    RAISE EXCEPTION 'KAN5_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'KAN5_ROLLBACK' THEN v_erg := v_erg || ('FEHLER Phase A abgebrochen: ' || SQLERRM); END IF;
  END;

  -- ── Phase B: Kontrolle mit aktivem Abo → dieselben Schreibzugriffe gehen durch ──
  UPDATE public.tenants SET stripe_status = 'active' WHERE id = v_tenant;
  BEGIN
    PERFORM set_config('request.jwt.claims', v_claims, true);
    SET LOCAL ROLE authenticated;

    INSERT INTO public.kontakte (tenant_id, nachname) VALUES (v_tenant, 'KAN5-neu') RETURNING id INTO v_neu;
    v_erg := v_erg || text 'OK     B1 INSERT kontakte bei aktivem Abo';
    UPDATE public.kontakte SET nachname = 'KAN5-geaendert' WHERE id = v_kontakt;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_erg := v_erg || format('%s B2 UPDATE kontakte: %s Zeile(n), erwartet 1', CASE WHEN v_n = 1 THEN 'OK    ' ELSE 'FEHLER' END, v_n);
    INSERT INTO public.kontakt_praeferenzen (kontakt_id, notizen) VALUES (v_kontakt, 'KAN5');
    v_erg := v_erg || text 'OK     B3 INSERT kontakt_praeferenzen bei aktivem Abo';
    DELETE FROM public.kontakte WHERE id = v_neu;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_erg := v_erg || format('%s B4 DELETE kontakte: %s Zeile(n), erwartet 1', CASE WHEN v_n = 1 THEN 'OK    ' ELSE 'FEHLER' END, v_n);
    UPDATE public.tenants SET bio_status = bio_status WHERE id = v_tenant;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_erg := v_erg || format('%s B5 UPDATE tenants (bio_status): %s Zeile(n), erwartet 1', CASE WHEN v_n = 1 THEN 'OK    ' ELSE 'FEHLER' END, v_n);
    -- ohne tenant_einstellungen-Zeile antwortet die Funktion mit erlaubt=false/„Mandant nicht gefunden“ – aber OHNE Abo-Fehler
    PERFORM public.check_und_increment_ki_abfrage(v_tenant);
    v_erg := v_erg || text 'OK     B6 KI-Abfrage ohne Abo-Fehler';
    -- ohne tenant_einstellungen-Zeile liefert get_next_accountnummer NULL – aber OHNE Abo-Fehler
    SELECT public.get_next_accountnummer(v_tenant) INTO v_t;
    v_erg := v_erg || format('OK     B7 RPC get_next_accountnummer ohne Abo-Fehler (Ergebnis %s)', COALESCE(v_t, 'NULL'));
    BEGIN
      INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('dokumente', v_tenant::text || '/kan5-test.txt', v_user);
      v_erg := v_erg || text 'OK     B8 Storage-Upload in den Betriebsordner bei aktivem Abo';
    EXCEPTION WHEN insufficient_privilege THEN
      v_erg := v_erg || text 'FEHLER B8 Storage-Upload bei aktivem Abo abgelehnt (Rechte des Testkontos im Bucket dokumente prüfen)';
    END;

    RAISE EXCEPTION 'KAN5_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'KAN5_ROLLBACK' THEN v_erg := v_erg || ('FEHLER Phase B abgebrochen: ' || SQLERRM); END IF;
  END;

  -- ── Phase C: Mandantenregel direkt (als postgres) ──
  UPDATE public.tenants SET stripe_status = 'trialing', stripe_trial_ends_at = now() - interval '1 day' WHERE id = v_tenant;
  v_b := public.s112_abo_gesperrt(v_tenant);
  v_erg := v_erg || format('%s C1 trialing, Testphase abgelaufen → gesperrt=%s', CASE WHEN v_b THEN 'OK    ' ELSE 'FEHLER' END, v_b);
  UPDATE public.tenants SET stripe_trial_ends_at = now() + interval '1 day' WHERE id = v_tenant;
  v_b := public.s112_abo_gesperrt(v_tenant);
  v_erg := v_erg || format('%s C2 trialing, Testphase läuft → gesperrt=%s', CASE WHEN NOT v_b THEN 'OK    ' ELSE 'FEHLER' END, v_b);
  UPDATE public.tenants SET stripe_trial_ends_at = NULL WHERE id = v_tenant;
  v_b := public.s112_abo_gesperrt(v_tenant);
  v_erg := v_erg || format('%s C3 trialing ohne Ende → gesperrt=%s', CASE WHEN NOT v_b THEN 'OK    ' ELSE 'FEHLER' END, v_b);
  UPDATE public.tenants SET stripe_status = 'past_due' WHERE id = v_tenant;
  v_b := public.s112_abo_gesperrt(v_tenant);
  v_erg := v_erg || format('%s C4 past_due (nur Warnung) → gesperrt=%s', CASE WHEN NOT v_b THEN 'OK    ' ELSE 'FEHLER' END, v_b);
  UPDATE public.tenants SET stripe_status = NULL WHERE id = v_tenant;
  v_b := public.s112_abo_gesperrt(v_tenant);
  v_erg := v_erg || format('%s C5 ohne Status (NULL; '' verbietet tenants_stripe_status_check) → gesperrt=%s', CASE WHEN NOT v_b THEN 'OK    ' ELSE 'FEHLER' END, v_b);
  UPDATE public.tenants SET stripe_status = 'cancelled' WHERE id = v_tenant;
  v_b := public.s112_abo_gesperrt(v_tenant);
  v_erg := v_erg || format('%s C6 cancelled (britisch) → gesperrt=%s', CASE WHEN v_b THEN 'OK    ' ELSE 'FEHLER' END, v_b);
  v_b := public.s112_abo_gesperrt('fa22dc07-eca5-43df-af96-f7b9b09f0471');
  v_erg := v_erg || format('%s C7 Sandbox (Status incomplete) → gesperrt=%s', CASE WHEN NOT v_b THEN 'OK    ' ELSE 'FEHLER' END, v_b);
  v_b := public.s112_abo_gesperrt('33333333-3333-4333-8333-333333333333');
  v_erg := v_erg || format('%s C8 Demo → gesperrt=%s', CASE WHEN NOT v_b THEN 'OK    ' ELSE 'FEHLER' END, v_b);
  v_b := public.s112_abo_gesperrt(gen_random_uuid());
  v_erg := v_erg || format('%s C9 unbekannte ID → gesperrt=%s', CASE WHEN NOT v_b THEN 'OK    ' ELSE 'FEHLER' END, v_b);

  -- ── Phase D: Ausnahme role system_admin (Abo wieder 'canceled') ──
  UPDATE public.tenants SET stripe_status = 'canceled', stripe_trial_ends_at = NULL WHERE id = v_tenant;
  BEGIN
    UPDATE public.tenant_memberships SET role = 'system_admin' WHERE tenant_id = v_tenant AND user_id = v_user;
    PERFORM set_config('request.jwt.claims', v_claims, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO v_n FROM public.s112_schreibgesperrte_tenants() AS g(id) WHERE g.id = v_tenant;
    v_erg := v_erg || format('%s D1 system_admin nicht in schreibgesperrten Betrieben: %s, erwartet 0', CASE WHEN v_n = 0 THEN 'OK    ' ELSE 'FEHLER' END, v_n);
    INSERT INTO public.kontakte (tenant_id, nachname) VALUES (v_tenant, 'KAN5-sysadmin');
    v_erg := v_erg || text 'OK     D2 system_admin darf trotz gesperrtem Abo schreiben';
    SELECT public.get_next_accountnummer(v_tenant) INTO v_t;
    v_erg := v_erg || text 'OK     D3 system_admin: RPC ohne Abo-Fehler';
    RAISE EXCEPTION 'KAN5_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'KAN5_ROLLBACK' THEN v_erg := v_erg || ('FEHLER Phase D abgebrochen: ' || SQLERRM); END IF;
  END;

  -- ── Phase E: Service-Kontext (kein JWT, wie Morgenbericht über den Admin-Client) ──
  BEGIN
    PERFORM public.check_und_increment_ki_abfrage(v_tenant);
    v_erg := v_erg || text 'FEHLER E1 KI-Abfrage im Service-Kontext ging trotz gesperrtem Abo durch';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
    v_erg := v_erg || format('%s E1 KI-Abfrage im Service-Kontext abgelehnt: hint=%s', CASE WHEN v_hint = 'abo_gesperrt' THEN 'OK    ' ELSE 'FEHLER' END, v_hint);
  END;
  BEGIN
    SELECT public.get_next_accountnummer(v_tenant) INTO v_t;
    v_erg := v_erg || text 'OK     E2 RPC im Service-Kontext (Cron/Admin-Client) nicht gesperrt';
  EXCEPTION WHEN insufficient_privilege THEN
    v_erg := v_erg || text 'FEHLER E2 RPC im Service-Kontext gesperrt';
  END;

  RAISE EXCEPTION 'KAN5-Testergebnis (alles zurückgerollt):%', E'\n' || array_to_string(v_erg, E'\n');
END
$test$;
*/
