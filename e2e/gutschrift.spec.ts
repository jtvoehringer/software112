// ── Verkauf → Rechnung → Gutschrift über eine Teilmenge (SCHREIBEND, KAN-419 G1) ─────────────────────────────────────
//
// Läuft nur gegen Staging bzw. einen lokalen Stack (schreibend(), e2e/umgebung.ts). Der Verkauf trägt die Notiz
// „E2E-Test <Zeitstempel>“ und eine Position „Sonstiges“ ohne Lagerstand – der Test berührt keinen Flaschenbestand.
// Ablauf: Verkauf mit Sofort-Rechnung anlegen (2 × 10 €), von dort die Rechnung öffnen, Gutschrift über 1 Stück
// ausstellen. Erwartet: eigener Beleg „GUTSCHRIFT“ mit Verweis auf die Rechnung; an der Rechnung steht die Gutschrift
// und der Restbetrag; der Verkauf lässt sich danach nicht mehr stornieren. Verkauf und Gutschrift bleiben stehen
// (eine Gutschrift lässt sich nicht stornieren – KAN-453).

import { test, expect, schreibend } from './fixtures'

test.describe('Gutschrift zur Rechnung (schreibend)', () => {
  test('Teilmenge gutschreiben: eigener Beleg, Rest an der Rechnung, Storno gesperrt', async ({ page, rolle }) => {
    schreibend()
    test.skip(rolle !== 'tenant_admin', 'als Betriebs-Manager')
    test.setTimeout(180_000)
    const marke = `E2E-Test ${Date.now()}`

    await page.goto('/weinhandel/verkauf/neu')
    await page.waitForLoadState('networkidle')   // Formular erst nach der Übernahme durch React bedienen

    // Kunde: erster vorhandener Treffer (wie e2e/verkauf.spec.ts)
    const suche = page.getByLabel('Kunde suchen').or(page.getByPlaceholder('Name oder Firma suchen…')).first()
    await suche.click()
    const ersterKunde = suche.locator('xpath=..').getByRole('button').filter({ hasNotText: '+ Neue' }).filter({ hasNotText: '+ Neuer' }).first()
    await expect(ersterKunde, 'kein Kunde im Testbetrieb').toBeVisible()
    await ersterKunde.click()

    // Position „Sonstiges“ mit freier Bezeichnung: 2 × 10 € – ohne Lagerstand
    await page.getByLabel('Sonstiges', { exact: true }).first().check()
    await page.getByPlaceholder('Bezeichnung eingeben oder auswählen…').first().fill(marke)
    await page.getByLabel('Menge', { exact: true }).first().fill('2')
    await page.getByLabel('Preis/Einheit (€, brutto)').first().fill('10')
    await page.getByLabel('Interne Notiz').first().fill(marke)
    await page.getByRole('button', { name: 'Verkauf anlegen' }).click()
    await page.waitForURL(url => url.pathname === '/weinhandel/verkauf', { timeout: 30_000 })

    // neuester Verkauf = der eben angelegte (Notiz prüfen, bevor etwas geändert wird)
    await page.locator('tbody tr').first().getByRole('link').first().click()
    await expect(page.getByText(marke).first(), 'Detailseite gehört nicht zum angelegten Verkauf').toBeVisible()
    const verkauf = page.url()

    // vom Verkauf zur Rechnung
    await page.getByText('dort lässt sich eine Gutschrift ausstellen').getByRole('link').click()
    await page.waitForURL(url => /^\/weinhandel\/rechnungen\/[0-9a-f-]{36}$/.test(url.pathname), { timeout: 20_000 })
    const rechnung = page.url()
    await expect(page.getByText('Zu dieser Rechnung gibt es noch keine Gutschrift.')).toBeVisible()

    // Gutschrift über 1 von 2 Stück
    await page.getByRole('button', { name: 'Gutschrift ausstellen' }).click()
    await page.getByLabel(`Menge der Gutschrift für ${marke}`).fill('1')
    await page.getByLabel(/^Grund/).fill('E2E-Test: ein Stück beschädigt')
    await page.getByRole('button', { name: 'Gutschrift ausstellen' }).last().click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Gutschrift ausstellen' }).click()
    await page.waitForURL(url => /^\/weinhandel\/rechnungen\/[0-9a-f-]{36}$/.test(url.pathname) && url.href !== rechnung, { timeout: 40_000 })

    // der Beleg
    await expect(page.getByRole('heading', { name: 'GUTSCHRIFT' })).toBeVisible()
    await expect(page.getByText(/Rechnungskorrektur zu Rechnung /).first()).toBeVisible()
    await expect(page.getByText(/Gutschriftbetrag:/)).toContainText('-10,00')

    // an der Rechnung: Gutschrift gelistet, Rest 10 €
    await page.goto(rechnung)
    await expect(page.getByText(/Noch gutschreibbar:/)).toContainText('10,00')
    await expect(page.getByRole('link', { name: /^GS-\d{4}-\d+$/ }).first()).toBeVisible()

    // mehr als der Rest wird am Feld abgelehnt, nichts gebucht
    await page.getByRole('button', { name: 'Gutschrift ausstellen' }).click()
    await page.getByLabel(`Menge der Gutschrift für ${marke}`).fill('2')
    await page.getByLabel(/^Grund/).fill('E2E-Test: über dem Rest')
    await page.getByRole('button', { name: 'Gutschrift ausstellen' }).last().click()
    await expect(page.getByRole('alert').filter({ hasText: 'höchstens 1 gutschreibbar' })).toBeVisible()

    // der Verkauf lässt sich nicht mehr stornieren
    await page.goto(verkauf)
    await page.getByRole('button', { name: 'Verkauf stornieren' }).first().click()
    await page.getByLabel(/Grund des Stornos/).fill('E2E-Test: Storno trotz Gutschrift')
    await page.getByRole('button', { name: 'Verkauf stornieren' }).last().click()
    await expect(page.getByText(/gibt es eine Gutschrift/).first()).toBeVisible({ timeout: 20_000 })
  })
})
