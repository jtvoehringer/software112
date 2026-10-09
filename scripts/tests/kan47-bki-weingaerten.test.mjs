// KAN-47 AP10 Schritt 1 (09.10.2026): BKI-Blatt „Weingärten“ aus den vorhandenen Ried- und Grundstücksdaten.
// Annahmen W1–W6 im Kopf von src/lib/behoerden/bki-weingaerten.ts.
// Schritt 2 (09.10.2026): Großlage, Gemeindeteil, DAC-Orts- und Riedenwein aus src/lib/wein/herkunftKatalog.ts (Thermenregion,
// Annahmen K1–K5 dort).
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import * as kat from '../../src/lib/wein/herkunftKatalog.ts'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich, datenbank } from './buchung-attrappe.mjs'

hooksRegistrieren()
const wg = hooksMoeglich ? await laden('lib/behoerden/bki-weingaerten.ts') : null
const T = 't1'

const ried = (x = {}) => ({ id: 'w1', tenant_id: T, name: 'Kirchberg', interne_bezeichnung: null, ama_feldnummer: 'FS 12', flaeche_ha: 1.23456, trauben_herkunft_code: null, aktiv: true, ...x })
const gst = (x = {}) => ({ id: 'g1', tenant_id: T, weingarten_id: 'w1', gst_nr: '1234/5', katastralgemeinde: '16110', kg_bezeichnung: null, flaeche_ha: 0.4567, nutzart: 'WI', rechtsverhaeltnis: 'pacht', rebsorte: 'Grüner Veltliner', pflanzjahr: 1998, trauben_herkunft_code: 'WLTH', aktiv: true, deaktiviert_am: null, ...x })

describe('Blatt „Weingärten“: Abbildung je Grundstück', nurMitHooks, () => {
  test('KG, Gemeinde und Bundesland aus der KG-Nr.; Feldstück nur Ziffern; Flächen in ha bzw. m²; DAC-Gebiet aus „WLTH“', () => {
    const z = wg.weingartenZeile(ried(), gst())
    assert.deepEqual(
      [z.gstNr, z.kgNr, z.feldstueck, z.flaecheFeldstueckHa, z.flaecheSorteM2, z.nutzungsart, z.bezeichnung],
      ['1234/5', '16110', '12', 1.2346, 4567, 'Wein', 'Kirchberg'])
    assert.deepEqual([z.gemeinde, z.bundesland, z.katastralgemeinde], ['Gumpoldskirchen', 'Niederösterreich', z.katastralgemeinde])
    assert.ok(z.katastralgemeinde, 'KG-Name aus dem Verzeichnis')
    assert.deepEqual([z.gU, z.dacGebiet], ['Thermenregion', 'Thermenregion'])
    assert.deepEqual([z.sorte, z.qualitaetsrebsorte, z.pflanzjahr, z.eigen], ['GV', true, 1998, false])
    assert.deepEqual([z.grosslage, z.dacOrtswein, z.gemeindeteil], ['Schatzberg', 'Gumpoldskirchen', null])
    for (const k of ['dacRiedenwein', 'ersteLage', 'grosseLage']) assert.equal(z[k], null, k)   // Ried ohne Lage
  })

  test('Eigen/Pacht: Eigentum Ja, Pacht Nein, Nutzung bzw. ohne Angabe leer (W3)', () => {
    assert.equal(wg.weingartenZeile(ried(), gst({ rechtsverhaeltnis: 'eigentum' })).eigen, true)
    assert.equal(wg.weingartenZeile(ried(), gst({ rechtsverhaeltnis: 'nutzung' })).eigen, null)
    assert.equal(wg.weingartenZeile(ried(), gst({ rechtsverhaeltnis: null })).eigen, null)
  })

  test('Sorte: Kürzel, Sortenverschnitt keine Qualitätsrebsorte, unbekannte Sorte mit Namen, Brache ohne Sorte (W4)', () => {
    assert.deepEqual([wg.weingartenZeile(ried(), gst({ rebsorte: 'Sortenverschnitt weiß' })).sorte, wg.weingartenZeile(ried(), gst({ rebsorte: 'Sortenverschnitt weiß' })).qualitaetsrebsorte], ['SW', false])
    const fremd = wg.weingartenZeile(ried(), gst({ rebsorte: 'Fantasierebe' }))
    assert.deepEqual([fremd.sorte, fremd.qualitaetsrebsorte], ['Fantasierebe', false])
    const brache = wg.weingartenZeile(ried(), gst({ rebsorte: null, nutzart: 'A' }))
    assert.deepEqual([brache.sorte, brache.qualitaetsrebsorte, brache.nutzungsart], [null, null, 'Grünbrache'])
  })

  test('Herkunft: Qualitätswein-Region als g.U. ohne DAC; ohne Code am Grundstück gilt die Ried', () => {
    const noe = wg.weingartenZeile(ried(), gst({ trauben_herkunft_code: 'wlnoe' }))
    assert.deepEqual([noe.gU, noe.dacGebiet], ['Niederösterreich', null])
    const vonRied = wg.weingartenZeile(ried({ trauben_herkunft_code: 'WLTH' }), gst({ trauben_herkunft_code: null }))
    assert.equal(vonRied.dacGebiet, 'Thermenregion')
  })

  test('deaktiviertes Grundstück: Kommentar mit Datum (W6); Bezeichnung = interne Bezeichnung vor Name', () => {
    const z = wg.weingartenZeile(ried({ interne_bezeichnung: 'KB oben' }), gst({ aktiv: false, deaktiviert_am: '2026-03-01' }))
    assert.equal(z.kommentar, 'nicht mehr bewirtschaftet ab 01.03.2026')
    assert.equal(z.bezeichnung, 'KB oben')
  })
})

