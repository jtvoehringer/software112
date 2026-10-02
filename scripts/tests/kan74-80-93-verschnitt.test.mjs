// KAN-74, KAN-80, KAN-93 (02.10.2026): eine Qualitätsrangfolge, Aufwertungssperre, Rebsorte/Jahrgang aus den Anteilen
//
// Aufruf:  node --experimental-strip-types --test scripts/tests/kan74-80-93-verschnitt.test.mjs
//          (läuft auch über npm run test:csv)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  niedrigsteQualitaet, istAbstufung, istAufwertung, qualitaetsStufe,
} from '../../src/lib/wein/qualitaetsrang.ts'
import { QUALITAET_OPTS, minQualitaet as minPaar } from '../../src/lib/wein/qualitaet.ts'
import { minQualitaet, maxQualitaet, istNiedrigerAls } from '../../src/lib/weinqualitaet.ts'
import { sortenBezeichnung, sortenverschnittBezeichnung, addiereGruppen } from '../../src/lib/wein/sortenangabe.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

describe('KAN-74: eine Rangfolge', () => {
  test('Verschnitt zweier DAC-Chargen behält DAC; Sekt + Sekt bleibt Sekt', () => {
    assert.equal(niedrigsteQualitaet(['dac', 'dac']), 'dac')
    assert.equal(minQualitaet(['dac', 'dac']), 'dac')
    assert.equal(niedrigsteQualitaet(['sekt', 'sekt']), 'sekt')
  })
  test('Reserve + Qualitätswein = Qualitätswein, als Abstufung erkannt', () => {
    assert.equal(minQualitaet(['reserve', 'qualitaetswein']), 'qualitaetswein')
    assert.equal(maxQualitaet(['reserve', 'qualitaetswein']), 'reserve')
    assert.ok(istNiedrigerAls('qualitaetswein', 'reserve'))
    assert.ok(istAbstufung('reserve', 'qualitaetswein'))
  })
  test('DAC + Kabinett = Qualitätswein; Eiswein + BA = BA; Ausbruch zwischen BA und TBA', () => {
    assert.equal(niedrigsteQualitaet(['dac', 'kabinett']), 'qualitaetswein')
    assert.equal(niedrigsteQualitaet(['eiswein', 'beerenauslese']), 'beerenauslese')
    assert.ok(qualitaetsStufe('beerenauslese') < qualitaetsStufe('ausbruch'))
    assert.ok(qualitaetsStufe('ausbruch') < qualitaetsStufe('trockenbeerenauslese'))
  })
  test('nie NULL, solange ein Wert bekannt ist (alle Paare aller Werte)', () => {
    const werte = QUALITAET_OPTS.map(o => o.value)
    for (const a of werte) for (const b of werte) {
      assert.notEqual(niedrigsteQualitaet([a, b]), null, `${a} + ${b}`)
      assert.notEqual(minPaar(a, b), null, `${a} + ${b}`)
    }
    assert.equal(niedrigsteQualitaet([null, undefined]), null)
  })
  test('Listen-Rang = Stufe der Rangfolge (nur noch eine Rangfolge)', () => {
    for (const o of QUALITAET_OPTS) assert.equal(o.rang, qualitaetsStufe(o.value), o.value)
  })
  test('keine zweite Rangliste mehr im Code', () => {
    assert.doesNotMatch(quelle('src/lib/weinqualitaet.ts'), /PRAEDIKATSWEIN_ORDER\.indexOf/)
    assert.doesNotMatch(quelle('src/lib/wein/qualitaet.ts'), /\?\.rang \?\? 99/)
    assert.doesNotMatch(quelle('src/components/kellerbuch/VerschneidungForm.tsx'), /QUALITAET_ORDER\.indexOf/)
  })
})

