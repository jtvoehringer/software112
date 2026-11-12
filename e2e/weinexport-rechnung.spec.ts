// ── Weinexport → Rechnung stellen → Storno: Bestand geht weg und kommt zurück (SCHREIBEND, KAN-436 E1) ───────────────
//
// Läuft nur gegen Staging bzw. einen lokalen Stack (schreibend(), e2e/umgebung.ts) und nur, wenn der Testbetrieb das
// Export-Modul hat. Der Exportauftrag trägt die Notiz „E2E-Test <Zeitstempel>“. Ablauf: Auftrag in ein Drittland anlegen
// (Ausfuhr, ohne UID), bestätigen, „Rechnung stellen“ – der Flaschenbestand sinkt, der Auftrag ist gesperrt; das Storno
// des Verkaufs bucht den Bestand zurück und gibt den Auftrag wieder frei. Der Auftrag bleibt als Entwurf-Rest stehen
// (bestätigt, ohne Rechnung); stornierte Verkäufe zählen in keinem Bestand (Stornieren statt Löschen, KAN-145).

import type { Page } from '@playwright/test'
import { test, expect, schreibend } from './fixtures'

/** Bestand einer Füllung aus der Auswahlliste einer Exportposition („… (42 Fl.)“) */
async function bestandLaut(page: Page, fuellungId: string): Promise<number> {
  await page.goto('/weinexport/neu')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: '+ Position' }).click()
  const option = page.locator('select', { has: page.locator('option', { hasText: '– Füllung –' }) }).first().locator(`option[value="${fuellungId}"]`)
  await expect(option).toHaveCount(1, { timeout: 20_000 })
  const text = await option.textContent()
  const m = /\((-?\d+) Fl\.\)/.exec(text ?? '')
  expect(m, `Bestand der Füllung ${fuellungId} nicht lesbar: ${text}`).not.toBeNull()
  return Number(m![1])
}

test.describe('Weinexport: Rechnung aus dem Exportauftrag (schreibend)', () => {
  test('Rechnung stellen bucht den Bestand ab und sperrt den Auftrag; Storno der Rechnung gibt beides zurück', async ({ page, rolle }) => {
    schreibend()
    test.skip(rolle !== 'tenant_admin', 'als Betriebs-Manager')
    test.setTimeout(180_000)
    const marke = `E2E-Test ${Date.now()}`

    await page.goto('/weinexport/neu')
    await page.waitForLoadState('networkidle')   // Formular erst nach der Übernahme durch React bedienen
    test.skip(!new URL(page.url()).pathname.startsWith('/weinexport/neu'), 'Testbetrieb ohne Export-Modul')

    // Importeur: erste Firma, sonst erster Kontakt
    const firma = page.getByLabel('Firma', { exact: true })
    if ((await firma.locator('option').count()) > 1) {
      await firma.selectOption({ index: 1 })
    } else {
      await page.getByRole('button', { name: 'Kontakt', exact: true }).click()
      const kontakt = page.getByLabel('Kontakt', { exact: true })
      test.skip((await kontakt.locator('option').count()) < 2, 'kein Kunde im Testbetrieb')
      await kontakt.selectOption({ index: 1 })
    }
    // Drittland = steuerfreie Ausfuhr, auch ohne UID des Kunden
    await page.getByLabel('UID-Nummer Importeur').fill('')
    await page.getByLabel('Destination Land').selectOption('US')
    await page.getByLabel('Destination Stadt').fill('New York')

    // Position: eine Flasche aus einer Füllung mit Bestand
    await page.getByRole('button', { name: '+ Position' }).click()
    const fuellung = page.locator('select', { has: page.locator('option', { hasText: '– Füllung –' }) }).first()
    const optionen = await fuellung.locator('option').evaluateAll(os => os.map(o => ({ wert: (o as HTMLOptionElement).value, text: o.textContent ?? '' })))
    // nie die Füllung eines parallel laufenden Tests („E2E-Test …“)
    const mitBestand = optionen.find(o => o.wert && !o.text.includes('E2E-Test') && Number(/\((\d+) Fl\.\)/.exec(o.text)?.[1] ?? 0) >= 1)
    test.skip(!mitBestand, 'keine Füllung mit Bestand im Testbetrieb')
    const fuellungId = mitBestand!.wert
    const vorher = Number(/\((\d+) Fl\.\)/.exec(mitBestand!.text)![1])
    await fuellung.selectOption(fuellungId)
    await page.getByPlaceholder('Menge').first().fill('1')
    await page.getByPlaceholder('€/Einheit').first().fill('10')
    await page.getByLabel('Notizen / Besonderheiten').fill(marke)
    await page.getByRole('button', { name: 'Exportauftrag anlegen' }).click()
    await page.waitForURL(url => /^\/weinexport\/[0-9a-f-]{36}$/.test(url.pathname), { timeout: 30_000 })
    const auftrag = page.url()
    await expect(page.getByText(marke), 'Detailseite gehört nicht zum angelegten Exportauftrag').toBeVisible()

    // Im Entwurf gibt es noch keine Rechnung
    await expect(page.getByText('Die Rechnung gibt es erst ab dem Status „Bestätigt“.')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Rechnung stellen/ })).toHaveCount(0)

    // Bestätigen (Statuswechsel per PATCH), danach rechnet der Server den Stand neu
    const status = page.locator('select', { has: page.locator('option[value="bestaetigt"]') }).first()
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/weinexport/') && r.request().method() === 'PATCH' && r.ok(), { timeout: 20_000 }),
      status.selectOption('bestaetigt'),
    ])
    await page.goto(auftrag)

    // Rechnung stellen (mit Rückfrage)
    await page.getByRole('button', { name: /^Rechnung stellen/ }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Rechnung stellen' }).click()
    await expect(page.getByText('Der Flaschenbestand ist abgebucht.'), 'Rechnung wurde nicht gestellt').toBeVisible({ timeout: 40_000 })
    await expect(page.getByText(/Zum Exportauftrag gibt es eine Rechnung/)).toBeVisible()   // Sperrhinweis
    await expect(page.getByRole('link', { name: 'Bearbeiten', exact: true })).toHaveCount(0)

    expect(await bestandLaut(page, fuellungId), 'Bestand nach „Rechnung stellen“').toBe(vorher - 1)

    // Die Rechnung trägt Steuerfall und Exportauftrag; der Verkauf lässt sich stornieren
    await page.goto(auftrag)
    await page.getByRole('link', { name: 'Zur Rechnung' }).click()
    await page.waitForURL(url => /^\/weinhandel\/verkauf\/[0-9a-f-]{36}$/.test(url.pathname), { timeout: 20_000 })
    await expect(page.getByText(/Steuerfreie Ausfuhrlieferung/).first()).toBeVisible()
    await expect(page.getByText(/Exportauftrag \/ Export order: /).first()).toBeVisible()
    await page.getByRole('button', { name: 'Verkauf stornieren' }).first().click()
    await page.getByLabel(/Grund des Stornos/).fill('E2E-Test: Rechnung zum Exportauftrag zurück')
    await page.getByRole('button', { name: 'Verkauf stornieren' }).last().click()
    await expect(page.getByText(/storniert/i).first()).toBeVisible({ timeout: 30_000 })

    expect(await bestandLaut(page, fuellungId), 'Bestand nach dem Storno').toBe(vorher)

    // Der Exportauftrag ist wieder frei: Rechnung stellen und Bearbeiten sind wieder möglich
    await page.goto(auftrag)
    await expect(page.getByRole('button', { name: /^Rechnung stellen/ })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('link', { name: 'Bearbeiten', exact: true })).toBeVisible()
  })
})
