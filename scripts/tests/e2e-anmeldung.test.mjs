// E2E-Ausbau (10.10.2026): Anmeldung im Playwright-Setup (e2e/auth.setup.ts) – läuft in verify mit.
// Befund im ersten Staging-Lauf: Der Test brach schon beim Erreichen von /betrieb-waehlen mit „mehreren Betrieben“ ab,
// obwohl das Konto nur einen Betrieb hat – die Seite leitet erst nach dem Laden (Server-Redirect) aufs Dashboard weiter.
//
// Aufruf:  npm run -s test:csv

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const quelle = readFileSync(new URL('../../e2e/auth.setup.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('„mehrere Betriebe“ erst, wenn das Dashboard nach dem Warten ausbleibt', () => {
  const warten = quelle.indexOf('await page.waitForURL(/\\/dashboard/, { timeout: 20_000 }).catch(')
  const meldung = quelle.indexOf('Das Konto gehört zu mehreren Betrieben')
  assert.ok(warten > 0, 'Warten auf /dashboard mit Fehlerbehandlung fehlt')
  assert.ok(meldung > warten, 'Die Meldung „mehrere Betriebe“ darf erst nach dem Warten auf /dashboard kommen')
  assert.equal(quelle.split('Das Konto gehört zu mehreren Betrieben').length, 2, 'genau eine Stelle')
})

test('Vercel-Toolbar wird in den Tests abgeschaltet (sonst CSP-Konsolenfehler auf jeder Staging-Seite)', () => {
  const umgebung = readFileSync(new URL('../../e2e/umgebung.ts', import.meta.url), 'utf8')
  assert.match(umgebung, /'x-vercel-skip-toolbar': '1'/)
})

test('Pflanzenschutz-Lager: Lieferant der Betriebsmittel-Bewegungen über den Namen des Verbund-FK (sonst PGRST200, Seite 500)', () => {
  const seite = readFileSync(new URL('../../src/app/(dashboard)/behandlungen/lager/page.tsx', import.meta.url), 'utf8')
  assert.match(seite, /lieferant:firmen!betriebsmittel_lager_bewegungen_lieferant_fkey\(name\)/)
  assert.doesNotMatch(seite, /lieferant:firmen!lieferant_firma_id/)
})
