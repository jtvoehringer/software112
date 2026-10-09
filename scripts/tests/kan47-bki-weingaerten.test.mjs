// KAN-47 AP10 Schritt 1 (09.10.2026): BKI-Blatt „Weingärten“ aus den vorhandenen Ried- und Grundstücksdaten.
// Annahmen W1–W6 im Kopf von src/lib/behoerden/bki-weingaerten.ts.
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
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
    for (const k of ['grosslage', 'gemeindeteil', 'dacOrtswein', 'dacRiedenwein', 'ersteLage', 'grosseLage']) assert.equal(z[k], null, k)
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
    assert.ok(r.warnungen.some(w => /Großlage.*Schritt 2/.test(w)))
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
