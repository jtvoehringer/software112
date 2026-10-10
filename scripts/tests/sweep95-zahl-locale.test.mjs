// Sweep 95 (10.10.2026): Zahlen nie mit 'de-AT' formatieren.
// Befund: 'de-AT' gruppiert mit geschütztem Leerzeichen („1 234,50“), die CD verlangt den Tausenderpunkt („1.234,50“) –
// src/lib/format.ts nutzt dafür ZAHL_LOCALE ('de-DE'). 15 Stellen (Betriebsmittel-Lager, Grundstückskosten,
// CRM-Gemeinschaft, E-Label, Liter-/kg-/Prozent-Meldungen in Kellerbuch und Lese) formatierten trotzdem mit 'de-AT'.
// Wächter: scripts/check-zahl-locale.js (prebuild).
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { ZAHL_LOCALE } from '../../src/lib/format.ts'
import { verarbeitungFehler } from '../../src/lib/kellerbuch/verarbeitung.ts'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefeText, pruefeWurzel } = require(path.join(HIER, '..', 'check-zahl-locale.js'))
const zeilen = t => pruefeText(t).funde.map(f => f.zeile)

describe('Locale', () => {
  test("'de-AT' gruppiert mit Leerzeichen, ZAHL_LOCALE mit Punkt (Grund für den Wächter)", () => {
    assert.match((1234567.5).toLocaleString('de-AT'), /^1\s234\s567,5$/)
    assert.equal((1234567.5).toLocaleString(ZAHL_LOCALE), '1.234.567,5')
  })

  test('Meldung im Kellerbuch: Bestand mit Tausenderpunkt', () => {
    const m = verarbeitungFehler({ zweck: 'essig', menge: 2000, bestand: 1234.5, datum: '2026-10-01', heute: '2026-10-10' })
    assert.match(m, /1\.234,5 L/)
  })
})

describe('Erkennung', () => {
  test("Zahl mit 'de-AT' → Fund, Datum und ZAHL_LOCALE → kein Fund", () => {
    assert.deepEqual(zeilen("const a = n.toLocaleString('de-AT', { maximumFractionDigits: 2 })"), [1])
    assert.deepEqual(zeilen("x\nconst a = `${(rund(n, 1)).toLocaleString('de-AT')} kg`"), [2])
    assert.deepEqual(zeilen("const a = Number(p.wert).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })"), [1])
    assert.deepEqual(zeilen("const f = new Intl.NumberFormat('de-AT')"), [1])
    assert.deepEqual(zeilen("const a = new Date(x).toLocaleString('de-AT')"), [])
    assert.deepEqual(zeilen("const a = d.toLocaleString('de-AT', { timeZone: 'Europe/Vienna' })"), [])
    assert.deepEqual(zeilen("const a = d.toLocaleDateString('de-AT')"), [])
    assert.deepEqual(zeilen("const a = n.toLocaleString(ZAHL_LOCALE, { maximumFractionDigits: 2 })"), [])
    assert.deepEqual(zeilen("// n.toLocaleString('de-AT')"), [])
  })

  test('Ausnahme nur mit Begründung', () => {
    assert.deepEqual(zeilen("// zahl-locale-ok: d ist ein Date aus der Liste\nconst a = d.toLocaleString('de-AT')"), [])
    assert.deepEqual(zeilen("// zahl-locale-ok: kurz\nconst a = d.toLocaleString('de-AT')"), [2])
  })
})

test('Projekt: keine Zahl mit de-AT formatiert', () => {
  const e = pruefeWurzel(ROOT)
  assert.ok(e.dateien > 500, `zu wenige Dateien (${e.dateien})`)
  assert.deepEqual(e.funde, [])
})
