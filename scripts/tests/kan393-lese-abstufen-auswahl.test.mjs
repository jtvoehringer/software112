// KAN-393 (Epic KAN-391): „Abstufen auf“ in „Lese erfassen“ zeigt nur Stufen unter der Obergrenze aus dem
// Mostgewicht (17 °KMW = Kabinett → Qualitätswein, Landwein, Wein), der Knopf heißt nur „Speichern“.
//
// Aufruf:  npm run -s test:csv  (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')
const la = hooksMoeglich ? await laden('lib/wein/leseAbstufung.ts') : null
const q = hooksMoeglich ? await laden('lib/wein/qualitaet.ts') : null
const werte = (art, kmw) => la.sammelAbstufenOptionen(q.LESE_QUALITAETEN, art, kmw).map(o => o.value)

describe('KAN-393 Auswahl „Abstufen auf“', nurMitHooks, () => {
  test('17 °KMW (Kabinett): nur Qualitätswein, Landwein, Wein – höchste zuerst', () => {
    assert.deepEqual(werte(null, [17]), ['qualitaetswein', 'landwein', 'wein'])
  })
  test('ohne Mostgewicht (Qualitätswein): Landwein und Wein', () => {
    assert.deepEqual(werte(null, [null]), ['landwein', 'wein'])
    assert.deepEqual(werte(null, []), ['landwein', 'wein'])
  })
  test('Einzelerfassung: höchste Obergrenze der Zeilen zählt', () => {
    const o = werte(null, [15.5, 19.4])   // Qualitätswein, Spätlese
    assert.equal(o[0], 'kabinett')
    assert.ok(!o.includes('spaetlese') && !o.includes('auslese'))
  })
  test('Eiswein nur bei einer Eiswein-Lese', () => {
    assert.ok(!werte(null, [30]).includes('eiswein'))
    const e = werte('eiswein', [30])
    assert.ok(!e.includes('eiswein') && e.includes('qualitaetswein'))
  })
})

test('Formular: Auswahl aus dem Mostgewicht, ungültige Wahl springt zurück, Knopf „Speichern“', () => {
  const f = quelle('src/app/(dashboard)/erntemeldung/[id]/ErnteDetailClient.tsx')
  assert.match(f, /const abstufenOptionen = sammelAbstufenOptionen\(LESE_QUALITAETEN, leseArt, einzeln/)
  assert.match(f, /onChange=\{wert => setMgGemeinsam\(wert\?\.kmw \?\? null\)\}/)
  assert.match(f, /if \(abstufenAuf && !abstufenOptionen\.some\(o => o\.value === abstufenAuf\)\) setAbstufenAuf\(''\)/)
  assert.doesNotMatch(f, /× Speichern|× `/)
})
