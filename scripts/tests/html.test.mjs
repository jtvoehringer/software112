// Tests für das HTML-Escaping (src/lib/utils/html.ts, KAN-138) und dafür, dass die
// Weinexport-Druckansicht keine Interpolation aus DB-Daten mehr ungeescaped einsetzt.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//          bzw. node --experimental-strip-types --test scripts/tests/html.test.mjs

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { escHtml, escHtmlMehrzeilig, sichererDateiname, DOKUMENT_CSP } from '../../src/lib/utils/html.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('escHtml', () => {
  test('Sonderzeichen werden zu Entitäten', () => {
    assert.equal(escHtml(`<img src=x onerror="alert('x')">&`),
      '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;')
  })
  test('null/undefined → leer, Zahlen als Text', () => {
    assert.equal(escHtml(null), '')
    assert.equal(escHtml(undefined), '')
    assert.equal(escHtml(12.5), '12.5')
    assert.equal(escHtml(0), '0')
  })
  test('Umlaute und Gedankenstrich bleiben', () => {
    assert.equal(escHtml('Grüner Veltliner – Ried Höhe'), 'Grüner Veltliner – Ried Höhe')
  })
  test('Steuerzeichen entfernt, Tab und Zeilenumbruch bleiben', () => {
    assert.equal(escHtml('a\u0000b\u0007c\td\ne'), 'abc\td\ne')
  })
})

describe('escHtmlMehrzeilig', () => {
  test('erst escapen, dann Zeilenumbrüche als <br>', () => {
    assert.equal(escHtmlMehrzeilig('Zeile 1\r\n<b>Zeile 2</b>\nZeile 3'),
      'Zeile 1<br>&lt;b&gt;Zeile 2&lt;/b&gt;<br>Zeile 3')
  })
})

describe('sichererDateiname', () => {
  test('nur [A-Za-z0-9._-]', () => {
    assert.equal(sichererDateiname('rechnung-EX-2026/001"\r\nX: y'), 'rechnung-EX-2026_001_X_y')
    assert.equal(sichererDateiname(''), 'dokument')
    assert.equal(sichererDateiname('..'), 'dokument')
  })
})

describe('DOKUMENT_CSP', () => {
  test('Sandbox ohne Script', () => {
    assert.match(DOKUMENT_CSP, /^sandbox /)
    assert.doesNotMatch(DOKUMENT_CSP, /allow-scripts|allow-same-origin|script-src/)
    assert.match(DOKUMENT_CSP, /default-src 'none'/)
  })
})

describe('Weinexport-Druckansicht', () => {
  const quelle = readFileSync(path.join(ROOT, 'src/app/api/weinexport/[id]/dokument/[art]/route.ts'), 'utf8')
  test('jede einfache Interpolation läuft über e()/escHtmlMehrzeilig', () => {
    // css()/header(b) liefern fertiges HTML; art und a.referenz ?? auftragId stehen nur in der
    // JSON-Fehlermeldung bzw. innerhalb von sichererDateiname(…) im Content-Disposition-Header.
    const erlaubt = new Set(['css()', 'header(b)', 'i+1', 'gesamtEUR.toFixed(2)', 'art', 'a.referenz ?? auftragId'])
    const roh = [...quelle.matchAll(/\$\{([^{}`]+)\}/g)]
      .map(m => m[1].trim())
      .filter(x => !erlaubt.has(x) && !/^(e|escHtmlMehrzeilig)\(/.test(x))
    assert.deepEqual(roh, [])
  })
  test('Antwort setzt die Dokument-CSP', () => {
    assert.match(quelle, /'Content-Security-Policy': DOKUMENT_CSP/)
  })
})
