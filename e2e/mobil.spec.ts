// ── Mobil-Smoke: Kernseiten am Handy (375 × 812) ──────────────────────────────
//
// UAT-Paket D (KAN-370/371/341/339/354/372, 22.10.2026): Seiten waren am Handy rechts abgeschnitten und unten nicht
// erreichbar. Seit KAN-335/336 scrollt nur <main id="inhalt">; der Rahmen muss in den sichtbaren Bereich passen.
// Je Seite: nichts ragt rechts über den Bildschirm (Dokument und <main>), <main> lässt sich bis ganz unten scrollen
// und das Ende (Fußzeile) liegt dann im sichtbaren Bereich. Nur lesend – Formulare werden höchstens geöffnet.
// Hinweis: Die Emulation hat keine einblendende Browserleiste (dort 100vh ≠ 100dvh) – das bleibt Gerätetest.

import type { Page } from '@playwright/test'
import { test, expect, keinFehlerbild } from './fixtures'

const HANDY = { width: 375, height: 812 }

/** Breite und Scrollbarkeit des Inhalts prüfen */
async function passtAufsHandy(page: Page, pfad: string) {
  await keinFehlerbild(page)
  const breite = await page.evaluate(() => ({
    dokument: document.documentElement.scrollWidth,
    fenster: window.innerWidth,
  }))
  expect(breite.dokument, `${pfad}: Dokument breiter als der Bildschirm`).toBeLessThanOrEqual(breite.fenster)

  const main = page.locator('main#inhalt')
  await expect(main, `${pfad}: kein App-Rahmen`).toHaveCount(1)
  const ergebnis = await main.evaluate(m => {
    m.scrollTop = m.scrollHeight
    const r = m.getBoundingClientRect()
    const fuss = m.querySelector('footer')?.getBoundingClientRect() ?? null
    return {
      ueberBreite: m.scrollWidth - m.clientWidth,
      amEnde: m.scrollTop + m.clientHeight >= m.scrollHeight - 2,
      mainUnten: r.bottom,
      fussUnten: fuss?.bottom ?? null,
      fenster: window.innerHeight,
    }
  })
  expect(ergebnis.ueberBreite, `${pfad}: Inhalt ragt rechts aus <main> (waagrecht scrollen nötig)`).toBeLessThanOrEqual(1)
  expect(ergebnis.amEnde, `${pfad}: <main> lässt sich nicht bis ganz unten scrollen`).toBe(true)
  expect(ergebnis.mainUnten, `${pfad}: <main> reicht unter den sichtbaren Bereich`).toBeLessThanOrEqual(ergebnis.fenster + 1)
  if (ergebnis.fussUnten != null) expect(ergebnis.fussUnten, `${pfad}: Seitenende nicht erreichbar`).toBeLessThanOrEqual(ergebnis.fenster + 1)
}

async function laden(page: Page, pfad: string) {
  const antwort = await page.goto(pfad, { waitUntil: 'domcontentloaded' })
  expect(antwort?.status() ?? 0, `HTTP-Status ${pfad}`).toBeLessThan(400)
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
  expect(new URL(page.url()).pathname, 'Sitzung verloren').not.toMatch(/^\/(login|zwei-faktor)/)
}

/** Erster Jahrgang mit Lesedaten (Lese-Detail) oder null */
async function leseDetailPfad(page: Page): Promise<string | null> {
  await laden(page, '/erntemeldung')
  const href = await page.locator('a[href^="/erntemeldung/"]').evaluateAll(as =>
    as.map(a => a.getAttribute('href') ?? '').find(h => /^\/erntemeldung\/[0-9a-f-]{36}$/.test(h)) ?? null)
  return href
}

test.describe('Mobil – Kernseiten passen aufs Handy', { tag: '@lesend' }, () => {
  test.use({ viewport: HANDY, isMobile: true, hasTouch: true })

  for (const pfad of ['/dashboard', '/behandlungen/neu', '/kellerbuch/umziehen?neu=1', '/weinhandel/verkauf/neu']) {
    test(`Seite ${pfad}`, async ({ page, rolle }) => {
      test.skip(rolle !== 'tenant_admin', 'Formularseiten als Betriebs-Manager')
      await laden(page, pfad)
      await passtAufsHandy(page, pfad)
    })
  }

  test('Lese-Detail: Bearbeiten öffnet das Formular über der Liste und springt hin', async ({ page, rolle }) => {
    test.skip(rolle !== 'tenant_admin', 'als Betriebs-Manager')
    const pfad = await leseDetailPfad(page)
    test.skip(!pfad, 'kein Jahrgang im Testbetrieb')
    await laden(page, pfad!)
    await passtAufsHandy(page, pfad!)
    // KAN-441: Der erste Knopf „Bearbeiten“ der Seite gehört seit KAN-129 zur Lese selbst – gemeint ist die Zeile der
    // Lesedaten (Tabelle unter „Lesedaten“)
    const bearbeiten = page.locator('table').getByRole('button', { name: 'Bearbeiten', exact: true }).first()
    test.skip(await bearbeiten.count() === 0, 'keine Lesedaten zum Bearbeiten')
    await bearbeiten.click()
    const formular = page.locator('[data-lesedaten-bearbeiten]')
    await expect(formular).toBeVisible()
    await expect(formular).toBeInViewport()
    await passtAufsHandy(page, `${pfad} (Bearbeiten offen)`)
  })
})

test.describe('Notebook – Lesedaten bearbeiten ohne Scrollen in der Tabelle (KAN-339/354)', { tag: '@lesend' }, () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test('Formular steht nicht in der Tabelle', async ({ page, rolle }) => {
    test.skip(rolle !== 'tenant_admin', 'als Betriebs-Manager')
    const pfad = await leseDetailPfad(page)
    test.skip(!pfad, 'kein Jahrgang im Testbetrieb')
    await laden(page, pfad!)
    const bearbeiten = page.locator('table').getByRole('button', { name: 'Bearbeiten' }).first()
    test.skip(await bearbeiten.count() === 0, 'keine Lesedaten zum Bearbeiten')
    await bearbeiten.click()
    await expect(page.locator('[data-lesedaten-bearbeiten]')).toBeInViewport()
    await expect(page.locator('table [data-lesedaten-bearbeiten]')).toHaveCount(0)
  })
})
