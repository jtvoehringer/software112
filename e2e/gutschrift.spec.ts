// ── Verkauf → Rechnung → Gutschrift über eine Teilmenge (SCHREIBEND, KAN-419 G1) ─────────────────────────────────────
//
// Läuft nur gegen Staging bzw. einen lokalen Stack (schreibend(), e2e/umgebung.ts). Der Verkauf trägt die Notiz
// „E2E-Test <Zeitstempel>“ und eine Position „Sonstiges“ ohne Lagerstand – der Test berührt keinen Flaschenbestand.
// Ablauf: Verkauf mit Sofort-Rechnung anlegen (2 × 10 €), von dort die Rechnung öffnen, Gutschrift über 1 Stück
// ausstellen. Erwartet: eigener Beleg „GUTSCHRIFT“ mit Verweis auf die Rechnung; an der Rechnung steht die Gutschrift
// und der Restbetrag; der Verkauf lässt sich danach nicht mehr stornieren. Verkauf und Gutschrift bleiben stehen
// (eine Gutschrift lässt sich nicht stornieren – KAN-453).

import type { Page } from '@playwright/test'
import { test, expect, schreibend } from './fixtures'

/** Bestand einer Füllung aus der Auswahlliste von „Neuer Verkauf“ („… · Bestand: 42“) – wie e2e/verkauf.spec.ts */
async function bestandLaut(page: Page, fuellungId: string): Promise<number> {
  await page.goto('/weinhandel/verkauf/neu')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Flasche', { exact: true }).first().check()
  const option = page.getByLabel('Füllung (Lager)').first().locator(`option[value="${fuellungId}"]`)
  await expect(option, `Füllung ${fuellungId} nicht in der Auswahl`).toHaveCount(1, { timeout: 20_000 })
  const text = await option.textContent()
  const m = /Bestand:\s*(-?\d+)/.exec(text ?? '')
  expect(m, `Bestand der Füllung ${fuellungId} nicht lesbar: ${text}`).not.toBeNull()
  return Number(m![1])
}

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
    // Rechnungsnummer aus der Brotkrumenzeile („Rechnung RE-…“) – für die Zeile in den offenen Posten (KAN-453 G3c)
    const rechnungsnummer = (await page.locator('nav span', { hasText: /^Rechnung \S+$/ }).first().innerText()).replace(/^Rechnung /, '')

    // Gutschrift über 1 von 2 Stück; eine freie Position kann nicht zurück in den Bestand (KAN-452: kein Haken)
    await page.getByRole('button', { name: 'Gutschrift ausstellen' }).click()
    await expect(page.getByLabel(`Menge der Gutschrift für ${marke}`)).toBeVisible()
    await expect(page.getByText('Ware kommt zurück')).toHaveCount(0)
    await page.getByLabel(`Menge der Gutschrift für ${marke}`).fill('1')
    await page.getByLabel(/^Grund/).fill('E2E-Test: ein Stück beschädigt')
    await page.getByRole('button', { name: 'Gutschrift ausstellen' }).last().click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Gutschrift ausstellen' }).click()
    await page.waitForURL(url => /^\/weinhandel\/rechnungen\/[0-9a-f-]{36}$/.test(url.pathname) && url.href !== rechnung, { timeout: 40_000 })

    // der Beleg
    await expect(page.getByRole('heading', { name: 'GUTSCHRIFT' })).toBeVisible()
    await expect(page.getByText(/Rechnungskorrektur zu Rechnung /).first()).toBeVisible()
    await expect(page.getByText(/Gutschriftbetrag:/)).toContainText('-10,00')
    // KAN-453 G3a: die Gutschrift lässt sich per E-Mail senden (hier ohne Versand – nur das Angebot)
    await expect(page.getByText('Gutschrift per E-Mail senden')).toBeVisible()

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

    // KAN-453 G3c: Rechnung ganz bezahlen (20 €) → mit der Gutschrift 10 € Guthaben → in den offenen Posten auszahlen
    await page.goto(verkauf)
    await page.getByLabel('Betrag (€)').fill('20')
    await page.getByRole('button', { name: /Zahlung buchen/ }).click()
    await expect(page.getByText('Bezahlt', { exact: true }).first()).toBeVisible({ timeout: 20_000 })
    await page.goto('/weinhandel/offene-posten')
    await page.getByLabel(/Bezahlte Rechnungen anzeigen/).check()
    const zeile = page.locator('tbody tr', { hasText: rechnungsnummer }).first()
    await expect(zeile.getByText(/Guthaben/), 'Guthaben der bezahlten Rechnung mit Gutschrift').toContainText('10,00')
    await zeile.getByRole('button', { name: 'Rückzahlung erfassen' }).click()
    await expect(page.getByLabel('Betrag der Rückzahlung (€)')).toHaveValue('10,00')
    await page.getByRole('button', { name: 'Rückzahlung buchen' }).click()
    await expect(zeile.getByText(/Guthaben/), 'nach der Rückzahlung kein Guthaben mehr').toHaveCount(0, { timeout: 30_000 })
    // beim Verkauf steht die Rückzahlung als negative Zahlung
    await page.goto(verkauf)
    await expect(page.getByText(/· Rückzahlung/).first()).toBeVisible()
  })

  // KAN-452 G2: Flasche verkaufen (Bestand −1), Gutschrift mit „Ware kommt zurück“ → Bestand wieder wie vorher.
  // Nimmt die LETZTE Füllung mit Bestand – e2e/verkauf.spec.ts läuft parallel mit der ersten; gibt es nur eine, entfällt
  // der Test (sonst zählten zwei Tests gleichzeitig am selben Bestand).
  test('Flasche gutschreiben mit Rücknahme, Gutschrift stornieren: Bestand folgt', async ({ page, rolle }) => {
    schreibend()
    test.skip(rolle !== 'tenant_admin', 'als Betriebs-Manager')
    test.setTimeout(180_000)
    const marke = `E2E-Test ${Date.now()}`

    await page.goto('/weinhandel/verkauf/neu')
    await page.waitForLoadState('networkidle')
    const suche = page.getByLabel('Kunde suchen').or(page.getByPlaceholder('Name oder Firma suchen…')).first()
    await suche.click()
    const ersterKunde = suche.locator('xpath=..').getByRole('button').filter({ hasNotText: '+ Neue' }).filter({ hasNotText: '+ Neuer' }).first()
    await expect(ersterKunde, 'kein Kunde im Testbetrieb').toBeVisible()
    await ersterKunde.click()

    await page.getByLabel('Flasche', { exact: true }).first().check()
    const fuellung = page.getByLabel('Füllung (Lager)').first()
    await expect(fuellung.locator('option'), 'Füllungen nicht geladen').not.toHaveCount(1, { timeout: 20_000 })
    const optionen = await fuellung.locator('option').evaluateAll(os => os.map(o => ({ wert: (o as HTMLOptionElement).value, text: o.textContent ?? '' })))
    const mitBestand = optionen.filter(o => o.wert && !o.text.includes('E2E-Test') && Number(/Bestand:\s*(\d+)/.exec(o.text)?.[1] ?? 0) >= 1)
    test.skip(mitBestand.length < 2, 'weniger als zwei Füllungen mit Bestand im Testbetrieb')
    const gewaehlt = mitBestand[mitBestand.length - 1]
    const fuellungId = gewaehlt.wert
    const vorher = Number(/Bestand:\s*(\d+)/.exec(gewaehlt.text)![1])
    await fuellung.selectOption(fuellungId)
    await page.getByLabel('Menge', { exact: true }).first().fill('1')
    const preis = page.getByLabel('Preis/Einheit (€, brutto)').first()
    if (!(await preis.inputValue())) await preis.fill('10')
    await page.getByLabel('Interne Notiz').first().fill(marke)
    await page.getByRole('button', { name: 'Verkauf anlegen' }).click()
    await page.waitForURL(url => url.pathname === '/weinhandel/verkauf', { timeout: 30_000 })

    await page.locator('tbody tr').first().getByRole('link').first().click()
    await expect(page.getByText(marke).first(), 'Detailseite gehört nicht zum angelegten Verkauf').toBeVisible()
    const verkauf = page.url()
    expect(await bestandLaut(page, fuellungId), 'Bestand nach dem Verkauf').toBe(vorher - 1)

    // zur Rechnung, Gutschrift über die Flasche mit Rücknahme
    await page.goto(verkauf)
    await page.getByText('dort lässt sich eine Gutschrift ausstellen').getByRole('link').click()
    await page.waitForURL(url => /^\/weinhandel\/rechnungen\/[0-9a-f-]{36}$/.test(url.pathname), { timeout: 20_000 })
    const rechnung = page.url()
    await page.getByRole('button', { name: 'Gutschrift ausstellen' }).click()
    const haken = page.getByLabel(/^Ware kommt zurück: /).first()
    await expect(haken, 'ohne Menge ist der Haken gesperrt').toBeDisabled()
    await page.getByLabel(/^Menge der Gutschrift für /).first().fill('1')
    await haken.check()
    await page.getByLabel(/^Grund/).fill('E2E-Test: Flasche kommt zurück')
    await page.getByRole('button', { name: 'Gutschrift ausstellen' }).last().click()
    await expect(page.getByRole('alertdialog')).toContainText('wieder in den Bestand gebucht')
    await page.getByRole('alertdialog').getByRole('button', { name: 'Gutschrift ausstellen' }).click()
    await page.waitForURL(url => /^\/weinhandel\/rechnungen\/[0-9a-f-]{36}$/.test(url.pathname) && url.href !== rechnung, { timeout: 40_000 })

    // der Beleg trägt den Vermerk, an der Rechnung steht er bei der Gutschrift, der Bestand ist zurück
    const gutschrift = page.url()
    await expect(page.getByRole('heading', { name: 'GUTSCHRIFT' })).toBeVisible()
    await expect(page.getByText('Ware zurückgenommen').first()).toBeVisible()
    await page.goto(rechnung)
    await expect(page.getByText(/· Ware zurückgenommen/).first()).toBeVisible()
    expect(await bestandLaut(page, fuellungId), 'Bestand nach der Gutschrift mit Rücknahme').toBe(vorher)

    // KAN-453 G3b: Gutschrift stornieren → Stornobeleg, die zurückgenommene Flasche geht wieder ab, die Menge ist wieder frei
    await page.goto(gutschrift)
    await page.getByRole('button', { name: 'Gutschrift stornieren' }).first().click()
    await page.getByLabel(/Grund des Stornos/).fill('E2E-Test: Gutschrift war ein Irrtum')
    await page.getByRole('button', { name: 'Gutschrift stornieren' }).last().click()
    await expect(page.getByRole('note').filter({ hasText: /Storniert.*Stornobeleg/ })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Gutschrift stornieren' })).toHaveCount(0)
    await page.getByRole('note').filter({ hasText: /Stornobeleg/ }).getByRole('link', { name: /^ST-\d{4}-\d+$/ }).click()
    await expect(page.getByRole('heading', { name: 'STORNOBELEG' })).toBeVisible()
    await expect(page.getByText(/zu Gutschrift GS-/).first()).toBeVisible()
    await page.goto(rechnung)
    await expect(page.getByText(/storniert \(/).first(), 'die stornierte Gutschrift steht gekennzeichnet in der Liste').toBeVisible()
    expect(await bestandLaut(page, fuellungId), 'Bestand nach dem Storno der Gutschrift').toBe(vorher - 1)
  })
})
