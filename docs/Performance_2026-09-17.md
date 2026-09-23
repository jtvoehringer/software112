# Performance-Check software:112 (17.9.2026)

## Befund

**Datenbank (Supabase-Advisor, Projekt Software112)**
- 158× `auth_rls_initplan`: RLS-Policies riefen `auth.uid()` je Zeile auf; 122 Policies riefen zusätzlich `user_has_role_in_tenant()` je Zeile (Funktionsaufruf mit eigener Abfrage). Bei 8.267 Kontakten / 4.648 Firmen (Gebeshuber) heißt das je Listenaufruf zehntausende Funktionsaufrufe.
- 68 Fremdschlüssel ohne Index (u. a. `kontakte.firma_id`, `keller_umzuege.von/nach_behaelter_id`, `kosteneintraege.*`, `ea_transaktionen.kategorie_id`).
- 125× `multiple_permissive_policies` (z. B. `rabattgruppen` 20 Policies, `profiles` 15): jede wird ausgewertet – nur Aufräumarbeit, kein Fehler.

**App (Vercel-Logs, 3 Tage)**
- Beim Öffnen einer Seite erschienen 10–20 weitere Seitenaufrufe im Log (Dashboard, Weingarten, Kellerbuch, Nachrichten …) – das ist das Vorabladen (`prefetch`) aller sichtbaren `<Link>` durch Next.js. Weil alle Seiten dynamisch sind, rendert jedes Vorabladen Middleware + Dashboard-Layout (mit Datenbankabfragen). `/crm/kontakte/[id]` war mit 168 Aufrufen der häufigste Pfad: je sichtbarer Zeile der Kontaktliste ein Vorabladen.
- Kontakte-/Firmen-/CRM-Übersicht laden alle Datensätze (8.267 Kontakte in 9 sequenziellen 1.000er-Blöcken + 4.648 Firmen in 5) und geben sie komplett an den Browser – mehrere MB je Seitenaufruf.
- Kein Autorefresh: besuchte Seiten bleiben im Router-Cache, Änderungen anderer Benutzer kommen ohne Neuladen nicht an.

## Umgesetzt (Build nach a39d560)

| Maßnahme | Wirkung |
|---|---|
| Migration 206: alle 293 Policies umgeschrieben – `(select auth.uid())` als InitPlan, Rollenprüfung als `tenant_id IN (Mitgliedschaften …)` statt Funktion je Zeile; Index `tenant_memberships (user_id, tenant_id, aktiv, role)`; 33 FK-Indizes | Listen-/Detailabfragen deutlich günstiger, wächst nicht mehr linear mit der Zeilenzahl |
| `components/ui/Link.tsx`: `prefetch={false}` als Standard für alle 130 Link-Importe | keine Phantom-Renderings mehr; Serverless-Aufrufe und DB-Last je Seitenaufruf sinken auf 1 statt 10–20 |
| `lib/supabase/alle.ts`: 1.000er-Blöcke parallel (5 auf einmal) | Kontaktliste 9 → 3 Round-Trips, Firmen 5 → 2 |
| `components/AutoRefresh.tsx` + `experimental.staleTimes { dynamic: 0, static: 30 }` | Daten aktualisieren sich bei Tab-Rückkehr, Browser-Zurück und alle 3 Minuten; Formulare bleiben erhalten |
| E-Mail: Nachrichtenliste 50 je Seite mit Nachladen; Ordner rekursiv; tägliche CRM-Spiegelung inkrementell | keine Vollabrufe des Postfachs |

## Umgesetzt, zweiter Schritt (Build nach 595ff13)

| Maßnahme | Wirkung |
|---|---|
| **Kontakte/Firmen serverseitig** (`lib/crm/liste.ts`): Suche, Segment, Buchstabe, Lead/Kunde/Lieferant, Sortierung und Umfang stehen als URL-Parameter (`?q=&segment=&buchstabe=&lead=&sort=&n=`); eine Abfrage mit `ilike`/`range` + `count`, Aktivitäten/Pipeline bzw. Ansprechpersonen nur für die geladenen Zeilen; Zähler je Segment über RPC `crm_zaehler` (Migration 207); „Mehr anzeigen“ in 100er-Schritten bis 1.000 | Kontaktliste Gebeshuber: statt 8.300 Zeilen (~9 Abfragen, mehrere MB HTML) 100 Zeilen und 4 Abfragen; Seitenaufbau < 500 ms |
| Dublettenprüfung beim Anlegen als Server-Action (`pruefeKontaktDublette`/`pruefeFirmaDublette`) | vorher brauchte das Formular die komplette Liste im Browser |
| CRM-Übersicht: Kontakt-/Firmenauswahl im Termin-Dialog sucht serverseitig (`/api/crm/suche`, 30 Treffer); Namen nur für verknüpfte Aktivitäten; Verkauf/Notiz/E-Mail-Aktivitäten gar nicht erst geladen | vorher 8.300 + 4.600 Namen bei jedem Aufruf der CRM-Startseite |
| **Layout-Cache** (`lib/tenant/kopf.ts`): Branding, Modulschalter, Abo-Status 60 s im Next-Data-Cache je Betrieb; Invalidierung beim Speichern (Mein Betrieb, Administration › Mandanten, Abo, Stripe-Webhook) | zwei Abfragen weniger je Seitenaufruf |
| **Auth pro Request dedupliziert**: `createSupabaseServerClient` und `getCurrentMembership` mit React `cache`, `auth.getUser()` je Request nur einmal (Netz-Roundtrip zum Auth-Server) | vorher 4–6 Auth-Roundtrips je Seitenaufruf (Layout + Seite + Helfer) → 1 |
| **Migration 208**: mehrfache permissive Policies zusammengelegt (`kosteneintraege` 4 → 1, `rabattgruppen` 6 → 4, `profiles` 5 → 3) | weniger Policy-Auswertungen je Zeile; Schreibrechte auf `rabattgruppen` jetzt im Standardmuster (system_admin/tenant_admin/winzer) |
| **`loading.tsx`** für Buchhaltung, Weingarten, Reports, Controlling, Auswertungen, Administration, Mein Betrieb, Weinexport, Erntemeldung, Pflanzenschutz, Nachrichten (`components/ui/SeitenSkeleton.tsx`) | sofortiges Skelett statt weißer Seite beim Wechsel |
| E-Mail: eingebettete Bilder (`cid:`) werden als Inline-Daten in den Nachrichtentext eingesetzt, echte Anhänge als Download-Liste (`/api/nachrichten/anhang`) | bisher nur Alt-Text („Obsah obrázku …“) statt Signaturbildern |

