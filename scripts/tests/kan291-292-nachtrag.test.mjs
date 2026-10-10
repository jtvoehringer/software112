// Rückmeldung Jörgen zu KAN-291/KAN-292 (10.10.2026)
// 1. AMA-Erntemeldung: Spaltenköpfe brachen uneinheitlich um, „17.000 kg“ bzw. „131,00 hl“ in der Summenzeile zweizeilig.
//    Jetzt: Kopf zweizeilig „Bezeichnung / (Einheit)“, unten bündig; Zahlen- und Summenzellen einzeilig.
// 2. Pressung: Mengenfelder ohne Einheit und zu breit (4000 = kg, 2750 = L), Mostgewicht-Felder zu breit.
// KAN-292: leeres Feld zeigte „0.00“ – Platzhalter mit Dezimalpunkt; jetzt „0,00“, Wächter check-zahl-eingabe.
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
const { pruefeText } = require(path.join(HIER, '..', 'check-zahl-eingabe.js'))
const quelle = d => readFileSync(path.join(ROOT, d), 'utf8').replace(/\r\n/g, '\n')

describe('AMA-Erntemeldung (Druck)', () => {
  const t = quelle('src/app/(dashboard)/reports/(pflicht)/ama/page.tsx')
  test('Köpfe zweizeilig mit Einheit, unten bündig', () => {
    for (const [l, e] of [['Fläche', '(ha)'], ['Menge', '(kg)'], ['davon verkauft', '(kg)'], ['Menge', '(hl)'], ['Ertrag', '(kg/ha)'], ['Übermenge', '(kg)']])
      assert.ok(t.includes(`whitespace-nowrap">${l}<br />${e}</th>`), `${l} ${e}`)
    assert.doesNotMatch(t, />Fläche \(ha\)</)
  })
  test('Summenzeile einzeilig („17.000 kg“)', () => {
    assert.match(t, /border-s112-line-str text-right tabular-nums whitespace-nowrap">\{fmtNum\(ernte\?\.summe\.mengeKg \?\? 0, 0\)\} kg/)
  })
})

describe('Pressung', () => {
  const t = quelle('src/app/(dashboard)/erntemeldung/[id]/PressungSection.tsx')
  test('Traubenmenge mit „kg“, Mostmenge mit „L“, schmal und rechtsbündig', () => {
    assert.match(t, /aria-label=\{`Menge kg Traubenzeile[\s\S]{0,200}w-20! text-right tabular-nums`\} \/>\n\s*<span className="text-sm text-s112-text-2">kg<\/span>/)
    assert.match(t, /aria-label=\{`Most in Liter Behälterzeile[\s\S]{0,220}w-28! text-right tabular-nums`\} \/>\n\s*<span className="text-sm text-s112-text-2">L<\/span>/)
  })
  test('Mostgewicht-Felder schmaler', () => {
    assert.match(quelle('src/components/wein/MostgewichtEingabe.tsx'), /className=\{`w-20 border rounded-lg/)
  })
})

describe('Platzhalter mit Dezimalkomma (KAN-292)', () => {
  const zeilen = t => pruefeText(t).funde.map(f => f.zeile)
  test('Erkennung', () => {
    assert.deepEqual(zeilen('<input placeholder="0.00" />'), [1])
    assert.deepEqual(zeilen('<input placeholder="z.B. 12.90" />'), [1])
    assert.deepEqual(zeilen('<input placeholder="0.0000" />'), [1])
    assert.deepEqual(zeilen('<input placeholder="0,00" />'), [])
    assert.deepEqual(zeilen('<input placeholder="z.B. 1.250" />'), [])          // Tausenderpunkt
    assert.deepEqual(zeilen('<input placeholder="2.2.0" />'), [])               // Version
    assert.deepEqual(zeilen('<input placeholder="Inventur 30.09.: Tank 3" />'), [])
  })
  test('Weinexport: Versicherungswert zeigt „0,00“', () => {
    assert.match(quelle('src/app/(dashboard)/weinexport/neu/WeinexportFormClient.tsx'), /placeholder="0,00"/)
  })
})
