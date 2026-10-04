// KAN-110 (04.10.2026): Herkunftsabstufung beim Verschnitt nach § 21 WeinG (lib/wein/herkunftRegel.ts)
//
// Aufruf:  npm run -s test:csv
//
// Geprüft: Akzeptanzkriterien des Tickets – 85 % je Ried bzw. Gemeinde (Rest aus demselben Weinbaugebiet), Ried A + Ried B,
// Bundesländer/Regionen (100 %), eigene Gebiete nie NULL, nicht prüfbare Ried/Gemeinde, Höchststufe aus der Herkunft.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./ernte.aufloesung.mjs', import.meta.url)

const { ermittleHerkunft, kgSchluessel, riedSchluessel } = await import('../../src/lib/wein/herkunftRegel.ts')

const t = (liter, code, ried = null, ort = null) => ({ liter, code, ried, ort })

describe('Ried (85 %)', () => {
  test('900 L Pfaffenberg + 100 L Sandgrube behalten die Ried', () => {
    const e = ermittleHerkunft([t(900, 'kremstal_riedenwein', 'Pfaffenberg', '12119'), t(100, 'kremstal_riedenwein', 'Sandgrube', '12125')])
    assert.equal(e.code, 'kremstal_riedenwein')
    assert.match(e.hinweise.join(), /Ried Pfaffenberg mit 90 %/)
  })
  test('700 L Pfaffenberg + 300 L Sandgrube: Ried fällt weg', () => {
    const e = ermittleHerkunft([t(700, 'kremstal_riedenwein', 'Pfaffenberg', '12119'), t(300, 'kremstal_riedenwein', 'Sandgrube', '12125')])
    assert.equal(e.code, 'kremstal_gebietswein')
    assert.match(e.hinweise.join(), /Keine Ried bzw. Gemeinde mit mindestens 85 %/)
  })
  test('Ried + 10 % Gebietswein desselben Gebiets bleibt Riedenwein', () => {
    const e = ermittleHerkunft([t(900, 'thermenregion_riedenwein', 'Mandlerin', '16110'), t(100, 'thermenregion_gebietswein')])
    assert.equal(e.code, 'thermenregion_riedenwein')
  })
  test('Ried + 10 % aus einem anderen Gebiet: kein Riedenwein (Rest muss aus demselben Gebiet sein)', () => {
    const e = ermittleHerkunft([t(900, 'thermenregion_riedenwein', 'Mandlerin', '16110'), t(100, 'kremstal_gebietswein')])
    assert.equal(e.code, 'wlnoe')
  })
  test('genau 85 % genügen, 84,9 % nicht', () => {
    assert.equal(ermittleHerkunft([t(85, 'kamptal_riedenwein', 'Heiligenstein'), t(15, 'kamptal_gebietswein')]).code, 'kamptal_riedenwein')
    assert.equal(ermittleHerkunft([t(84.9, 'kamptal_riedenwein', 'Heiligenstein'), t(15.1, 'kamptal_gebietswein')]).code, 'kamptal_gebietswein')
  })
  test('Schreibweise der Ried ist egal', () => {
    assert.equal(riedSchluessel('  GLASLAUTERN   '), riedSchluessel('Glaslautern'))
    const e = ermittleHerkunft([t(500, 'thermenregion_riedenwein', 'GLASLAUTERN'), t(500, 'thermenregion_riedenwein', 'Glaslautern ')])
    assert.equal(e.code, 'thermenregion_riedenwein')
    assert.deepEqual(e.hinweise, [])
  })
  test('Ried bei keiner Herkunft gepflegt: Stufe bleibt, Hinweis', () => {
    const e = ermittleHerkunft([t(500, 'thermenregion_riedenwein'), t(500, 'thermenregion_riedenwein')])
    assert.equal(e.code, 'thermenregion_riedenwein')
    assert.match(e.hinweise.join(), /nicht prüfbar/)
  })
  test('unbekannte Ried zählt als fremd, wenn eine andere bekannt ist', () => {
    const e = ermittleHerkunft([t(800, 'thermenregion_riedenwein', 'Mandlerin', '16110'), t(200, 'thermenregion_riedenwein', null, '4023')])
    assert.equal(e.code, 'thermenregion_gebietswein')
  })
  test('Ried uneinheitlich, Gemeinde nirgends bekannt: Ortswein bleibt mit Hinweis', () => {
    const e = ermittleHerkunft([t(800, 'thermenregion_riedenwein', 'Mandlerin'), t(200, 'thermenregion_riedenwein')])
    assert.equal(e.code, 'thermenregion_ortswein')
    assert.match(e.hinweise.join(), /Ortsangabe nicht prüfbar/)
  })
})

