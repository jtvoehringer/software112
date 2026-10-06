// KAN-27 (06.10.2026): Brevo – System-Mails über das Konto von IC&P (Vercel BREVO_API_KEY/BREVO_SENDER_EMAIL),
// Newsletter nur über das eigene Brevo-Konto des Betriebs. Der Übergang über das Umgebungskonto
// (NEWSLETTER_TENANT_ID, BREVO_LIST_*, Absender noreply@weingut-gebeshuber.at) ist entfernt.
//
// Aufruf:  npm run -s test:csv  (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const brevo = hooksMoeglich ? await laden('lib/brevo/api.ts') : null

function dateien(dir) {
  return readdirSync(dir).flatMap(n => {
    const p = path.join(dir, n)
    return statSync(p).isDirectory() ? dateien(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
  })
}

describe('KAN-27 Brevo: System-Mails und Newsletter getrennt', () => {
  test('kein Newsletter über das Umgebungskonto mehr (NEWSLETTER_TENANT_ID, BREVO_LIST_*, Gebeshuber-Absender)', () => {
    const funde = dateien(path.join(WURZEL, 'src'))
      .filter(p => /process\.env\.(NEWSLETTER_TENANT_ID|BREVO_LIST_)|noreply@weingut-gebeshuber\.at/.test(readFileSync(p, 'utf8')))
      .map(p => path.relative(WURZEL, p))
    assert.deepEqual(funde, [])
    assert.equal(existsSync(path.join(WURZEL, 'src/lib/brevo/listen.ts')), false)
    assert.equal(existsSync(path.join(WURZEL, 'src/app/newsletter/page.tsx')), false)
  })

  test('System-Mail ohne BREVO_SENDER_EMAIL scheitert mit klarer Meldung – kein Rückfall auf die Adresse eines Betriebs', nurMitHooks, async () => {
    const alt = { key: process.env.BREVO_API_KEY, mail: process.env.BREVO_SENDER_EMAIL }
    process.env.BREVO_API_KEY = 'test'
    delete process.env.BREVO_SENDER_EMAIL
    try {
      await assert.rejects(brevo.sendEmail({ to: { email: 'a@b.at' }, subject: 'x', htmlContent: 'x' }), /BREVO_SENDER_EMAIL nicht konfiguriert/)
    } finally {
      if (alt.key === undefined) delete process.env.BREVO_API_KEY; else process.env.BREVO_API_KEY = alt.key
      if (alt.mail !== undefined) process.env.BREVO_SENDER_EMAIL = alt.mail
    }
  })
})
