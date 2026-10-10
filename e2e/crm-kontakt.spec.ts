// ── Muster für einen SCHREIBENDEN Test: Kontakt anlegen und wieder löschen ─────
//
// Bewusst OHNE Tag @lesend: läuft nie gegen die Produktion (playwright.config.ts filtert
// auf @lesend, schreibend() sperrt zusätzlich zur Laufzeit). Nur als Betriebs-Manager.
// Der Name trägt Präfix + Zeitstempel, damit Reste eines abgebrochenen Laufs eindeutig
// erkennbar sind (Aufräumen: Kontakte „E2E-Test …“ im Test-Betrieb löschen).

import { test, expect, schreibend } from './fixtures'

test.describe('CRM – Kontakt anlegen und löschen (schreibend)', () => {
  test('Kontakt anlegen, finden, löschen', async ({ page, rolle }) => {
    schreibend()
    test.skip(rolle !== 'tenant_admin', 'Muster läuft nur als Betriebs-Manager')

    const nachname = `E2E-Test ${Date.now()}`

    await page.goto('/crm/kontakte')
    await page.getByRole('button', { name: /Neuer Kontakt/ }).click()
    await page.getByLabel('Vorname', { exact: true }).fill('Playwright')
    await page.getByLabel('Nachname', { exact: true }).fill(nachname)
    await page.getByRole('button', { name: 'Anlegen', exact: true }).click()

    // Formular schließt sich nach dem Speichern; eine Dublettenwarnung wäre ein Testdatenproblem.
    // Während des Speicherns heißt der Knopf „Wird gespeichert…“ – erst wenn auch der verschwunden ist, ist der
    // Kontakt angelegt (erster Staging-Lauf 10.10.2026: Test navigierte zu früh weg, die Server Action brach ab)
    await expect(page.getByRole('button', { name: /^(Anlegen|Wird gespeichert…)$/ })).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByText(/bereits vorhanden/)).toHaveCount(0)

    // Über die Suche finden (die Liste ist seitenweise geladen)
    await page.goto(`/crm/kontakte?q=${encodeURIComponent(nachname)}`)
    const link = page.getByRole('link', { name: new RegExp(nachname) })
    await expect(link).toHaveCount(1)
    // innerste Karte um den Link (bei verschachtelten .card-Containern die letzte)
    const karte = page.locator('.card', { has: link }).last()

    // Löschen bestätigt ein window.confirm
    page.once('dialog', d => d.accept())
    await karte.getByRole('button', { name: 'Löschen' }).click()

    await expect(async () => {
      await page.goto(`/crm/kontakte?q=${encodeURIComponent(nachname)}`)
      await expect(page.getByRole('link', { name: new RegExp(nachname) })).toHaveCount(0)
    }).toPass({ timeout: 15_000 })
  })
})
