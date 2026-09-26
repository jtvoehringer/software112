// ── Gemeinsame Fixtures der E2E-Tests ─────────────────────────────────────────
//
//  rolle            Option je Playwright-Projekt (tenant_admin | winzer | leser)
//  (automatisch)    Test wird übersprungen, wenn für die Rolle keine Zugangsdaten gesetzt sind
//  konsolenFehler   sammelt console.error und unbehandelte Seitenfehler (mit Allowlist)
//  schreibend()     Laufzeit-Schutz für schreibende Tests (zusätzlich zum grep der Config)

import { test as basis, expect, type Page } from '@playwright/test'
import { konsoleIgnorieren, rolleKonfiguriert, schreibenErlaubt, zielPruefen, type Rolle } from './umgebung'

export type Optionen = { rolle: Rolle }

/** Konsolenmeldungen, die kein Anwendungsfehler sind */
const KONSOLE_ALLOWLIST: RegExp[] = [
  /Download the React DevTools/i,
  /favicon\.ico/i,
  // Browser meldet abgebrochene Prefetches/Navigationen als Fehler
  /net::ERR_ABORTED/i,
  /Failed to fetch RSC payload/i,
  // Vercel-Toolbar/Analytics auf Previews
  /vercel\.(live|com)\/.*(toolbar|_next-live)/i,
  /\/_vercel\/(insights|speed-insights)/i,
  // CSP-Berichtsmodus meldet Verstöße nur (kein Blockieren)
  /\[Report Only\]/i,
]

export type KonsolenFehler = { liste: string[] }

function konsolenFehlerSammeln(page: Page): KonsolenFehler {
  const erlaubt = [...KONSOLE_ALLOWLIST, ...konsoleIgnorieren()]
  const liste: string[] = []
  const merken = (text: string) => {
    if (!erlaubt.some(re => re.test(text))) liste.push(text)
  }
  page.on('console', msg => {
    if (msg.type() === 'error') merken(`console.error: ${msg.text()} (${msg.location().url})`)
  })
  page.on('pageerror', err => merken(`Seitenfehler: ${err.message}`))
  return { liste }
}

export const test = basis.extend<{ konsolenFehler: KonsolenFehler; _zugangPruefen: void }, Optionen>({
  rolle: ['tenant_admin', { option: true, scope: 'worker' }],

  _zugangPruefen: [async ({ rolle }, use) => {
    basis.skip(!rolleKonfiguriert(rolle), `Keine Zugangsdaten für Rolle ${rolle} (E2E_${rolle.toUpperCase()}_EMAIL/_PASSWORT)`)
    await use()
  }, { auto: true }],

  konsolenFehler: async ({ page }, use) => {
    await use(konsolenFehlerSammeln(page))
  },
})

/**
 * Am Anfang JEDES schreibenden Tests aufrufen. Der Config-Schutz filtert schreibende Tests
 * gegen die Produktion bereits heraus (grep @lesend) – das hier ist die zweite Sicherung,
 * falls jemand den grep per Kommandozeile überschreibt.
 */
export function schreibend(): void {
  const ziel = zielPruefen()
  basis.skip(!schreibenErlaubt(), `Schreibender Test gesperrt: ${ziel.gruende.join('; ') || 'E2E_NUR_LESEN=1'}`)
}

/** Next.js-Fehlerbilder bzw. die Fehlerseite der App (src/app/(dashboard)/error.tsx) */
export const FEHLER_TEXTE = /Application error|Unhandled Runtime Error|Internal Server Error|Da ist etwas schiefgelaufen|This page could not be found/i

export async function keinFehlerbild(page: Page): Promise<void> {
  // Next.js-Dev-Overlay (nur `next dev`) – bei Fehlern mit sichtbarem Dialog
  await expect(page.locator('nextjs-portal [data-nextjs-dialog], nextjs-portal [data-nextjs-toast-errors]'), 'Next.js-Fehler-Overlay sichtbar').toHaveCount(0)
  await expect(page.locator('body'), 'Fehlerseite statt Inhalt').not.toContainText(FEHLER_TEXTE)
}

export { expect }
