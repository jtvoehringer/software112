# E2E-Regressionstests (Playwright)

Grundgerüst für automatisierte Regressionstests von software:112 im echten Browser.
Ziel: Nach jeder Änderung schnell sehen, ob Navigation, Rollen, Mandantentrennung und
Behördenmeldungen noch funktionieren – bevor Winzer es merken.

## Warum nie gegen die Produktion

Die Produktion (`software112.icp-consultants.at`, Supabase-Projekt `zwcsgnemijkpyxrqykul`)
enthält echte Betriebsdaten (u. a. Weingut Gebeshuber im Echtbetrieb). Ein schreibender Test
legt dort Datensätze an, vergibt Nummern (Rechnungs-, Kunden-, Liefernummern – Lücken sind
steuerlich relevant), löst Trigger und Protokolle aus und kann bei einem Abbruch Reste
hinterlassen. Schreibende Tests laufen deshalb **nur gegen Staging** (seit 26.09.2026:
`https://staging.software112.icp-consultants.at`, Supabase-Projekt `sjpeghrlhsowmquacjhb`, Testbetrieb
„Weingut Musterhof (Demo)“ mit den Konten `admin@`, `betrieb@`, `winzer@`, `leser@software112.test`)
oder gegen einen lokalen Supabase-Stack:

