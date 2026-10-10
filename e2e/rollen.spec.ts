// ── Rollen: Leser schreibt nicht, Betriebsleitung sieht keine Plattform-Verwaltung ─
//
// Direkte Schreibaufrufe an die API (ohne Oberfläche) – der Leser wird mit 403 abgewiesen, BEVOR etwas geschrieben
// wird (Rollen- und Modulprüfung vor dem Lesen des Inhalts; leere Anfragen, daher auch im Nur-Lesen-Modus sicher).
// Die Schreib-Knöpfe auf den Listen prüft der Smoke-Test (SCHREIB_KNOEPFE in e2e/navigation.ts).

import { test, expect } from './fixtures'

/** Schreibende API-Routen mit eigener Rollen-/Modulprüfung (Admin-Client umgeht RLS – die Route muss prüfen) */
const SCHREIBROUTEN: { pfad: string; daten?: unknown }[] = [
  { pfad: '/api/weinexport', daten: {} },
  { pfad: '/api/kostenrechnung', daten: {} },
  { pfad: '/api/behandlungen/uebermittlung' },
  { pfad: '/api/buchhaltung/belege', daten: {} },
  { pfad: '/api/import', daten: {} },
]

test.describe('Rollen', { tag: '@lesend' }, () => {
  for (const r of SCHREIBROUTEN) {
    test(`Leser: POST ${r.pfad} → 403`, async ({ page, rolle }) => {
      test.skip(rolle !== 'leser', 'nur der Leser')
      const antwort = await page.request.post(r.pfad, { data: r.daten ?? {}, maxRedirects: 0 })
      expect(antwort.status(), `${r.pfad}: ${await antwort.text()}`).toBe(403)
    })
  }

  test('Betriebsleitung ohne Plattform-Recht: Mandantenverwaltung leitet aufs Dashboard', async ({ page, rolle }) => {
    test.skip(rolle !== 'tenant_admin', 'Betriebs-Manager des Testbetriebs (kein Plattform-Admin)')
    await page.goto('/admin/mandanten')
    await expect(page).toHaveURL(/\/dashboard/)
  })
})
