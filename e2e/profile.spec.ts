// ── Profile „Extern“ und „Vertrieb“: Rundgang, gesperrte Seiten, Gegenprobe (KAN-456/KAN-457) ──────────────────
//
// Läuft nur in den Playwright-Projekten „extern“ und „vertrieb“ (playwright.config.ts) mit den Testbenutzern des
// Staging-Testbetriebs (E2E_EXTERN_* / E2E_VERTRIEB_*). Je Profil:
//   1. jede Seite seiner Navigation öffnet ohne Fehlerbild, ohne Konsolenfehler und ohne Umleitung „kein Leserecht“
//   2. eine Seite eines gesperrten Bereichs (Lesezeichen, alter Link) leitet auf die Übersicht mit Hinweis
//   3. die Navigation enthält keinen Verweis in einen gesperrten Bereich
//   4. Gegenprobe über die Datenschnittstelle mit der Sitzung des Testbenutzers: Tabellen gesperrter Bereiche liefern
//      0 Zeilen, der eigene Bereich liefert Zeilen; Anlegen in einem gesperrten Bereich wird abgelehnt
// Die Pfade kommen aus src/lib/navigation (buildNav, seitenBereich) – keine abgeschriebene Liste.

import fs from 'node:fs'
import { test, expect, keinFehlerbild, schreibend } from './fixtures'
import { navPfade } from './navigation'
import { KEIN_LESERECHT_TEXT, PROFILE } from '../src/lib/auth/lesebereiche'
import { seitenBereich } from '../src/lib/navigation/seitenBereich'
import { authDatei, PROFIL_ROLLEN, schluesselDatei, type ProfilRolle } from './umgebung'

const lesbar = (profil: ProfilRolle, pfad: string) => (PROFILE[profil].lesen as readonly string[]).includes(seitenBereich(pfad))

/** Seiten der Navigation der Betriebsleitung, deren Bereich das Profil nicht liest */
const gesperrtePfade = (profil: ProfilRolle) => navPfade('tenant_admin').filter(p => !lesbar(profil, p)).sort()

/** Tabellen für die Gegenprobe: gesperrt (0 Zeilen), offen (mindestens eine Zeile im Testbetrieb), anlegen (abgelehnt) */
const GEGENPROBE: Record<ProfilRolle, { gesperrt: string[]; offen: string; anlegen: { tabelle: string; werte: Record<string, unknown> } }> = {
  extern: {
    gesperrt: ['kontakte', 'grundstueck_recht', 'pflanzenschutzmittel', 'behaelter', 'verkaufsposten', 'ea_transaktionen', 'kostenstellen'],
    offen: 'weingarten',
    anlegen: { tabelle: 'kostenstellen', werte: { name: 'S112TEST E2E Profil' } },
  },
  vertrieb: {
    gesperrt: ['behaelter', 'weinausbau', 'grundstuecke', 'grundstueck_recht', 'ea_transaktionen', 'pflanzenschutzmittel', 'ernte_parzellen'],
    offen: 'kontakte',
    anlegen: { tabelle: 'kellerplaene', werte: { name: 'S112TEST E2E Profil' } },
  },
}

