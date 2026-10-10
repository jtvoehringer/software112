// ── Kellerbuch: Umzug und Füllung mit Storno (SCHREIBEND) ─────────────────────
//
// Umzug: 5 L einer Charge in ein leeres Gebinde: Quelle −5 L, Ziel 5 L. Storno mit Grund: Quelle wieder wie vorher, Ziel leer.
// Füllung: 2 Flaschen à 0,75 L aus einer Charge: Charge −1,5 L, Füllung mit 2 Flaschen. Storno: Charge wieder wie vorher.
// Nur Staging bzw. lokal (schreibend()); Umzug und Füllung tragen „E2E-Test <Zeitstempel>“ (Notiz bzw. Produktname) und
// werden daran erkannt, bevor storniert wird. Stornierte Buchungen bleiben gekennzeichnet stehen (KAN-145).
// Die Tests laufen nacheinander: Eine Füllung lässt sich nicht stornieren, wenn an der Charge seither weitergebucht wurde.

import type { Locator, Page } from '@playwright/test'
import { test, expect, schreibend } from './fixtures'
import { zahlDe } from './csv-lesen'

const MENGE = 5
const FLASCHEN = 2
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

/** Liter am Ende eines Optionstexts („Tank 3 · GV · 1.200,00 L“, Füllung: „Muskateller (2025) · 1.485 L“) – auch mit
 *  Tausenderpunkt ohne Nachkommastellen (vorher wurde aus „1.485 L“ 485 L) */
