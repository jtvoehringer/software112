// KAN-121: Maßnahmen ohne weingarten_id – Wartefristen und Morgenbericht verlieren den Riedbezug (01.10.2026)
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//          bzw. node --experimental-strip-types --test scripts/tests/kan121-massnahmen-ried.test.mjs
//
// Geprüft: Rieden einer Maßnahme aus src/lib/behandlungen/rieden.ts (über die Grundstücke, sonst über
// weingarten_id) sowie per Quelltext-Prüfung, dass Dashboard-Wartefristen, Wetterregeln (letzte Spritzung
// je Ried), Morgenbericht und Betriebsmittel-Verbrauch die Rieden darüber lesen.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const r = await import('../../src/lib/behandlungen/rieden.ts')
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

const PFAFFENBERG = { id: 'wg-1', name: 'Pfaffenberg Riesling', ried: 'Pfaffenberg' }
const FRECHAU = { id: 'wg-2', name: 'Frechau Zweigelt', ried: null }
const gst = (wg) => ({ grundstueck: { weingarten_id: wg.id, weingarten: wg } })

describe('riedenDerMassnahme()', () => {
  test('über die App erfasst: kein weingarten_id, Ried aus den Grundstücken', () => {
    const b = { weingarten_id: null, weingarten: null, behandlung_grundstuecke: [gst(PFAFFENBERG), gst(PFAFFENBERG)] }
    assert.deepEqual(r.riedIdsDerMassnahme(b), ['wg-1'])
    assert.equal(r.riedText(b), 'Pfaffenberg Riesling')
  })

  test('mehrere Rieden über die Grundstücke, alphabetisch und ohne Doppelte', () => {
    const b = { weingarten_id: null, behandlung_grundstuecke: [gst(PFAFFENBERG), gst(FRECHAU), gst(PFAFFENBERG)] }
    assert.deepEqual(r.riedIdsDerMassnahme(b), ['wg-2', 'wg-1'])
    assert.equal(r.riedText(b), 'Frechau Zweigelt, Pfaffenberg Riesling')
  })

  test('Grundstücke gehen vor weingarten_id (Demo: dort steht nur die erste Ried)', () => {
    const b = { weingarten_id: 'wg-1', weingarten: PFAFFENBERG, behandlung_grundstuecke: [gst(FRECHAU)] }
    assert.deepEqual(r.riedIdsDerMassnahme(b), ['wg-2'])
  })

  test('Altdaten ohne Grundstück: weingarten_id zählt', () => {
    const b = { weingarten_id: 'wg-1', weingarten: PFAFFENBERG, behandlung_grundstuecke: [] }
    assert.deepEqual(r.riedIdsDerMassnahme(b), ['wg-1'])
    assert.equal(r.riedText(b, { bevorzugt: 'ried' }), 'Pfaffenberg')
  })

  test('PostgREST liefert Einbettungen auch als Array', () => {
    const b = { behandlung_grundstuecke: [{ grundstueck: [{ weingarten_id: 'wg-2', weingarten: [FRECHAU] }] }] }
    assert.equal(r.riedText(b), 'Frechau Zweigelt')
  })

  test('ohne Ried: Platzhalter', () => {
    assert.equal(r.riedText({ weingarten_id: null, behandlung_grundstuecke: [] }), '–')
    assert.equal(r.riedText(null, { leer: 'Ried' }), 'Ried')
    assert.deepEqual(r.riedenDerMassnahme(undefined), [])
  })

  test('Morgenbericht: Riedbezeichnung bevorzugt, sonst Name', () => {
    const b = { behandlung_grundstuecke: [gst(PFAFFENBERG), gst(FRECHAU)] }
    assert.equal(r.riedText(b, { bevorzugt: 'ried' }), 'Frechau Zweigelt, Pfaffenberg')
  })

  test('viele Rieden: höchstens drei Namen, danach +N', () => {
    const wgs = ['A', 'B', 'C', 'D', 'E'].map((n, i) => ({ id: `x${i}`, name: n, ried: null }))
    assert.equal(r.riedText({ behandlung_grundstuecke: wgs.map(gst) }), 'A, B, C +2')
  })
})

describe('Verdrahtung (Quelltext)', () => {
  test('Select-Teil bettet Grundstücke samt Ried ein', () => {
    assert.match(r.BEHANDLUNG_RIEDEN_SELECT, /behandlung_grundstuecke\(grundstueck:grundstueck_id\(weingarten_id, weingarten:weingarten_id\(/)
  })

  for (const [datei, fn] of [
    ['src/app/(dashboard)/dashboard/_shared/data.ts', 'riedText'],
    ['src/lib/morgenbericht/pruefungen.ts', 'riedText'],
    ['src/lib/wetter/auswertung.ts', 'riedIdsDerMassnahme'],
  ]) {
    test(`${datei} liest die Rieden über die Grundstücke`, () => {
      const q = quelle(datei)
      assert.match(q, /BEHANDLUNG_RIEDEN_SELECT/)
      assert.match(q, new RegExp(`${fn}\\(`))
      assert.doesNotMatch(q, /b\.weingarten\?\.name|w\.weingarten\?\.ried|b\.weingarten_id && !letzte/)
    })
  }

  test('Betriebsmittel-Verbrauch nennt die Ried auch ohne weingarten_id', () => {
    const q = quelle('src/app/(dashboard)/behandlungen/lager/page.tsx')
    assert.match(q, /grundstueck:grundstueck_id\(flaeche_ha, weingarten_id, weingarten:weingarten_id\(/)
    assert.match(q, /const ort = riedText\(b/)
  })
})