describe('Blatt „Weingärten“: Zeilen und Laden', nurMitHooks, () => {
  test('je Grundstück eine Zeile (nach GST-Nr. numerisch), Ried ohne Grundstück mit eigener Zeile und Hinweis', () => {
    const r = wg.weingartenZeilen([ried(), ried({ id: 'w2', name: 'Leere Ried' })], [gst({ id: 'b', gst_nr: '10' }), gst({ id: 'a', gst_nr: '9' })])
    assert.deepEqual(r.zeilen.map(z => [z.bezeichnung, z.gstNr]), [['Kirchberg', '9'], ['Kirchberg', '10'], ['Leere Ried', null]])
    assert.ok(r.warnungen.some(w => /1 Ried\(en\) ohne Grundstück/.test(w)))
    assert.ok(r.warnungen.some(w => /2 Zeile\(n\) im DAC-Gebiet ohne amtliche Ried/.test(w)))
    assert.ok(r.warnungen.some(w => /nicht gegen die NÖ Riedenverordnung geprüft/.test(w)))
    assert.ok(!r.warnungen.some(w => /Schritt 2/.test(w)), 'kein Hinweis „bleiben leer bis Schritt 2“ mehr')
  })

  test('Laden: nur bewirtschaftete auf Wunsch; jede Abfrage auf den Betrieb gefiltert', async () => {
    const d = datenbank({
      weingarten: [ried(), ried({ id: 'w3', name: 'Alt', aktiv: false }), { ...ried({ id: 'x', name: 'Fremd' }), tenant_id: 'anderer' }],
      grundstuecke: [gst(), gst({ id: 'g2', gst_nr: '7', aktiv: false })],
    })
    const alle = await wg.ladeBkiWeingaerten(d, T)
    assert.deepEqual(alle.zeilen.map(z => [z.bezeichnung, z.gstNr]), [['Alt', null], ['Kirchberg', '7'], ['Kirchberg', '1234/5']])
    const aktiv = await wg.ladeBkiWeingaerten(d, T, { nurAktiv: true })
    assert.deepEqual(aktiv.zeilen.map(z => z.gstNr), ['1234/5'])
  })

  test('CSV-Spalten: 26 wie die Spezifikation', () => {
    assert.equal(wg.SPALTEN_BKI_WEINGAERTEN.length, 26)
  })
})

