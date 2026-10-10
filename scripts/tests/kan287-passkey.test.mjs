// KAN-287 (10.10.2026): Anmeldung per Passkey (Fingerabdruck, Gesicht, Windows Hello) über Supabase „Passkeys“ (Beta).
// WebAuthn als zweiter Faktor ist im Supabase-Dashboard nicht freischaltbar; die Passkey-Anmeldung ersetzt das Passwort.
// Die Abfrage läuft nur auf der Basis-Adresse (eine Origin je Hauptdomain in Supabase, nicht je Betrieb – KAN-221);
// auf Betriebs-Subdomains führt der Knopf dorthin, das Anmelde-Cookie gilt für alle Subdomains (KAN-31).
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
  test('Browser-Fähigkeit und Gerätename', () => {
    assert.equal(p.passkeyMoeglich({ PublicKeyCredential: function () {} }), true)
    assert.equal(p.passkeyMoeglich({}), false)
    assert.equal(p.passkeyMoeglich(undefined), false)
    assert.equal(p.passkeyName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', '10.10.2026'), 'Passkey iPhone 10.10.2026')
    assert.equal(p.passkeyName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', '10.10.2026'), 'Passkey Windows 10.10.2026')
    assert.equal(p.passkeyName('', '10.10.2026'), 'Passkey Gerät 10.10.2026')
  })

  test('Fehlertexte', () => {
    assert.match(p.passkeyFehlerText({ name: 'NotAllowedError', message: 'x' }), /Abgebrochen/)
    assert.match(p.passkeyFehlerText({ message: 'Passkey authentication is disabled' }), /noch nicht freigeschaltet/)
    assert.match(p.passkeyFehlerText({ name: 'InvalidStateError' }), /bereits ein Passkey/)
    assert.match(p.passkeyFehlerText({ message: 'credential not found' }), /kein Passkey eingerichtet/)
  })
})

describe('Verdrahtung', () => {
  test('Browser-Client schaltet die experimentelle Passkey-Funktion ein', () => {
    assert.match(quelle('src/lib/supabase/client.ts'), /auth: \{ experimental: \{ passkey: true \} \}/)
  })

  test('Login: „Mit Passkey anmelden“, auf Subdomains zur Basis; nach jeder Anmeldung Sitzungs-Cookie (KAN-286)', () => {
    const l = quelle('src/app/(auth)/login/page.tsx')
    assert.match(l, /await supabase\.auth\.signInWithPasskey\(\)/)
    assert.match(l, /if \(passkey\.basisLogin\) \{ window\.location\.href = passkey\.basisLogin; return \}/)
    assert.match(l, /basisLogin: sub \? subdomainUrl\(null, '\/login'\) : null/)
    assert.match(l, /const angemeldet = \(\) => \{\n\s*sitzungsCookieSchreiben\(\)/)
    assert.equal((l.match(/angemeldet\(\)/g) ?? []).length, 2, 'Passwort und Passkey')
  })

  test('Zwei-Faktor-Seite: Passkeys einrichten, anzeigen, entfernen (nur auf der Basis-Adresse)', () => {
    const v = quelle('src/components/PasskeyVerwaltung.tsx')
    assert.match(v, /await supabase\.auth\.registerPasskey\(\)/)
    assert.match(v, /await supabase\.auth\.passkey\.list\(\)/)
    assert.match(v, /await supabase\.auth\.passkey\.delete\(\{ passkeyId: p\.id \}\)/)
    assert.match(v, /setBasis\(sub \? subdomainUrl\(null, '\/zwei-faktor'\) : null\)/)
    assert.equal((quelle('src/app/zwei-faktor/page.tsx').match(/<PasskeyVerwaltung \/>/g) ?? []).length, 2)
  })

  test('Sitzungs-Cookie: eine gemeinsame Funktion für Login und Inaktivitäts-Timer', () => {
    assert.match(quelle('src/components/SessionTimeout.tsx'), /import \{ sitzungsCookieSchreiben \} from '@\/lib\/auth\/sitzungCookie'/)
    assert.doesNotMatch(quelle('src/components/SessionTimeout.tsx'), /function sitzungsCookieSchreiben/)
  })
})
