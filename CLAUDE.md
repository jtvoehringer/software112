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

- **Tenant-ID Sandbox:** `fa22dc07-eca5-43df-af96-f7b9b09f0471` · Tenant-Name in DB: **„Sandbox"** (Produktiv-Tenant „Weinbau Gebeshuber" wird erst nach UAT-Abschluss angelegt)
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
- **Navigation (seit 27.8.2026, Dashboard-Relaunch):** keine Sidebar mehr – Navy-Topbar + zweizeilige Tab-Navigation (`src/components/layout/AppShell.tsx`, `Topbar.tsx`, `TabNav.tsx`), Struktur/Sichtbarkeitsregeln zentral in `src/lib/navigation/index.ts`; Befehlspalette Strg K in `src/components/CommandPalette.tsx`. Dashboard = fünf Sichten unter `src/app/(dashboard)/dashboard/` (Übersicht, kellerbuch, verkauf, weingarten, fristen; gemeinsame Bausteine in `_shared/`). `lib/auth/roles` ist server-only – `canWrite` nie in Client-Komponenten importieren.
- **Sprache:** In allen deutschen Texten (UI-Labels, Kommentare, Fehlermeldungen) immer Umlaute verwenden: ä/ö/ü/Ä/Ö/Ü – niemals ae/oe/ue als Ersatz
- **Skript-Sprache:** Python bevorzugt für Datei- und Datenoperationen; Node.js wenn npm-Pakete nötig (z.B. docx); Bash nur für einfache Einzeiler
- Migrationen: `supabase/migrations/` enthält genau die Remote-Historie als `<version>_<name>.sql` (Version = Zeitstempel aus `supabase_migrations.schema_migrations`), Projekt-Ref `zwcsgnemijkpyxrqykul`. Die älteren, handnummerierten Dateien liegen unverändert in `supabase/migrations_legacy/` (bis 24.09.2026; „Migration 182“ usw. = diese Dateien).
  Neue Migrationen per Supabase-MCP `apply_migration` mit `<name>` einspielen – nicht im SQL Editor, der schreibt keine Historie –, danach die von `list_migrations` gemeldete Version übernehmen und die Datei exakt als `supabase/migrations/<version>_<name>.sql` speichern; keine eigene Nummer oder Zeitstempel erfinden. Prüfen mit `npx supabase migration list` (lokal = remote).
  Neuaufbau einer Datenbank: alle Dateien aus `migrations_legacy/` in Reihenfolge, danach nur die Dateien aus `migrations/` mit Version nach `20260923190744`.
  Beim Neuaufbau in `migrations_legacy/052_release_notes.sql` das Statement `CREATE POLICY "rn_admin"` überspringen – es referenziert `tenant_memberships.rolle` (Spalte heißt `role`) und bricht die Datei ab; die Policies setzen `20260924071722_legacy_nachtrag_025_050_052` und `20260924082326_plattform_admin_haertung` korrekt.
- **Plattform-Admin in RLS (seit 24.09.2026):** globale Schreibrechte (nicht mandantenbezogen) nur über `EXISTS (SELECT 1 FROM public.plattform_admins p WHERE p.user_id = (SELECT auth.uid()))` prüfen – nie über `tenant_memberships.role = 'system_admin'` allein. Vergabe von `system_admin` nur durch Plattform-Admins (RLS auf `tenant_memberships`) bzw. per Service-Role – in der App ausschließlich über `inviteSystemAdmin` (`/admin/benutzer`, pflegt `plattform_admins` mit); `/admin/mandanten/[id]` und `/benutzer` vergeben nur `tenant_admin`/`winzer`/`leser` und fassen `system_admin`-Zeilen nicht an. Noch offen: die älteren Policies auf `module_flags`, `rebsorten` und Storage `mandant-logos` prüfen weiter `role = 'system_admin'` und sollen auf `plattform_admins` umgestellt werden (`tenants` INSERT ist seit `paketfelder_schutz` umgestellt).
- **Paket- und Systemfelder (seit 24.09.2026, Migration `20260924090247_paketfelder_schutz`):** `tenants` und `tenant_einstellungen` schreibt die App über die Service-Role bzw. SECURITY-DEFINER-Funktionen (Nummernkreise, KI-Zähler, Kundennummer). Direkt als Benutzer (`authenticated`) lässt der Trigger `a_schutz_plattformfelder` nur eine Positivliste zu – `tenants`: `bio_status`; `tenant_einstellungen`: `svs_option`, `svs_option_seit`, `svs_einkuenfte_manuell`, `svs_kv_angehoerige` –, alles andere endet mit Fehler 42501 (Plattform-Admins ausgenommen). Einstellungszeilen anlegen oder löschen nur per Service-Role. Soll ein weiteres Feld per User-Client schreibbar werden: Trigger-Argumente per Migration erweitern oder über eine Server-Action mit Service-Role schreiben.

## Aktuelle Nutzer

| Name   | E-Mail                          | Rolle          |
|--------|---------------------------------|----------------|
| Jörgen | jv@icp-consultants.at           | tenant_admin   |
| Hannes | jg@hohenstein-partner.at        | leser          |
| Paul   | pd@hohenstein-partner.at        | leser          |

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
