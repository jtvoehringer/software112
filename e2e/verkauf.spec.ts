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
  // Füllungen kommen per Abruf nach dem Laden – auf die Option warten
  const option = page.getByLabel('Füllung (Lager)').first().locator(`option[value="${fuellungId}"]`)
  await expect(option).toHaveCount(1, { timeout: 20_000 })
  const text = await option.textContent()
  const m = /Bestand:\s*(-?\d+)/.exec(text ?? '')
  expect(m, `Bestand der Füllung ${fuellungId} nicht lesbar: ${text}`).not.toBeNull()
  return Number(m![1])
}

test.describe('Verkauf (schreibend)', () => {
  test('Flasche verkaufen, bezahlen, Zahlung und Verkauf stornieren: Bestand −1, danach wieder wie vorher', async ({ page, rolle }) => {
    schreibend()
    test.skip(rolle !== 'tenant_admin', 'als Betriebs-Manager')
    const marke = `E2E-Test ${Date.now()}`

    await page.goto('/weinhandel/verkauf/neu')
    await page.waitForLoadState('networkidle')   // Formular erst nach der Übernahme durch React bedienen

    // Kunde: erster Treffer der Suche (Liste öffnet sich beim Fokus mit den ersten 30)
    // Beschriftung „Kunde suchen“ (seit dem E2E-Ausbau); Platzhalter als Rückfall für ältere Stände
    const suche = page.getByLabel('Kunde suchen').or(page.getByPlaceholder('Name oder Firma suchen…')).first()
    await suche.click()
    // KAN-441: In der Liste stehen seit der Schnellanlage auch „+ Neue Firma“ / „+ Neuer Kontakt“ – solange die Treffer noch
    // laden, sind das die ersten Knöpfe; sie öffnen einen Dialog, der danach „Verkauf anlegen“ verdeckt. Gemeint ist der
    // erste vorhandene Kunde (auf ihn wird gewartet).
    const ersterKunde = suche.locator('xpath=..').getByRole('button').filter({ hasNotText: '+ Neue' }).filter({ hasNotText: '+ Neuer' }).first()
    await expect(ersterKunde, 'kein Kunde im Testbetrieb').toBeVisible()
    await ersterKunde.click()

    // Position: Flasche aus einer Füllung mit Bestand
    await page.getByLabel('Flasche', { exact: true }).first().check()
    const fuellung = page.getByLabel('Füllung (Lager)').first()
    await expect(fuellung.locator('option'), 'Füllungen nicht geladen').not.toHaveCount(1, { timeout: 20_000 })
    const optionen = await fuellung.locator('option').evaluateAll(os => os.map(o => ({ wert: (o as HTMLOptionElement).value, text: o.textContent ?? '' })))
    // nie die Füllung des parallel laufenden Kellerbuch-Tests („E2E-Test …“) – deren Storno scheitert nach einem Verkauf
    const mitBestand = optionen.find(o => o.wert && !o.text.includes('E2E-Test') && Number(/Bestand:\s*(\d+)/.exec(o.text)?.[1] ?? 0) >= 1)
    test.skip(!mitBestand, 'keine Füllung mit Bestand im Testbetrieb')
    const fuellungId = mitBestand!.wert
    const vorher = Number(/Bestand:\s*(\d+)/.exec(mitBestand!.text)![1])
    await fuellung.selectOption(fuellungId)

    await page.getByLabel('Menge', { exact: true }).first().fill('1')
    const preis = page.getByLabel('Preis/Einheit (€, brutto)').first()
    if (!(await preis.inputValue())) await preis.fill('10')
    await page.getByLabel('Interne Notiz').first().fill(marke)   // KAN-441: seit KAN-416 heißt das Feld „Interne Notiz“
    await page.getByRole('button', { name: 'Verkauf anlegen' }).click()
    await page.waitForURL(url => url.pathname === '/weinhandel/verkauf', { timeout: 30_000 })

    // neuester Verkauf = der eben angelegte (Notiz prüfen, bevor etwas geändert wird)
    await page.locator('tbody tr').first().getByRole('link').first().click()
    await expect(page.getByText(marke), 'Detailseite gehört nicht zum angelegten Verkauf').toBeVisible()
    const detail = page.url()

    expect(await bestandLaut(page, fuellungId), 'Bestand nach dem Verkauf').toBe(vorher - 1)

    // Zahlung über den Rechnungsbetrag → „Bezahlt“; Zahlung stornieren → wieder „Offen“
    await page.goto(detail)
    const gesamt = (await page.locator('tfoot tr', { hasText: 'Gesamt brutto' }).locator('td').last().innerText()).replace(/[€\s]/g, '')
    await page.getByLabel('Betrag (€)').fill(gesamt)
    await page.getByRole('button', { name: /Zahlung buchen/ }).click()
    await expect(page.getByText('Bezahlt', { exact: true }).first(), `Zahlung über ${gesamt} €`).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Zahlung stornieren' }).first().click()
    await page.getByLabel(/Grund des Stornos/).fill('E2E-Test: Zahlung zurück')
    await page.getByRole('button', { name: 'Zahlung stornieren' }).last().click()
    await expect(page.getByText('Offen', { exact: true }).first()).toBeVisible({ timeout: 20_000 })

    // Stornieren mit Grund
    await page.goto(detail)
    await page.getByRole('button', { name: 'Verkauf stornieren' }).first().click()
    await page.getByLabel(/Grund des Stornos/).fill('E2E-Test: automatische Rückbuchung')
    await page.getByRole('button', { name: 'Verkauf stornieren' }).last().click()
    await expect(page.getByText(/storniert/i).first()).toBeVisible({ timeout: 20_000 })

    expect(await bestandLaut(page, fuellungId), 'Bestand nach dem Storno').toBe(vorher)
  })
})
