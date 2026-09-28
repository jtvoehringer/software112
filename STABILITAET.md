# Stabilität von software:112

Stand und Ausgangswerte der automatischen Prüfungen. Grundlage ist Jörgens Vorgabe `softwaretests.md`, übernommen für software:112 mit Stufe 1 (PR #66) und Stufe 2 (dieses Dokument).
Regeln für jede Änderung stehen in der `CLAUDE.md`, Abschnitt „Stabilität (verbindlich)“.

## Ampel (28.09.2026)

| Bereich | Stand | Ampel |
|---|---|---|
| Build | `next build` auf Vercel, inkl. prebuild-Wächter und vollständiger Typprüfung | 🟢 |
| Typprüfung | `npm run typecheck` (`tsc --noEmit` über das ganze Programm): 0 Fehler | 🟢 |
| Unit-Tests | 976 Tests in 185 Suiten (32 Testdateien, `node:test`), alle grün, ca. 12 s | 🟢 |
| Projekt-Wächter | 8 Wächter (Mandantentrennung, 2FA, Seitenbetrieb, Schreibsperre, Schema, Barrierefreiheit, Behörden-CSV, Replica): 0 Funde | 🟢 |
| CI | Job „check“ = `npm run verify` bei jedem PR und Push; `main` per Ruleset geschützt (Merge nur mit grünem „check“) | 🟢 |
| Abhängigkeiten | `npm audit`: 0 Schwachstellen (CI-Job „abhaengigkeiten“, ab Stufe hoch blockierend) | 🟢 |
| Coverage | gemessen, aber nur 98 von 604 `src`-Dateien werden von Tests geladen; kein Gate | 🟡 |
| Datenbank (RLS, Trigger, RPCs) | nur einmalige, zurückgerollte Tests bei Migrationen, nichts Wiederholbares | 🔴 |
| Server Actions | 43 Dateien mit `'use server'`, davon 3 mit Tests | 🔴 |
| Lint | ESLint läuft nicht, die Konfiguration fehlt (KAN-140) | 🔴 |
| E2E | Playwright-Grundgerüst gegen Staging (PR #55), in der CI noch übersprungen | 🟡 |

## Ausgangswerte (Baseline 28.09.2026, main 808fe6c)

```
Typprüfung:   0 Fehler (tsc --noEmit -p tsconfig.json)
Unit-Tests:   823 Tests, 167 Suiten, 27 Dateien – alle grün, ca. 7 s (verify gesamt lokal ca. 30 s, CI ca. 70 s)
Wächter:      8/8 grün, 0 Funde
npm audit:    0 Schwachstellen
Coverage (npm run test:coverage, nur von Tests geladene Dateien):
              94,7 % Zeilen / 83,1 % Branches / 91,4 % Funktionen
Abdeckung:    89 von 604 Dateien unter src/ geladen; src/lib: 82 von 162 Dateien
              (ursprünglich als 90 angegeben – die Summenzeile „all files“ war mitgezählt)
```

**Stand 28.09.2026 nach den Charakterisierungstests der Buchungslogik (Stufe 3, Punkt 2):**

```
Unit-Tests:   976 Tests, 185 Suiten, 32 Dateien – alle grün, ca. 12 s
Coverage:     93,7 % Zeilen / 83,6 % Branches / 91,2 % Funktionen
              (Zeilen leicht gesunken: dashboard/_shared/data.ts wird jetzt mitgeladen, aber nur zu 23 % genutzt)
Abdeckung:    98 von 604 Dateien unter src/ geladen; src/lib: 89 von 162 Dateien
              (+9: verkauf/bestand, kellerbuch/storno, folgebuchungen, hinweise, finanzen/uebersicht,
              ea/betriebsbeginn, aufgaben/mitglieder, dashboard/_shared/data und types)
```

**Ab jetzt gilt:** Die Testzahl darf nicht sinken. Typprüfung und Wächter bleiben bei 0 Fehlern. Die Coverage-Werte der geladenen Dateien sollen nicht spürbar fallen. Ein hartes Coverage-Gate gibt es bewusst noch nicht: Solange 506 Dateien gar nicht geladen werden, sagt die Prozentzahl wenig aus.

Neu messen: `npm run test:coverage`. Die Tabelle am Ende der Ausgabe listet je Datei Zeilen, Branches und Funktionen; Dateien, die kein Test lädt, fehlen darin. Gezählt werden die Dateizeilen der Tabelle, ohne die Summenzeile „all files“.

### Coverage je Bereich (`src/lib`)

| Bereich | Dateien | davon getestet | Zeilen | ⌀ Branch der getesteten |
|---|---|---|---|---|
| behoerden (Meldungen, CSV) | 50 | 44 | 10.584 | 81 % |
| wein | 10 | 8 | 8.010 | 94 % |
| kellerbuch | 5 | 5 | 2.245 | 90 % (storno.ts 91 %, folgebuchungen.ts 93 %) |
| assistent | 9 | 1 | 1.757 | 61 % |
| crm | 7 | 0 | 960 | – |
| auth | 10 | 1 | 828 | – |
| csv | 2 | 1 | 645 | 91 % |
| abo | 3 | 3 | 618 | 93 % |
| behandlungen | 3 | 3 | 595 | 95 % |
| verkauf | 1 | 1 | 458 | 94 % (bestand.ts) |
| ea | 3 | 2 (+ betriebsbeginn geladen) | 424 | 80 % |
| finanzen | 1 | 1 | 242 | 75 % (uebersicht.ts) |
| buchhaltung, svs, abo, utils, format, herkunft | | alle | | 93–100 % |

## Lücken, nach Risiko sortiert

1. **Datenbank-Logik ohne wiederholbare Tests** (RLS-Policies, Löschsperren, Schreibsperre, Periodensperre, Trigger wie `bestandsprotokoll`, RPCs wie `fuellung_bestand_buchen`, `schwund_buchen`, `berechne_ea_uva`). Das ist der Kern der Mandantentrennung und der Behördenzahlen. Heute gibt es nur einmalige DO-Block-Tests bei Migrationen.
   **Vorschlag (Stufe 3):** eine SQL-Testsuite gegen Staging. Jede Datei ist ein DO-Block mit `RAISE EXCEPTION` am Ende, läuft per `npx supabase db query --project-ref sjpeghrlhsowmquacjhb` und zählt „OK“-Meldungen. Zuerst für die Rollen × Tabellen der Mandantentrennung, die Schreibsperre und die E&A-Sperren.
2. **Buchungslogik – Rest nach den Charakterisierungstests vom 28.09.2026.**
   `verkauf/bestand.ts`, `kellerbuch/storno.ts`, `kellerbuch/folgebuchungen.ts` und `finanzen/uebersicht.ts` sind jetzt durch Charakterisierungstests abgedeckt: `scripts/tests/verkauf-bestand`, `kellerbuch-storno`, `kellerbuch-folgebuchungen` und `finanzen-uebersicht.test.mjs`, gemeinsame Supabase-Attrappe in `scripts/tests/buchung-attrappe.mjs` (wertet Filter, select-Liste samt Einbettungen/`!inner` und Sortierung wie PostgREST aus, Selbsttest in `buchung-attrappe.test.mjs`; was sie nicht nachbildet – Schema, Trigger, Kaskaden, echte RLS –, steht im Kopfkommentar). Sie halten das heutige Verhalten fest, auch die als „Befund“ markierten Auffälligkeiten – wer eines davon bewusst ändert, passt den Test mit an.
   Offen bleiben:
   - die Server Actions, die diese Bausteine aufrufen (`weinhandel/verkauf/actions.ts` createVerkauf/stornoVerkauf, `weinhandel/traubenverkauf/actions.ts`, `kellerbuch/gebinde-actions.ts`, `kellerbuch/actions.ts`), siehe Lücke 4
   - die DB-Seite (Trigger `bestandsprotokoll`, RPCs `fuellung_bestand_buchen`, `schwund_buchen`), siehe Lücke 1
   - `finanzen/uebersicht.ts` mit 75 % Branch-Coverage

   Befunde aus den Tests (festgehalten, nicht korrigiert – Entscheidung offen):
   - Finanzübersicht: Buchungen ohne Kategorie landen in einem Topf „–“, Einnahmen und Ausgaben werden addiert
   - Finanzübersicht: Stichtag (`heuteStr`) und UVA-Fälligkeit über `toISOString` (UTC-Datum), Jahr und Monat über `getFullYear`/`getMonth` (Serverzeit).
     - Server-Zeitzone östlich von UTC (z. B. `npm run dev` in Wien): die Fälligkeit ist einen Tag zu früh (14. statt 15.), und zwischen 0 und 1 bzw. 2 Uhr Wiener Zeit fallen Jahr/Monat und Stichtag auseinander. Am 1.1.2027 00:30 sind Jahr 2027, 0 abgelaufene Monate und die UVA Dez 2026 bzw. Q4 2026 für das Wiener Datum **richtig**; falsch sind der Stichtag (31.12.2026 statt 1.1.2027), daraus das leere YTD und der Vorjahresvergleich über das ganze Jahr 2026 (`stichtagVj` 2026-12-31) sowie die Fälligkeit 14.2. statt 15.2. An jedem anderen Tag fehlen in dieser Stunde die Buchungen und Rechnungen vom heutigen Tag im Stichtagsvergleich.
     - Server in UTC (Vercel, Produktion): Jahr, Monat und Stichtag bleiben stimmig, hinken aber jede Nacht zwischen 0 und 1 bzw. 2 Uhr Wiener Zeit einen Kalendertag hinterher – Stichtag, YTD, Überfälligkeit, am Monatsersten auch UVA-Periode und offene Monate (am 1.1.2027 00:30: Jahr 2026, Stichtag 31.12.2026, UVA Nov 2026). Das ist keine Entwarnung, sondern der Vortag aus Nutzersicht.
     - Ein Fix bildet das Datum (Stichtag, Jahr, Monat, Fälligkeit) einheitlich nach Europe/Vienna – nicht Jahr und Monat nach UTC. Offen: Entscheidung, ob die App das Datum grundsätzlich nach Europe/Vienna bildet.
   - Finanzübersicht: Die Überfälligkeit hängt am Zeitpunkt, nicht am Kalendertag – `(heute − Rechnungsdatum als UTC-Mitternacht) / 86 400 000 > 30`. Mit Uhrzeit ist eine Rechnung damit schon am 30. Kalendertag überfällig (ab 00:00:00.001 UTC, in Wien ab 02:00 Sommer- bzw. 01:00 Winterzeit); „nicht überfällig“ gilt nur exakt um Mitternacht UTC
   - Finanzübersicht: `afaGebuchtVj` wird berechnet, aber nie ausgegeben (`void afaGebuchtVj`) – toter Zweig
   - Finanzübersicht: Datenbankfehler werden verschluckt, es erscheint 0
   - Finanzübersicht: Forderungen nur aus Rechnungen ab 1.1. des Vorjahres
   - Finanzübersicht, abgelaufenes Jahr: als letzte UVA erscheint Nov bzw. Q3 statt Dez bzw. Q4, der Monatsabschluss im selben Aufruf zählt dagegen 12 Monate
   - Finanzübersicht, Doppik-Übergabe: offene Rechnungen und Belege werden über beide Jahre gezählt (ab 1.1. des Vorjahres), auch nach dem Stichtag
   - Verschnitt-Storno: ohne Snapshot (Ziel vorher ohne Qualitätsstufe) bleibt die Verschnitt-Qualität am Ziel; ohne Quellmengen wird nur gelöscht
   - Umzug-/Verschnitt-Storno: spätere Bewegungen an Quell-Chargen sperren nicht
   - Umzug-Storno: bis 0,01 L Fehlmenge am Ziel wird still auf 0 gekappt (Toleranz)
   - Verkaufsstorno: eine gesperrte E&A-Einnahme (übermittelte UVA) bleibt ohne Meldung stehen – E&A bzw. UVA sind danach zu hoch, die Gegenbuchung ist offen (KAN-149)
   - Verkaufsstorno: CRM-Betreff ohne Rechnungsnummer mit doppeltem Leerzeichen
   - Verkauf: Zugang unter 0,005 L auf eine leere Charge wird als 0 L gespeichert

3. **Zugriffsschutz in der App:**
   - `src/lib/auth/roles.ts`, `sperren.ts`, `seitenBetrieb.ts`, `mfa.ts`, `einladung.ts`
   - `src/lib/api/zweiFaktor.ts`

   Die Wächter prüfen nur, *dass* diese Funktionen aufgerufen werden, nicht, *ob sie richtig entscheiden*. Kleine, gut testbare Einheiten.
4. **Server Actions:** 40 der 43 `'use server'`-Dateien sind ungetestet. Getestet sind Maßnahmen, Lager und AfA. Einzelne Actions sind nach Risiko nachzuziehen, zuerst Verkauf, Zahlungen, E&A und Kellerbuch.
5. **Getestete Dateien mit Branch-Coverage unter 70 %:**
   - `lib/fehler.ts` (33 %), `supabase/alle.ts` (43 %), `wein/blendKomposition.ts` (49 %), `wein/weinbuch.ts` (53 %), `pakete.ts` (56 %)
   - `assistent/tools/massnahme.ts` (61 %), `behandlungen/lager/actions.ts` (63 %), `buchhaltung/anlagen/actions.ts` (65 %)
   - `behoerden/keller-auswertungen.ts` (68 %), `behoerden/bewegungsbuch.ts` (68 %), `behoerden/weinbuch.ts` (69 %)
6. **Lint:** ESLint 9 einrichten (KAN-140). Nur Errors blockieren, die Anzahl der Warnings als Ausgangswert festhalten.
7. **E2E:** Playwright gegen Staging in die CI holen, sobald die Staging-Zugänge als GitHub-Secrets hinterlegt sind.

## Was automatische Tests nicht abdecken – manuelle Szenarien vor Releases

Jeweils auf Staging (https://staging.software112.icp-consultants.at) mit den Testkonten `admin@`, `betrieb@`, `winzer@` und `leser@software112.test`:

| # | Ablauf | Erwartung |
|---|---|---|
| 1 | Login mit 2FA, Betrieb wechseln | Kopfleiste zeigt den Betrieb; nur dessen Daten sind sichtbar |
| 2 | Maßnahme anlegen (Spritzung mit Mittel, Laubschneiden, Sonstiges), bearbeiten, Behandlungsprotokoll als Druck und CSV | Mengen, Wartefrist, Lagerabzug und CSV stimmen |
| 3 | Lese erfassen (°KMW/°Oe), Pressung, Umzug, Verschnitt | Bestände und Kellerbuch stimmen; Grenzfall-Hinweis erscheint |
| 4 | Füllung → Verkauf → Teilzahlungen → Storno | Flaschenbestand, Rechnung, E&A-Einnahme genau einmal, Storno bucht zurück |
| 5 | E&A: Buchung, Monatsabschluss, UVA sperren | Gesperrte Zeiträume lassen sich nicht mehr ändern |
| 6 | Behördenmeldungen (AMA-Erntemeldung, Weinbuch, Transportbescheinigung) als CSV | Excel öffnet sauber (Umlaute, Dezimalkomma) |
| 7 | Rolle Leser | Keine Schreibaktion möglich, Pflichtmeldungen nur mit Controlling |
| 8 | Handy-Ansicht: Navigation, Maßnahme erfassen | Bedienbar, nichts abgeschnitten |

## Pflege

- **Bei jeder Änderung:** `npm run verify` (siehe CLAUDE.md). Die Testzahl vorher und nachher vergleichen.
- **Monatlich bzw. vor größeren Releases:**
  - `npm run test:coverage` ausführen und die Tabellen hier nachziehen
  - `npm audit` und `npm outdated`
  - die manuellen Szenarien auf Staging durchgehen
  - Datum und Werte oben aktualisieren
