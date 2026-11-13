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

    // KAN-441: Seit KAN-359 (22.10.2026) fragt die App im eigenen Dialog (role="alertdialog"), nicht mehr per Browser-Dialog.
    const dialog = page.getByRole('alertdialog')

    // 1) „Weiter bearbeiten“ → bleibt auf der Seite, Eingabe noch da
    await menue.click()
    await expect(dialog).toContainText('Ungespeicherte Eingaben gehen verloren')
    await dialog.getByRole('button', { name: 'Weiter bearbeiten' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page).toHaveURL(/\/buchhaltung\/neu/)
    await expect(betrag).toHaveValue('99.90')

    // 2) „Verlassen“ → verlässt die Seite
    await menue.click()
    await dialog.getByRole('button', { name: 'Verlassen' }).click()
    await expect(page).toHaveURL(/\/dashboard/)
  })
})
