// KAN-165 (01.10.2026): Herkunft für alle österreichischen Weinbaugebiete – Katalog als Baum (lib/herkunft.ts)
//
// Aufruf:  node --experimental-strip-types --disable-warning=ExperimentalWarning --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/kan165-herkunft.test.mjs
//          (läuft auch über npm run test:csv)
//
// Geprüft: Aufbau des Katalogs, Abstufung über den gemeinsamen Oberbegriff (§ 21 WeinG), Sortenspiegel
// über BKI-Sortenkürzel (Synonyme), automatische Abstufung, Auswahl nur nach unten.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('./ernte.aufloesung.mjs', import.meta.url)

const h = await import('../../src/lib/herkunft.ts')

describe('Katalog', () => {
  test('eindeutige Codes, jeder Elternteil existiert und steht davor, nur „wein“ ist Wurzel', () => {
    const gesehen = new Set()
    for (const n of h.HERKUNFT_KATALOG) {
      assert.ok(!gesehen.has(n.code), `doppelt: ${n.code}`)
      if (n.eltern === null) assert.equal(n.code, 'wein')
      else assert.ok(gesehen.has(n.eltern), `${n.code}: Elternteil ${n.eltern} fehlt oder steht dahinter`)
      assert.match(n.bki, /^[A-Z]{4}$/, n.code)
      assert.ok(n.quelle.length > 5, n.code)
      gesehen.add(n.code)
    }
  })

  test('v1-Codes bleiben (keine Datenmigration)', () => {
    for (const c of ['wein', 'wlnoe', 'thermenregion_gebietswein', 'thermenregion_ortswein', 'thermenregion_riedenwein']) {
      assert.ok(h.herkunftKnoten(c), c)
    }
  })

  test('alle Weinbaugebiete nach § 21 Abs. 3 WeinG und alle DAC sind wählbar', () => {
    const gebiete = new Set(h.HERKUNFT_KATALOG.map(n => n.gebiet))
    for (const g of ['Niederösterreich', 'Burgenland', 'Wien', 'Steiermark', 'Kärnten', 'Oberösterreich', 'Salzburg', 'Tirol', 'Vorarlberg',
      'Thermenregion', 'Kremstal', 'Kamptal', 'Wagram', 'Traisental', 'Carnuntum', 'Wachau', 'Weinviertel',
      'Südsteiermark', 'Vulkanland Steiermark', 'Weststeiermark', 'Neusiedlersee', 'Leithaberg', 'Mittelburgenland', 'Eisenberg',
      'Rosalia', 'Ruster Ausbruch', 'Weinland', 'Steirerland', 'Bergland']) {
      assert.ok(gebiete.has(g), g)
    }
  })

  test('Auswahl gruppiert nach Region, jeder Code genau einmal', () => {
    const opt = h.herkunftOptionen()
    assert.equal(opt.length, h.HERKUNFT_KATALOG.length)
    assert.equal(new Set(opt.map(o => o.value)).size, opt.length)
    assert.ok(opt.find(o => o.value === 'kremstal_riedenwein').gruppe.startsWith('Weinland'))
    assert.ok(opt.find(o => o.value === 'vulkanland_ortswein').gruppe.startsWith('Steirerland'))
    assert.deepEqual(h.herkunftOptionen(['wlnoe', 'wein']).map(o => o.value), ['wein', 'wlnoe'])
  })
})

