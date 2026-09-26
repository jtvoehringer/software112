// ── Mandantentrennung: Datensätze eines fremden Betriebs bleiben unsichtbar ────
//
// E2E_FREMDE_IDS = JSON-Array mit Pfaden zu Datensätzen aus Betrieb B, z. B.
//   ["/crm/kontakte/<uuid>", { "pfad": "/kellerbuch/weinausbau/<uuid>", "text": "Grüner Veltliner Ried X 2025" }]
// Die Test-Benutzer gehören zu Betrieb A. Erwartet: 404, Weiterleitung weg vom Pfad
// oder eine leere Seite (der optionale `text` des fremden Datensatzes kommt nicht vor).

import { test, expect } from './fixtures'
import { fremdeDatensaetze } from './umgebung'

const NICHT_GEFUNDEN = /nicht gefunden|existiert nicht|could not be found|kein Zugriff|keine Berechtigung/i

test.describe('Mandantentrennung', { tag: '@lesend' }, () => {
  const datensaetze = fremdeDatensaetze()

  test('fremde Datensätze konfiguriert', async () => {
    test.skip(datensaetze.length === 0, 'E2E_FREMDE_IDS nicht gesetzt – Mandantentrennung wird nicht geprüft')
    expect(datensaetze.length).toBeGreaterThan(0)
  })

  for (const d of datensaetze) {
    test(`fremder Datensatz ${d.pfad}`, async ({ page, rolle }) => {
      test.skip(!!d.rollen && !d.rollen.includes(rolle), `nur für ${d.rollen?.join(', ')}`)

      const antwort = await page.goto(d.pfad, { waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
      const status = antwort?.status() ?? 0
      const ziel = new URL(page.url()).pathname
      const body = await page.locator('body').innerText()

      if (d.text) expect(body, 'Inhalt des fremden Datensatzes sichtbar').not.toContain(d.text)

      const abgewiesen = status === 404 || status === 403 || ziel !== d.pfad || NICHT_GEFUNDEN.test(body)
      if (!d.text) {
        expect(abgewiesen, `HTTP ${status}, Ziel ${ziel}: weder 404 noch Weiterleitung noch Hinweis „nicht gefunden“ – ohne „text“ ist eine leere Seite nicht prüfbar`).toBe(true)
      }
      expect(status, 'Serverfehler statt sauberer Abweisung').toBeLessThan(500)
    })
  }
})
