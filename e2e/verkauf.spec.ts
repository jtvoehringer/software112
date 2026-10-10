// ── Verkauf → Storno: der Flaschenbestand geht weg und kommt zurück (SCHREIBEND) ─
//
// Läuft nur gegen Staging bzw. einen lokalen Stack (schreibend(), e2e/umgebung.ts). Der Verkauf trägt die Notiz
// „E2E-Test <Zeitstempel>“ – die Detailseite wird daran erkannt, bevor storniert wird (nie ein fremder Verkauf).
// Stornierte Verkäufe bleiben gekennzeichnet stehen (Stornieren statt Löschen, KAN-145) und zählen in keinem Bestand.

import type { Page } from '@playwright/test'
import { test, expect, schreibend } from './fixtures'

/** Bestand einer Füllung aus der Auswahlliste von „Neuer Verkauf“ („… · Bestand: 42“) */
async function bestandLaut(page: Page, fuellungId: string): Promise<number> {
  await page.goto('/weinhandel/verkauf/neu')
  const text = await page.getByLabel('Füllung (Lager)').first().locator(`option[value="${fuellungId}"]`).textContent()
  const m = /Bestand:\s*(-?\d+)/.exec(text ?? '')
  expect(m, `Bestand der Füllung ${fuellungId} nicht lesbar: ${text}`).not.toBeNull()
  return Number(m![1])
}

test.describe('Verkauf (schreibend)', () => {
  test('Flasche verkaufen und stornieren: Bestand −1, nach dem Storno wieder wie vorher', async ({ page, rolle }) => {
    schreibend()
    test.skip(rolle !== 'tenant_admin', 'als Betriebs-Manager')
    const marke = `E2E-Test ${Date.now()}`

    await page.goto('/weinhandel/verkauf/neu')

    // Kunde: erster Treffer der Suche (Liste öffnet sich beim Fokus mit den ersten 30)
    const suche = page.getByLabel('Kunde suchen')
    await suche.click()
    const ersterKunde = suche.locator('xpath=..').getByRole('button').first()
    await expect(ersterKunde, 'kein Kunde im Testbetrieb').toBeVisible()
    await ersterKunde.click()

    // Position: Flasche aus einer Füllung mit Bestand
    await page.getByLabel('Flasche', { exact: true }).first().check()
    const fuellung = page.getByLabel('Füllung (Lager)').first()
    const optionen = await fuellung.locator('option').evaluateAll(os => os.map(o => ({ wert: (o as HTMLOptionElement).value, text: o.textContent ?? '' })))
    const mitBestand = optionen.find(o => o.wert && Number(/Bestand:\s*(\d+)/.exec(o.text)?.[1] ?? 0) >= 1)
    test.skip(!mitBestand, 'keine Füllung mit Bestand im Testbetrieb')
    const fuellungId = mitBestand!.wert
    const vorher = Number(/Bestand:\s*(\d+)/.exec(mitBestand!.text)![1])
    await fuellung.selectOption(fuellungId)

    await page.getByLabel('Menge', { exact: true }).first().fill('1')
    const preis = page.getByLabel('Preis/Einheit (€, brutto)').first()
    if (!(await preis.inputValue())) await preis.fill('10')
    await page.getByLabel('Notizen').first().fill(marke)
    await page.getByRole('button', { name: 'Verkauf anlegen' }).click()
    await page.waitForURL(url => url.pathname === '/weinhandel/verkauf', { timeout: 30_000 })

    // neuester Verkauf = der eben angelegte (Notiz prüfen, bevor etwas geändert wird)
    await page.locator('tbody tr').first().getByRole('link').first().click()
    await expect(page.getByText(marke), 'Detailseite gehört nicht zum angelegten Verkauf').toBeVisible()
    const detail = page.url()

    expect(await bestandLaut(page, fuellungId), 'Bestand nach dem Verkauf').toBe(vorher - 1)

    // Stornieren mit Grund
    await page.goto(detail)
    await page.getByRole('button', { name: 'Verkauf stornieren' }).first().click()
    await page.getByLabel(/Grund des Stornos/).fill('E2E-Test: automatische Rückbuchung')
    await page.getByRole('button', { name: 'Verkauf stornieren' }).last().click()
    await expect(page.getByText(/storniert/i).first()).toBeVisible({ timeout: 20_000 })

    expect(await bestandLaut(page, fuellungId), 'Bestand nach dem Storno').toBe(vorher)
  })
})