/** Zugriffstoken der angemeldeten Sitzung aus dem gespeicherten Zustand (Cookie sb-…-auth-token, ggf. in Teilen) */
function sitzungsToken(profil: ProfilRolle): string {
  const zustand = JSON.parse(fs.readFileSync(authDatei(profil), 'utf8')) as { cookies: { name: string; value: string }[] }
  const teile = zustand.cookies.filter(c => /^sb-.+-auth-token(\.\d+)?$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
  if (teile.length === 0) throw new Error(`Profil ${profil}: kein Sitzungs-Cookie (sb-…-auth-token) im gespeicherten Zustand`)
  let roh = decodeURIComponent(teile.map(t => t.value).join(''))
  if (roh.startsWith('base64-')) roh = Buffer.from(roh.slice('base64-'.length), 'base64url').toString('utf8')
  const sitzung = JSON.parse(roh) as { access_token?: string } | [string]
  const token = Array.isArray(sitzung) ? sitzung[0] : sitzung.access_token
  if (!token) throw new Error(`Profil ${profil}: Sitzungs-Cookie ohne Zugriffstoken`)
  return token
}

function datenschnittstelle(): { url: string; apikey: string } | null {
  if (!fs.existsSync(schluesselDatei())) return null
  return JSON.parse(fs.readFileSync(schluesselDatei(), 'utf8')) as { url: string; apikey: string }
}

for (const profil of PROFIL_ROLLEN) {
  test.describe(`Profil ${profil} – Rundgang`, { tag: '@lesend' }, () => {
    for (const pfad of navPfade(profil)) {
      test(`${profil}: Seite ${pfad}`, async ({ page, rolle, konsolenFehler }) => {
        test.skip(rolle !== profil, `nur im Projekt ${profil}`)
        const antwort = await page.goto(pfad, { waitUntil: 'domcontentloaded' })
        expect(antwort, 'keine Antwort').not.toBeNull()
        expect(antwort!.status(), `HTTP-Status ${pfad}`).toBeLessThan(400)
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)

        const ziel = new URL(page.url())
        expect(ziel.pathname, 'Sitzung verloren').not.toMatch(/^\/(login|zwei-faktor)/)
        expect(ziel.search, `${pfad} steht in der Navigation, leitet aber mit „kein Leserecht“ um`).not.toContain('kein_leserecht')
        await keinFehlerbild(page)
        await expect(page.locator('body'), 'Meldung „Leserecht fehlt“ auf einer erlaubten Seite').not.toContainText(/Für diesen Bereich fehlt das Leserecht/)
        await expect(page.locator('h1, h2, [role="heading"]').first(), 'keine Überschrift').toBeVisible()
        expect(konsolenFehler.liste, 'Konsolenfehler').toEqual([])
      })
    }

    test(`${profil}: Navigation ohne Verweise in gesperrte Bereiche`, async ({ page, rolle }) => {
      test.skip(rolle !== profil, `nur im Projekt ${profil}`)
      await page.goto('/dashboard')
      const erlaubt = new Set(navPfade(profil))
      for (const pfad of gesperrtePfade(profil)) {
        if (erlaubt.has(pfad)) continue
        await expect(page.locator(`nav a[href="${pfad}"]`), `Verweis auf ${pfad} in der Navigation`).toHaveCount(0)
      }
    })

    for (const pfad of gesperrtePfade(profil)) {
      test(`${profil}: gesperrte Seite ${pfad} leitet auf die Übersicht`, async ({ page, rolle }) => {
        test.skip(rolle !== profil, `nur im Projekt ${profil}`)
        await page.goto(pfad, { waitUntil: 'domcontentloaded' })
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
        const ziel = new URL(page.url())
        // Rollen- und Modul-Guards leiten ebenfalls auf die Übersicht – entscheidend ist: die Seite selbst erscheint nicht
        expect(ziel.pathname, `${pfad} ist für ${profil} erreichbar`).toBe('/dashboard')
        if (ziel.search.includes('kein_leserecht')) await expect(page.getByText(KEIN_LESERECHT_TEXT)).toBeVisible()
        await keinFehlerbild(page)
      })
    }

    test(`${profil}: Datenschnittstelle liefert aus gesperrten Bereichen 0 Zeilen`, async ({ request, rolle }) => {
      test.skip(rolle !== profil, `nur im Projekt ${profil}`)
      const api = datenschnittstelle()
      test.skip(!api, 'Schlüssel der Datenschnittstelle nicht gemerkt (Anmeldung ohne Aufruf von /auth/v1)')
      const kopf = { apikey: api!.apikey, Authorization: `Bearer ${sitzungsToken(profil)}` }
      const g = GEGENPROBE[profil]

      // Gegenkontrolle zuerst: Token und Schlüssel funktionieren, der eigene Bereich liefert Zeilen
      const offen = await request.get(`${api!.url}/rest/v1/${g.offen}?select=id&limit=1`, { headers: kopf })
      expect(offen.status(), `${g.offen}: ${await offen.text()}`).toBe(200)
      expect((await offen.json() as unknown[]).length, `${g.offen}: der eigene Bereich liefert keine Zeile – Gegenprobe wäre wertlos`).toBeGreaterThan(0)

      for (const tabelle of g.gesperrt) {
        const antwort = await request.get(`${api!.url}/rest/v1/${tabelle}?select=*&limit=1`, { headers: kopf })
        expect(antwort.status(), `${tabelle}: ${await antwort.text()}`).toBe(200)
        expect(await antwort.json(), `${tabelle} liefert ${profil} Zeilen`).toEqual([])
      }
    })
  })

  test.describe(`Profil ${profil} – Schreiben`, () => {
    test(`${profil}: Anlegen in einem gesperrten Bereich wird abgelehnt`, async ({ request, rolle }) => {
      test.skip(rolle !== profil, `nur im Projekt ${profil}`)
      schreibend()
      const api = datenschnittstelle()
      test.skip(!api, 'Schlüssel der Datenschnittstelle nicht gemerkt (Anmeldung ohne Aufruf von /auth/v1)')
      const kopf = { apikey: api!.apikey, Authorization: `Bearer ${sitzungsToken(profil)}` }
      const mitglied = await request.get(`${api!.url}/rest/v1/tenant_memberships?select=tenant_id,profil&limit=1`, { headers: kopf })
      expect(mitglied.status(), await mitglied.text()).toBe(200)
      const [m] = await mitglied.json() as { tenant_id: string; profil: string | null }[]
      expect(m?.profil, 'der Testbenutzer trägt das Profil nicht').toBe(profil)

      const g = GEGENPROBE[profil].anlegen
      const antwort = await request.post(`${api!.url}/rest/v1/${g.tabelle}`, { headers: { ...kopf, Prefer: 'return=minimal' }, data: { tenant_id: m.tenant_id, ...g.werte } })
      const text = await antwort.text()
      // 42501 = Policy lehnt ab (PostgREST: 403). Alles andere – vor allem 201 – ist ein Befund.
      expect(antwort.status(), `${g.tabelle}: ${text}`).toBe(403)
      expect(text, g.tabelle).toContain('42501')
    })
  })
}
