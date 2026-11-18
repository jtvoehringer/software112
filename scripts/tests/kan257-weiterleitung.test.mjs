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

  // KAN-465: der Fehler bleibt auf einer eigenen Seite stehen – /login zeigte ihn nicht an und leitet bei offener Sitzung
  // ins Dashboard des angemeldeten (womöglich anderen) Kontos
  test('ohne gültigen Code: Fehlerseite (nie /login, nie ein fremdes Ziel)', async () => {
    globalThis.__serverFake = { auth: { exchangeCodeForSession: async () => ({ error: { message: 'abgelaufen' } }) } }
    try {
      const ziel = async q => String((await route.GET(new Request(`${ORIGIN}/auth/callback?${q}`))).ziel)
      assert.equal(await ziel('code=x&next=@boese.example'), `${ORIGIN}/auth/fehler?zweck=anmeldung`)
      assert.equal(await ziel('code=x&type=recovery&next=/auth/update-password'), `${ORIGIN}/auth/fehler?zweck=passwort`)
      assert.equal(await ziel('code=x&type=invite'), `${ORIGIN}/auth/fehler?zweck=einladung`)
      assert.equal(await ziel('next=/dashboard'), `${ORIGIN}/auth/fehler?zweck=anmeldung`)
    } finally { globalThis.__serverFake = null }
  })
  test('KAN-465: Token-Hash wird beim Abruf NICHT eingelöst – weiter zur Seite, auf der der Klick ihn einlöst', async () => {
    let eingeloest = 0
    globalThis.__serverFake = { auth: { exchangeCodeForSession: async () => { eingeloest++; return { error: null } }, verifyOtp: async () => { eingeloest++; return { error: null } } } }
    try {
      const ziel = async q => String((await route.GET(new Request(`${ORIGIN}/auth/callback?${q}`))).ziel)
      assert.equal(await ziel('next=/auth/update-password&type=recovery&token_hash=abc123'), `${ORIGIN}/auth/update-password?token_hash=abc123&type=recovery`)
      assert.equal(await ziel('type=invite&token_hash=abc123'), `${ORIGIN}/auth/invite?token_hash=abc123&type=invite`)
      // ein fremdes „next“ spielt dabei keine Rolle
      assert.equal(await ziel('next=https://boese.example&type=recovery&token_hash=x'), `${ORIGIN}/auth/update-password?token_hash=x&type=recovery`)
      assert.equal(eingeloest, 0, 'ein Abruf durch Mailprogramm oder Virenscanner verbraucht den Link nicht')
    } finally { globalThis.__serverFake = null }
  })
  test('KAN-465: ohne Code (Sitzung bzw. Fehler im Fragment) weiter zur Seite des Zwecks, Fehlerangaben bleiben erhalten', async () => {
    const ziel = async q => String((await route.GET(new Request(`${ORIGIN}/auth/callback?${q}`))).ziel)
    assert.equal(await ziel('next=/auth/update-password&type=recovery'), `${ORIGIN}/auth/update-password`)
    assert.equal(await ziel('type=recovery&error=access_denied&error_code=otp_expired'), `${ORIGIN}/auth/update-password?error=access_denied&error_code=otp_expired`)
    assert.equal(await ziel('type=invite&error=access_denied'), `${ORIGIN}/auth/invite?error=access_denied`)
  })
})