describe('KAN-80: keine Aufwertung', () => {
  test('Landwein → DAC, Reserve, Sekt ist eine Aufwertung; Perlwein nicht', () => {
    for (const neu of ['dac', 'reserve', 'sekt', 'kabinett']) assert.ok(istAufwertung('landwein', neu), neu)
    assert.ok(!istAufwertung('landwein', 'perlwein'))
  })
  test('Qualitätswein/Kabinett → DAC erlaubt (Herkunft prüft KAN-111); Abstufen immer erlaubt', () => {
    assert.ok(!istAufwertung('qualitaetswein', 'dac'))
    assert.ok(!istAufwertung('kabinett', 'dac'))
    assert.ok(!istAufwertung('reserve', 'qualitaetswein'))
    assert.ok(!istAufwertung('spaetlese', 'kabinett'))
    assert.ok(istAufwertung('kabinett', 'spaetlese'))
    assert.ok(!istAufwertung(null, 'trockenbeerenauslese'))
  })
  test('Charge bearbeiten: Aufwertungssperre und gesperrte Felder aus Pressung/Zukauf serverseitig', () => {
    const q = quelle('src/app/(dashboard)/kellerbuch/actions.ts')
    const start = q.indexOf('export async function updateWeinausbau(')
    const teil = q.slice(start, q.indexOf('// Deaktivieren/Abschließen nur ohne Bestand', start))
    // KAN-186: ganze Angabe (Stufe + Zusatzbezeichnung), Altwerte normalisiert
    assert.match(teil, /istAufwertungQualitaet\(altQualitaet, neuQualitaet\)/)
    assert.match(teil, /const altQualitaet = normalisiereQualitaet\(alt\)/)
    assert.match(teil, /\['jahrgang', 'Jahrgang'\], \['rebsorte', 'Rebsorte'\], \['weinart', 'Weinart'\]/)
    assert.match(teil, /from\('pressung_behaelter'\)/)
    assert.match(teil, /from\('zukauf_posten'\)/)
  })
  test('Füllung (neu und bearbeiten) lehnt Aufwertungen über istAufwertungQualitaet ab', () => {
    const q = quelle('src/app/(dashboard)/weinhandel/actions.ts')
    assert.equal((q.match(/istAufwertungQualitaet\(chargeQualitaet, qualitaetInput\)/g) ?? []).length, 2)
  })
})

describe('KAN-93: Rebsorte und Jahrgang aus den Anteilen', () => {
  const weiss = { rebsorte: 'Riesling', jahrgang: 2026, weinart: 'weiss' }
  test('zwei Verschnitte à 150 L GV in 1.000 L Riesling → beim zweiten Sortenverschnitt weiß', () => {
    const erster = sortenBezeichnung(
      [{ wert: 'Riesling', liter: 1000 }, { wert: 'Grüner Veltliner', liter: 150 }], [{ wert: '2026', liter: 1150 }], weiss)
    assert.equal(erster.rebsorte, 'Riesling')   // 86,96 %
    const zweiter = sortenBezeichnung(
      addiereGruppen([{ wert: 'Riesling', liter: 1000 }, { wert: 'Grüner Veltliner', liter: 150 }], [{ wert: 'Grüner Veltliner', liter: 150 }]),
      [{ wert: '2026', liter: 1300 }], weiss)
    assert.equal(zweiter.rebsorte, 'Sortenverschnitt weiß')   // 76,9 %
    assert.match(zweiter.hinweise[0], /Rebsorte „Riesling“ entfällt/)
  })
  test('Jahrgang: 11,3 % Fremdjahrgang bleibt, 20 % entfällt mit Hinweis; ohne Jahrgang bekommt die Charge keinen', () => {
    const wb = { rebsorte: 'Weißburgunder', jahrgang: 2026, weinart: 'weiss' }
    assert.equal(sortenBezeichnung([], [{ wert: '2026', liter: 2750 }, { wert: '2025', liter: 350 }], wb).jahrgang, 2026)
    const r = sortenBezeichnung([], [{ wert: '2026', liter: 800 }, { wert: '2025', liter: 200 }], wb)
    assert.equal(r.jahrgang, null)
    assert.match(r.hinweise.join(' '), /Jahrgang 2026 entfällt/)
    assert.equal(sortenBezeichnung([], [{ wert: '2025', liter: 1000 }], { ...wb, jahrgang: null }).jahrgang, null)
  })
  test('Farbe nach Weinart; ohne bekannte Anteile bleiben die Angaben', () => {
    assert.equal(sortenverschnittBezeichnung('rot'), 'Sortenverschnitt rot')
    assert.equal(sortenverschnittBezeichnung('rose'), 'Sortenverschnitt Rosé')
    const r = sortenBezeichnung([{ wert: 'unbekannt', liter: 500 }], [{ wert: 'unbekannt', liter: 500 }], weiss)
    assert.equal(r.rebsorte, 'Riesling')
    assert.equal(r.jahrgang, 2026)
  })
  test('Verschnitt nutzt die Anteile, schreibt Jahrgang und Momentaufnahme; Storno stellt den Jahrgang wieder her', () => {
    const q = quelle('src/app/(dashboard)/kellerbuch/actions.ts')
    assert.match(q, /await verschnittGruppen\(supabase, tenantId, \[/)
    assert.match(q, /jahrgang: angabe\.jahrgang,/)
    assert.match(q, /ziel_jahrgang_vorher: zielVorher\.jahrgang \?\? null/)
    assert.doesNotMatch(q, /dominanterAnteil >= 0\.85/)
    const s = quelle('src/lib/kellerbuch/storno.ts')
    assert.match(s, /if \(v\.ziel_jahrgang_vorher != null\) ziel\.payload\.jahrgang = v\.ziel_jahrgang_vorher/)
  })
})
