// ── Eingabefelder: Mausrad ändert keine Zahlen (Sweep 117) ───────────────────
//
// In Chromium ändert das Mausrad über einem fokussierten <input type="number"> den Wert (5× → 12,50 wird 12,45).
// ZahlenfeldMausrad im Root-Layout nimmt dem Feld beim Mausrad den Fokus. Geprüft im echten Browser an
// „Neue Buchung“ (E&A) – nur Eingabe, kein Speichern, daher auch im Nur-Lesen-Modus.

import { test, expect } from './fixtures'

test.describe('Eingabefelder', { tag: '@lesend' }, () => {
  test('Mausrad über einem Zahlenfeld ändert den Wert nicht, die Seite scrollt', async ({ page, rolle }) => {
    test.skip(rolle !== 'tenant_admin', 'einmal je Lauf genügt')
    await page.goto('/buchhaltung/neu')
    const betrag = page.getByLabel('Betrag Netto (€)')
    test.skip(await betrag.count() === 0, 'E&A-Modul im Testbetrieb nicht aktiv')

    await betrag.fill('12.50')
    await betrag.focus()
    const box = await betrag.boundingBox()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 100)

    await expect(betrag).toHaveValue('12.50')
    await expect(betrag).not.toBeFocused()
  })

  // KAN-318: Ereignis-Datum in der Zukunft → Hinweis, Speichern bleibt möglich (kein max)
  test('Datum in der Zukunft zeigt einen Hinweis, heute nicht', async ({ page, rolle }) => {
    test.skip(rolle !== 'tenant_admin', 'einmal je Lauf genügt')
    await page.goto('/buchhaltung/neu')
    const datum = page.getByLabel('Datum', { exact: true })
    test.skip(await datum.count() === 0, 'E&A-Modul im Testbetrieb nicht aktiv')
    const hinweis = page.getByText('Datum liegt in der Zukunft – bitte prüfen.')

    await datum.fill('2099-01-01')
    await expect(hinweis).toBeVisible()
    await expect(datum).not.toHaveAttribute('max', /.+/)

    await datum.fill(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' }))
    await expect(hinweis).toHaveCount(0)
  })
})
