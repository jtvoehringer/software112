// KAN-257 (09.10.2026): Login-Callback (/auth/callback) leitet nach dem Anmelden nur auf relative Pfade der App weiter.
// Vorher `${origin}${next}` mit ungeprüftem next: „@boese.example“ → https://app@boese.example (Benutzerinfo, Ziel ist
// boese.example), „.boese.example“ → https://app.at.boese.example – offene Weiterleitung direkt nach dem Login.
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { DOPPEL, hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

const modul = code => 'data:text/javascript,' + encodeURIComponent(code)
DOPPEL['next/server'] = modul('export class NextResponse { static redirect(url) { return { status: 307, ziel: String(url) } } }')
hooksRegistrieren()
const route = hooksMoeglich ? await laden('app/auth/callback/route.ts') : null

const ORIGIN = 'https://software112.icp-consultants.at'
const sitzung = (bestaetigtVorMs = null) => ({
  auth: {
    exchangeCodeForSession: async () => ({ error: null }),
    getUser: async () => ({ data: { user: { email_confirmed_at: bestaetigtVorMs === null ? null : new Date(Date.now() - bestaetigtVorMs).toISOString() } } }),
  },
})
const aufruf = async (query, fake = sitzung()) => {
  globalThis.__serverFake = fake
  try { return (await route.GET(new Request(`${ORIGIN}/auth/callback?code=abc&${query}`))).ziel } finally { globalThis.__serverFake = null }
}

describe('Login-Callback: Weiterleitung nur innerhalb der App', nurMitHooks, () => {
  test('fremde Ziele landen auf dem Dashboard', async () => {
    for (const next of ['@boese.example', '.boese.example', '//boese.example', 'https://boese.example/login', '/\\boese.example', 'javascript:alert(1)', '']) {
      const ziel = await aufruf(`next=${encodeURIComponent(next)}`)
      assert.equal(ziel, `${ORIGIN}/dashboard`, `next=${next}`)
      assert.equal(new URL(ziel).host, 'software112.icp-consultants.at')
    }
  })

  test('relative Pfade der App bleiben erhalten (mit Suche); ohne next das Dashboard', async () => {
    assert.equal(await aufruf(`next=${encodeURIComponent('/kellerbuch/weinausbau?tab=offen')}`), `${ORIGIN}/kellerbuch/weinausbau?tab=offen`)
    assert.equal(await aufruf('type=magiclink'), `${ORIGIN}/dashboard`)
  })

  test('Passwort-Reset und Einladung führen wie bisher zur Passwortseite', async () => {
    assert.equal(await aufruf(`next=${encodeURIComponent('/auth/update-password')}&type=recovery`), `${ORIGIN}/auth/update-password`)
    assert.equal(await aufruf('type=invite'), `${ORIGIN}/auth/update-password`)
    assert.equal(await aufruf('next=/dashboard', sitzung(5000)), `${ORIGIN}/auth/update-password`, 'gerade bestätigt')
  })

  test('ohne gültigen Code: zurück zum Login mit Fehler', async () => {
    globalThis.__serverFake = { auth: { exchangeCodeForSession: async () => ({ error: { message: 'abgelaufen' } }) } }
    try {
      assert.equal((await route.GET(new Request(`${ORIGIN}/auth/callback?code=x&next=@boese.example`))).ziel, `${ORIGIN}/login?error=auth_callback_failed`)
    } finally { globalThis.__serverFake = null }
  })
})
