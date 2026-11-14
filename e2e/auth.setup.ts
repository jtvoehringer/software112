// ── Anmeldung je Rolle → storageState in e2e/.auth/<rolle>.json ───────────────
//
// Läuft als Setup-Projekt vor allen Tests. Meldet sich über die echte Login-Seite an,
// gibt bei eingerichteter Zwei-Faktor-Anmeldung den TOTP-Code ein (E2E_<ROLLE>_TOTP_SECRET)
// und wählt bei mehreren Betrieben den Betrieb aus E2E_<ROLLE>_TENANT_ID.
// Richtet NIE selbst einen zweiten Faktor ein und ändert keine Kontodaten.

import fs from 'node:fs'
import path from 'node:path'
import { test as setup, expect, type Page } from '@playwright/test'
import { authDatei, PROFIL_ROLLEN, ROLLEN, schluesselDatei, zugang, type Rolle, type Zugang } from './umgebung'
import { restSekunden, totp } from './totp'

async function zweiFaktor(page: Page, rolle: Rolle, z: Zugang): Promise<void> {
  const codeFeld = page.locator('#mfa-code')
  const einrichten = page.getByText(/einrichten/i).first()
  await expect(codeFeld.or(einrichten), 'Zwei-Faktor-Seite lädt nicht').toBeVisible()
  if (!(await codeFeld.isVisible())) {
    throw new Error(`Rolle ${rolle}: Das Konto muss erst eine Zwei-Faktor-Anmeldung einrichten. Bitte manuell einrichten und das Geheimnis als E2E_${rolle.toUpperCase()}_TOTP_SECRET hinterlegen – der Test richtet keinen Faktor ein.`)
  }
  if (!z.totpSecret) {
    throw new Error(`Rolle ${rolle}: Konto verlangt einen Zwei-Faktor-Code, aber E2E_${rolle.toUpperCase()}_TOTP_SECRET ist nicht gesetzt.`)
  }
  // Kurz vor dem Codewechsel warten, damit der Code beim Prüfen noch gilt
  if (restSekunden() < 4) await page.waitForTimeout(restSekunden() * 1000 + 500)
  await codeFeld.fill(totp(z.totpSecret))
  await page.getByRole('button', { name: 'Bestätigen' }).click()
  await page.waitForURL(url => url.pathname !== '/zwei-faktor', { timeout: 20_000 })
}

for (const rolle of [...ROLLEN, ...PROFIL_ROLLEN]) {
  // @lesend: die Anmeldung ändert keine Daten und muss auch im Nur-Lesen-Modus laufen
  setup.describe(`Rolle ${rolle}`, { tag: '@lesend' }, () => {
    // Übersprungen, bevor ein Browser startet (kein page-Fixture ohne Zugangsdaten)
    setup.skip(!zugang(rolle), `Keine Zugangsdaten für ${rolle} – Tests dieser Rolle werden übersprungen`)
    anmeldung(rolle)
  })
}

function anmeldung(rolle: Rolle): void {
  setup(`Anmeldung ${rolle}`, async ({ page }) => {
    const z = zugang(rolle)
    if (!z) return

    // Die Anmeldeseite spricht direkt mit der Datenschnittstelle – ihren öffentlichen Schlüssel für die Gegenprobe merken
    page.on('request', req => {
      const apikey = req.headers()['apikey']
      if (!apikey || !req.url().includes('/auth/v1/')) return
      fs.mkdirSync(path.dirname(schluesselDatei()), { recursive: true })
      fs.writeFileSync(schluesselDatei(), JSON.stringify({ url: new URL(req.url()).origin, apikey }))
    })

    await page.goto('/login')
    await page.locator('#email').fill(z.email)
    await page.locator('#password').fill(z.passwort)
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click()

    // Nach dem Passwort: Zwei-Faktor, Betriebsauswahl oder direkt das Dashboard
    await page.waitForURL(url => url.pathname !== '/login', { timeout: 20_000 }).catch(async () => {
      const meldung = await page.locator('.card').innerText().catch(() => '')
      throw new Error(`Rolle ${rolle}: Anmeldung fehlgeschlagen. ${meldung}`)
    })
    if (new URL(page.url()).pathname === '/zwei-faktor') await zweiFaktor(page, rolle, z)

    // Ein Betrieb: /betrieb-waehlen leitet selbst auf /dashboard weiter; mehrere: Auswahlseite bleibt
    await page.waitForURL(url => url.pathname.startsWith('/dashboard') || url.pathname === '/betrieb-waehlen', { timeout: 20_000 })
    if (z.tenantId) {
      // Aktiven Betrieb ausdrücklich setzen (GET-Route, prüft die eigene Mitgliedschaft)
      await page.goto(`/auth/betrieb?tenant_id=${encodeURIComponent(z.tenantId)}`)
    }

    // Nicht schon beim Erreichen von /betrieb-waehlen abbrechen: bei einem Betrieb leitet die Seite erst nach dem
    // Laden (Server-Redirect über /auth/betrieb) weiter – der erste Staging-Lauf scheiterte am Ladezustand (10.10.2026)
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 }).catch(() => {
      if (!z.tenantId && new URL(page.url()).pathname === '/betrieb-waehlen') {
        throw new Error(`Rolle ${rolle}: Das Konto gehört zu mehreren Betrieben – bitte E2E_${rolle.toUpperCase()}_TENANT_ID setzen.`)
      }
      throw new Error(`Rolle ${rolle}: Nach der Anmeldung kein Dashboard (zuletzt ${new URL(page.url()).pathname}).`)
    })
    await expect(page.locator('body')).not.toContainText(/Application error/i)

    const datei = authDatei(rolle)
    fs.mkdirSync(path.dirname(datei), { recursive: true })
    await page.context().storageState({ path: datei })
  })
}
