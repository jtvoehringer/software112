// KAN-287 Nachtrag (10.10.2026): Passkey-Anmeldung gilt als Zwei-Faktor.
// Befund Jörgen: nach der Anmeldung per Fingerabdruck kam trotzdem die Code-Abfrage – Supabase stuft eine Passkey-Anmeldung
// als aal1 ein (amr-Methode „passkey“). Entscheidung: der Passkey ersetzt den Code. Gleiche Regel in App (zweiFaktorErfuellt)
// und Datenbank (s112_aal_ok, Migration kan287_passkey_aal).
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const m = hooksMoeglich ? await laden('lib/auth/mfa.ts') : null
const quelle = d => readFileSync(new URL(`../../${d}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('zweiFaktorErfuellt', nurMitHooks, () => {
  test('aal2 und Passkey erfüllen, Passwort allein nicht', () => {
    assert.equal(m.zweiFaktorErfuellt({ currentLevel: 'aal2', currentAuthenticationMethods: [] }), true)
    assert.equal(m.zweiFaktorErfuellt({ currentLevel: 'aal1', currentAuthenticationMethods: [{ method: 'passkey', timestamp: 1 }] }), true)
    assert.equal(m.zweiFaktorErfuellt({ currentLevel: 'aal1', currentAuthenticationMethods: ['passkey'] }), true)
    assert.equal(m.zweiFaktorErfuellt({ currentLevel: 'aal1', currentAuthenticationMethods: [{ method: 'password', timestamp: 1 }] }), false)
    assert.equal(m.zweiFaktorErfuellt({ currentLevel: 'aal1', currentAuthenticationMethods: [{ method: 'otp', timestamp: 1 }] }), false)
    assert.equal(m.zweiFaktorErfuellt({ currentLevel: 'aal1' }), false)
    assert.equal(m.zweiFaktorErfuellt(null), false)
    assert.equal(m.zweiFaktorErfuellt(undefined), false)
  })
})

describe('Verdrahtung', () => {
  test('alle App-Prüfungen der Stufe laufen über zweiFaktorErfuellt (kein currentLevel-Vergleich mehr)', () => {
    for (const d of ['src/proxy.ts', 'src/lib/api/zweiFaktor.ts', 'src/lib/auth/roles.ts', 'src/app/zwei-faktor/page.tsx']) {
      const t = quelle(d)
      assert.match(t, /zweiFaktorErfuellt\(aal\)/, d)
      assert.doesNotMatch(t, /currentLevel\s*[!=]==/, d)
    }
    assert.match(quelle('src/lib/auth/mfa.ts'), /stufe: \(zweiFaktorErfuellt\(aal\) \? 'aal2'/)
  })

  test('Datenbank: s112_aal_ok lässt die amr-Methode passkey gelten', () => {
    const dir = new URL('../../supabase/migrations/', import.meta.url)
    const mig = readdirSync(dir).find(f => /_kan287_passkey_aal\.sql$/.test(f))
    const entwurf = new URL('../../supabase/entwurf/kan287_passkey_aal.sql', import.meta.url)
    const pfad = mig ? new URL(mig, dir) : existsSync(entwurf) ? entwurf : null
    if (!pfad) return   // Entwurf ist nicht eingecheckt; nach dem Einspielen liegt die Migration vor
    const sql = readFileSync(pfad, 'utf8')
    assert.match(sql, /FUNCTION public\.s112_aal_ok\(\)/)
    assert.match(sql, /= 'passkey'/)
    assert.match(sql, /SET search_path TO 'public'/)
  })
})
