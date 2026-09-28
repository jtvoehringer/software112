# Stabilität von software:112

Stand und Ausgangswerte der automatischen Prüfungen. Grundlage ist Jörgens Vorgabe `softwaretests.md`, übernommen für software:112 mit Stufe 1 (PR #66) und Stufe 2 (dieses Dokument).
Regeln für jede Änderung stehen in der `CLAUDE.md`, Abschnitt „Stabilität (verbindlich)“.

## Ampel (28.09.2026)

| Bereich | Stand | Ampel |
|---|---|---|
| Build | `next build` auf Vercel, inkl. prebuild-Wächter und vollständiger Typprüfung | 🟢 |
| Typprüfung | `npm run typecheck` (`tsc --noEmit` über das ganze Programm): 0 Fehler | 🟢 |
| Unit-Tests | 823 Tests in 167 Suiten (27 Testdateien, `node:test`), alle grün, ca. 7 s | 🟢 |
| Projekt-Wächter | 8 Wächter (Mandantentrennung, 2FA, Seitenbetrieb, Schreibsperre, Schema, Barrierefreiheit, Behörden-CSV, Replica): 0 Funde | 🟢 |
| CI | Job „check“ = `npm run verify` (inkl. Lint) bei jedem PR und Push; `main` per Ruleset geschützt (Merge nur mit grünem „check“) | 🟢 |
| Abhängigkeiten | `npm audit`: 0 Schwachstellen (CI-Job „abhaengigkeiten“, ab Stufe hoch blockierend) | 🟢 |
| Coverage | gemessen, aber nur 90 von 604 `src`-Dateien werden von Tests geladen; kein Gate | 🟡 |
| Datenbank (RLS, Trigger, RPCs) | nur einmalige, zurückgerollte Tests bei Migrationen, nichts Wiederholbares | 🔴 |
| Server Actions | 43 Dateien mit `'use server'`, davon 3 mit Tests | 🔴 |
| Lint | `npm run lint` (ESLint 9, Flat Config `eslint.config.mjs`, eslint-config-next 16 core-web-vitals + typescript), Teil von `verify`: 0 Errors, 1.105 Warnings (Altbestand, blockieren nicht) | 🟡 |
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
Abdeckung:    90 von 604 Dateien unter src/ geladen; src/lib: 82 von 162 Dateien
```

**Ab jetzt gilt:** Die Testzahl darf nicht sinken. Typprüfung und Wächter bleiben bei 0 Fehlern. Die Coverage-Werte der geladenen Dateien sollen nicht spürbar fallen. Ein hartes Coverage-Gate gibt es bewusst noch nicht: Solange 514 Dateien gar nicht geladen werden, sagt die Prozentzahl wenig aus.

Neu messen: `npm run test:coverage`. Die Tabelle am Ende der Ausgabe listet je Datei Zeilen, Branches und Funktionen; Dateien, die kein Test lädt, fehlen darin.

### Lint-Warnings je Regel (Ausgangswert KAN-140, 28.09.2026)

`npm run lint` = `eslint .`, lokal ca. 2 min. Nur Errors blockieren (`verify`, CI), `--max-warnings` ist bewusst nicht gesetzt. Die Zahlen sollen nur sinken; neue Warnings möglichst vermeiden. Erster Lauf mit der reinen Next-Konfiguration: 1.028 Errors, 110 Warnings.

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
| kellerbuch | 5 | 2 | 2.245 | 84 % – **storno.ts (728 Zeilen) ungetestet** |
| assistent | 9 | 1 | 1.757 | 61 % |
| crm | 7 | 0 | 960 | – |
| auth | 10 | 1 | 828 | – |
| csv | 2 | 1 | 645 | 91 % |
| abo | 3 | 3 | 618 | 93 % |
| behandlungen | 3 | 3 | 595 | 95 % |
| verkauf | 1 | 0 | 458 | – **bestand.ts ungetestet** |
| ea | 3 | 2 | 424 | 77 % |
| finanzen | 1 | 0 | 242 | – |
| buchhaltung, svs, abo, utils, format, herkunft | | alle | | 93–100 % |

## Lücken, nach Risiko sortiert

1. **Datenbank-Logik ohne wiederholbare Tests** (RLS-Policies, Löschsperren, Schreibsperre, Periodensperre, Trigger wie `bestandsprotokoll`, RPCs wie `fuellung_bestand_buchen`, `schwund_buchen`, `berechne_ea_uva`). Das ist der Kern der Mandantentrennung und der Behördenzahlen. Heute gibt es nur einmalige DO-Block-Tests bei Migrationen.
   **Vorschlag (Stufe 3):** eine SQL-Testsuite gegen Staging. Jede Datei ist ein DO-Block mit `RAISE EXCEPTION` am Ende, läuft per `npx supabase db query --project-ref sjpeghrlhsowmquacjhb` und zählt „OK“-Meldungen. Zuerst für die Rollen × Tabellen der Mandantentrennung, die Schreibsperre und die E&A-Sperren.
2. **Buchungslogik mit Geld- und Bestandswirkung ohne Unit-Tests:**
   - `src/lib/kellerbuch/storno.ts` (728 Zeilen): Storno von Kellerbewegungen
   - `src/lib/kellerbuch/folgebuchungen.ts` (256)
   - `src/lib/verkauf/bestand.ts` (458): Verkauf, Bestandsabzug, Verkaufsstorno, E&A-Einnahmen
   - `src/lib/finanzen/uebersicht.ts` (242)

   Das sind die nächsten Kandidaten für Charakterisierungstests. Sie halten zuerst das heutige Verhalten fest und laufen mit Supabase-Attrappen wie in `scripts/tests/ea-verkaufseinnahmen.test.mjs`.
3. **Zugriffsschutz in der App:**
   - `src/lib/auth/roles.ts`, `sperren.ts`, `seitenBetrieb.ts`, `mfa.ts`, `einladung.ts`
   - `src/lib/api/zweiFaktor.ts`

   Die Wächter prüfen nur, *dass* diese Funktionen aufgerufen werden, nicht, *ob sie richtig entscheiden*. Kleine, gut testbare Einheiten.
4. **Server Actions:** 40 der 43 `'use server'`-Dateien sind ungetestet. Getestet sind Maßnahmen, Lager und AfA. Einzelne Actions sind nach Risiko nachzuziehen, zuerst Verkauf, Zahlungen, E&A und Kellerbuch.
5. **Getestete Dateien mit Branch-Coverage unter 70 %:**
   - `lib/fehler.ts` (33 %), `supabase/alle.ts` (43 %), `wein/blendKomposition.ts` (49 %), `wein/weinbuch.ts` (53 %), `pakete.ts` (56 %)
   - `assistent/tools/massnahme.ts` (61 %), `behandlungen/lager/actions.ts` (63 %), `buchhaltung/anlagen/actions.ts` (65 %)
   - `behoerden/keller-auswertungen.ts` (68 %), `behoerden/bewegungsbuch.ts` (68 %), `behoerden/weinbuch.ts` (69 %)
6. ~~**Lint:** ESLint 9 einrichten (KAN-140).~~ Erledigt 28.09.2026: `npm run lint` in `verify` und CI, 0 Errors, Warnings je Regel siehe oben. Offen bleibt der Abbau der Warnings, zuerst die React-Compiler-Regeln und die ungenutzten Werte.
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
