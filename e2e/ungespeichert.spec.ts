// ── Ungespeicherte Eingaben: Rückfrage vor dem Verlassen (Sweep 119) ─────────
//
// An „Neue Buchung“ etwas eintippen und auf einen Menüpunkt klicken: Rückfrage erscheint; „Abbrechen“ bleibt auf der
// Seite mit der Eingabe, „OK“ verlässt sie. Nur Eingabe, kein Speichern – daher auch im Nur-Lesen-Modus.

import { test, expect } from './fixtures'

test.describe('Ungespeicherte Eingaben', { tag: '@lesend' }, () => {
  test('Menüklick in einem geänderten Formular fragt nach', async ({ page, rolle }) => {
    test.skip(rolle !== 'tenant_admin', 'einmal je Lauf genügt')
    await page.goto('/buchhaltung/neu')
    const betrag = page.getByLabel('Betrag Netto (€)')
    test.skip(await betrag.count() === 0, 'E&A-Modul im Testbetrieb nicht aktiv')
    await betrag.fill('99.90')

    // erster Treffer = Hauptpunkt „Übersicht“ (/dashboard); die zweite Zeile kann ebenfalls „Übersicht“ enthalten
    const menue = page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name: 'Übersicht', exact: true }).first()

    // 1) abbrechen → bleibt auf der Seite, Eingabe noch da
    const erste = page.waitForEvent('dialog')
    await menue.click()
    const d1 = await erste
    expect(d1.message()).toContain('Ungespeicherte Eingaben gehen verloren')
    await d1.dismiss()
    await expect(page).toHaveURL(/\/buchhaltung\/neu/)
    await expect(betrag).toHaveValue('99.90')

    // 2) bestätigen → verlässt die Seite
    page.once('dialog', d => d.accept())
    await menue.click()
    await expect(page).toHaveURL(/\/dashboard/)
  })
})
