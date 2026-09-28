# software:112 – Projektkontext für Claude

## Über den Auftraggeber

- ** Hohenstein Consulting OG

## Über den Auftragnehmer

- **Name:** Jörgen Vöhringer (IC&P Consultants e.U.)
- **Anrede:** Du (wir sind per Du)
- **E-Mail:** jv@icp-consultants.at
- Wenn der vollständige Name verwendet werden muss/soll: **Jörgen Vöhringer**

## Projekt

**software:112** – Digitales Weingut-Für Winzer in Österreich

- **Tenant-ID Sandbox:** `fa22dc07-eca5-43df-af96-f7b9b09f0471` · Tenant-Name in DB: **„Sandbox"**
- **Weitere Tenants (Stand 24.09.2026):** „Weingut Johannes Gebeshuber" `097f67ed-381e-4bb3-952e-758aa9d3a501` (**Produktivbetrieb**, seit 14.08.2026) · „Spaetrot Gebeshuber GmbH" `0569d025-576d-4d47-a102-17173835dc5d` (seit 16.09.2026) · „Weingut Musterhof (Demo)" `33333333-3333-4333-8333-333333333333` (Demo-Betrieb, seit 27.08.2026)
- **Produktions-URL:** https://software112.icp-consultants.at
- **GitHub:** https://github.com/jtvoehringer/software112
- **Supabase Projekt:** zwcsgnemijkpyxrqykul.supabase.co (Region: West EU Ireland)

## Tech Stack

- **Framework:** Next.js 16 (App Router, TypeScript, Tailwind CSS)
- **Datenbank:** Supabase (PostgreSQL + RLS + Auth)
- **Hosting:** Vercel (migriert von Netlify, Mai 2026)
- **Auth:** Supabase SSR mit `@supabase/ssr`

## Konventionen

