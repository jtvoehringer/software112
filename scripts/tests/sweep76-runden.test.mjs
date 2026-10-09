// Sweep 76 (09.10.2026): Kommastellen kaufmännisch wie Postgres round(numeric, n) – nie über Math.round(x * 100) / 100.
// Befund: Math.round rechnet binär (1,005 → 1,00; ein Rabattposten 1,13 € − 50 % = 0,565 → 0,56) und rundet negative halbe
// Werte Richtung +∞; die Datenbank rundet exakt (0,57). Rechnungsposition, Sammelrechnung, Einnahmenplan und BMD-Export
// lagen damit um einen Cent neben Zahlung bzw. Rechnung der Datenbank. Dazu: ohneKommentare() leerte Ausdrücke in
// Template-Strings mit – alle Wächter übersahen Code in `${…}`.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { rund, rund2, rund3 } from '../../src/lib/zahl/runden.ts'
import { positionBrutto } from '../../src/lib/verkauf/rechnungen.ts'
import { lieferscheinBetrag } from '../../src/lib/verkauf/sammelrechnung.ts'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefeText, pruefeWurzel } = require(path.join(HIER, '..', 'check-runden.js'))
const { ohneKommentare } = require(path.join(HIER, '..', 'check-loeschen.js'))
const alt = (x, s) => Math.round(x * 10 ** s) / 10 ** s
const zeilen = t => pruefeText(t).funde.map(f => f.zeile)

describe('rund(): kaufmännisch wie Postgres', () => {
  test('halbe Stellen, die Math.round binär abrundet', () => {
    for (const [x, soll] of [[1.005, 1.01], [0.565, 0.57], [1.035, 1.04], [2.675, 2.68], [0.285, 0.29], [2.135, 2.14], [4.015, 4.02]]) {
      assert.equal(rund(x, 2), soll, String(x))
    }
    assert.equal(alt(1.005, 2), 1, 'Gegenprobe: alte Rundung lag daneben')
  })

  test('Binärrauschen aus Produkten (1,66 · 0,75 = 1,2449999…) rundet wie die Datenbank', () => {
    assert.equal(1.66 * 0.75 === 1.245, false, 'Voraussetzung: Produkt ist binär ungenau')
    assert.equal(rund2(1.66 * 0.75), 1.25)
    assert.equal(rund2(1.9 * 0.75), 1.43)
    assert.equal(rund2(0.1 + 0.2), 0.3)
  })

  test('negative Werte von null weg, kein −0; NaN/∞ unverändert; 3 und 1 Stelle', () => {
    assert.equal(rund(-0.125, 2), -0.13)
    assert.equal(rund(-1.005, 2), -1.01)
    assert.ok(Object.is(rund(-0.001, 2), 0))
    assert.ok(Number.isNaN(rund(NaN, 2)))
    assert.equal(rund(Infinity, 2), Infinity)
    assert.equal(rund3(12.3455), 12.346)
    assert.equal(rund(57.25, 1), 57.3)
    assert.equal(rund(123456789.125, 2), 123456789.13)
  })
})

describe('Geldbeträge der App = Datenbank', () => {
  test('Rechnungsposition mit 50 % Rabatt: 1,13 € → 0,57 € (vorher 0,56 €)', () => {
    assert.equal(positionBrutto({ menge: 1, preis_brutto: 1.13, rabatt_pct: 50 }), 0.57)
    assert.equal(positionBrutto({ menge: 1, preis_brutto: 1.66, rabatt_pct: 25 }), 1.25)
  })
  test('Lieferscheinbetrag der Sammelrechnung rechnet gleich', () => {
    assert.equal(lieferscheinBetrag([{ menge: 1, preis_brutto: 1.13, rabatt_pct: 50 }]).betrag, 0.57)
    // 3 × 1,38 € − 25 % = 3,105 € → 3,11 € (binär 3,1049999…)
    assert.equal(alt(3 * 1.38 * 0.75, 2), 3.1, 'Gegenprobe: alte Rundung lag daneben')
    assert.equal(lieferscheinBetrag([{ menge: 3, preis_brutto: 1.38, rabatt_pct: 25 }]).betrag, 3.11)
  })
})

describe('check-runden: Erkennung', () => {
  test('Math.round(x * 10^n) / 10^n in allen Schreibweisen → Fund', () => {
    assert.deepEqual(zeilen('const a = Math.round(x * 100) / 100\n'), [1])
    assert.deepEqual(zeilen('const a = Math.round((b + c) * 1000) / 1000\n'), [1])
    assert.deepEqual(zeilen('const a = Math.round(x * 10 ** s) / 10 ** s\n'), [1])
    assert.deepEqual(zeilen('const f = 100\nconst a = Math.round(x * f) / f\n'), [2])
    assert.deepEqual(zeilen('const a = Math.round((x + Number.EPSILON) * f) / f\n'), [1])
    assert.deepEqual(zeilen('const a = Math.round(x * Math.pow(10, 2)) / Math.pow(10, 2)\n'), [1])
  })
  test('auch in Template-Strings', () => {
    assert.deepEqual(zeilen('const t = `${Math.round(v * 10) / 10} kg`\n'), [1])
  })
  test('kein Fund: ganze Einheiten, Kommentare, Strings, rund()', () => {
    assert.deepEqual(zeilen('const n = Math.round(x * 100)\nconst m = Math.round(a / b)\n'), [])
    assert.deepEqual(zeilen('// Math.round(x * 100) / 100\nconst s = "Math.round(x * 100) / 100"\n'), [])
    assert.deepEqual(zeilen('const a = rund(x, 2)\n'), [])
  })
  test('Ausnahme nur mit Begründung', () => {
    assert.deepEqual(pruefeText('// runden-ok: altes CSV-Profil bildet das bewusst nach\nconst a = Math.round(x * f) / f\n'), { funde: [], ausnahmen: 1 })
    assert.equal(pruefeText('// runden-ok: kurz\nconst a = Math.round(x * f) / f\n').funde.length, 1)
  })
  test('ganzes Projekt ohne Fund', () => {
    assert.deepEqual(pruefeWurzel(ROOT).funde, [])
  })
})

describe('ohneKommentare: Ausdrücke in Template-Strings bleiben Code', () => {
  test('Text geleert, ${…} erhalten, auch verschachtelt; Länge und Zeilen gleich', () => {
    const t = 'a = `x ${b ? `y${c}z` : {d: 1}.d} w` // k\nq = "s"'
    const o = ohneKommentare(t)
    assert.equal(o, 'a = `  ${b ? ` ${c} ` : {d: 1}.d}  `     \nq = " "')
    assert.equal(o.length, t.length)
  })
  test('Escapes und Zeilenumbrüche im Template bleiben zeilentreu', () => {
    const t = 'a = `1\\`2\n${x}\n3`\nb'
    const o = ohneKommentare(t)
    assert.equal(o.split('\n').length, t.split('\n').length)
    assert.match(o, /\$\{x\}/)
    assert.ok(o.endsWith('`\nb'))
  })
})
