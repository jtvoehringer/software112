// Sweep 97 (10.10.2026): jedes Zahlenfeld mit ausdrücklichem step.
// Befund: <input type="number"> ohne step lässt im Browser nur ganze Zahlen zu – im Weinexport ließen sich
// Versicherungswert (EUR) und die Menge einer Position (numeric(…,2)) nicht mit Kommastellen speichern.
// Jetzt step="0.01" dort, step="1" bei den 41 ganzzahligen Feldern. Wächter: scripts/check-zahl-eingabe.js (prebuild).
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefeText, pruefeWurzel } = require(path.join(HIER, '..', 'check-zahl-eingabe.js'))
const zeilen = t => pruefeText(t).funde.map(f => f.zeile)

describe('Erkennung', () => {
  test('Zahlenfeld ohne step → Fund; mit step, andere Typen → kein Fund', () => {
    assert.deepEqual(zeilen('<input type="number" value={x} />'), [1])
    assert.deepEqual(zeilen("a\n<input\n  type={'number'}\n  value={x} />"), [2])
    assert.deepEqual(zeilen('<input type="number" step="0.01" value={x} />'), [])
    assert.deepEqual(zeilen('<input type="number" step={schritt} />'), [])
    assert.deepEqual(zeilen('<input type="text" inputMode="decimal" />'), [])
    assert.deepEqual(zeilen('<input type="number" onChange={e => f(e.target.value > 1)} />'), [1])   // „>“ im Ausdruck beendet den Tag nicht
  })
})

describe('Projekt', () => {
  test('Weinexport: Versicherungswert und Menge nehmen Kommastellen an', () => {
    const t = readFileSync(path.join(ROOT, 'src/app/(dashboard)/weinexport/neu/WeinexportFormClient.tsx'), 'utf8')
    assert.match(t, /aria-label="Versicherungswert \(EUR\)" type="number" step="0\.01"/)
    assert.match(t, /type="number" step="0\.01" value=\{pos\.menge\}/)
  })

  test('jedes Zahlenfeld hat ein step', () => {
    const e = pruefeWurzel(ROOT)
    assert.ok(e.felder > 100, `zu wenige Zahlenfelder (${e.felder}) – Muster prüfen`)
    assert.deepEqual(e.funde, [])
  })
})
