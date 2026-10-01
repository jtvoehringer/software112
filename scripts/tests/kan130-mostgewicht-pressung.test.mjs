// KAN-130 Etappe 1 (01.10.2026): Mostgewicht Pressung → Charge
//
// Aufruf:  node --experimental-strip-types --test scripts/tests/kan130-mostgewicht-pressung.test.mjs
//          (läuft auch über npm run test:csv)
//
// Entscheidungen Jörgen 01.10.2026: Mischwert = massegewichteter Ø in °KMW, auf 2 Stellen abgerundet; fehlt einer
// Quelle der Wert, zählen nur die Teile mit Wert („teilweise“). Der Server rechnet selbst, die Charge bekommt den Wert.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mischenMitAnteil } from '../../src/lib/wein/mostgewicht.ts'
import { kmwZuQualitaet } from '../../src/lib/weinqualitaet.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

describe('Pressungs-Ø (mischenMitAnteil)', () => {
  test('je 50 % 18,9 und 19,0 °KMW = 18,95 °KMW = Kabinett (bis 01.10.2026: 19,0 = Spätlese)', () => {
    const m = mischenMitAnteil([{ menge: 500, kmw: 18.9 }, { menge: 500, kmw: 19.0 }])
    assert.equal(m.mostgewicht?.kmw, 18.95)
    assert.equal(m.teilweise, false)
    assert.equal(kmwZuQualitaet(m.mostgewicht.kmw), 'kabinett')
    assert.equal(kmwZuQualitaet(Math.round(18.95 * 10) / 10), 'spaetlese')   // die alte Rundung im Formular
  })
  test('abgerundet, nicht kaufmännisch: 1/3 zu 2/3 aus 17 und 17,01 → 17,00', () => {
    assert.equal(mischenMitAnteil([{ menge: 1, kmw: 17 }, { menge: 2, kmw: 17.01 }]).mostgewicht?.kmw, 17)
  })
  test('Zeile ohne Mostgewicht zählt nicht und macht das Mittel „teilweise“', () => {
    const m = mischenMitAnteil([{ menge: 300, kmw: 18.4 }, { menge: 100, kmw: null }, { menge: 0, kmw: 30 }])
    assert.equal(m.mostgewicht?.kmw, 18.4)
    assert.equal(m.teilweise, true)
    assert.equal(m.mitWert, 1)
    assert.equal(m.gesamt, 2)   // Zeilen ohne Menge zählen gar nicht
  })
  test('ohne jedes Mostgewicht: kein Mittel, nicht „teilweise“', () => {
    const m = mischenMitAnteil([{ menge: 300, kmw: null }])
    assert.equal(m.mostgewicht, null)
    assert.equal(m.teilweise, false)
  })
})

describe('Server Action und Formular', () => {
  const ACTIONS = quelle('src/app/(dashboard)/erntemeldung/actions.ts')
  const FORM = quelle('src/app/(dashboard)/erntemeldung/[id]/PressungSection.tsx')
  test('upsertPressung rechnet den Ø selbst aus den Traubenzeilen, das Formularfeld ist nur Rückfall', () => {
    assert.match(ACTIONS, /const mittel = mischenMitAnteil\(weingaerten\.map\(w => \(\{ menge: w\.trauben_kg, kmw: w\.kmw \}\)\)\)/)
    assert.match(ACTIONS, /const kmwGrad = mittel\.mostgewicht\?\.kmw\s*\?\? \(kmwGradFormular != null && !isNaN\(kmwGradFormular\) \? abrunden\(kmwGradFormular, KMW_STELLEN\) : null\)/)
    assert.doesNotMatch(ACTIONS, /const kmwGrad\s+= zahlAus\(fd\.get\('kmw_grad'\)\)/)
  })
  test('die neue Charge bekommt das Mostgewicht (p_charge.kmw)', () => {
    assert.match(ACTIONS, /\.\.\.\(v\.kmw != null \? \{ kmw: v\.kmw, mostgewicht_einheit: 'kmw' \} : \{\}\)/)
  })
  test('Formular rundet nicht mehr auf 1 Stelle und zeigt „teilweise“', () => {
    assert.doesNotMatch(FORM, /Math\.round\(\(sumKmw \/ sumKg\) \* 10\) \/ 10/)
    assert.match(FORM, /mischenMitAnteil\(wgRows\.map/)
    assert.match(FORM, /teilweise: \{mittelZeilen\.mitWert\} von \{mittelZeilen\.gesamt\} Zeilen/)
  })
})