const literAmEnde = (text: string) => zahlDe(/(\d{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:,\d+)?)\s*L\s*$/.exec(text)?.[1] ?? '0')

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
  test.describe.configure({ mode: 'serial' })

  test(`Umzug von ${MENGE} L in ein leeres Gebinde und Storno: Mengen gehen hin und zurück`, async ({ page, rolle }) => {
    schreibend()
    test.skip(rolle !== 'tenant_admin', 'als Betriebs-Manager')
    const marke = `E2E-Test ${Date.now()}`
    page.on('dialog', d => d.accept())   // Rückfragen (z. B. Prüfnummer) bestätigen

    // Aufräumen: nicht stornierte Umzüge abgebrochener früherer Läufe zurückbuchen (sonst fehlen Menge bzw. leere Gebinde)
    await formularOeffnen(page)
    const reste = page.locator('tr', { hasText: 'E2E-Test' }).filter({ hasNotText: 'storniert am' }).filter({ has: page.getByRole('button', { name: 'Stornieren' }) })
    const storniert = page.locator('tr', { hasText: 'E2E-Test' }).filter({ hasText: 'storniert am' })
    for (let i = 0; i < 10; i++) {
      const anzahl = await reste.count()
      const stornierteVorher = await storniert.count()
      if (anzahl === 0) break
      const rest = reste.first()
      await rest.getByRole('button', { name: 'Stornieren' }).first().click()
      await rest.getByLabel(/Grund des Stornos/).fill('E2E-Test: Rest eines abgebrochenen Laufs')
      await rest.getByRole('button', { name: 'Stornieren' }).last().click()
      // die stornierte Zeile fällt aus dem Filter – daher auf weniger offene Reste warten, nicht auf „storniert am“ in ihr
      await expect(reste, 'Rest nicht storniert').toHaveCount(anzahl - 1, { timeout: 20_000 })
      // „storniert am“ kommt aus der gespeicherten Zeile – erst dann ist die Rückbuchung auch in den Beständen
      // (ein Umzug kann mehrere Zeilen haben, Quelle und Ziel – daher „mehr als vorher“)
      await expect.poll(() => storniert.count(), { message: 'Storno nicht gespeichert', timeout: 20_000 }).toBeGreaterThan(stornierteVorher)
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

    // Bestände je neu geladen abfragen, bis sie stimmen (die Liste wird nach der Buchung erst neu aufgebaut)
    const zielMitMenge = new RegExp(`· ${MENGE}(,0+)? L`)   // „Betonei · 5 L Chardonnay (CH) | frei 795 L“
    await expect.poll(async () => (await stand(page, q!.wert, z!.wert)).quelleLiter, { message: 'Quelle nach dem Umzug', timeout: 30_000 }).toBeCloseTo(vorher - MENGE, 2)
    await expect.poll(async () => (await stand(page, q!.wert, z!.wert)).zielText, { message: 'Ziel nach dem Umzug', timeout: 30_000 }).toMatch(zielMitMenge)

    // Storno: Zeile an der Notiz erkennen
    const zeile = page.locator('tr', { hasText: marke })
    await expect(zeile, 'Umzug mit der Notiz nicht in der Liste').toHaveCount(1)
    await zeile.getByRole('button', { name: 'Stornieren' }).first().click()
    await zeile.getByLabel(/Grund des Stornos/).fill('E2E-Test: automatische Rückbuchung')
    await zeile.getByRole('button', { name: 'Stornieren' }).last().click()
    await expect(zeile.getByText(/storniert am/)).toBeVisible({ timeout: 20_000 })

    await expect.poll(async () => (await stand(page, q!.wert, z!.wert)).quelleLiter, { message: 'Quelle nach dem Storno', timeout: 30_000 }).toBeCloseTo(vorher, 2)
    await expect.poll(async () => (await stand(page, q!.wert, z!.wert)).zielText, { message: 'Ziel nach dem Storno', timeout: 30_000 }).toContain(' · leer')
  })

  test(`Füllung von ${FLASCHEN} Flaschen und Storno: Charge −${FLASCHEN * 0.75} L, danach wieder wie vorher`, async ({ page, rolle }) => {
    schreibend()
    test.skip(rolle !== 'tenant_admin', 'als Betriebs-Manager')
    const marke = `E2E-Test ${Date.now()}`
    page.on('dialog', d => d.accept())   // Rückfragen bzw. Hinweise nach dem Anlegen bestätigen

    // Aufräumen: Füllungen abgebrochener früherer Läufe stornieren (Liste zeigt nur Füllungen mit Bestand, stornierte nicht)
    await page.goto('/weinhandel')
    await page.waitForLoadState('networkidle')
    const reste = page.locator('tr', { hasText: 'E2E-Test' }).filter({ has: page.getByRole('button', { name: 'Stornieren' }) })
    for (let i = 0; i < 10; i++) {
      if (await reste.count() === 0) break
      const name = /E2E-Test \d+/.exec(await reste.first().innerText())?.[0]
      expect(name, 'Name des Rests nicht lesbar').toBeTruthy()
      const rest = page.locator('tr', { hasText: name! })
      await rest.getByRole('button', { name: 'Stornieren' }).first().click()
      await rest.getByLabel(/Grund des Stornos/).fill('E2E-Test: Rest eines abgebrochenen Laufs')
      await rest.getByRole('button', { name: 'Stornieren' }).last().click()
      // während des Speicherns verschwindet der Knopf schon – erst neu geladen ohne die Zeile ist der Storno gebucht
      // (Lauf 11.10.2026: der Ausgangsbestand wurde sonst vor der Rückbuchung gelesen)
      await expect.poll(async () => {
        await page.goto('/weinhandel')
        await page.waitForLoadState('networkidle')
        return page.locator('tr', { hasText: name! }).count()
      }, { message: `Rest ${name} nicht storniert`, timeout: 30_000 }).toBe(0)
    }

    await page.goto('/weinhandel/fuellungen/neu')
    await page.waitForLoadState('networkidle')
    const charge = page.getByLabel('Weinausbau-Charge')
    const c = (await optionen(charge)).find(o => o.wert && literAmEnde(o.text) >= 10)
    test.skip(!c, 'keine Charge mit genug Menge im Testbetrieb')
    const vorher = literAmEnde(c!.text)

    await charge.selectOption(c!.wert)
    await page.getByLabel('Produktname').fill(marke)
    await page.getByLabel('Flaschengröße').selectOption('750')
    await page.getByLabel('Anzahl Flaschen').fill(String(FLASCHEN))
    await page.getByRole('button', { name: 'Füllung anlegen' }).click()
    await page.waitForURL(url => !url.pathname.endsWith('/fuellungen/neu'), { timeout: 30_000 })

    // Charge −1,5 L (Auswahlliste neu geladen, bis die Buchung sichtbar ist)
    const literDerCharge = async () => {
      await page.goto('/weinhandel/fuellungen/neu')
      const o = (await optionen(page.getByLabel('Weinausbau-Charge'))).find(x => x.wert === c!.wert)
      return o ? literAmEnde(o.text) : 0
    }
    await expect.poll(literDerCharge, { message: 'Charge nach der Füllung', timeout: 30_000 }).toBeCloseTo(vorher - FLASCHEN * 0.75, 2)

    // Füllung in der Weinhandel-Liste: Bestand = Anzahl; dann stornieren
    await page.goto('/weinhandel')
    const zeile = page.locator('tr', { hasText: marke })
    await expect(zeile, 'Füllung nicht in der Liste').toHaveCount(1, { timeout: 20_000 })
    await expect(zeile).toContainText(String(FLASCHEN))
    await zeile.getByRole('button', { name: 'Stornieren' }).first().click()
    await zeile.getByLabel(/Grund des Stornos/).fill('E2E-Test: automatische Rückbuchung')
    await zeile.getByRole('button', { name: 'Stornieren' }).last().click()
    await expect(zeile, 'stornierte Füllung noch in der Liste').toHaveCount(0, { timeout: 20_000 })

    await expect.poll(literDerCharge, { message: 'Charge nach dem Storno', timeout: 30_000 }).toBeCloseTo(vorher, 2)
  })
})
