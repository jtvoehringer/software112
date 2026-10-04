// KAN-159 Teil 2 (04.10.2026): Ein deaktivierter Betrieb (B16) bzw. eine deaktivierte Mitgliedschaft blendet die
// Datenbank für das Mitglied ganz aus. /betrieb-waehlen zeigt dann den Hinweis „Kein aktiver Betrieb“ samt Abmelden,
// statt auf /login umzuleiten (dort landete man ohne Erklärung wieder auf /betrieb-waehlen).
//
// Aufruf:  npm run -s test:csv   bzw. node --test scripts/tests/kan159-kein-aktiver-betrieb.test.mjs

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SEITE = readFileSync(path.join(ROOT, 'src/app/(auth)/betrieb-waehlen/page.tsx'), 'utf8')
const KNOPF = readFileSync(path.join(ROOT, 'src/app/(auth)/betrieb-waehlen/AbmeldenKnopf.tsx'), 'utf8')

// Rumpf des Zweigs „keine Mitgliedschaft“ (bis zur nächsten Leerzeile auf Funktionsebene)
const zweig = (() => {
  const i = SEITE.indexOf('if (!memberships || memberships.length === 0)')
  assert.ok(i >= 0, 'Zweig ohne Mitgliedschaft fehlt')
  return SEITE.slice(i, SEITE.indexOf('\n\n', i))
})()

describe('KAN-159 B16: kein aktiver Betrieb', () => {
  test('keine Umleitung auf /login ohne Mitgliedschaft', () => {
    assert.ok(!/redirect\(\s*['"]\/login['"]\s*\)/.test(zweig), 'ohne Mitgliedschaft nicht auf /login umleiten')
  })
  test('Hinweis und Abmelden-Knopf', () => {
    assert.match(zweig, /Kein aktiver Betrieb/)
    assert.match(zweig, /<AbmeldenKnopf\s*\/>/)
    assert.match(KNOPF, /auth\.signOut\(\)/)
    assert.match(KNOPF, /router\.push\('\/login'\)/)
  })
  test('ohne Anmeldung weiterhin /login', () => {
    assert.match(SEITE, /if \(!user\) redirect\('\/login'\)/)
  })
})