## Umgesetzt, dritter Schritt (Build nach 9a65898)

| Maßnahme | Wirkung |
|---|---|
| **Kundenauswahl im Verkauf/Zukauf** (`components/crm/PartnerSuche.tsx`): Typeahead sucht serverseitig über `/api/crm/suche?art=kunde|lieferant` (Kontakte + Firmen mit passendem Häkchen, 30 Treffer, Konditionen Rabattgruppe/Sonderrabatt/Skonto kommen mit dem Treffer); z.H.-Ansprechperson über `art=kontakt&firma_id=`; `/api/verkauf-stammdaten` liefert keine Kontakte/Firmen mehr | „Neuer Verkauf“ bei Gebeshuber: statt 8.300 + 4.600 Datensätzen (~2 MB JSON) nur noch Füllungen/Chargen/Artikel |
| E-Mail: Anhänge-Liste ohne `$select` (Graph lehnt `contentBytes` auf der Basisliste ab → eingebettete Bilder blieben Alt-Text); Zuordnung zusätzlich über den Dateinamen | Signaturbilder werden angezeigt |
| E-Mail: Thread-Verlauf (`/api/nachrichten/conversation`) ohne `$orderby` – Graph lehnt `$filter conversationId` + `$orderby` ab (bisher 502 bei jedem Öffnen) | Verlauf einer Konversation erscheint wieder |

## Umgesetzt, vierter Schritt (Build nach 585b58d)

| Maßnahme | Wirkung |
|---|---|
| **Sichtbare Reaktion auf jeden Klick** (Rückmeldung „Controlling dauert 4 s, man glaubt, der Klick war erfolglos“): `components/ui/Link.tsx` meldet jede Navigation, `components/NavigationsBalken.tsx` zeigt einen Ladebalken am oberen Rand bis die neue Seite da ist; in der Hauptnavigation dreht sich zusätzlich ein Symbol direkt am angeklickten Tab (`useLinkStatus`) | Rückmeldung innerhalb von Millisekunden, unabhängig von der Serverzeit |
| **Controlling › Auswertungen** (`reports/page.tsx`): eine Umsatzabfrage über zwölf Monate statt zwölf nacheinander, alle Abfragen parallel, Orte/Länder per RPC `crm_filterwerte` (Migration 210) statt 13.000 Kontakt-/Firmenzeilen, Kundenfilter als serverseitige Suche (PartnerSuche) | Seitenaufbau von ~4 s auf < 1 s |

Weitere Stellen, die noch ganze Listen laden (unkritisch, kleine Mengen oder Export): `crm/pipeline`, `weinhandel/traubenverkauf`, `erntemeldung/[id]` (Kontakte für Auswahl), Exporte (gewollt).

## Empfehlungen (offen)

1. ✅ **Erledigt 23.9.2026:** Vercel Pro aktiv. Korrektur: Fluid Compute war schon unter Hobby aktiv (Standard für Projekte ab 23.4.2025), jetzt zusätzlich fest in vercel.json (`"fluid": true`). Messung 23.9. vom Arbeitsplatz: statische Datei ~145 ms, öffentliche Seiten über den Proxy 170–240 ms (davon ~110 ms Verbindungsaufbau/TLS), erster Aufruf nach Pause einmalig 450–700 ms. Ursprüngliche Empfehlung: **Vercel Pro** prüfen, sobald mehrere Betriebe produktiv sind: Hobby hat 10 s Funktionslaufzeit im Standard, keine Fluid-Compute-Warmhaltung und nur zwei Cron-Jobs – die Kaltstarts (erste Anfrage nach Pause ~1–2 s) sind damit nicht wegzubekommen. Entscheidung des Betreibers, kein Code nötig.
2. **Supabase Compute:** Projekt läuft auf der kleinsten Instanz; bei > 3 aktiven Betrieben auf „Small“ wechseln (mehr RAM für Index-Caches). Vorher den `pg_stat_statements`-Report ziehen (Dashboard › Reports › Query Performance), um langsame Abfragen zu sehen.

## Hinweis zur Umstellung der Policies

Beim Umschreiben trat für rund eine Minute ein „infinite recursion“-Fehler auf `tenant_memberships` auf (die Rollenprüfung dieser Tabelle darf nicht auf sich selbst verweisen); die vier betroffenen Policies verwenden wieder die SECURITY-DEFINER-Funktion. Wer in diesem Zeitfenster geladen hat, sah eine Fehlermeldung – Neuladen genügt.

**Regel für Migrationen über den MCP-`execute_sql`:** DDL nie mit `begin … rollback`-Tests im selben Batch ausführen – der Batch ist eine Transaktion, das Rollback verwirft auch die Policy-Änderungen (Ursache des Ausfalls „Kein Betrieb“ am 17.9.).