describe('KAN-47 Schritt 2: Katalog Thermenregion', () => {
  test('Großlage je Gemeinde; KG-Zuordnung vor Gemeinde (Oeynhausen → Steinfeld, Traiskirchen → Badener Berg)', () => {
    assert.equal(kat.herkunftKatalog('17201', '31719').grosslage, 'Weißer Stein')       // Perchtoldsdorf über die GKZ
    assert.equal(kat.herkunftKatalog('4033', '30639').grosslage, 'Badener Berg')        // KG Traiskirchen
    assert.equal(kat.herkunftKatalog('4022', '30639').grosslage, 'Steinfeld')           // KG Oeynhausen (Traiskirchen)
    assert.equal(kat.herkunftKatalog('04022', '30639').grosslage, 'Steinfeld', 'führende Null')
    assert.equal(kat.herkunftKatalog('4031', '30635').grosslage, 'Soosser Sonnberg')    // Sooß
    assert.equal(kat.herkunftKatalog('4003', '30604').grosslage, 'Harterberg')          // KG Braiten (Baden)
    assert.equal(kat.herkunftKatalog('4002', '30604').grosslage, null, 'KG Baden selbst ohne Großlage')
    assert.equal(kat.herkunftKatalog('9999', '30615').grosslage, 'Vöslauer Hauerberg')  // Hirtenberg
  })

  test('DAC-Ortswein: Anhang A je Gemeinde, KG Oeynhausen → Tattendorf, Anhang B mit eigenem Namen (K2), Wiener Neustadt (K1)', () => {
    assert.equal(kat.herkunftKatalog('4033', '30639').dacOrtswein, 'Gumpoldskirchen')
    assert.equal(kat.herkunftKatalog('4022', '30639').dacOrtswein, 'Tattendorf')
    assert.equal(kat.herkunftKatalog('4002', '30604', 'Baden').dacOrtswein, 'Baden')
    assert.equal(kat.herkunftKatalog('4031', '30635', 'Sooß').dacOrtswein, 'Sooß')
    assert.equal(kat.herkunftKatalog('1', '32327', 'Sollenau').dacOrtswein, 'Wiener Neustadt', 'Sollenau steht in A und B → A')
    assert.equal(kat.herkunftKatalog('23443', '30401').dacOrtswein, 'Wiener Neustadt')
    assert.equal(kat.herkunftKatalog('1', '30615').imDacGebiet, false, 'Hirtenberg: Großlage, aber nicht im DAC-Anhang')
  })

  test('außerhalb der Kataloge leer; Gemeindeteil nur bei abweichendem KG-Namen (K4)', () => {
    assert.deepEqual(kat.herkunftKatalog('12345', '31301'), { gebiet: null, grosslage: null, dacOrtswein: null, imDacGebiet: false })
    assert.deepEqual(kat.herkunftKatalog(null, undefined), { gebiet: null, grosslage: null, dacOrtswein: null, imDacGebiet: false })
    assert.equal(kat.gemeindeteil('Tribuswinkel', 'Traiskirchen'), 'Tribuswinkel')
    assert.equal(kat.gemeindeteil('gumpoldskirchen', 'Gumpoldskirchen'), null)
    assert.equal(kat.gemeindeteil(null, 'Baden'), null)
  })

  test('Zeile: DAC-Riedenwein = amtliche Ried der Lage nur im DAC-Gebiet (K3), Erste/Große Lage leer (K5)', { skip: !hooksMoeglich }, () => {
    const lage = { lage: { amtliche_ried: 'Kreuzweingarten' } }
    const z = wg.weingartenZeile(ried(lage), gst({ katastralgemeinde: '4034', kg_bezeichnung: 'Tribuswinkel' }))
    assert.deepEqual([z.gemeinde, z.gemeindeteil, z.grosslage, z.dacOrtswein, z.dacRiedenwein, z.ersteLage, z.grosseLage],
      ['Traiskirchen', 'Tribuswinkel', 'Badener Berg', 'Gumpoldskirchen', 'Kreuzweingarten', null, null])
    const hirtenberg = wg.weingartenZeile(ried(lage), gst({ katastralgemeinde: '4312' }))
    assert.deepEqual([hirtenberg.grosslage, hirtenberg.dacOrtswein, hirtenberg.dacRiedenwein], ['Vöslauer Hauerberg', null, null])
    const r = wg.weingartenZeilen([ried(lage)], [gst({ katastralgemeinde: '10001' })])
    assert.ok(r.warnungen.some(w => /außerhalb der erfassten Kataloge \(Thermenregion\)/.test(w)), r.warnungen.join(' | '))
  })
})