- `playwright.config.ts` **bricht ab**, wenn
  - `E2E_BASE_URL` die Produktions-Domain enthält,
  - irgendeine Supabase-Angabe (`E2E_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, bei lokaler
    Basis-URL auch `.env.local`) die Produktions-Ref enthält, oder
  - das Supabase-Projekt unbekannt bzw. keine gültige Supabase-URL ist (z. B. entfernte
    Basis-URL ohne `E2E_SUPABASE_URL` – Vercel-Previews nutzen die Produktions-Datenbank!),
  - das Supabase-Projekt weder Staging (`sjpeghrlhsowmquacjhb`) noch ein lokaler Stack ist
    (Positivliste seit 10.10.2026; `scripts/tests/e2e-zielschutz.test.mjs` prüft das in `verify`).
- Ausnahme: `E2E_NUR_LESEN=1` – dann sammelt Playwright nur Tests mit Tag `@lesend`.
- Jeder schreibende Test ruft zusätzlich `schreibend()` auf (zweite Sicherung zur Laufzeit,
  falls jemand den Filter per `--grep` überschreibt).
- Wer lokal mit `npm run dev` gegen die Produktions-Datenbank arbeitet (`.env.local`), kann
  deshalb nur `npm run test:e2e:lesend` ausführen. Das ist Absicht.

Auch „lesende“ Tests gegen die Produktion hinterlassen Spuren (Anmeldungen im Auth-Log,
Seitenaufrufe). Sie ändern aber keine fachlichen Daten.

## Aufbau

| Datei | Zweck |
|---|---|
| `playwright.config.ts` | Ziel prüfen (Produktionsschutz), Projekte `setup` + je Rolle `tenant_admin`, `winzer`, `leser` |
| `e2e/umgebung.ts` | alle Umgebungsvariablen, `.env.e2e`, Rollen, `schreibenErlaubt()` |
| `e2e/auth.setup.ts` | Anmeldung je Rolle (inkl. TOTP und Betriebsauswahl) → `e2e/.auth/<rolle>.json` |
| `e2e/totp.ts` | TOTP-Code (RFC 6238) mit `node:crypto` |
| `e2e/fixtures.ts` | Option `rolle`, Überspringen ohne Zugangsdaten, Konsolenfehler, Fehlerbild-Prüfung |
| `e2e/navigation.ts` | Seitenpfade je Rolle aus `buildNav()` (`src/lib/navigation`) – nicht abgeschrieben |
| `e2e/smoke.spec.ts` | `@lesend` jede Navigationsseite je Rolle; Leser ohne Schreib-Knöpfe |
| `e2e/mandantentrennung.spec.ts` | `@lesend` fremde Datensatz-URLs → 404/Weiterleitung/leer |
| `e2e/behoerden-csv.spec.ts` | `@lesend` `/meldungen/<id>/csv`: 200, BOM, `;`, CRLF |
| `e2e/crm-kontakt.spec.ts` | Muster eines **schreibenden** Tests: Kontakt anlegen und löschen |

Tags: `@lesend` = ändert keine Daten. Alles ohne `@lesend` gilt als schreibend.

## Einrichtung

```bash
npm ci
npx playwright install chromium        # Browser einmalig (nicht im postinstall)
cp .env.e2e.example .env.e2e           # ausfüllen – Datei ist gitignored
npm run dev                            # in einem zweiten Terminal (oder E2E_BASE_URL setzen)

npm run test:e2e                       # alle Tests (nur gegen Test-Umgebung)
npm run test:e2e:lesend                # nur @lesend (setzt E2E_NUR_LESEN=1)
npx playwright test --list             # Tests auflisten (läuft ohne Zugangsdaten)
npx playwright test --project=leser    # nur eine Rolle
npm run type-check:e2e                 # TypeScript der Tests (eigene tsconfig)
```

Die App-`tsconfig.json` schließt `e2e/` und `playwright.config.ts` aus, damit `next build`
und `tsc --noEmit` nicht von Playwright abhängen; die Tests haben `e2e/tsconfig.json`.

## Variablen

| Variable | Bedeutung |
|---|---|
| `E2E_BASE_URL` | Ziel, Standard `http://localhost:3000` |
| `E2E_SUPABASE_URL` | Supabase-Projekt der getesteten App (Pflicht bei entfernter Basis-URL) |
| `E2E_NUR_LESEN` | `1` = nur `@lesend` (Pflicht, wenn das Ziel die Produktion ist) |
| `E2E_<ROLLE>_EMAIL`, `E2E_<ROLLE>_PASSWORT` | Zugang je Rolle (`TENANT_ADMIN`, `WINZER`, `LESER`); fehlt er, werden die Tests der Rolle übersprungen |
| `E2E_<ROLLE>_TOTP_SECRET` | Base32-Geheimnis, wenn das Konto Zwei-Faktor nutzt (Code wird im Test berechnet) |
| `E2E_<ROLLE>_TENANT_ID` | aktiver Betrieb, wenn das Konto zu mehreren Betrieben gehört |
| `E2E_FREMDE_IDS` | JSON-Array mit Pfaden aus einem **fremden** Betrieb, z. B. `["/crm/kontakte/<uuid>", {"pfad": "/kellerbuch/weinausbau/<uuid>", "text": "Name nur dort"}]` |
| `E2E_MODULE` | Modul-Toggles des Test-Betriebs (`modul_ea,modul_controlling,…`); leer = alle an |
| `E2E_KONSOLE_IGNORIEREN` | weitere erlaubte Konsolenmeldungen (Regex, mit `\|\|` getrennt) |
| `E2E_VERCEL_BYPASS` | Secret „Protection Bypass for Automation“ für geschützte Vercel-Previews |

Zugangsdaten stehen nur in `.env.e2e` (lokal) bzw. in GitHub-Secrets – nie im Repository.
Die Test-Konten sollten eigene Konten eines eigenen Test-Betriebs sein (kein Konto einer
echten Person). Der Setup-Schritt richtet **keinen** zweiten Faktor ein: Verlangt ein Konto die
Einrichtung, einmal manuell einrichten und das Geheimnis als `E2E_<ROLLE>_TOTP_SECRET` hinterlegen.

## GitHub-Workflow (seit 10.10.2026)

1. **Merge auf main** → `.github/workflows/staging.yml` spiegelt main auf den Branch `staging` (wenige Sekunden).
2. **Vercel** baut `staging` in der Umgebung „staging“ und meldet das Deployment an GitHub.
3. **`.github/workflows/e2e.yml`** startet auf den fertigen Staging-Deploy (`deployment_status` = success,
   Umgebung `staging`) und führt **alle** Tests aus, auch schreibende. Manuell (`workflow_dispatch`) ebenso,
   wahlweise nur lesend. Nicht bei PRs und nicht nach Preview-Deploys (Actions-Minuten, KAN-269).

Ziel und Datenbank stehen fest im Workflow. Als Secrets (Settings → Secrets and variables → Actions) nur:

| Secret | Inhalt |
|---|---|
| `E2E_WINZER_EMAIL`, `E2E_WINZER_PASSWORT` | `winzer@software112.test` – zugleich Schalter „E2E aktiv“ |
| `E2E_LESER_EMAIL`, `E2E_LESER_PASSWORT` | `leser@software112.test` |
| `E2E_TENANT_ADMIN_EMAIL`, `E2E_TENANT_ADMIN_PASSWORT` | `betrieb@software112.test` |
| `E2E_TENANT_ADMIN_TOTP_SECRET` | Base32-Geheimnis des Authenticators von `betrieb@` (2FA-Pflicht für Admins ab 15.10.2026) |
| `E2E_VERCEL_BYPASS` | Vercel → Projekt software112 → Settings → Deployment Protection → „Protection Bypass for Automation“ (nur nötig, wenn Staging geschützt ist) |

Mandantentrennung: Gegen Staging prüfen die Tests ohne weitere Angabe den Betrieb „E2E Fremdbetrieb (nur Staging)“
(`44444444-…`, Kontakt, Firma, Tank; `STAGING_FREMDE` in `e2e/umgebung.ts`) – `E2E_FREMDE_IDS` ist nur für andere Ziele nötig.
 Bei Fehlern wird der Bericht (Screenshots) 7 Tage als Artefakt aufbewahrt;
Traces sind in CI aus, weil sie Sitzungs-Cookies enthalten.

## Ausbau-Plan

**Stand 10.10.2026:**
- Umgesetzt:
  - `verkauf.spec.ts`: Verkauf anlegen → Bestand −1 → Storno → Bestand wie vorher (schreibend, Notiz „E2E-Test …“)
  - `druck-csv.spec.ts`: Cu-Bilanz, Nährstoffbilanz und Behandlungsprotokoll, Druck = CSV
  - `rollen.spec.ts`: Leser-Schreibaufrufe an fünf API-Routen → 403, Mandantenverwaltung nur für die Plattform; Schreibknöpfe auf Zukauf und Lese im Smoke-Test
- Offen: Kellerbuch-Ablauf (1), Rechnung/Zahlung im Verkauf (Rest von 2), automatische Mandantentrennung (5), Aufräumen (6)
- Einzelne Dateien per Workflow-Eingabe „auswahl“ starten (z. B. `e2e/verkauf.spec.ts`)

Sobald es eine Test-Umgebung gibt (eigenes Supabase-Projekt oder Supabase-Branch mit
Testdaten, z. B. Kopie von „Weingut Musterhof (Demo)“), die kritischen Abläufe schreibend absichern:

1. **Kellerbuch-Buchung** – Lese → Pressung → Behälter, Umziehen, Verschnitt, Füllung;
   Bestände und Weinbuch-CSV danach prüfen.
2. **Verkauf → Rechnung → Storno** – Verkauf anlegen, Rechnungsnummer fortlaufend, Bestand
   reduziert, bezahlt setzen, Storno bucht zurück, offene Posten stimmen.
3. **Behördenmeldungen** – Druckseite und CSV liefern dieselben Summen (gleiche Ladefunktion);
   alle Katalog-Meldungen samt Parametern, Leermeldung (nur Kopfzeile, `X-Zeilen: 0`).
4. **Rollen** – je Rolle Schreibversuche über UI und Server Actions (Leser: abgewiesen),
   Pflichtmeldungen ohne Modul Controlling, Admin-Seiten nur für Plattform-Admins,
   Nur-Lesen-Modus bei gesperrtem Abo.
5. **Mandantentrennung** – automatisch Datensätze in Betrieb B anlegen und aus Betrieb A
   abrufen (statt fester `E2E_FREMDE_IDS`), auch für CSV-Routen und `/api`.
6. Aufräumen: Testdaten mit Präfix „E2E-Test“ nach jedem Lauf per Service-Role entfernen;
   danach Testlauf im Workflow bei jedem PR gegen die Test-Umgebung.
