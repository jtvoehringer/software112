// Sweep 77 (09.10.2026): toFixed() rundet wie Math.round binär ((1.005).toFixed(2) = „1.00“). Befunde:
//   – Weinexport-Dokumente (Handelsrechnung, EUR.1, Ursprungszeugnis, Lieferschein): Zeilenwert (menge · preis).toFixed(2)
//     und Gesamtwert als Summe der UNgerundeten Produkte – Summe der gedruckten Zeilen ≠ gedruckter Gesamtwert;
//   – „toFixed als Rundung“ (+(x).toFixed(3), Number(x.toFixed(6))) beim Umziehen (Schwund, Restmenge, Literstand) und
//     bei Koordinaten; Vorschlagswerte in Eingabefeldern (Kosten, Schwund, Preis/kg).
// Hier: rundText(), die Exportwerte und der erweiterte Wächter scripts/check-runden.js.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { rundText } from '../../src/lib/zahl/runden.ts'
import { positionsWert, gesamtWert, eurText } from '../../src/lib/export/exportWerte.ts'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefeText, pruefeWurzel } = require(path.join(HIER, '..', 'check-runden.js'))
const quelle = p => readFileSync(path.join(ROOT, p), 'utf8')
const zeilen = t => pruefeText(t).funde.map(f => f.zeile)

describe('rundText(): feste Stellen, kaufmännisch', () => {
  test('halbe Stellen, die toFixed binär abrundet', () => {
    for (const [x, s, soll] of [[1.005, 2, '1.01'], [0.565, 2, '0.57'], [1.66 * 0.75, 2, '1.25'], [-1.005, 2, '-1.01'], [0.0005, 3, '0.001']]) {
      assert.equal(rundText(x, s), soll, String(x))
    }
    assert.equal((1.005).toFixed(2), '1.00', 'Gegenprobe: toFixed lag daneben')
  })
  test('Stellen werden aufgefüllt; NaN wie toFixed', () => {
    assert.equal(rundText(12.3, 4), '12.3000')
    assert.equal(rundText(2, 2), '2.00')
    assert.equal(rundText(NaN, 2), 'NaN')
  })
})

describe('Weinexport: Zeilenwerte und Gesamtwert', () => {
  test('Zeilenwert kaufmännisch auf Cent (1,5 l × 0,71 € = 1,065 → 1,07)', () => {
    assert.equal(((1.5) * (0.71)).toFixed(2), '1.06', 'Gegenprobe: alte Berechnung')
    assert.equal(positionsWert({ menge: '1.5', preis_eur: '0.71' }), 1.07)
    assert.equal(eurText(positionsWert({ menge: 1.5, preis_eur: 0.71 })), '1.07')
    assert.equal(positionsWert({ menge: null, preis_eur: '3' }), 0)
  })
  test('Gesamtwert = Summe der gedruckten Zeilen (vorher Summe der ungerundeten Produkte)', () => {
    const pos = [{ menge: '1.5', preis_eur: '0.71' }, { menge: '1.5', preis_eur: '0.71' }]
    const alt = pos.reduce((s, p) => s + parseFloat(p.menge) * parseFloat(p.preis_eur), 0).toFixed(2)
    assert.equal(alt, '2.13', 'Gegenprobe: alter Gesamtwert passte nicht zu 1,07 + 1,07')
    assert.equal(gesamtWert(pos), 2.14)
    assert.equal(eurText(gesamtWert([])), '0.00')
  })
  test('Dokument-Route rechnet nur noch über exportWerte; das EMCS-Datenblatt (KAN-435) übernimmt gerundete Zeilen', () => {
    const d = quelle('src/app/api/weinexport/[id]/dokument/[art]/route.ts')
    assert.doesNotMatch(d, /toFixed\(/)
    assert.match(d, /const gesamtEUR = gesamtWert\(pos\)/)
    assert.equal((d.match(/eurText\(positionsWert\(p\)\)/g) ?? []).length, 4)
    const m = quelle('src/lib/behoerden/emcsDatenblatt.ts')
    // KAN-435 D1: die e-AD-XML-Route ist entfernt; das Datenblatt rechnet nicht selbst, es übernimmt die Zeilen aus ladeExportauftrag
    assert.doesNotMatch(m, /toFixed\(|Math\.round\(/)
    assert.match(m, /bruttoKg: p\.bruttoKg,/)
  })
})

describe('check-runden: toFixed als Rundung', () => {
  test('Ergebnis wieder als Zahl → Fund', () => {
    for (const t of ['const a = +(x - y).toFixed(3)', 'const a = Number(lat.toFixed(6))', 'const a = parseFloat( (b*c).toFixed(2) )',
      'const v = +x.toFixed(1)', 'const v = +( x.toFixed(1) )', 'f(a, +b.c.toFixed(2))']) {
      assert.deepEqual(zeilen(t + '\n'), [1], t)
    }
  })
  test('Anzeige und Verkettung → kein Fund', () => {
    for (const t of ['const s = x.toFixed(2)', 'const s = "a" + x.toFixed(2)', "const s = 'a' + x.toFixed(2)", 'const s = `a` + x.toFixed(2)',
      'const n = Number(x).toFixed(2)', 'const v = a + ( x.toFixed(1) )', 'const t = `${x.toFixed(1)} %`']) {
      assert.deepEqual(zeilen(t + '\n'), [], t)
    }
  })
  test('ganzes Projekt ohne Fund; Umziehen rundet über rund()', () => {
    assert.deepEqual(pruefeWurzel(ROOT).funde, [])
    const u = quelle('src/app/(dashboard)/kellerbuch/umziehen/actions.ts')
    assert.match(u, /const restmenge = rund\(verfuegbar - q\.menge, 3\)/)
    assert.match(u, /menge_liter:\s+rund\(\(parseFloat\(vorhanden\.menge_liter\) \|\| 0\) \+ z\.menge, 3\)/)
  })
})