describe('Abstufung über den gemeinsamen Oberbegriff (§ 10 Abs. 1, § 21 WeinG)', () => {
  test('gleicher Ast: wie bisher die breitere Stufe', () => {
    assert.equal(h.minHerkunft(['thermenregion_riedenwein', 'thermenregion_ortswein']), 'thermenregion_ortswein')
    assert.equal(h.minHerkunft(['thermenregion_gebietswein', 'wlnoe']), 'wlnoe')
    assert.equal(h.minHerkunft(['kremstal_riedenwein', 'kremstal_riedenwein']), 'kremstal_riedenwein')
  })
  test('verschiedene Gebiete: gemeinsamer Oberbegriff', () => {
    assert.equal(h.minHerkunft(['kremstal_riedenwein', 'kamptal_gebietswein']), 'wlnoe')
    assert.equal(h.minHerkunft(['suedsteiermark_ortswein', 'vulkanland_gebietswein']), 'steiermark')
    assert.equal(h.minHerkunft(['wlnoe', 'wiener_gemischter_satz_dac']), 'weinland')
    assert.equal(h.minHerkunft(['leithaberg_dac', 'kremstal_gebietswein']), 'weinland')
    assert.equal(h.minHerkunft(['wlnoe', 'steiermark']), 'wein')
    assert.equal(h.minHerkunft(['tirol', 'salzburg']), 'bergland')
  })
  test('Steiermark: Riedenwein hängt am Gebietswein (Rieden auch außerhalb der Ortsgebiete)', () => {
    assert.equal(h.minHerkunft(['suedsteiermark_riedenwein', 'suedsteiermark_ortswein']), 'suedsteiermark_gebietswein')
  })
  test('eigene Weinbaugebiete, „sonstiges“ und leer zählen nicht', () => {
    assert.equal(h.minHerkunft(['WLTH', 'sonstiges', null, '', 'kremstal_ortswein']), 'kremstal_ortswein')
    assert.equal(h.minHerkunft(['WLTH', null]), null)
    assert.equal(h.minHerkunft(['constructor']), null)
  })
  test('maxHerkunft = engste Stufe; istNiedrigerAls nur für echte Oberbegriffe', () => {
    assert.equal(h.maxHerkunft(['wlnoe', 'kremstal_riedenwein', null]), 'kremstal_riedenwein')
    assert.equal(h.istNiedrigerAls('wlnoe', 'kremstal_riedenwein'), true)
    assert.equal(h.istNiedrigerAls('wein', 'tirol'), true)
    assert.equal(h.istNiedrigerAls('kremstal_gebietswein', 'kamptal_riedenwein'), false)   // anderer Ast = keine Abstufung
    assert.equal(h.istNiedrigerAls('wlnoe', 'wlnoe'), false)
    assert.equal(h.istNiedrigerAls('kremstal_riedenwein', 'wlnoe'), false)                  // Aufstufung
  })
})

describe('Sortenspiegel', () => {
  test('über BKI-Sortenkürzel: Synonyme zählen gleich', () => {
    assert.equal(h.istRebsorteZulaessig('thermenregion_gebietswein', 'Morillon'), true)
    assert.equal(h.istRebsorteZulaessig('thermenregion_gebietswein', 'Pinot Blanc'), true)
    assert.equal(h.istRebsorteZulaessig('thermenregion_riedenwein', 'Zweigelt'), false)
    assert.equal(h.istRebsorteZulaessig('kremstal_riedenwein', 'Riesling'), true)
    assert.equal(h.istRebsorteZulaessig('kremstal_riedenwein', 'Zweigelt'), false)
    assert.equal(h.istRebsorteZulaessig('wiener_gemischter_satz_dac', 'Gemischter Satz'), true)
    assert.equal(h.istRebsorteZulaessig('eisenberg_gebietswein', 'Welschriesling'), false)
    assert.equal(h.istRebsorteZulaessig('eisenberg_ortswein', 'Welschriesling'), true)
  })
  test('ohne Einschränkung bzw. außerhalb des Katalogs: immer zulässig; unbekannte Sorte auf DAC-Stufe nicht', () => {
    assert.equal(h.istRebsorteZulaessig('wlnoe', 'Zweigelt'), true)
    assert.equal(h.istRebsorteZulaessig('WLTH', 'Zweigelt'), true)
    assert.equal(h.istRebsorteZulaessig('kremstal_gebietswein', null), true)
    assert.equal(h.istRebsorteZulaessig('kremstal_gebietswein', 'Fantasiesorte'), false)
  })
  test('automatische Abstufung geht den eigenen Ast hinauf', () => {
    assert.deepEqual(h.findePassendeHerkunftsstufe('thermenregion_riedenwein', 'Zweigelt'), { code: 'thermenregion_ortswein', abgestuft: true })
    assert.deepEqual(h.findePassendeHerkunftsstufe('thermenregion_riedenwein', 'Neuburger'), { code: 'thermenregion_gebietswein', abgestuft: true })
    assert.deepEqual(h.findePassendeHerkunftsstufe('kremstal_riedenwein', 'Zweigelt'), { code: 'wlnoe', abgestuft: true })
    assert.deepEqual(h.findePassendeHerkunftsstufe('wachau_riedenwein', 'Neuburger'), { code: 'wachau_ortswein', abgestuft: true })
    assert.deepEqual(h.findePassendeHerkunftsstufe('suedsteiermark_ortswein', 'Welschriesling'), { code: 'suedsteiermark_gebietswein', abgestuft: true })
    assert.deepEqual(h.findePassendeHerkunftsstufe('mittelburgenland_dac', 'Zweigelt'), { code: 'burgenland', abgestuft: true })
    assert.deepEqual(h.findePassendeHerkunftsstufe('kremstal_riedenwein', 'Grüner Veltliner'), { code: 'kremstal_riedenwein', abgestuft: false })
    assert.deepEqual(h.findePassendeHerkunftsstufe('WLTH', 'Zweigelt'), { code: 'WLTH', abgestuft: false })
  })
})
