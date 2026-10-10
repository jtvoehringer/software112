// ── Smoke: jede Seite der Navigation je Rolle ─────────────────────────────────
//
// Pfade kommen aus src/lib/navigation (buildNav) – siehe e2e/navigation.ts. Je Seite:
// HTTP < 400, keine Fehlerseite/kein Next.js-Overlay, keine Konsolenfehler, Titel und
// Überschrift vorhanden. Leser: keine Schreib-Knöpfe (SCHREIB_KNOEPFE).

import { test, expect, keinFehlerbild } from './fixtures'
import { alleNavPfade, navPfade, SCHREIB_KNOEPFE } from './navigation'

test.describe('Smoke – Navigation', { tag: '@lesend' }, () => {
  test('Anmeldung gültig: Dashboard erreichbar', async ({ page }) => {
    const antwort = await page.goto('/dashboard')
    expect(antwort?.status() ?? 0).toBeLessThan(400)
    expect(new URL(page.url()).pathname, 'Sitzung ungültig – Weiterleitung auf Login/2FA').toMatch(/^\/dashboard/)
    await keinFehlerbild(page)
  })

  for (const pfad of alleNavPfade()) {
    test(`Seite ${pfad}`, async ({ page, rolle, konsolenFehler }) => {
      test.skip(!navPfade(rolle).includes(pfad), `${pfad} ist für ${rolle} nicht in der Navigation`)

      const antwort = await page.goto(pfad, { waitUntil: 'domcontentloaded' })
      expect(antwort, 'keine Antwort').not.toBeNull()
      expect(antwort!.status(), `HTTP-Status ${pfad}`).toBeLessThan(400)
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)

      // Modul-/Rollen-Guards leiten auf /dashboard um – das ist erlaubt, aber nie auf Login/2FA
      const ziel = new URL(page.url()).pathname
      expect(ziel, 'Sitzung verloren').not.toMatch(/^\/(login|zwei-faktor)/)

      await keinFehlerbild(page)
      await expect(page).toHaveTitle(/\S/)
      // Sweep 115: eigener Seitentitel, Markenname nur einmal (die Vorlage im Root-Layout hängt „| software:112“ an)
      const titel = await page.title()
      expect(titel, 'Seite ohne eigenen Titel').not.toBe('software:112')
      expect(titel, 'Markenname doppelt im Titel').not.toMatch(/software:112.*software:112/)
      await expect(page.locator('h1, h2, [role="heading"]').first(), 'keine Überschrift').toBeVisible()

      const knopf = SCHREIB_KNOEPFE[pfad]
      if (knopf && ziel === pfad) {
        const treffer = page.getByRole('button', { name: knopf }).or(page.getByRole('link', { name: knopf }))
        if (rolle === 'leser') await expect(treffer, 'Leser sieht einen Schreib-Knopf').toHaveCount(0)
        if (rolle === 'tenant_admin') await expect(treffer.first(), 'Schreib-Knopf fehlt beim Betriebs-Manager').toBeVisible()
      }

      expect(konsolenFehler.liste, 'Konsolenfehler').toEqual([])
    })
  }
})
