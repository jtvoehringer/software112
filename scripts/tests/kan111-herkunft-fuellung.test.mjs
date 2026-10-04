// KAN-111 (04.10.2026): Herkunftsregel in Verschnitt und Füllung, Qualitätsstufe an die Herkunft gekoppelt.
//
// Aufruf:  npm run -s test:csv
//
// Geprüft: zulässige Herkünfte einer Füllung (nur Charge und breitere Stufen, auch bei eigenen Gebieten), Hinweis
// „Ried im Chargennamen“. Qualitätsdeckel und Rückfrage im Verschnitt: kan112-verschnitt.test.mjs.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./ernte.aufloesung.mjs', import.meta.url)

const h = await import('../../src/lib/herkunft.ts')

describe('Füllung: zulässige Herkünfte', () => {
  test('Riedenwein: die Stufe selbst und alle breiteren, nichts aus einem anderen Ast', () => {
    const z = h.zulaessigeHerkuenfte('kremstal_riedenwein')
    assert.deepEqual(z, ['kremstal_riedenwein', 'kremstal_ortswein', 'kremstal_gebietswein', 'wlnoe', 'weinland', 'wein'])
    assert.equal(h.herkunftZulaessig('kremstal_riedenwein', 'wlnoe'), true)
    assert.equal(h.herkunftZulaessig('kremstal_gebietswein', 'kremstal_riedenwein'), false)   // Aufstufung
    assert.equal(h.herkunftZulaessig('kremstal_gebietswein', 'kamptal_gebietswein'), false)   // anderer Ast (bisher erlaubt)
  })
  test('eigenes Weinbaugebiet: es selbst und Wein aus Österreich; mit Gebietsnamen auch der Ast', () => {
    assert.deepEqual(h.zulaessigeHerkuenfte('Mein Gebiet'), ['Mein Gebiet', 'wein'])
    assert.equal(h.herkunftZulaessig('Mein Gebiet', 'thermenregion_riedenwein'), false)   // bisher ohne Prüfung
    assert.equal(h.herkunftZulaessig('Mein Gebiet', 'wein'), true)
    assert.deepEqual(h.zulaessigeHerkuenfte('Kremstal'), ['Kremstal', 'kremstal_gebietswein', 'wlnoe', 'weinland', 'wein'])
  })
  test('ohne Herkunft der Charge bzw. ohne Wahl: keine Einschränkung', () => {
    assert.equal(h.zulaessigeHerkuenfte(null), null)
    assert.equal(h.herkunftZulaessig(null, 'kremstal_riedenwein'), true)
    assert.equal(h.herkunftZulaessig('kremstal_gebietswein', ''), true)
  })
})
