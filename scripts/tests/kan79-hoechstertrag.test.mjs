// KAN-79 (02.10.2026): Hektarhöchstertrag für alle Stufen ab Landwein (§ 23 WeinG), nicht nur „Qualitätswein“
//
// Aufruf:  node --experimental-strip-types --test scripts/tests/kan79-hoechstertrag.test.mjs
//          (läuft auch über npm run test:csv)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { register } from 'node:module'

register('./ernte.aufloesung.mjs', import.meta.url)
const ernte = await import('../../src/lib/behoerden/erntemeldung.ts')
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

describe('KAN-79: Hektarhöchstertrag', () => {
  test('1,0 ha, 6.000 kg Qualitätswein + 5.000 kg Kabinett = 11.000 kg/ha → Überschreitung um 1.000 kg', () => {
    const r = ernte.berechneHektarhoechstertrag(
      [{ qualitaetsstufe: 'qualitaetswein', mengeKg: 6000 }, { qualitaetsstufe: 'kabinett', mengeKg: 5000 }], 1)
    assert.deepEqual(r, { gesamtFlaecheHaBetrieb: 1, gesamtKg: 11000, maxKg: 10000, ueberschreitungKg: 1000, ueberschritten: true })
  })
  test('alle Stufen ab Landwein zählen, „Wein“ und leere Stufen nicht', () => {
    for (const s of ['landwein', 'qualitaetswein', 'kabinett', 'spaetlese', 'auslese', 'beerenauslese', 'eiswein', 'trockenbeerenauslese', 'dac']) {
      assert.ok(ernte.unterliegtHoechstertrag(s), s)
    }
    for (const s of ['wein', 'perlwein', 'sonstiges', null]) assert.ok(!ernte.unterliegtHoechstertrag(s), String(s))
    const r = ernte.berechneHektarhoechstertrag(
      [{ qualitaetsstufe: 'wein', mengeKg: 50000 }, { qualitaetsstufe: null, mengeKg: 9000 }, { qualitaetsstufe: 'landwein', mengeKg: 9000 }], 1)
    assert.equal(r.gesamtKg, 9000)
    assert.equal(r.ueberschritten, false)
  })
  test('je Sorte: Höchstertrag und Übermenge auch bei Kabinett', () => {
    const z = ernte.ernteZeile({ rebsorte: 'Zweigelt', flaecheHa: 0.5, mengeKg: 6000, mengeHl: null, qualitaetsstufe: 'kabinett' })
    assert.equal(z.hoechstertragKgHa, 10000)
    assert.equal(z.uebermengeKg, 1000)
  })
  test('Druck (AMA-Seite), Lese-Seite und CSV-Warnung nennen die Rechtsfolge', () => {
    assert.match(ernte.HOECHSTERTRAG_RECHTSFOLGE, /§ 23 WeinG/)
    assert.match(quelle('src/app/(dashboard)/reports/(pflicht)/ama/page.tsx'), /HOECHSTERTRAG_RECHTSFOLGE/)
    assert.match(quelle('src/app/(dashboard)/erntemeldung/[id]/ErnteDetailClient.tsx'), /HOECHSTERTRAG_RECHTSFOLGE/)
    assert.match(quelle('src/lib/behoerden/erntemeldung.ts'), /ÜBERSCHRITTEN um .*\$\{HOECHSTERTRAG_RECHTSFOLGE\}/)
    assert.doesNotMatch(quelle('src/lib/behoerden/erntemeldung.ts'), /HOECHSTERTRAG_STUFEN/)
  })
})