- TypeScript: `(supabase.from('table') as any)` um `never`-Type-Fehler zu vermeiden
- Alle Server Components mit `export const dynamic = 'force-dynamic'` wenn nötig
- CSS-Klassen: `s112-teal`, `s112-muted`, `s112-border`, `s112-bg` (siehe tailwind.config.ts)
- Rollenmodell: `leser` / `winzer` / `tenant_admin`
- **DB-Funktionen (seit Migration 182, 27.8.2026):** jede neue Funktion in `public` endet mit `REVOKE EXECUTE ON FUNCTION <fn> FROM PUBLIC, anon;` (Postgres gibt PUBLIC sonst automatisch EXECUTE; Trigger-/Cron-Funktionen zusätzlich `FROM authenticated`), bekommt `SET search_path = public` und – wenn sie eine `p_tenant_id` entgegennimmt – als erste Zeile `PERFORM public.pruefe_tenant_zugriff(p_tenant_id, ARRAY['system_admin','tenant_admin','winzer']);` (Rollen je nach Zweck, `NULL` = jedes Mitglied). Service-Role/SQL-Editor passieren die Prüfung automatisch. Nach jeder Migration: Supabase Security Advisor prüfen (Lint 0028/0029, search_path).
- **RLS-Policies (seit 24.09.2026):** jede neue Policy auf Mandantendaten mit `TO authenticated` anlegen – ohne `TO` gilt sie für `PUBLIC`, also auch für `anon`, und anonyme Abfragen scheitern dann mit 42501 an den für `anon` gesperrten Hilfsfunktionen (`s112_meine_tenants`, `user_has_role_in_tenant` …). Seit `20260924174006_s112_tenant_funktionen_ohne_anon` und `20260924175611_policies_nur_authenticated` bekommt `anon` auf allen Tabellen fehlerfrei 0 Zeilen; bewusst `to public` sind nur noch `rebsorten` (öffentlich lesbar), `profiles`, `release_notes_gesehen` und `svs_parameter` (dort über `auth.uid()` abgesichert; `user_email_connections` seit KAN-135 `TO authenticated`). Prüfabfrage: `pg_policies` im Schema `public` mit `roles = '{public}'` – darf nur diese 6 Policies liefern.
- **Zugangsdaten/Geheimnis-Spalten (seit KAN-135):** `tenant_einstellungen` (`m365_access_token_enc`, `m365_refresh_token_enc`, `m365_client_secret_enc`, `email_imap_pass_enc`, `email_smtp_pass_enc`, `brevo_api_key`, `sumup_api_key`, `bawb_passwort`) und `user_email_connections` (`m365_access_token_enc`, `m365_refresh_token_enc`, `imap_pass_enc`, `smtp_pass_enc`) liest und schreibt die App nur per Service-Role – nach der Berechtigungsprüfung und immer mit `.eq('tenant_id', membership.tenantId)` bzw. zusätzlich `.eq('user_id', user.id)` (User aus `getUser()`). `getValidUserAccessToken(…, admin, …)` bekommt den Admin-Client. `user_email_connections` dürfen Benutzer nur lesen (ohne Geheimnis-Spalten) und löschen, alle Schreibpfade laufen serverseitig. An den Browser gehen Geheimnisse nie – nur `geheimMaskiert()` (Maske = „hinterlegt“); beim Speichern `geheimFeld('<spalte>', formData.get(…))` verwenden (Maske = unverändert), nie `geheimSpeichern(…) ?? null`. Beide Tabellen haben für `anon`/`authenticated` nur **Spaltenrechte**: `select('*')` bzw. `.select()` im User-Client endet mit 42501, und eine **neue Spalte** ist für Benutzer erst nach einem expliziten `GRANT SELECT (<spalte>) … TO authenticated, anon` (bei `tenant_einstellungen` ggf. auch `GRANT UPDATE (<spalte>) … TO authenticated`) sichtbar – in derselben Migration mitliefern; ein neues Geheimnis bekommt keinen GRANT und kommt in die Liste oben und in die Selbstprüfung der KAN-135-Migration. Prüfabfrage: `has_column_privilege('authenticated', 'public.tenant_einstellungen', '<spalte>', 'SELECT')` muss für alle Geheimnis-Spalten `false` liefern.
- **API-Routen und Zwei-Faktor (seit 24.09.2026, KAN-54):** Der Proxy-Matcher schließt `/api` aus – jeder Handler unter `src/app/api` beginnt mit `const zweiFaktor = await pruefeZweiFaktor(); if (zweiFaktor) return zweiFaktor` (`src/lib/api/zweiFaktor.ts`; 401 `{ fehler }`, wenn ein Faktor eingerichtet, aber die Sitzung nur aal1 ist, oder die Pflicht gilt und noch kein Faktor da ist). Cron-Routen mit Sitzungszweig prüfen nur in diesem Zweig. Handler ohne Benutzersitzung (Webhook mit Signatur, Cron nur mit Secret, OAuth-Rückkehr, CSP-Bericht) bekommen direkt darüber `// zwei-faktor-ausnahme: <Grund>`. `scripts/check-api-zwei-faktor.js` (prebuild, CI; `--liste` zeigt alle Handler samt Ausnahmen) lässt den Build sonst scheitern. Ob ein Faktor eingerichtet ist, nie aus `aal.nextLevel` lesen (stammt aus dem unsignierten Sitzungs-Cookie), sondern `hatBestaetigtenFaktor(user)` mit dem User aus `getUser()`.
- **Zwei-Faktor in der Datenbank (KAN-136, Entwurf `supabase/entwurf/kan136_zwei_faktor_datenbank.sql`, Staging seit 26.09.2026):** `public.s112_aal_ok()` ist false, wenn der Benutzer einen bestätigten Faktor hat, das JWT aber nur `aal1` trägt. Jede Tabelle in `public` mit RLS und `storage.objects` hat die RESTRICTIVE Policy `zwei_faktor_aal` (`TO authenticated`, `USING/WITH CHECK ((SELECT public.s112_aal_ok()))`) – neue Tabellen bekommen sie ebenfalls (Prüfabfrage im Entwurf, muss leer sein). `pruefe_tenant_zugriff` prüft die Stufe mit; der PostgREST-Pre-Request `public.s112_pre_request()` (`pgrst.db_pre_request` an der Rolle `authenticator`) lehnt Data-API-Aufrufe solcher Sitzungen mit HTTP 401 ab. Notfall-Schalter: `s112_aal_ok()` auf `SELECT true` setzen. Die 2FA-Pflicht bleibt bewusst App-Sache.
- **Neue Server Actions und schreibende Routen (seit 25.09.2026, KAN-30 und KAN-5):** Jede `'use server'`-Datei unter `src/app/(dashboard)` prüft im Kontext-Helfer direkt nach `getCurrentMembership()` – und **vor** `canWrite`/`canAdmin`/`canManageUsers` – den Betrieb der Seite (`pruefeSeitenBetrieb(membership.tenantId)` bzw. `seitenBetriebFehler(…)` aus `src/lib/auth/seitenBetrieb.ts`; sonst schreibt ein veralteter Tab nach einem Betriebswechsel in den neuen Betrieb) und die Abo-Schreibsperre (`pruefeSchreibzugriff(membership)` bzw. `schreibSperreFehler(membership)` aus `src/lib/auth/sperren.ts`; Nur-Lesen-Modus). Neue schreibende `/api`-Routen (POST/PUT/PATCH/DELETE) verwenden `seitenBetriebKonflikt(…)` (409) und `schreibSperreKonflikt(membership)` (403; KI-Routen mit `'ki'`); GET-Handler, die nebenbei schreiben, fragen `schreibSperre()` und lassen das Schreiben im Nur-Lesen-Modus weg. Ausnahmen nur mit Begründung (≥ 15 Zeichen) direkt darüber: `// seiten-betrieb-ausnahme: <Grund>`, `// schreibsperre-ausnahme: <Grund>` bzw. im Dateikopf `// schreibsperre-ausnahme-datei: <Grund>`. `scripts/check-seiten-betrieb.js` und `scripts/check-schreibsperre.js` (prebuild, CI) lassen den Build sonst scheitern. Neue schreibende SECURITY-DEFINER-RPCs rufen nach der Zugriffsprüfung `PERFORM public.s112_pruefe_abo_schreibsperre(p_tenant_id);` auf, neue Tabellen mit `mitgliedschaft_aktiv` bekommen die drei `abo_schreibsperre`-Policies (siehe Migration `20260925095428_kan5_abo_schreibsperre`, Abschnitte 3a/3b/4b).
- **Navigation (seit 27.8.2026, Dashboard-Relaunch):** keine Sidebar mehr – Navy-Topbar + zweizeilige Tab-Navigation (`src/components/layout/AppShell.tsx`, `Topbar.tsx`, `TabNav.tsx`), Struktur/Sichtbarkeitsregeln zentral in `src/lib/navigation/index.ts`; Befehlspalette Strg K in `src/components/CommandPalette.tsx`. Dashboard = fünf Sichten unter `src/app/(dashboard)/dashboard/` (Übersicht, kellerbuch, verkauf, weingarten, fristen; gemeinsame Bausteine in `_shared/`). `lib/auth/roles` ist server-only – `canWrite` nie in Client-Komponenten importieren.
- **Sprache:** In allen deutschen Texten (UI-Labels, Kommentare, Fehlermeldungen) immer Umlaute verwenden: ä/ö/ü/Ä/Ö/Ü – niemals ae/oe/ue als Ersatz
- **Skript-Sprache:** Python bevorzugt für Datei- und Datenoperationen; Node.js wenn npm-Pakete nötig (z.B. docx); Bash nur für einfache Einzeiler
- Migrationen: `supabase/migrations/` enthält genau die Remote-Historie als `<version>_<name>.sql` (Version = Zeitstempel aus `supabase_migrations.schema_migrations`), Projekt-Ref `zwcsgnemijkpyxrqykul`. Die älteren, handnummerierten Dateien liegen unverändert in `supabase/migrations_legacy/` (bis 24.09.2026; „Migration 182“ usw. = diese Dateien).
  Neue Migrationen per Supabase-MCP `apply_migration` mit `<name>` einspielen – nicht im SQL Editor, der schreibt keine Historie –, danach die von `list_migrations` gemeldete Version übernehmen und die Datei exakt als `supabase/migrations/<version>_<name>.sql` speichern; keine eigene Nummer oder Zeitstempel erfinden. Prüfen mit `npx supabase migration list` (lokal = remote).
  Neuaufbau einer Datenbank: alle Dateien aus `migrations_legacy/` in Reihenfolge, danach nur die Dateien aus `migrations/` mit Version nach `20260923190744`.
  Beim Neuaufbau in `migrations_legacy/052_release_notes.sql` das Statement `CREATE POLICY "rn_admin"` überspringen – es referenziert `tenant_memberships.rolle` (Spalte heißt `role`) und bricht die Datei ab; die Policies setzen `20260924071722_legacy_nachtrag_025_050_052` und `20260924082326_plattform_admin_haertung` korrekt.
