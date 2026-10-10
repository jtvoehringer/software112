// ── Behördenmeldungen: Druckseite und CSV liefern dieselben Zahlen ────────────
//
// Druck und CSV laden über dieselbe Funktion; die Druckseite addiert die gerundeten Zeilenwerte (CLAUDE.md,
// „Behördenmeldungen immer auch als CSV“). Hier im echten Lauf geprüft: die Summe in der Fußzeile der Druckseite
// gleich der Spaltensumme der CSV bzw. die angezeigte Zeilenzahl gleich X-Zeilen. Nur lesend; als Betriebs-Manager.

import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { csvTabelle, spaltenSumme, zahlDe } from './csv-lesen'

/** CSV der Meldung laden (Status 200, X-Zeilen) */
async function csv(page: Page, id: string, parameter: Record<string, string>) {
  const r = await page.request.get(`/meldungen/${id}/csv?${new URLSearchParams(parameter)}`, { maxRedirects: 0 })
  expect(r.status(), `CSV ${id}: ${r.status() >= 400 ? await r.text() : ''}`).toBe(200)
  return { tabelle: csvTabelle((await r.body()).toString('utf8')), zeilen: Number(r.headers()['x-zeilen']) }
}

/** Jahr aus dem Seitenkopf („Jahr 2026“ bzw. „Saison 2026“) */
async function jahrDerSeite(page: Page): Promise<string> {
  const m = /(?:Jahr|Saison)\s+(\d{4})/.exec(await page.locator('main').innerText())
  expect(m, 'Jahr im Seitenkopf nicht gefunden').not.toBeNull()
  return m![1]
}

/** Zellen der Fußzeile (GESAMT …) als Text */
async function fusszeile(page: Page): Promise<string[]> {
  const zeile = page.locator('tfoot tr').filter({ hasText: 'GESAMT' }).first()
  await expect(zeile, 'Fußzeile GESAMT fehlt').toBeVisible()
  return zeile.locator('td').allInnerTexts()
}

test.describe('Behördenmeldungen – Druck = CSV', { tag: '@lesend' }, () => {
  test.beforeEach(({ rolle }) => { test.skip(rolle !== 'tenant_admin', 'Pflichtmeldungen der Betriebsleitung – einmal je Lauf') })

  test('Cu-Bilanz: GESAMT kg = Summe „Cu (kg)“ der CSV', async ({ page }) => {
    await page.goto('/reports/cu-bilanz')
    const jahr = await jahrDerSeite(page)
    const zellen = await fusszeile(page)
    const druck = zahlDe(zellen[1])
    const { tabelle } = await csv(page, 'cu-bilanz-behandlungen', { jahr })
    expect(spaltenSumme(tabelle, 'Cu (kg)')).toBeCloseTo(druck, 3)
  })

  test('Nährstoffbilanz: N und P (kg) = Spaltensummen der CSV', async ({ page }) => {
    await page.goto('/reports/naehrstoffbilanz')
    const jahr = await jahrDerSeite(page)
    const zellen = await fusszeile(page)
    const { tabelle } = await csv(page, 'naehrstoffbilanz', { jahr })
    expect(spaltenSumme(tabelle, 'N (kg)'), 'Stickstoff').toBeCloseTo(zahlDe(zellen[1]), 2)
    expect(spaltenSumme(tabelle, 'P (kg)'), 'Phosphor').toBeCloseTo(zahlDe(zellen[3]), 2)
  })

  test('Behandlungsprotokoll: angezeigte Grundstückszeilen = Zeilen der CSV', async ({ page }) => {
    await page.goto('/reports/behandlungsprotokoll')
    const jahr = await jahrDerSeite(page)
    const m = /·\s*([\d.]+)\s+Grundstückszeilen/.exec(await page.locator('main').innerText())
    expect(m, 'Angabe „… Grundstückszeilen“ fehlt').not.toBeNull()
    const { zeilen, tabelle } = await csv(page, 'psm-aufzeichnung', { jahr })
    expect(zeilen, 'X-Zeilen').toBe(tabelle.zeilen.length)
    expect(zeilen).toBe(zahlDe(m![1]))
  })
})
