// KAN-37 Punkt 6 (02.10.2026): Fristen-Dashboard – Erntemeldung mit Stichtag 30.11. und Abgabe 15.12.,
// Bestandsmeldung mit Stichtag 31.07. und Abgabe 15.08. (Vorlage)
//
// Aufruf:  node --test scripts/tests/kan37-fristen-erntemeldung.test.mjs   (läuft auch über npm run test:csv)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

describe('KAN-37: Fristen Erntemeldung und Bestandsmeldung', () => {
  test('Erntemeldung: eigene Stichtag-Frist 30.11. neben der Abgabe 15.12.', () => {
    const q = quelle('src/app/(dashboard)/dashboard/_shared/data.ts')
    assert.match(q, /const faelligAm = `\$\{jahr\}-12-15`/)
    assert.match(q, /const stichtag = `\$\{jahr\}-11-30`/)
    assert.match(q, /key: `ernte-stichtag:\$\{jahr\}`/)
    // nach dem Stichtag bzw. nach der Meldung gilt die Stichtag-Frist als erledigt (sonst stünde sie rot bis zur Abgabe)
    assert.match(q, /statusAus\(stichtag, eingereicht \|\| stichtag < ctx\.heuteStr, ctx\.heuteStr, vt\)/)
    assert.match(q, /Stichtag 30\.11\. · Abgabe bis 15\.12\./)
  })
  test('Vorlage Bestandsmeldung: Stichtag 31.07., Abgabe 15.08.', () => {
    const v = quelle('src/app/(dashboard)/dashboard/fristen/vorlage.ts')
    assert.match(v, /bezeichnung: 'Bestandsmeldung Wein',[^\n]*Stichtag 31\.07\. · Abgabe bis 15\.08\.[^\n]*monat: 8, tag: 15/)
  })
})
