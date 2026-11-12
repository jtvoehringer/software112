// KAN-141 (01.10.2026): Drucken-Knopf in den Weinexport-Druckansichten (/api/weinexport/[id]/dokument/[art]).
// Die Antwort bleibt in der Sandbox ohne allow-same-origin; freigegeben ist genau ein Skript per SHA-256-Hash,
// kein 'unsafe-inline', keine Inline-Handler. Der Knopf steht in allen sechs Dokumenten und ist im Ausdruck ausgeblendet.
//
// Aufruf:  npm run -s test:csv   bzw. node --experimental-strip-types --test scripts/tests/kan141-druckknopf.test.mjs

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { DOKUMENT_CSP } from '../../src/lib/utils/html.ts'
import { druckCsp, druckleiste, DRUCK_SKRIPT, DRUCKLEISTE_CSS } from '../../src/lib/utils/druckknopf.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ROUTE = readFileSync(path.join(ROOT, 'src/app/api/weinexport/[id]/dokument/[art]/route.ts'), 'utf8')
const CSP = druckCsp(DOKUMENT_CSP)
const direktiven = Object.fromEntries(CSP.split(';').map(d => d.trim().split(/\s+/)).map(([k, ...w]) => [k, w]))

describe('KAN-141 Druck-CSP', () => {
  test('Sandbox mit allow-scripts, aber weiterhin ohne allow-same-origin', () => {
    assert.ok(direktiven.sandbox.includes('allow-scripts'))
    assert.ok(direktiven.sandbox.includes('allow-modals'), 'window.print() braucht allow-modals')
    assert.ok(!direktiven.sandbox.includes('allow-same-origin'))
  })
  test('script-src nur der Hash des Druckskripts', () => {
    const hash = `'sha256-${createHash('sha256').update(DRUCK_SKRIPT, 'utf8').digest('base64')}'`
    assert.deepEqual(direktiven['script-src'], [hash])
  })
  test('übrige Direktiven der Dokument-CSP bleiben unverändert', () => {
    assert.equal(CSP.replace(/ allow-scripts/, '').replace(/ script-src [^;]+;/, ''), DOKUMENT_CSP)
  })
  test('unerwartete Basis wird abgelehnt', () => {
    assert.throws(() => druckCsp("default-src 'none';"))
    assert.throws(() => druckCsp(CSP))
  })
})

describe('KAN-141 Druckleiste', () => {
  const leiste = druckleiste()
  test('Skript im HTML ist byte-gleich mit dem gehashten Skript', () => {
    assert.ok(leiste.includes(`<script>${DRUCK_SKRIPT}</script>`))
  })
  test('kein Inline-Handler, Knopf per addEventListener', () => {
    assert.doesNotMatch(leiste, /\son[a-z]+=/i)
    assert.match(DRUCK_SKRIPT, /addEventListener\('click'/)
    assert.match(DRUCK_SKRIPT, /window\.print\(\)/)
    assert.match(leiste, /id="s112-drucken"/)
  })
  test('im Ausdruck ausgeblendet', () => {
    assert.match(DRUCKLEISTE_CSS, /@media print\{\.s112-druckleiste\{display:none\}\}/)
  })
})

describe('KAN-141 Weinexport-Route', () => {
  // KAN-433: sieben Dokumente (+ Packliste); außer V1/V2 steht die Druckleiste in `leiste` (Druckleiste + Hinweisleiste)
  test('alle sieben Dokumente haben die Druckleiste direkt nach <body>', () => {
    const bodies = ROUTE.match(/<body>/g) ?? []
    const mitLeiste = ROUTE.match(/<body>\$\{(druckleiste\(\)|leiste)\}/g) ?? []
    assert.equal(bodies.length, 7)
    assert.equal(mitLeiste.length, 7)
    assert.match(ROUTE, /const leiste = druckleiste\(\) \+ hinweisLeiste/)
    for (const art of ['v1v2', 'eur1', 'cmr', 'certificate_of_origin', 'lieferschein', 'rechnung', 'packliste'])
      assert.match(ROUTE, new RegExp(`case '${art}':`))
  })
  test('CSS der Leiste im Style-Block, Antwort mit Druck-CSP', () => {
    assert.match(ROUTE, /\$\{DRUCKLEISTE_CSS\}/)
    assert.match(ROUTE, /'Content-Security-Policy': DRUCK_CSP/)
  })
})
