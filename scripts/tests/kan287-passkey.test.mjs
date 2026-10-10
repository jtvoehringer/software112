// KAN-287 (10.10.2026): Zwei-Faktor per Passkey (Fingerabdruck, Gesicht, Windows Hello) über Supabase MFA „webauthn“.
// Ein bestätigter Passkey ist ein Faktor wie der Code (Stufe aal2); einrichten zusätzlich oder als erster Faktor,
// bei der Anmeldung bestätigen (Code als Rückfall), einzeln entfernen.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const p = hooksMoeglich ? await laden('lib/auth/passkey.ts') : null
const quelle = d => readFileSync(new URL(`../../${d}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('Passkey-Hilfen', nurMitHooks, () => {
  test('Faktoren aufteilen: Code und Passkeys, nur bestätigte', () => {
    const fl = { all: [
      { id: 't1', status: 'verified', factor_type: 'totp' },
      { id: 'w1', status: 'verified', factor_type: 'webauthn', friendly_name: 'Passkey Windows' },
      { id: 'w2', status: 'unverified', factor_type: 'webauthn' },
    ] }
    const f = p.faktorenAufteilen(fl)
    assert.equal(f.totp.id, 't1')
    assert.deepEqual(f.passkeys.map(x => x.id), ['w1'])
    assert.equal(f.bestaetigt.length, 2)
    // nur Passkey (ohne App) ist ebenfalls ein Faktor
    assert.deepEqual(p.faktorenAufteilen({ all: [{ id: 'w1', status: 'verified', factor_type: 'webauthn' }] }).bestaetigt.map(x => x.id), ['w1'])
    assert.equal(p.faktorenAufteilen(null).totp, null)
  })

  test('Browser-Fähigkeit, Name, Fehlertexte', () => {
    assert.equal(p.passkeyMoeglich({ PublicKeyCredential: function () {} }), true)
    assert.equal(p.passkeyMoeglich({}), false)
    assert.equal(p.passkeyMoeglich(undefined), false)
    assert.equal(p.passkeyName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', '10.10.2026'), 'Passkey iPhone 10.10.2026')
    assert.equal(p.passkeyName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', '10.10.2026'), 'Passkey Windows 10.10.2026')
    assert.match(p.passkeyFehlerText({ name: 'NotAllowedError', message: 'x' }), /Abgebrochen/)
    assert.match(p.passkeyFehlerText({ message: 'MFA WebAuthn is disabled' }), /noch nicht freigeschaltet/)
    assert.match(p.passkeyFehlerText({ name: 'InvalidStateError' }), /bereits ein Passkey/)
  })
})

describe('Verdrahtung', () => {
  test('Zwei-Faktor-Seite: bestätigen, einrichten (auch als erster Faktor), entfernen', () => {
    const s = quelle('src/app/zwei-faktor/page.tsx')
    assert.match(s, /supabase\.auth\.mfa\.webauthn\.authenticate\(\{ factorId: p\.id \}\)/)
    assert.match(s, /supabase\.auth\.mfa\.webauthn\.register\(\{ friendlyName: passkeyName\(/)
    assert.match(s, /passkeyKnopf\('Mit Passkey bestätigen', mitPasskey, true\)/)
    assert.match(s, /passkeyKnopf\('Mit Passkey einrichten', passkeyEinrichten\)/)
    assert.match(s, /passkeyKnopf\('Passkey hinzufügen', passkeyEinrichten\)/)
    assert.match(s, /supabase\.auth\.mfa\.unenroll\(\{ factorId: p\.id \}\)/)
    assert.match(s, /const verifiziert = f\.totp \?\? f\.passkeys\[0\]/)
  })

  test('Faktor-Stand zählt auch Passkeys; Proxy/DB unverändert über die Stufe im Token', () => {
    assert.match(quelle('src/lib/auth/mfa.ts'), /const hatFaktor = \(\(faktoren\?\.all \?\? faktoren\?\.totp \?\? \[\]\) as R\[\]\)\.some\(f => f\.status === 'verified'\)/)
    assert.match(quelle('src/lib/auth/mfa.ts'), /return \(user\?\.factors \?\? \[\]\)\.some\(f => f\.status === 'verified'\)/)
  })
})