describe('Gemeinde (85 %)', () => {
  test('Thermenregion Ried A + Ried B je 50 % in derselben Gemeinde → Ortswein', () => {
    const e = ermittleHerkunft([t(500, 'thermenregion_riedenwein', 'Mandlerin', '16110'), t(500, 'thermenregion_riedenwein', 'Student', '16110')])
    assert.equal(e.code, 'thermenregion_ortswein')
  })
  test('Ried A + Ried B je 50 % in verschiedenen Gemeinden → Gebietswein', () => {
    const e = ermittleHerkunft([t(500, 'thermenregion_riedenwein', 'Mandlerin', '16110'), t(500, 'thermenregion_riedenwein', 'Student', '4023')])
    assert.equal(e.code, 'thermenregion_gebietswein')
  })
  test('KG-Nr. „4023“ und „04023“ sind dieselbe Gemeinde; „0“ ist unbekannt', () => {
    assert.equal(kgSchluessel('4023'), '04023')
    assert.equal(kgSchluessel(' 04023 '), '04023')
    assert.equal(kgSchluessel('0'), null)
    const e = ermittleHerkunft([t(500, 'thermenregion_ortswein', null, '4023'), t(500, 'thermenregion_ortswein', null, '04023')])
    assert.equal(e.code, 'thermenregion_ortswein')
  })
  test('Steiermark: Riedenwein hängt am Gebietswein – zwei Rieden ergeben Gebietswein', () => {
    const e = ermittleHerkunft([t(500, 'suedsteiermark_riedenwein', 'Zieregg', '1'), t(500, 'suedsteiermark_riedenwein', 'Grassnitzberg', '1')])
    assert.equal(e.code, 'suedsteiermark_gebietswein')
  })
})

describe('Gebiet und Region (100 %)', () => {
  test('Niederösterreich + Burgenland → Landwein Weinland, höchstens Landwein', () => {
    const e = ermittleHerkunft([t(900, 'wlnoe'), t(100, 'burgenland')])
    assert.equal(e.code, 'weinland')
    assert.equal(e.hoechsteStufe, 'landwein')
  })
  test('Niederösterreich + Steiermark → Österreich, höchstens Wein', () => {
    const e = ermittleHerkunft([t(990, 'kremstal_riedenwein', 'Pfaffenberg'), t(10, 'steiermark')])
    assert.equal(e.code, 'wein')
    assert.equal(e.hoechsteStufe, 'wein')
  })
  test('Kremstal + Kamptal → Niederösterreich (auch bei 99 %)', () => {
    const e = ermittleHerkunft([t(990, 'kremstal_gebietswein'), t(10, 'kamptal_gebietswein')])
    assert.equal(e.code, 'wlnoe')
    assert.equal(e.hoechsteStufe, null)
  })
  test('gleiche Herkunft bleibt ohne Hinweis', () => {
    const e = ermittleHerkunft([t(500, 'thermenregion_gebietswein'), t(500, 'thermenregion_gebietswein')])
    assert.deepEqual(e, { code: 'thermenregion_gebietswein', hoechsteStufe: null, hinweise: [] })
  })
})

describe('eigene Gebiete und Randfälle', () => {
  test('zwei eigene Gebiete ergeben nie NULL', () => {
    const e = ermittleHerkunft([t(500, 'Mein Gebiet A'), t(500, 'Mein Gebiet B')])
    assert.equal(e.code, 'wein')
    assert.equal(e.hoechsteStufe, 'wein')
  })
  test('ein einheitliches eigenes Gebiet bleibt', () => {
    assert.equal(ermittleHerkunft([t(500, 'Mein Gebiet'), t(500, 'Mein Gebiet')]).code, 'Mein Gebiet')
  })
  test('Gebietsname bzw. BKI-Kürzel als eigenes Gebiet wird aufgelöst (Kremstal + Kremstal DAC)', () => {
    assert.equal(ermittleHerkunft([t(500, 'Kremstal'), t(500, 'kremstal_gebietswein')]).code, 'kremstal_gebietswein')
  })
  test('ohne Herkunft: null; leere Codes und 0 L zählen nicht', () => {
    assert.equal(ermittleHerkunft([]).code, null)
    assert.equal(ermittleHerkunft([t(100, null), t(0, 'steiermark')]).code, null)
    assert.equal(ermittleHerkunft([t(100, null), t(100, 'wlnoe')]).code, 'wlnoe')
  })
})
