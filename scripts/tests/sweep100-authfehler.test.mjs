// Sweep 100 (10.10.2026): Meldungen von Supabase Auth auf Deutsch.
// Befund: Anmeldung, Passwort zurücksetzen, Zwei-Faktor, Profil und Einladungen zeigten englische Texte
// („For security purposes, you can only request this after 45 seconds.“, „Email not confirmed“, „A user with this email
// address has already been registered“) – einzelne Stellen übersetzten selbst über Textvergleiche
// (error.message === 'Invalid login credentials', message.includes('Invalid')). Jetzt authFehlerText() zentral;
// check-fehlertext meldet zusätzlich error?.message und Textvergleiche auf Rohmeldungen.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { authFehlerText } from '../../src/lib/auth/authFehler.ts'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefeText, pruefeWurzel } = require(path.join(HIER, '..', 'check-fehlertext.js'))
const quelle = d => readFileSync(path.join(ROOT, d), 'utf8')

describe('authFehlerText', () => {
  test('nach Fehlercode', () => {
    assert.equal(authFehlerText({ code: 'invalid_credentials', message: 'Invalid login credentials' }), 'E-Mail oder Passwort falsch.')
    assert.match(authFehlerText({ code: 'email_not_confirmed', message: 'Email not confirmed' }), /noch nicht bestätigt/)
    assert.match(authFehlerText({ code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' }), /Code stimmt nicht/)
    assert.match(authFehlerText({ code: 'email_exists', message: 'A user with this email address has already been registered' }), /bereits ein Konto/)
  })

  test('Wartezeit aus dem Text, auch mit Code', () => {
    const m = 'For security purposes, you can only request this after 45 seconds.'
    assert.equal(authFehlerText({ message: m }), 'Aus Sicherheitsgründen erst in 45 Sekunden wieder möglich – bitte kurz warten.')
    assert.match(authFehlerText({ code: 'over_email_send_rate_limit', message: m }), /in 45 Sekunden/)
  })

  test('nach Text ohne Code, Netzfehler, Unbekanntes und leer', () => {
    assert.equal(authFehlerText({ message: 'Invalid login credentials' }), 'E-Mail oder Passwort falsch.')
    assert.match(authFehlerText({ message: 'Token has expired or is invalid' }), /Link ist abgelaufen/)
    assert.match(authFehlerText(new TypeError('Failed to fetch')), /Keine Verbindung/)
    assert.equal(authFehlerText({ message: 'Etwas Eigenes' }), 'Etwas Eigenes')
    assert.match(authFehlerText(null), /nicht erreichbar/)
  })
})

// Rückmeldung Jörgen zu KAN-294 (10.10.2026): Stoffliste der Besonderen Konten – „0 kg“ brach um, weil die Art-Auswahl
// (form-input, volle Breite) den Platz nahm
describe('Besondere Konten: Stoffliste', () => {
  test('Bestand einzeilig, Art-Auswahl nur so breit wie nötig', () => {
    assert.match(quelle('src/app/(dashboard)/kellerbuch/besondere-konten/page.tsx'), /tabular-nums whitespace-nowrap \$\{\(saldoJe/)
    assert.match(quelle('src/app/(dashboard)/kellerbuch/besondere-konten/StoffkontoClient.tsx'), /aria-label=\{`Art von \$\{name\}`\}[^>]*className="form-input w-auto! text-xs py-0\.5"/)
  })
})

describe('Verdrahtung', () => {
  test('Anmeldung, Passwort zurücksetzen, Zwei-Faktor, Einladungen nutzen authFehlerText', () => {
    assert.match(quelle('src/app/(auth)/login/page.tsx'), /setError\(authFehlerText\(error\)\)/)
    assert.match(quelle('src/app/(auth)/login/reset/page.tsx'), /setError\(authFehlerText\(error\)\)/)
    assert.equal((quelle('src/app/zwei-faktor/page.tsx').match(/setFehler\(authFehlerText\(error\)\)/g) ?? []).length, 2)
    assert.match(quelle('src/lib/auth/einladung.ts'), /fehler: error \? authFehlerText\(error\)/)
    assert.match(quelle('src/app/(dashboard)/benutzer/actions.ts'), /return \{ error: authFehlerText\(error\) \}/)
    assert.match(quelle('src/lib/auth/passwort.ts'), /return authFehlerText\(err\)/)
  })

  test('Wächter: error?.message und Textvergleiche', () => {
    const zeilen = t => pruefeText(t).funde.map(f => f.zeile)
    assert.deepEqual(zeilen("  return { ok: false, fehler: error?.message ?? 'x' }"), [1])
    assert.deepEqual(zeilen("  setError(error.message === 'Invalid login credentials' ? 'a' : 'b')"), [1])
    assert.deepEqual(zeilen("  if (error.message.includes('Invalid')) x()"), [1])
    assert.deepEqual(zeilen('  setError(authFehlerText(error))'), [])
    assert.deepEqual(pruefeWurzel(ROOT).funde, [])
  })
})
