// KAN-99 (04.10.2026): Prüfnummer je Charge – Weitergabe per Umzug, Ende laut pruefnummer_chargen, Mengenregel über
// Teilmengen desselben Antrags (Entscheidung Jörgen: Menge gemeinsam), Füllungen aus der weitergegebenen Charge.
//
// Aufruf:  npm run -s test:csv   bzw. node --experimental-strip-types --test scripts/tests/kan99-pn-chargen.test.mjs

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as pn from '../../src/lib/kellerbuch/pruefnummer.ts'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = rel => readFileSync(path.join(WURZEL, rel), 'utf8').replace(/\r\n/g, '\n')

const A = 'aaaaaaaa-0000-4000-8000-000000000001'   // Antrags-Charge
const B = 'bbbbbbbb-0000-4000-8000-000000000002'   // per Teilumzug entstanden
const ANTRAG = {
  id: 'd1', weinausbauId: A, status: 'genehmigt', aktiv: true, pruefnummer: 'N 10716/26', mengeLiter: 1000,
  eingereichtAm: '2026-05-20', bescheidAm: '2026-06-08', angelegtAm: '2026-05-20', bezeichnung: 'Riesling',
}
// Sicht der Charge B: der Lader legt den Antrag als Antrag von B an (weinausbauId = B)
const geerbt = (extra = {}) => ({ ...ANTRAG, weinausbauId: B, weitereChargen: [A], ...extra })
const datenB = (antrag, extra = {}) => ({
  chargeId: B, bestandLiter: 400, bestandAm: '2026-10-04', antraege: [antrag], zugaenge: [], abfuellungen: [], ...extra,
})

describe('KAN-99 Weitergabe per Umzug', () => {
  test('neue Charge aus dem Teilumzug: Nummer gilt', () => {
    const e = pn.pruefnummerGueltig(datenB(geerbt()), '2026-10-04')
    assert.equal(e.gueltig, true)
    assert.equal(e.pruefnummer, 'N 10716/26')
  })
  test('Ende laut Tabelle (Verschnitt in B): danach ungültig, am Tag selbst noch gültig', () => {
    const a = geerbt({ gueltigBis: '2026-09-25', endeArt: 'verschnitt' })
    assert.equal(pn.pruefnummerGueltig(datenB(a), '2026-09-25').gueltig, true)
    const e = pn.pruefnummerGueltig(datenB(a), '2026-09-26')
    assert.equal(e.gueltig, false)
    assert.equal(e.grund, 'verschnitt')
    assert.equal(e.ereignisDatum, '2026-09-25')
  })
  test('Füllung aus der weitergegebenen Charge trägt die Nummer des Antrags (Blend, TBS)', () => {
    assert.equal(pn.pruefnummerAusAntrag({ ...ANTRAG, weitereChargen: [B] }, B), 'N 10716/26')
    assert.equal(pn.pruefnummerAusAntrag({ ...ANTRAG, weitereChargen: [] }, B), null)
    assert.equal(pn.pruefnummerAusAntrag(ANTRAG, A), 'N 10716/26')
  })
})

describe('KAN-99 Mengenregel über Teilmengen', () => {
  test('600 L in A + 400 L in B bei 1.000 L beantragt: gültig', () => {
    const a = geerbt({ familie: { bestandLiter: 600, abfuellungen: [] } })
    const e = pn.pruefnummerGueltig(datenB(a), '2026-10-04')
    assert.equal(e.gueltig, true)
    assert.equal(e.menge.bestandLiter, 1000)
  })
  test('Mehrmenge in der anderen Teilcharge (700 + 400 > 1.000): ungültig wegen Menge', () => {
    const e = pn.pruefnummerGueltig(datenB(geerbt({ familie: { bestandLiter: 700, abfuellungen: [] } })), '2026-10-04')
    assert.equal(e.gueltig, false)
    assert.equal(e.grund, 'menge')
  })
  test('Abfüllungen aus der anderen Teilcharge zählen mit', () => {
    const a = geerbt({ familie: { bestandLiter: 300, abfuellungen: [{ id: 'f1', datum: '2026-07-01', liter: 400, dacAntragId: 'd1' }] } })
    const e = pn.pruefnummerGueltig(datenB(a), '2026-10-04')
    assert.equal(e.menge.abgefuelltLiter, 400)
    assert.equal(e.menge.zulaessigLiter, 600)
    assert.equal(e.gueltig, false)   // 400 + 300 = 700 > 600
  })
})

describe('KAN-99 Lader', () => {
  const l = quelle('src/lib/kellerbuch/pruefnummerLaden.ts')
  test('liest pruefnummer_chargen, legt weitergegebene Anträge als Anträge der Charge an', () => {
    assert.match(l, /from\('pruefnummer_chargen'\)/)
    assert.match(l, /antraege\.push\(\{ \.\.\.antragAusZeile\(r\), weinausbauId: g\.charge, \.\.\.gueltigkeit\(g\.row\) \}\)/)
  })
  test('der Weitergabe-Umzug ist kein schädlicher Zugang', () => {
    assert.match(l, /if \(fremd && !weitergabeUmzuege\.get\(ziel\)\?\.has\(String\(u\.id\)\)\) zugang\(/)
  })
  test('Teilmengen nur ohne Rekursion (ohneFamilie)', () => {
    assert.match(l, /if \(!opts\.ohneFamilie\) await familienErgaenzen\(/)
    assert.match(l, /ladePruefnummerDaten\(supabase, tenantId, fremde, \{ heute, ohneFamilie: true \}\)/)
  })
  test('Blend-Protokoll und TBS kennen die weitergegebenen Chargen', () => {
    assert.match(quelle('src/lib/behoerden/blend.ts'), /antrag\.weitereChargen = \(await chargenDerAntraege\(/)
    assert.match(quelle('src/lib/behoerden/transportbescheinigung.ts'), /pn\.jeDacAntrag\[id\]\.weitereChargen = chargen/)
  })
})
