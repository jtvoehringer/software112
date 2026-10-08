# Stabilität von software:112

Stand und Ausgangswerte der automatischen Prüfungen. Grundlage ist Jörgens Vorgabe `softwaretests.md`, übernommen für software:112 mit Stufe 1 (PR #66) und Stufe 2 (dieses Dokument).
Regeln für jede Änderung stehen in der `CLAUDE.md`, Abschnitt „Stabilität (verbindlich)“.

## Ampel (28.09.2026)

| Bereich | Stand | Ampel |
|---|---|---|
| Build | `next build` auf Vercel, inkl. prebuild-Wächter und vollständiger Typprüfung | 🟢 |
| Typprüfung | `npm run typecheck` (`tsc --noEmit` über das ganze Programm): 0 Fehler | 🟢 |
| Unit-Tests | 976 Tests in 185 Suiten (32 Testdateien, `node:test`), alle grün, ca. 12 s | 🟢 |
| Projekt-Wächter | 10 Wächter (Mandantentrennung, 2FA, Seitenbetrieb, Schreibsperre, Schema, Barrierefreiheit, Behörden-CSV, Replica, Storno, seit 05.10.2026 `check-alle` gegen still bei 1.000 Zeilen gekappte Vollabfragen): 0 Funde | 🟢 |
| CI | Job „check“ = `npm run verify` (inkl. Lint) bei jedem PR und Push; `main` per Ruleset geschützt (Merge nur mit grünem „check“) | 🟢 |
| Abhängigkeiten | `npm audit`: 0 Schwachstellen (CI-Job „abhaengigkeiten“, ab Stufe hoch blockierend) | 🟢 |
| Coverage | gemessen, aber nur 98 von 604 `src`-Dateien werden von Tests geladen; kein Gate | 🟡 |
| Datenbank (RLS, Trigger, RPCs) | `npm run test:db`: wiederholbare SQL-Testsuite gegen Staging (14 Dateien, 8.598 Prüfungen, jede Datei zurückgerollt, `scripts/db-tests/README.md`); grün, aber 36 bekannte Lücken (siehe unten) | 🟡 |
| Server Actions | 43 Dateien mit `'use server'`, davon 3 mit Tests | 🔴 |
| Lint | ESLint 9 (Flat Config `eslint.config.mjs`, eslint-config-next 16 core-web-vitals + typescript), in `verify` als `npm run lint:verify`: 0 Errors, 1.105 Warnings (Altbestand; je Regel durch `scripts/eslint-baseline.json` gedeckelt) | 🟡 |
| E2E | Playwright-Grundgerüst gegen Staging (PR #55), in der CI noch übersprungen | 🟡 |

## Ausgangswerte (Baseline 28.09.2026, main 808fe6c)

```
Typprüfung:   0 Fehler (tsc --noEmit -p tsconfig.json)
Unit-Tests:   823 Tests, 167 Suiten, 27 Dateien – alle grün, ca. 7 s (verify gesamt lokal ca. 30 s, CI ca. 70 s)
Wächter:      8/8 grün, 0 Funde
npm audit:    0 Schwachstellen
Lint:         0 Errors, 1.105 Warnings (Stand 28.09.2026, KAN-140; je Regel siehe unten)
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

### Lint-Warnings je Regel (Ausgangswert KAN-140, 28.09.2026)

`npm run lint` = `eslint .` zeigt alle Befunde einzeln (lokal ca. 1–2 min, rund 2.400 Zeilen Ausgabe). `verify` und CI rufen stattdessen `npm run lint:verify` auf (`scripts/lint-zusammenfassung.mjs`): Errors vollständig, Warnings nur als Zählung je Regel (aktuell / Ausgangswert). Rot wird der Lauf bei einem Error oder wenn eine Regel mehr Warnings hat als in `scripts/eslint-baseline.json` (Regel ohne Eintrag = 0); dann zeigt das Skript die Stellen auf geänderten Zeilen (gegenüber dem Abzweig von `origin/main` bzw. `GITHUB_BASE_REF`, neue Dateien ganz; der CI-Job checkt dafür mit `fetch-depth: 0` aus – ohne ermittelbare Basis sagt das Skript das ausdrücklich, statt „keine davon in geänderten Dateien“ zu melden). Die Zahlen sollen nur sinken: nach einem Abbau `npm run lint:baseline` ausführen (schreibt nur, wenn keine Regel steigt) und die JSON-Datei mit committen – im Pull-Request-Lauf der CI ist der Lauf sonst rot (Ratsche: liegt eine Regel unter ihrem Ausgangswert, bleibt kein Spielraum für spätere neue Warnings; lokal und beim Push auf main nur ein Hinweis, weil zwei für sich grüne PRs, die dieselbe Regel je um eins senken, auf main sonst ein rotes Gate ergäben). Meldet ein PR „unter dem Ausgangswert“ für eine Regel, die er nicht angefasst hat (ein anderer PR hat sie auf main gesenkt, ohne dass die Baseline nachgezogen wurde), genügt nach einem Rebase auf main `npm run lint:baseline` und die JSON-Datei mit committen. Die Datei enthält bewusst nur `regeln` (kein Datum, keine Summe), damit parallele Abbauten verschiedener Regeln ohne Merge-Konflikt zusammengehen. Erhöhen nur von Hand mit Begründung im PR. Bekannte Grenze: gezählt wird je Regel, eine abgebaute Warning gleicht innerhalb desselben Stands eine neue derselben Regel in einer anderen Datei aus. Die reine Logik (Diff-Parser, Vergleich, Baseline, Exit-Code) liegt in `scripts/lint-auswertung.mjs`, Tests in `scripts/tests/lint-zusammenfassung.test.mjs`. Cache unter `node_modules/.cache/eslint/` (je Arbeitsverzeichnis eine Datei, `npm ci` leert ihn): erster Lauf ca. 1 min, danach rund 10 s. Erster Lauf mit der reinen Next-Konfiguration: 1.028 Errors, 110 Warnings.

Worktrees mit Junction auf die `node_modules` des Haupt-Checkouts: Nach dem Merge einer Änderung an `package-lock.json` dort `npm ci` ausführen – mit den alten Paketen (eslint-config-next 15 ohne `exports`) bricht `npm run lint` ab; `eslint.config.mjs` meldet das ausdrücklich. Paketänderung KAN-140: nur Dev-Abhängigkeiten, bis auf `zod` 4.6.5 – es kommt als `devOptional` (gebraucht von eslint-plugin-react-hooks 7, optionaler Peer von `@anthropic-ai/sdk`) und wird damit auch bei `npm ci --omit=dev` installiert. Im App-Code nicht darauf verlassen: wer zod braucht, trägt es ausdrücklich in `dependencies` ein.

| Regel | Warnings | Anmerkung |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | 912 | auf warn gestellt (Konvention `(supabase.from(…) as any)`) |
| `react/no-unescaped-entities` | 33 | auf warn gestellt, rein kosmetisch (gerade Anführungszeichen in JSX-Text) |
| `@typescript-eslint/no-unused-vars` | 32 | vorher 41; 9 ungenutzte Importe/Typen entfernt. Rest sind berechnete, aber nie verwendete Werte – teils prüfenswert (z. B. `gesamtUst`, `tankPos` in `weinhandel/verkauf/[id]/page.tsx`, `kundenRabatt` in `weinhandel/verkauf/neu/page.tsx`) |
| `react-hooks/set-state-in-effect` | 27 | React-Compiler-Regel (react-hooks 7), auf warn gestellt |
| unbenutzte `eslint-disable`-Kommentare | 27 | Kommentare, die nichts mehr unterdrücken (`reportUnusedDisableDirectives: 'warn'`) |
| `react-hooks/exhaustive-deps` | 24 | Standard warn |
| `react-hooks/refs` | 12 | React-Compiler-Regel, auf warn gestellt |
| `@typescript-eslint/no-unused-expressions` | 11 | Standard warn (`a && b()` als Anweisung) |
| `react-hooks/use-memo` | 8 | React-Compiler-Regel, auf warn gestellt (Ausdrücke in Abhängigkeitslisten, CRM-Kalender) |
| `react-hooks/purity` | 6 | React-Compiler-Regel, auf warn gestellt (`Date.now()` im Render) |
| `@next/next/no-location-assign-relative-destination` | 5 | Standard warn |
| `@next/next/no-html-link-for-pages` | 3 | auf warn gestellt: `<a>` statt `<Link>` (voller Reload) in `erntemeldung/neu`, `lagen/[id]`, `lagen/neu` |
| `@next/next/no-img-element` | 2 | Standard warn |
| `react-hooks/static-components` | 2 | React-Compiler-Regel, auf warn gestellt (`ChargenTabelle` in `kellerbuch/weinausbau/page.tsx` im Render definiert) |
| `react-hooks/immutability` | 1 | React-Compiler-Regel, auf warn gestellt (`zeichnen` in `RiedKarte.tsx` vor der Deklaration benutzt – per Hoisting funktionsfähig) |

Abgeschaltet sind nur `@typescript-eslint/no-require-imports` für die CommonJS-Wächter unter `scripts/` und `react-hooks/rules-of-hooks` unter `e2e/` (Playwrights Fixture-Callback heißt `use`). `react-hooks/rules-of-hooks` bleibt sonst Error (Abnahme: ein bedingter `useState` wird als Error gemeldet).

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

1. **Datenbank-Logik – Testsuite steht (29.09.2026), 36 bekannte Lücken.** `npm run test:db` prüft auf Staging Mandantentrennung (lesen/schreiben, dynamisch über alle Tabellen mit `tenant_id`), Rollen und Modulrechte, inaktive Mitgliedschaft, Abo-Schreibsperre, Zwei-Faktor, Paket-/Geheimnisspalten, Plattform-Admin, SECURITY-DEFINER-RPCs, Storage-Ordner, Sperr-/Protokoll-Trigger und Katalog-Invarianten; Mutationsprüfung je Datei. Ausführen nach jeder Migration (zuerst Staging) und vor Releases; läuft ca. 17 min (fast nur CLI-Verbindungsaufbau).
   Die Lücken zeigt jeder Lauf unter „Bekannte Lücken“ (B1–B17, BK1–BK4); B1, B9, B13 und BK1/BK2 seit KAN-159 (29.09.2026) behoben und hart geprüft; die wichtigsten offenen: B2 96 Fremdschlüssel ohne Mandantenprüfung, B7/B8 E&A- und Jahrgangssperren nur in der App, B16/B17 Betriebs- bzw. Modulschalter nicht in der DB durchgesetzt.
   Offen im Testrahmen (Review Runde 2, nicht mehr umgesetzt): Fremd-UPDATE/DELETE nur per PK geprüft (maskiert durch SELECT-Policy), Personas mit unterschiedlicher Rolle je Betrieb fehlen, tenants-Zeile fremder Betrieb nicht geprüft, Modulprüfung von fuellung_bestand_buchen/schwund_buchen nicht ausgeführt, Restprüfung wertet 4 Spalten nicht aus, statische RAISE-Prüfung per Quoting umgehbar.
2. **Buchungslogik – Rest nach den Charakterisierungstests vom 28.09.2026.**
   `verkauf/bestand.ts`, `kellerbuch/storno.ts`, `kellerbuch/folgebuchungen.ts` und `finanzen/uebersicht.ts` sind jetzt durch Charakterisierungstests abgedeckt: `scripts/tests/verkauf-bestand`, `kellerbuch-storno`, `kellerbuch-folgebuchungen` und `finanzen-uebersicht.test.mjs`, gemeinsame Supabase-Attrappe in `scripts/tests/buchung-attrappe.mjs` (wertet Filter, select-Liste samt Einbettungen/`!inner` und Sortierung wie PostgREST aus, Selbsttest in `buchung-attrappe.test.mjs`; was sie nicht nachbildet – Schema, Trigger, Kaskaden, echte RLS –, steht im Kopfkommentar). Sie halten das heutige Verhalten fest, auch die als „Befund“ markierten Auffälligkeiten – wer eines davon bewusst ändert, passt den Test mit an.
   Offen bleiben:
   - die Server Actions, die diese Bausteine aufrufen (`weinhandel/verkauf/actions.ts` createVerkauf/stornoVerkauf, `weinhandel/traubenverkauf/actions.ts`, `kellerbuch/gebinde-actions.ts`, `kellerbuch/actions.ts`), siehe Lücke 4
   - die DB-Seite (Trigger `bestandsprotokoll`, RPCs `fuellung_bestand_buchen`, `schwund_buchen`), siehe Lücke 1
   - `finanzen/uebersicht.ts` mit 75 % Branch-Coverage

   Befunde aus den Tests (festgehalten, nicht korrigiert – Entscheidung offen):
   - Finanzübersicht: Buchungen ohne Kategorie landen in einem Topf „–“, Einnahmen und Ausgaben werden addiert
   - ~~Finanzübersicht: Stichtag, UVA-Fälligkeit, Jahr und Monat nach UTC bzw. Serverzeit~~ – erledigt mit KAN-157/158 (29.09.2026): Kontext `heute` über `wienJetzt()`, Tage über `tageSeit()` (`src/lib/datum/wien.ts`), Tests in `finanzen-uebersicht.test.mjs`.
   - ~~Finanzübersicht: Überfälligkeit am Zeitpunkt statt am Kalendertag~~ – erledigt mit KAN-157 (volle Kalendertage in Wien).
   - Entscheidung Jörgen 08.10.2026 (KAN-237): Die App bildet das Datum grundsätzlich nach Europe/Vienna. Alle 54 Stellen mit „heute“ aus `new Date().toISOString()` (Formular-Vorbelegungen, Standarddaten in Server Actions, MFA-Pflicht ab) nutzen `heuteWien()`, das E-Mail-Datum aus Microsoft Graph `wienTag()`; `kan237-datum-wien.test.mjs` verhindert neue UTC-„heute“ im Code.
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

3. ~~**Zugriffsschutz in der App:**~~ Abgedeckt seit 08.10.2026 (KAN-238): `scripts/tests/zugriffsschutz.test.mjs` prüft die echten Module mit ersetzten Abhängigkeiten (Supabase, Cookie, Subdomain, Header, Abo-Kopf) – Rechte nach Rolle und Modul, aktive Mitgliedschaft (Sitzung, aal2, Cookie, Rückfall, Subdomain), Zwei-Faktor-Pflicht und API-Prüfung, Schreib- und Sitzungssperre, Betrieb der Seite. Offen: `einladung.ts` (Konto anlegen/zuordnen, Supabase-Admin-API).
   Ursprüngliche Lücke:
   - `src/lib/auth/roles.ts`, `sperren.ts`, `seitenBetrieb.ts`, `mfa.ts`, `einladung.ts`
   - `src/lib/api/zweiFaktor.ts`

   Die Wächter prüfen nur, *dass* diese Funktionen aufgerufen werden, nicht, *ob sie richtig entscheiden*. Kleine, gut testbare Einheiten.
4. **Server Actions:** Seit 08.10.2026 (KAN-239) getestet: Verkauf (`scripts/tests/verkauf-actions.test.mjs` – Kontext vor jedem Zugriff, Ablehnungen von createVerkauf ohne Schreibzugriff, Erfolg mit Reihenfolge Bestand → Beleg, Rücknahme bei Fehlschlag, Storno, Zahlung, Zahlungsstorno; Zahlungen erfassen/als bezahlt markieren/stornieren prüfen seit KAN-239 die Freigabe Warenwirtschaft oder E&A wie RLS). Konten und Kellerbuch (`scripts/tests/konten-kellerbuch-actions.test.mjs`, KAN-241 – Schreibrecht vorab in jeder Kellerbuch-Action; offen KAN-242: Lager, Lagen, Weinbaugebiete, Rabattgruppen, Sonstige Artikel, Maßnahmen). Rest ursprünglich: 40 der 43 `'use server'`-Dateien sind ungetestet. Getestet sind Maßnahmen, Lager und AfA. Einzelne Actions sind nach Risiko nachzuziehen, zuerst Verkauf, Zahlungen, E&A und Kellerbuch.
5. **Getestete Dateien mit Branch-Coverage unter 70 %:**
   - `lib/fehler.ts` (33 %), `supabase/alle.ts` (43 %), `wein/blendKomposition.ts` (49 %), `wein/weinbuch.ts` (53 %), `pakete.ts` (56 %)
   - `assistent/tools/massnahme.ts` (61 %), `behandlungen/lager/actions.ts` (63 %), `buchhaltung/anlagen/actions.ts` (65 %)
   - `behoerden/keller-auswertungen.ts` (68 %), `behoerden/bewegungsbuch.ts` (68 %), `behoerden/weinbuch.ts` (69 %)
6. ~~**Lint:** ESLint 9 einrichten (KAN-140).~~ Erledigt 28.09.2026: Lint in `verify` und CI (`npm run lint:verify`), 0 Errors, Warnings je Regel siehe oben und gedeckelt durch `scripts/eslint-baseline.json`. Offen bleibt der Abbau der Warnings, zuerst die React-Compiler-Regeln und die ungenutzten Werte.
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
