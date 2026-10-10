// ── Kellerbuch: Teilmenge umziehen und stornieren (SCHREIBEND) ───────────────
//
// 5 L einer Charge in ein leeres Gebinde: Quelle −5 L, Ziel 5 L. Storno mit Grund: Quelle wieder wie vorher, Ziel leer.
// Nur Staging bzw. lokal (schreibend()); der Umzug trägt die Notiz „E2E-Test <Zeitstempel>“ und wird daran in der
// Liste erkannt, bevor storniert wird. Stornierte Umzüge bleiben gekennzeichnet stehen (KAN-145).

import type { Locator, Page } from '@playwright/test'
import { test, expect, schreibend } from './fixtures'
import { zahlDe } from './csv-lesen'

const MENGE = 5
const QUELLE_LEER = '– Behälter · Charge wählen –'
const ZIEL_LEER = '– Behälter wählen –'

/** Auswahlfeld, das eine bestimmte Platzhalter-Option enthält (Quelle bzw. Ziel) */
function auswahl(page: Page, platzhalter: string): Locator {
  return page.locator('select', { has: page.locator('option', { hasText: platzhalter }) }).first()
}

/** Optionen als { wert, text } */
async function optionen(feld: Locator) {
  await expect(feld.locator('option'), 'Auswahl nicht geladen').not.toHaveCount(1, { timeout: 20_000 })
  return feld.locator('option').evaluateAll(os => os.map(o => ({ wert: (o as HTMLOptionElement).value, text: o.textContent ?? '' })))
}

/** Liter am Ende eines Optionstexts der Quelle („Tank 3 · GV · 1.200,00 L“) */
const literAmEnde = (text: string) => zahlDe(/([\d.]+,\d+|\d+)\s*L\s*$/.exec(text)?.[1] ?? '0')

async function formularOeffnen(page: Page) {
  await page.goto('/kellerbuch/umziehen')
  await page.waitForLoadState('networkidle')
  if (await auswahl(page, QUELLE_LEER).count() === 0) await page.getByRole('button', { name: '+ Neuer Umzug' }).click()
}

/** Aktueller Stand: Liter der Quell-Charge und Text des Zielgebindes */
async function stand(page: Page, chargeId: string, zielId: string) {
  await formularOeffnen(page)
  const q = (await optionen(auswahl(page, QUELLE_LEER))).find(o => o.wert === chargeId)
  const z = (await optionen(auswahl(page, ZIEL_LEER))).find(o => o.wert === zielId)
  return { quelleLiter: q ? literAmEnde(q.text) : 0, zielText: z?.text ?? '' }
}

test.describe('Kellerbuch (schreibend)', () => {
  test(`Umzug von ${MENGE} L in ein leeres Gebinde und Storno: Mengen gehen hin und zurück`, async ({ page, rolle }) => {
    schreibend()
    test.skip(rolle !== 'tenant_admin', 'als Betriebs-Manager')
    const marke = `E2E-Test ${Date.now()}`
    page.on('dialog', d => d.accept())   // Rückfragen (z. B. Prüfnummer) bestätigen

    // Aufräumen: nicht stornierte Umzüge abgebrochener früherer Läufe zurückbuchen (sonst fehlen Menge bzw. leere Gebinde)
    await formularOeffnen(page)
    for (let i = 0; i < 10; i++) {
      const rest = page.locator('tr', { hasText: 'E2E-Test' }).filter({ hasNotText: 'storniert am' }).filter({ has: page.getByRole('button', { name: 'Stornieren' }) }).first()
      if (await rest.count() === 0) break
      await rest.getByRole('button', { name: 'Stornieren' }).first().click()
      await rest.getByLabel(/Grund des Stornos/).fill('E2E-Test: Rest eines abgebrochenen Laufs')
      await rest.getByRole('button', { name: 'Stornieren' }).last().click()
      await expect(rest.getByText(/storniert am/)).toBeVisible({ timeout: 20_000 })
    }

    await formularOeffnen(page)
    const quelle = auswahl(page, QUELLE_LEER)
    const q = (await optionen(quelle)).find(o => o.wert && literAmEnde(o.text) >= MENGE * 4)
    test.skip(!q, 'keine Charge mit genug Menge im Testbetrieb')
    const ziel = auswahl(page, ZIEL_LEER)
    const gebindeDerQuelle = q!.text.split(' · ')[0]
    const z = (await optionen(ziel)).find(o => o.wert && o.text.includes(' · leer') && !o.text.startsWith(`${gebindeDerQuelle} ·`))
    test.skip(!z, 'kein leeres Gebinde im Testbetrieb')
    const vorher = literAmEnde(q!.text)

    await quelle.selectOption(q!.wert)
    await quelle.locator('xpath=following-sibling::input[1]').fill(String(MENGE))
    await ziel.selectOption(z!.wert)
    await ziel.locator('xpath=following-sibling::input[1]').fill(String(MENGE))
    await page.getByLabel('Notizen').fill(marke)
    await page.getByRole('button', { name: /^Umziehen \(/ }).click()
    // erst weiter, wenn die Buchung fertig ist – vorher las der Test die Quelle schon abgebucht, das Ziel noch leer
    await expect(page.getByText('Gespeichert – weiterleiten…')).toBeVisible({ timeout: 30_000 })

    const nachUmzug = await stand(page, q!.wert, z!.wert)
    expect(nachUmzug.quelleLiter, 'Quelle nach dem Umzug').toBeCloseTo(vorher - MENGE, 2)
    expect(nachUmzug.zielText, 'Ziel nach dem Umzug').toMatch(new RegExp(`· ${MENGE},00 L`))

    // Storno: Zeile an der Notiz erkennen
    const zeile = page.locator('tr', { hasText: marke })
    await expect(zeile, 'Umzug mit der Notiz nicht in der Liste').toHaveCount(1)
    await zeile.getByRole('button', { name: 'Stornieren' }).first().click()
    await zeile.getByLabel(/Grund des Stornos/).fill('E2E-Test: automatische Rückbuchung')
    await zeile.getByRole('button', { name: 'Stornieren' }).last().click()
    await expect(zeile.getByText(/storniert am/)).toBeVisible({ timeout: 20_000 })

    const nachStorno = await stand(page, q!.wert, z!.wert)
    expect(nachStorno.quelleLiter, 'Quelle nach dem Storno').toBeCloseTo(vorher, 2)
    expect(nachStorno.zielText, 'Ziel nach dem Storno').toContain(' · leer')
  })
})
