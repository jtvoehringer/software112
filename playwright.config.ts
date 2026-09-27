// ── Playwright: Regressionstests (e2e/) ───────────────────────────────────────
//
// NIE schreibend gegen die Produktion (software112.icp-consultants.at bzw. Supabase-Projekt
// zwcsgnemijkpyxrqykul). Ist das Ziel die Produktion – oder nicht sicher bestimmbar –,
// bricht die Config ab, außer E2E_NUR_LESEN=1: dann laufen nur Tests mit Tag @lesend.
// Details, Variablen und Einrichtung: e2e/README.md

import { defineConfig, devices } from '@playwright/test'
import type { Optionen } from './e2e/fixtures'
import { authDatei, BASE_URL, NUR_LESEN, PRODUKTIONS_DOMAIN, PRODUKTIONS_SUPABASE_REF, ROLLEN, rolleKonfiguriert, vercelBypassHeader, zielPruefen } from './e2e/umgebung'

const ziel = zielPruefen()
// `playwright test --list` führt nichts aus – Auflisten bleibt ohne Zielumgebung möglich
const nurAuflisten = process.argv.includes('--list')

if (ziel.produktion && !NUR_LESEN && !nurAuflisten) {
  throw new Error([
    '',
    '✗ E2E-Tests abgebrochen: Das Ziel ist (möglicherweise) die PRODUKTION.',
    ...ziel.gruende.map(g => `  • ${g}`),
    `  Basis-URL: ${ziel.baseUrl}`,
    `  Supabase:  ${ziel.supabase ?? '(unbekannt)'}`,
    '',
    `  Schreibende Tests laufen nur gegen eine eigene Test-Umgebung (nicht ${PRODUKTIONS_DOMAIN} / ${PRODUKTIONS_SUPABASE_REF}).`,
    '  Nur lesende Prüfungen: E2E_NUR_LESEN=1 setzen (npm run test:e2e:lesend) – dann laufen nur Tests mit @lesend.',
    '',
  ].join('\n'))
}

const CI = !!process.env.CI

export default defineConfig<Optionen>({
  testDir: './e2e',
  // Nur lesend (ausdrücklich oder gegen Produktion): schreibende Tests gar nicht erst sammeln
  grep: NUR_LESEN ? /@lesend/ : undefined,
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: './e2e/.ergebnisse',
  use: {
    baseURL: BASE_URL,
    locale: 'de-AT',
    timezoneId: 'Europe/Vienna',
    extraHTTPHeaders: vercelBypassHeader(),
    screenshot: 'only-on-failure',
    // Traces enthalten Sitzungs-Cookies – in CI (Artefakte) deshalb aus
    trace: CI ? 'off' : 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts$/ },
    ...ROLLEN.map(rolle => ({
      name: rolle,
      testMatch: /.*\.spec\.ts$/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        rolle,
        // Ohne Zugangsdaten gibt es keine Datei – die Tests der Rolle werden dann übersprungen
        storageState: rolleKonfiguriert(rolle) ? authDatei(rolle) : undefined,
      },
    })),
  ],
})
