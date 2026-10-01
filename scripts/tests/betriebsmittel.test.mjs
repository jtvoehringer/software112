// KAN-167 (01.10.2026): Weinbehandlungs- und Produktionsmittel – Verbrauch aus Maßnahmen (Sonstiges, Laubarbeit)
// und Bestand (lib/behandlungen/betriebsmittel.ts). Stornierte Buchungen zählen nicht, Stk/m nur 1:1, g/ml in kg/l.
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning \
//               --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/betriebsmittel.test.mjs
//          (Node ≥ 22.15 wegen module.registerHooks; läuft auch über npm run test:csv)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import * as nodeModule from 'node:module'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')

const hooksMoeglich = typeof nodeModule.registerHooks === 'function'
if (hooksMoeglich) {
  nodeModule.registerHooks({
    resolve(spezifizierer, kontext, weiter) {
      if (spezifizierer === 'server-only') return { url: 'data:text/javascript,export {}', shortCircuit: true }
      let basis = null
      if (spezifizierer.startsWith('@/')) basis = path.join(SRC, spezifizierer.slice(2))
      else if (/^\.\.?\//.test(spezifizierer) && !path.extname(spezifizierer) && kontext.parentURL?.startsWith('file:')) {
        basis = path.resolve(path.dirname(fileURLToPath(kontext.parentURL)), spezifizierer)
      }
      if (basis) {
        for (const kandidat of [basis + '.ts', basis + '.tsx', path.join(basis, 'index.ts')]) {
          if (existsSync(kandidat)) return weiter(pathToFileURL(kandidat).href, kontext)
        }
      }
      return weiter(spezifizierer, kontext)
    },
  })
}

const bm = hooksMoeglich ? await import(pathToFileURL(path.join(SRC, 'lib/behandlungen/betriebsmittel.ts')).href) : null
const opt = { skip: hooksMoeglich ? false : 'module.registerHooks fehlt (Node < 22.15)' }

describe('Betriebsmittel (KAN-167)', opt, () => {
  test('nur Sonstiges und Laubarbeit', () => {
    assert.equal(bm.artMitBetriebsmittel('sonstiges'), true)
    assert.equal(bm.artMitBetriebsmittel('laubarbeit'), true)
    assert.equal(bm.artMitBetriebsmittel('spritzung'), false)
    assert.equal(bm.artMitBetriebsmittel(null), false)
  })

  test('Einheiten: g → kg, ml → l, Stk/m nur 1:1', () => {
    assert.equal(bm.bmInEinheit(1500, 'g', 'kg'), 1.5)
    assert.equal(bm.bmInEinheit(2, 'l', 'ml'), 2000)
    assert.equal(bm.bmInEinheit(250, 'stk', 'stk'), 250)
    assert.equal(bm.bmInEinheit(5, 'stk', 'kg'), null)
    assert.equal(bm.bmInEinheit(5, 'm', 'stk'), null)
  })

  test('Verbrauch: je ha × Fläche, gesamt ohne Fläche, Gründe bei fehlenden Angaben', () => {
    assert.deepEqual(bm.bmVerbrauch({ aufwand: 400, aufwandEinheit: 'stk_ha', flaecheHa: 0.25 }, 'stk'),
      { menge: 100, basis: 'Aufwand × Fläche', warnung: null })
    assert.equal(bm.bmVerbrauch({ aufwand: 120, aufwandEinheit: 'm', flaecheHa: null }, 'm').menge, 120)
    assert.equal(bm.bmVerbrauch({ aufwand: 500, aufwandEinheit: 'g', flaecheHa: null }, 'kg').menge, 0.5)
    assert.equal(bm.bmVerbrauch({ aufwand: null, aufwandEinheit: 'stk_ha', flaecheHa: 1 }, 'stk').warnung, 'ohne Aufwand')
    assert.equal(bm.bmVerbrauch({ aufwand: 10, aufwandEinheit: 'stk_ha', flaecheHa: null }, 'stk').warnung, 'ohne behandelte Fläche')
    assert.match(bm.bmVerbrauch({ aufwand: 10, aufwandEinheit: 'kg', flaecheHa: null }, 'stk').warnung, /nicht umrechenbar/)
  })

  test('Konto: stornierte Buchung zählt nicht, Korrektur als Abgang, Verbrauch abgezogen', () => {
    const k = bm.bmKonto(
      [
        { datum: '2026-09-01', menge: 1000, einheit: 'stk', storniert: false },   // Einkauf
        { datum: '2026-09-02', menge: 500, einheit: 'stk', storniert: true },     // stornierter Einkauf
        { datum: '2026-09-20', menge: -20, einheit: 'stk', storniert: false },    // Inventurkorrektur
      ],
      [
        { behandlungId: 'b2', datum: '2026-09-15', kurz: 'Laubarbeit', art: 'Laubarbeit', ort: null, aufwand: 400, aufwandEinheit: 'stk_ha', flaecheHa: 0.5 },
        { behandlungId: 'b1', datum: '2026-09-10', kurz: 'Sonstiges', art: 'Sonstiges', ort: null, aufwand: 30, aufwandEinheit: 'stk', flaecheHa: null },
        { behandlungId: 'b3', datum: '2026-09-11', kurz: 'ohne Aufwand', art: 'Sonstiges', ort: null, aufwand: null, aufwandEinheit: null, flaecheHa: 1 },
      ],
      'stk',
    )
    assert.equal(k.zugang, 1000)
    assert.equal(k.abgang, 20)
    assert.equal(k.verbrauch, 230)
    assert.equal(k.bestand, 750)
    assert.deepEqual(k.posten.map(p => p.behandlungId), ['b1', 'b2'])
    assert.equal(k.hinweise.length, 1)
    assert.equal(k.hinweise[0].behandlungId, 'b3')
    assert.equal(k.einheit, 'Stk')
  })

  test('Brutto kaufmännisch gerundet', () => {
    assert.equal(bm.bmBrutto(300, 20), 360)
    assert.equal(bm.bmBrutto(10.005, 0), 10.01)
  })
})