- **Datenkorrekturen/Cleanup-Skripte (seit 25.09.2026, KAN-124):** nie `SET session_replication_role = 'replica'` und nie `DISABLE TRIGGER` – das umgeht FK-Kaskaden, FK-Prüfungen und die Protokoll-Trigger (`bestandsprotokoll`); so blieben 10 `ernte_parzellen` ohne Jahrgang zurück. `scripts/check-replica.js` (prebuild, CI) lässt den Build bei einer nicht auskommentierten Stelle in `sql/`, `scripts/` oder `supabase/` (ohne `migrations_legacy/`) scheitern (Ausnahme je Zeile: `-- replica-ausnahme: <Grund>`, ≥ 15 Zeichen). Abhängige Tabellen ohne `tenant_id` (z. B. `ernte_parzellen` über `jahrgang_id`, `pressung_behaelter`, `verschneidung_quellen`) ausdrücklich zuerst löschen, nicht auf Kaskaden verlassen; danach `scripts/fk-waisen.sql` ausführen – 0 Zeilen erwartet (Kennzahl „FK-Waisen gesamt“ auch in `scripts/restore-test.sql`).
- **Plattform-Admin in RLS (seit 24.09.2026):** globale Schreibrechte (nicht mandantenbezogen) nur über `EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid()))` prüfen – nie über `tenant_memberships.role = 'system_admin'` allein. Vergabe von `system_admin` nur durch Plattform-Admins (RLS auf `tenant_memberships`) bzw. per Service-Role – in der App ausschließlich über `inviteSystemAdmin` (`/admin/benutzer`, pflegt `plattform_admins` mit); `/admin/mandanten/[id]` und `/benutzer` vergeben nur `tenant_admin`/`winzer`/`leser` und fassen `system_admin`-Zeilen nicht an. Umgestellt sind auch `tenants` INSERT (`paketfelder_schutz`) sowie `module_flags`, `rebsorten` und Storage `mandant-logos` (`20260924170818_plattform_admin_restpolicies`) – keine Policy ohne Mandantenbezug prüft mehr `role = 'system_admin'`; mandantenbezogene Prüfungen wie `role IN ('system_admin','tenant_admin')` im eigenen Tenant bleiben so. Prüfabfrage: `pg_policies`, deren `qual`/`with_check` `system_admin` enthält, aber weder `plattform_admins` noch `tenant_id` noch `foldername` (Storage-Pfad mit Tenant) – muss leer sein.
- **Paket- und Systemfelder (seit 24.09.2026, Migrationen `20260924090247_paketfelder_schutz` + `20260924092152_paketfelder_schutz_nachschliff`):** `tenants` und `tenant_einstellungen` schreibt die App über die Service-Role bzw. SECURITY-DEFINER-Funktionen (Nummernkreise, KI-Zähler, Kundennummer). Direkt als Benutzer (`authenticated`/`anon`) lässt der Trigger `a_schutz_plattformfelder` nur die Trigger-Argumente zu – `tenants`: `bio_status` (plus `updated_at`, das `tenants_updated_at` ohnehin auf `now()` setzt); `tenant_einstellungen`: `svs_option`, `svs_option_seit`, `svs_einkuenfte_manuell`, `svs_kv_angehoerige` –, alles andere endet mit Fehler 42501 (Plattform-Admins ausgenommen). Regeln:
  - Benutzer-Schreibzugriffe auf `tenant_einstellungen` nur per `.update()`, nie per `.upsert()` (der BEFORE-INSERT-Teil lehnt jeden Insert ab, auch bei Konflikt); Zeilen anlegen/löschen nur per Service-Role.
  - Funktionen/Trigger, die diese Tabellen im Benutzerkontext schreiben (z. B. neue Nummernkreise), als `SECURITY DEFINER` (Owner postgres) anlegen – als INVOKER greift der Schutz mit 42501.
  - Soll ein weiteres Feld per User-Client schreibbar werden: Trigger-Argumente per Migration erweitern – oder über eine Server-Action mit Service-Role schreiben.
  - Kommt je eine weitere API-Rolle neben `anon`/`authenticated` dazu, muss sie in die Rollenprüfung von `schutz_plattformfelder()`.
  - `tenant_memberships`: Anlegen und Ändern per API nur für Plattform-Admins (Benutzerlimit `max_benutzer` sonst umgehbar); die App schreibt Mitgliedschaften per Service-Role, als Benutzer nur das Entfernen (`removeMember`).
