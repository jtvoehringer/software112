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

## Empfehlungen (offen, in dieser Reihenfolge)

1. **Kontakte/Firmen serverseitig filtern und blättern.** Suche, Segment, Buchstabe und Lead-Filter als URL-Parameter, Abfrage mit `ilike`/`range(0, 199)` + `count`, Aktivitäten nur für die geladenen Zeilen. Das ist der größte verbleibende Hebel für Gebeshuber (Seitenaufbau von Sekunden auf < 500 ms). Aufwand ca. ein halber Tag, betrifft `crm/kontakte`, `crm/firmen`, CRM-Übersicht und die Kundenauswahl im Verkauf.
2. **Dashboard-Layout schlanker:** Branding/Modulschalter/Stripe-Status werden bei jedem Seitenaufruf frisch gelesen. Mit `unstable_cache` (Schlüssel tenant_id, 60 s, Invalidierung beim Speichern der Einstellungen) fällt je Aufruf eine Abfrage-Gruppe weg.
3. **Policies zusammenlegen** (`multiple_permissive_policies`): je Tabelle eine SELECT- und eine Schreib-Policy; `rabattgruppen`, `profiles`, `kosteneintraege` zuerst.
4. **`loading.tsx` je Bereich** (Kellerbuch, CRM haben es, Buchhaltung/Weinhandel nicht): sofortiges Skelett statt weißer Seite beim Wechsel.
5. **Vercel Pro** prüfen, sobald mehrere Betriebe produktiv sind: Hobby hat 10 s Funktionslaufzeit im Standard, keine Fluid-Compute-Warmhaltung und nur zwei Cron-Jobs – die Kaltstarts (erste Anfrage nach Pause ~1–2 s) sind damit nicht wegzubekommen.
6. **Supabase Compute:** Projekt läuft auf der kleinsten Instanz; bei > 3 aktiven Betrieben auf „Small“ wechseln (mehr RAM für Index-Caches). Vorher den `pg_stat_statements`-Report ziehen (Dashboard › Reports › Query Performance), um langsame Abfragen zu sehen.

## Hinweis zur Umstellung der Policies

Beim Umschreiben trat für rund eine Minute ein „infinite recursion“-Fehler auf `tenant_memberships` auf (die Rollenprüfung dieser Tabelle darf nicht auf sich selbst verweisen); die vier betroffenen Policies verwenden wieder die SECURITY-DEFINER-Funktion. Wer in diesem Zeitfenster geladen hat, sah eine Fehlermeldung – Neuladen genügt.
