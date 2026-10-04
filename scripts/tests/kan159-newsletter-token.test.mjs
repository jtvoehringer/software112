// KAN-159 BK4 (04.10.2026): Das Double-Opt-in-Token der Newsletter-Anmeldung wird nur noch als SHA-256-Hash in
// kontakte.newsletter_token_hash gespeichert; der Klartext steht nur im Bestätigungslink. Mitglieder lesen die
// Spalte, können damit aber keine Anmeldung im Namen des Kontakts bestätigen.
//
// Aufruf:  npm run -s test:csv   bzw. node --experimental-strip-types --test scripts/tests/kan159-newsletter-token.test.mjs

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { neuesNewsletterToken, istNewsletterToken, newsletterTokenHash } from '../../src/lib/newsletter/token.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const AKTIONEN = readFileSync(path.join(ROOT, 'src/app/newsletter/actions.ts'), 'utf8')

describe('KAN-159 BK4: Newsletter-Token nur als Hash', () => {
  test('Token: 64 Hex-Zeichen, zufällig', () => {
    const a = neuesNewsletterToken()
    assert.ok(istNewsletterToken(a))
    assert.notEqual(a, neuesNewsletterToken())
    assert.ok(!istNewsletterToken('xyz'))
    assert.ok(!istNewsletterToken(a.toUpperCase()))
  })
  test('Hash = SHA-256 hex, gleich der Datenbank-Umrechnung (encode(sha256(…), \'hex\'))', () => {
    const t = 'a'.repeat(64)
    assert.equal(newsletterTokenHash(t), createHash('sha256').update(t).digest('hex'))
    assert.notEqual(newsletterTokenHash(t), t)
  })
  test('Aktionen speichern und suchen nur den Hash, nie den Klartext', () => {
    assert.doesNotMatch(AKTIONEN, /newsletter_token(?!_hash)/, 'alte Spalte newsletter_token nicht mehr verwenden')
    assert.match(AKTIONEN, /newsletter_token_hash: tokenHash/)
    assert.match(AKTIONEN, /\.eq\('newsletter_token_hash', newsletterTokenHash\(token\)\)/)
    assert.doesNotMatch(AKTIONEN, /newsletter_token_hash:\s*token\b/)
  })
})