- **Behördenmeldungen immer auch als CSV (Anforderung 24.09.2026):**
  - Geltungsbereich: jede Meldung, jeder Antrag, jedes Formular und jede Aufzeichnung für eine Behörde oder Kontrollstelle (AMA/eAMA, BKI/Weindatenbank, Bundesamt für Weinbau, Finanzamt, SVS, Zoll/EMCS, LK/Bio-Kontrolle …). Die CSV kommt zusätzlich zu Druck, PDF oder XML.
  - Aufbau je Meldung: Ladefunktion, Zeilentyp und Spalten (`CsvSpalte<Z>[]`) in `src/lib/behoerden/<meldung>.ts` – Druckseite und CSV nutzen DIESELBE Ladefunktion; Zahlen dort schon mit `runden()` gerundet, Druck-Summen addieren die gerundeten Zeilenwerte. Katalog-Eintrag in `src/lib/behoerden/katalog/<gruppe>.ts` (`katalogGruppe`: id = URL-Segment, `zugriff`, `druckPfad`, `pflicht`, `modul`), Register-Eintrag in `src/lib/behoerden/register/<gruppe>.ts` (`definiereMeldung(KATALOG_X.<id>, { parameter, laden, spalten, dateiteile, profil? })` mit `satisfies MeldungenZu<typeof KATALOG_X>` – Katalog und Register exakt gleich). Neue Gruppe in `katalog.ts` (Import, `GRUPPEN_KATALOGE`, Spread) und `register.ts` einsammeln. Parameterfehler mit `parameterFehler()` (→ 400), erwartete Abbrüche mit `throw new MeldungsFehler(404, …)`.
  - Ausgabe nur über die zentrale Route `/meldungen/<id>/csv` (`src/app/(dashboard)/meldungen/[meldung]/csv/route.ts`, im Proxy-Matcher → Login und 2FA). Sie prüft Modul und Rolle selbst (`zugriffsFehler`), lädt mit `.eq('tenant_id', …)` und `alle()`, ist GET ohne Seiteneffekte und liefert bei 0 Datensätzen eine Leermeldung (nur Kopfzeile, HTTP 200, `X-Zeilen: 0`). Auf der Seite `<CsvExportKnopf href={csvPfad('<id>', { …searchParams der Seite })} />` neben dem Druckknopf; erste Zeile der Seite `// behoerdenmeldung: <id>[, <id>]`.
  - Zugriff: `betriebsleitung` = Pflichtmeldungen (system_admin/tenant_admin/winzer immer, Leser nur mit `modul_controlling` + Auswertungsrecht; Seiten unter `reports/(pflicht)/` mit Guard `requirePflichtmeldungen()`, Nav-Eintrag mit `pflichtmeldung: true`), `auswertungen` = Controlling + Auswertungsrecht (`reports/(controlling)/`), `mitglied`, `schreiben`; ein gesetztes `modul` gilt zusätzlich.
  - Format nur über `csvText()`/`csvDatei()` aus `src/lib/csv` (isomorph, ohne `@/`-Importe wegen node:test). Standardprofil `PROFIL_EXCEL_AT`: UTF-8 mit BOM (im Code nur als Escape `\uFEFF`), `;`, CRLF auch nach der letzten Zeile, Dezimalkomma ohne Tausenderpunkt, feste Stellen je Spalte (`STELLEN`), kaufmännische Rundung, DATE stringbasiert als TT.MM.JJJJ, timestamptz in Europe/Vienna, Formelschutz (Apostroph) für Text und Codes – bewusst auch vor `+` („'+43“ in Telefon-Vorwahlen, KAN-54) –, Codes mit führenden Nullen (Typ `code`) sonst unverändert, eine Kopfzeile mit Umlauten und Einheit („Menge (kg)“). `PROFIL_BKI` (EDV-Liste Weindatenbank) und `PROFIL_BMD` (byte-identisch per Golden-File, `npm run test:csv`) nur für diese Importe. Browser-Listen ohne Route: `<CsvExportKnopf erzeugen={…} />` bzw. `lib/utils/csv` (Wrapper auf `csvText`). Datenexporte unter `src/app/api/export/*` (Kontakte, Firmen, Lager, Verkauf – keine Behördenmeldungen) bauen ihre Zeilen in `src/lib/export/datenexporte.ts`, antworten über `csvAntwort`/`fehlerAntwort` (`src/lib/csv/antwort`) und werden per `<CsvExportKnopf href="/api/export/…" />` geladen (zeigt Fehler und X-Warnungen, anders als `<a download>`).
  - Übersicht: Karte „Behördenmeldungen (Drucken & CSV)“ in `/dashboard/fristen` und Tab „Behörden“ in `/reports` entstehen aus dem Katalog (`lib/behoerden/uebersicht.ts`); ein `druckPfad` mit `[id]` braucht dort einen Eintrag in `EINSTIEG` (Auswahlseite).
  - Absicherung: `scripts/check-behoerden-csv.js` im prebuild bricht ab bei `text/csv`, `new Blob` für CSV oder einem BOM-Literal außerhalb von `src/lib/csv/**` und `src/components/CsvExportKnopf.tsx` (begründete Ausnahme je Zeile: `// csv-ignore: <Grund>`; `ALTFAELLE` im Skript ist seit KAN-54 leer), bei unbekannter Marker-id, nicht verdrahteter Register-id, `druckPfad` ohne Seite oder Marker und fehlendem `EINSTIEG`. Kein Export-Protokoll (bräuchte eine Migration; später per eigenem POST aus dem Knopf, nie im GET).
- **Stabilität (verbindlich, seit 28.09.2026):**
  - Nach JEDER Code-Änderung `npm run verify` ausführen: Typprüfung des ganzen Programms (`tsc --noEmit`), ESLint (`npm run lint:verify` mit `eslint.config.mjs`: Errors vollständig, Warnings nur als Zählung je Regel; rot bei einem Error oder wenn eine Regel über ihrem Ausgangswert in `scripts/eslint-baseline.json` liegt – keine neuen Warnings, die Stellen auf geänderten Zeilen werden dann gezeigt; nach einem Abbau `npm run lint:baseline` und die JSON-Datei mit committen – der PR-Lauf der CI ist sonst rot (Regel unter dem Ausgangswert; beim Push auf main nur Hinweis; betrifft es eine Regel, die ein anderer PR gesenkt hat, dasselbe nach einem Rebase auf main), Erhöhen nur von Hand mit Begründung im PR; `npm run lint` zeigt alle Befunde einzeln), alle Unit-Tests (`test:csv`), alle prebuild-Wächter. „Fertig“ nur bei grünem Lauf melden, mit Ergebnis (z. B. „verify grün: Typprüfung ok, Lint 0 Errors und keine Regel über dem Ausgangswert, 823/823 Tests, 8 Wächter“). In Worktrees ohne eigene `node_modules` vorher eine Verknüpfung (Junction) auf die `node_modules` des Haupt-Checkouts anlegen – `npx tsc` meldet sonst fälschlich Erfolg. Nach dem Merge einer Änderung an `package-lock.json` im Haupt-Checkout `npm ci` ausführen, sonst scheitert `npm run lint` in Junction-Worktrees (seit KAN-140 ist eslint-config-next 16 nötig; `eslint.config.mjs` meldet dann „… ist nicht ladbar … `npm ci` ausführen“).
  - Dasselbe Gate läuft in der CI (`.github/workflows/tenant-isolation-check.yml`, Job „check“) bei jedem PR und Push auf main; bei rotem „check“ wird nicht gemergt.
  - Neues oder geändertes Verhalten → Test; Bugfix → Regressionstest, der ohne den Fix rot wäre. Tests nie abschwächen, um grün zu werden; kein `test.only`/`test.skip` einchecken.
  - Testzahl vor und nach der Änderung vergleichen – sie darf nicht ungewollt sinken.
  - Ausgangswerte, Coverage je Bereich, Lücken nach Risiko und manuelle Testszenarien stehen in `STABILITAET.md`; Coverage messen mit `npm run test:coverage`. Beim Schließen einer Lücke dort nachziehen.

## Aktuelle Nutzer

Stand 24.09.2026 laut `tenant_memberships` (alle Mitgliedschaften aktiv). Leser gibt es derzeit keine – für Leser-Tests ein eigenes Testkonto anlegen.

| Name          | E-Mail                      | Sandbox      | Musterhof (Demo) | Weingut Johannes Gebeshuber | Spaetrot Gebeshuber GmbH |
|---------------|-----------------------------|--------------|------------------|-----------------------------|--------------------------|
| Jörgen        | jv@icp-consultants.at       | system_admin | system_admin     | system_admin                | system_admin             |
| Johannes      | jg@weingut-gebeshuber.at    | tenant_admin | –                | tenant_admin                | tenant_admin             |
| Ferdinand     | fg@weingut-gebeshuber.at    | –            | –                | tenant_admin                | tenant_admin             |
| Paul          | pg@weingut-gebeshuber.at    | –            | –                | tenant_admin                | tenant_admin             |
| Karin         | kk@weingut-gebeshuber.at    | –            | –                | winzer                      | winzer                   |
| Paul          | paul.derstroff@outlook.com  | tenant_admin | –                | –                           | –                        |
| Hannes (Demo) | jg@hohenstein-partner.at    | –            | tenant_admin     | –                           | –                        |
| Jörgen (Demo) | jv@hohenstein-partner.at    | –            | tenant_admin     | –                           | –                        |
| Paul (Demo)   | pd@hohenstein-partner.at    | –            | tenant_admin     | –                           | –                        |

- Jörgen ist zusätzlich Plattform-Admin (`plattform_admins`) – als einziger.
- Karin hat als `winzer` die Standard-Schreibmodule, also alle sechs (rieden, kellerbuch, warenwirtschaft, crm, ea, auswertungen).

## Migrations-Übersicht

Die Nummern beziehen sich auf die handnummerierten Dateien in `supabase/migrations_legacy/` (bis 228, Stand 24.09.2026);
neue Migrationen nur noch mit Remote-Version in `supabase/migrations/` (siehe Konventionen).

| Migration | Inhalt |
|-----------|--------|
| 001       | Initial Schema |
| 002       | RLS Policies |
| 003       | Kellerbuch: Behälter, Weinausbau-Chargen |
| 004–012   | DAC, Prüfnummern, Erntemeldung, PSM, Behandlungen, Rebsorten, Jahrgänge, Analysen, Grundstücke |
| 013       | Lagen-Tabelle (Rieden) + Grundstücke-Status |
| 014       | Behandlungen auf Grundstück-Ebene (Junction-Tabelle) |
| 015       | Behandlungen Erweiterung: art, menge, cu_gehalt_pct, flaeche_ha Snapshot |
| 016       | PSM-Lagerverwaltung: Anfangsbestand, Einkauf, Inventurkorrektur |
| 017       | Qualitätsstufe in weinausbau + Umziehen-Protokoll |
| 018       | Pressungen (Lese → Most → Behälter) |
| 019       | CRM Stammdaten: kontakte, firmen, Kundensegmente |
| 020       | CRM Bewegung: aktivitaeten, pipeline_eintraege, Preislisten |
| 021       | Tenant-Einstellungen: Branding, Module-Toggles, Brevo-Key |
| 022       | Weinhandel: fuellungen (Abfüllungsereignisse = Weinlager-Artikel) |
| 023       | Kellerplan: kellerplaene + kellerplan_positionen (Behälter-Grundriss) |
| 024       | Weinhandel: preislisten + preislisten_positionen (Mehrere Preislisten gleichzeitig aktiv) |
| 025       | Weinhandel: verkaufsposten + verkauf_positionen (Flasche/Tank/Sonstiges, Bestandsreduktion) |
| 026       | Rechnungsnummer: rechnung_prefix/zaehler/stellen in tenant_einstellungen + get_next_rechnungsnummer() RPC |
| 027       | Stornierung: storniert/storniert_am in verkaufsposten; Kundennummern in kontakte/firmen; kunden_prefix/zaehler/stellen + get_next_kundennummer() RPC; aktivitaeten.art += 'verkauf' |
| 028       | CRM Erweiterungen: aktivitaeten += ganztags/uhrzeit_von/uhrzeit_bis; pipeline_eintraege += kategorie/erledigt/erledigt_am |
| 029       | Pipeline Uhrzeit: pipeline_eintraege += ganztags/uhrzeit_von/uhrzeit_bis |
| 030       | Betriebsdaten + Rechnung: tenant_einstellungen += betrieb_*/rechnung_*; verkauf_positionen += ust_satz |
| 031       | Bezahlt-Status + Rabattgruppen: verkaufsposten += bezahlt/bezahlt_am; neue Tabelle rabattgruppen; kontakte/firmen += rabattgruppe_id; verkauf_positionen += rabatt_pct/sonderrabatt_pct |
| 032       | Standard-USt pro Mandant: tenant_einstellungen += ust_satz_standard (13% Weinproduzent / 20% Weinhändler) |
| 033       | Sonderrabatt auf Kontakt/Firma: kontakte/firmen += sonderrabatt_pct; wird im Verkaufsformular auto-vorbelegt |
| 034       | Lead-Feld: kontakte/firmen += is_lead (DEFAULT true); neue Datensätze starten als Lead; erster Verkauf → automatisch Kunde |
| 035       | Telefonvorwahl: kontakte += telefon_vorwahl/mobil_vorwahl; firmen += telefon_vorwahl (DEFAULT '+43') |
| 036       | Lückenhalter (Notizen/nurAnzeige – kein Schema-Change) |
| 037       | KI-Modul: ki_abfragen_aktiv/paket/zaehler/reset_datum in tenant_einstellungen + check_und_increment_ki_abfrage() RPC |
| 038       | E-Mail IMAP/SMTP Basic: email_modul_aktiv + SMTP-Felder in tenant_einstellungen |
| 039       | M365 Integration: m365_modul_aktiv + OAuth-Felder in tenant_einstellungen |
| 040       | Per-User E-Mail: user_email_connections (tenant_id, user_id, m365-Tokens, imap-Credentials) |
| 041       | Kostenrechnung: kostenstellen, kostenarten, kostenbuchungen |
| 042       | Shared Mailbox: user_email_connections += monitored_email |
| 043       | Weinexport: exportauftraege, exportauftrag_positionen, export_dokumente + modul_weinexport Toggle + get_next_exportnummer() |
| 044       | Email-IDs in Aktivitäten: aktivitaeten += email_id (UNIQUE), email_conversation_id |
| 045       | Email-Body persistent: aktivitaeten += email_von, email_von_name, email_an, email_body, email_body_html |
| 109       | Traubenverkauf: weingarten += trauben_verkauf/trauben_herkunft_code; neue Tabelle traubenverkauf (Verkauf an Abnehmer, BKI-Datenblatt CSV-Export) |
| 110       | BKI-Betriebsnummern Abnehmer: firmen.betrieb_nr + kontakte.betrieb_nr (Empfänger-Block BKI-Transportliste) |
| 111       | Traubenverkauf Erweiterungen: traubenverkauf += gesundheit (G/K) + liefernummer (auto); weingarten += nachhaltig_austria; tenant_einstellungen += liefernummer_prefix/zaehler/stellen + get_next_liefernummer() RPC |

## Phase 4 – Status (Stand Juni 2026)

| Epic | Status |
|---|---|
| Benutzerhandbuch + FAQs | ✅ `/hilfe/handbuch` + `/hilfe/faq` live |
| Onboarding Guide | ✅ `/admin/onboarding` live |
| Feature-Rollout-Manager | ✅ modul_*-Toggles in Mandantenverwaltung |
| Weinexport-Modul | ✅ EUR.1, V1/V2, CMR, Certificate of Origin, Lieferschein, Rechnung (ohne Akkreditiv) |
| Multi-User E-Mail-Boxen | ✅ user_email_connections + monitored_email (Shared Mailbox) |
| E-Mail-Threading UI | ✅ Betreff-basiertes Grouping + conversation_id, inline Body-Anzeige |
| Integrierter E-Mail-Client | ✅ `/nachrichten` mit Ordnern, Löschen, Antworten, Weiterleiten |
| KI-Modul Smart Query | ✅ `/ki` – Frag dein Weingut (Haiku, Limit-Check, Paket-Verwaltung) |

## Offen / Nächste Schritte

- **UAT** – Gebeshuber testet alle Module im Echtbetrieb (Juni 2026)
- **Testautomatisierung + Regressionstests** – Smoke Tests + Playwright E2E nach UAT-Abschluss
- **Stripe-Einrichtung (Konto, 3 Produkte, Webhook, Vercel-Variablen)** – Code fürs Paketmodell Basis/Standard/Premium ist fertig (`src/lib/pakete.ts`, Commit 80e24a2), Stripe selbst bewusst zurückgestellt bis das Konto steht – **spätestens vor dem ersten zahlenden Kunden**. Schritt-für-Schritt-Checkliste: `docs/STRIPE_EINRICHTUNG.md`
- **Multi-Betrieb-Login** – nach Login Betrieb auswählen (wenn User in mehreren Tenants); aktiver Tenant in Cookie; Switch im Header; ~2 Tage
- **Traubenverkauf-Modul** – Toggle in Ernte „für Verkauf freigeben"; Verkauf als neuer Verkaufsposten-Typ; Datenblatt gem. § 3 Weingesetz-Formularverordnung BGBl. II Nr. 13/2012 (Excel-Export); ~2 Tage
- **EMCS-Integration via n8n** – Weinexport Pro (€59/Mo)
- **Kostenrechnung Multi-Weingarten** – Kostenverteilung auf mehrere Weingärten (gleichmäßig oder gewichtet %) via Junction-Tabelle
- **SheetJS XLSX-Export** – KI-Abfragen + Auswertungen als formatiertes Excel (nicht nur CSV); Spaltenbreiten, Summenzeilen, Tabellenformat
- **Mobile UX** – PWA oder native App (bei Kundenbedarf)

## KI-Modul „Smart Query" (Phase 3 – geplant)

**Produkt:** Separates Zusatzmodul – „Frag dein Weingut" (AI-gestützte Abfragen via Claude Haiku)

**Lizenzmodell:**
| Paket     | Abfragen/Monat | Preis/Monat | Marge (bei ~€0.04 API-Kosten/100 Queries) |
|-----------|---------------|-------------|-------------------------------------------|
| Basic     | 100           | +€ 9        | ~€ 8,96 |
| Standard  | 200           | +€ 19       | ~€ 18,92 |
| Unlimited | unbegrenzt    | +€ 49       | ~€ 48,80 (bei ø 500 Abfragen) |

**Technische Umsetzung (geplant):**
- `tenant_einstellungen` += `ki_abfragen_aktiv` (bool), `ki_abfragen_paket` (basic|standard|unlimited), `ki_abfragen_zaehler_monat` (int), `ki_abfragen_reset_datum` (date)
- Supabase RPC `check_und_increment_ki_abfrage(p_tenant_id)` → atomarer Zähler + Limit-Check
- Claude Haiku API-Call (Server Action) → strukturierte Query-Parameter (kein rohes SQL)
- RLS greift automatisch → kein Datenleck zwischen Mandanten
- Admin-Tab in Mandantenverwaltung: Paket zuweisen, Verbrauch einsehen

**Features im Modul:**
1. **Smart Query** – Freitexteingabe → KI → gefilterte Tabelle + Zusammenfassung
2. **Besuchsplanung** – Region + Segment + Zeitraum → PLZ-geclusterte Besuchsliste + Karte (Leaflet.js)
3. **Statische Reports** – Monatsumsatz, Lagerbestand, Behandlungsübersicht (ohne KI, immer inkludiert)
