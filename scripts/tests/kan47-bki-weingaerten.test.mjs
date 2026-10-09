// KAN-47 AP10 Schritt 1 (09.10.2026): BKI-Blatt „Weingärten“ aus den vorhandenen Ried- und Grundstücksdaten.
// Annahmen W1–W6 im Kopf von src/lib/behoerden/bki-weingaerten.ts.
// Schritt 2 (09.10.2026): Großlage, Gemeindeteil, DAC-Orts- und Riedenwein aus src/lib/wein/herkunftKatalog.ts (Thermenregion,
// Kremstal, Wachau, Kamptal, Traisental, Carnuntum, Weinviertel, Wagram, Wien, Burgenland; Annahmen K1–K15 dort).
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
    assert.deepEqual(kat.herkunftKatalog('80001', '70201'), { gebiet: null, grosslage: null, dacOrtswein: null, imDacGebiet: false, riedenwein: false })
    assert.deepEqual(kat.herkunftKatalog(null, undefined), { gebiet: null, grosslage: null, dacOrtswein: null, imDacGebiet: false, riedenwein: false })
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
    const r = wg.weingartenZeilen([ried(lage)], [gst({ katastralgemeinde: '80001' })])
    assert.ok(r.warnungen.some(w => /außerhalb der erfassten Weinbaugebiete \(17 Gebiete mit DAC bzw\. Großlagen; leer z\. B\. Bergland, Graz-Umgebung\)/.test(w)), r.warnungen.join(' | '))
  })
})

describe('KAN-47 Schritt 2: Katalog Kremstal', () => {
  test('Ortsangaben nach Anlage 1: je KG (Krems, Stein, Senftenberg, Furth, Höbenbach, Krustetten) bzw. Gemeinde (Rohrendorf, Gedersdorf, Stratzing/Droß)', () => {
    const o = (kg, gkz) => kat.herkunftKatalog(kg, gkz).dacOrtswein
    assert.deepEqual([o('12114', '30101'), o('12132', '30101'), o('12112', '31343'), o('12166', '31309'), o('12147', '31333'), o('12153', '31333')],
      ['Krems', 'Stein', 'Senftenberg', 'Furth', 'Höbenbach', 'Krustetten'])
    assert.deepEqual([o('12127', '31337'), o('12119', '31337'), o('12102', '31310'), o('12103', '31356')], ['Rohrendorf', 'Rohrendorf', 'Gedersdorf', 'Stratzing'])
  })

  test('KG ohne Ortsangabe in einer Kremstal-Gemeinde: DAC-Gebiet ohne Ortswein (K6); Mautern und Dürnstein gehören zur Wachau', () => {
    assert.deepEqual(kat.herkunftKatalog('12125', '31343'), { gebiet: 'Kremstal', grosslage: null, dacOrtswein: null, imDacGebiet: true, riedenwein: false })   // Reichaueramt
    assert.equal(kat.herkunftKatalog('12138', '30101').imDacGebiet, true)                              // Weinzierl bei Krems
    assert.equal(kat.herkunftKatalog('12148', '31327').gebiet, 'Wachau')                                   // Baumgarten (Mautern)
    assert.equal(kat.herkunftKatalog('12105', '31304').gebiet, 'Wachau')                                   // Dürnstein
  })

  test('Großlagen: Kaiserstiege, Göttweiger Berg je Gemeinde; Kremser Großlagen über die amtliche Ried (K7)', () => {
    assert.equal(kat.herkunftKatalog('12119', '31337').grosslage, 'Kaiserstiege')
    assert.equal(kat.herkunftKatalog('12101', '31310').grosslage, 'Kaiserstiege')
    assert.equal(kat.herkunftKatalog('12160', '31333').grosslage, 'Göttweiger Berg')
    assert.equal(kat.herkunftKatalog('12132', '30101', null, 'Steiner Hund').grosslage, 'Kremser Kreuzberg')
    assert.equal(kat.herkunftKatalog('12114', '30101', null, 'ried  wachtberg').grosslage, 'Kremser Kreuzberg')
    assert.equal(kat.herkunftKatalog('12114', '30101', null, 'Obere Sandgrube').grosslage, 'Kremser Sandgrube')
    assert.equal(kat.herkunftKatalog('12123', '30101', null, 'Groß Rehberg').grosslage, 'Kremser Sommerleithen')
    assert.equal(kat.herkunftKatalog('12114', '30101', null, 'Pfaffenberg').grosslage, null, 'Ried ohne Großlage')
    assert.equal(kat.herkunftKatalog('12114', '30101').grosslage, null, 'ohne Ried keine Kremser Großlage')
    assert.equal(kat.herkunftKatalog('12127', '31337', null, 'Steiner Hund').grosslage, 'Kaiserstiege', 'Ried-Großlage nur in Krems')
  })

  test('Zeile Musterhof-Art: Unterrohrendorf mit amtlicher Ried', { skip: !hooksMoeglich }, () => {
    const z = wg.weingartenZeile(ried({ lage: { amtliche_ried: 'Gebling' } }), gst({ katastralgemeinde: '12127', kg_bezeichnung: 'Unterrohrendorf', trauben_herkunft_code: null }))
    assert.deepEqual([z.gemeinde, z.gemeindeteil, z.grosslage, z.dacOrtswein, z.dacRiedenwein], ['Rohrendorf bei Krems', 'Unterrohrendorf', 'Kaiserstiege', 'Rohrendorf', 'Gebling'])
  })
})

describe('KAN-47 Schritt 2: Katalog Wachau', () => {
  test('Gemeindeangaben je KG (K8): Loiben, Arnsdorf, Rossatz/Rührsdorf, Spitz, Povat → Spitzer Graben, nur Aggsbach Markt', () => {
    const o = (kg, gkz) => kat.herkunftKatalog(kg, gkz).dacOrtswein
    assert.deepEqual([o('12116', '31304'), o('12117', '31304'), o('12105', '31304')], ['Loiben', 'Loiben', 'Dürnstein'])
    assert.deepEqual([o('12189', '31338'), o('12187', '31338'), o('12167', '31338'), o('12168', '31338')], ['Arnsdorf', 'Arnsdorf', 'Rossatz', 'Rührsdorf'])
    assert.deepEqual([o('12358', '31344'), o('12348', '31330'), o('12307', '31330')], ['Spitz', 'Spitzer Graben', 'Elsarn'])
    assert.deepEqual([o('12301', '31301'), o('14101', '31542')], ['Aggsbach', null], 'Aggsbach Dorf (Schönbühel-Aggsbach) liegt außerhalb des Weinbaugebiets')
    assert.deepEqual([o('12140', '31351'), o('12162', '31327')], ['Weißenkirchen', 'Mautern'])
  })

  test('Großlage Spitzer Graben je KG; übrige Wachau ohne Großlage, aber DAC-Gebiet', () => {
    assert.equal(kat.herkunftKatalog('12362', '31344').grosslage, 'Spitzer Graben')
    assert.equal(kat.herkunftKatalog('12357', '31344').grosslage, null, 'Schwallenbach gehört zur Gemeinde Spitz, nicht zur Großlage')
    assert.deepEqual(kat.herkunftKatalog('12302', '31330'), { gebiet: 'Wachau', grosslage: null, dacOrtswein: null, imDacGebiet: true, riedenwein: false })   // Amstall
  })
})

describe('KAN-47 Schritt 2: Katalog Kamptal', () => {
  test('ortsübergreifende Weinbaugemeinden je KG (Anlage 1)', () => {
    const o = (kg, gkz) => kat.herkunftKatalog(kg, gkz).dacOrtswein
    assert.deepEqual([o('12206', '31308'), o('12203', '31308'), o('12232', '31346'), o('12210', '31322'), o('12224', '31322'), o('12218', '31355'), o('12216', '31323')],
      ['Engabrunn', 'Grafenegg', 'Strass', 'Gobelsburg', 'Langenlois', 'Schönberg', 'Lengenfeld'])
  })

  test('Rieden lenken um (K9): Heiligenstein in KG Kammern → Zöbing, Langenloiser Rieden → Mittelberg', () => {
    const o = (kg, gkz, ried) => kat.herkunftKatalog(kg, gkz, null, ried).dacOrtswein
    assert.equal(o('12213', '31315', 'Heiligenstein'), 'Zöbing')
    assert.equal(o('12213', '31315', 'Gaisberg'), 'Kammern')
    assert.equal(o('12213', '31315'), 'Kammern')
    assert.equal(o('12215', '31322', 'Ried Vogelberg'), 'Mittelberg')
    assert.equal(o('12215', '31322', 'Loiserberg'), 'Langenlois')
    assert.equal(o('12233', '31322', 'Heiligenstein'), 'Zöbing')
  })

  test('KG ohne Angabe (Grunddorf, Plank) im DAC-Gebiet ohne Ortswein; keine Großlage', () => {
    assert.deepEqual(kat.herkunftKatalog('12234', '31308'), { gebiet: 'Kamptal', grosslage: null, dacOrtswein: null, imDacGebiet: true, riedenwein: true })
    assert.equal(kat.herkunftKatalog('12222', '31355').imDacGebiet, true)
  })
})

describe('KAN-47 Schritt 2: Katalog Traisental (K10)', () => {
  test('Gebiet: Stadt und Bezirk St. Pölten, Atzenbrugg, Sitzenberg-Reidling, Würmla; Ortswein = Gemeindename', () => {
    assert.deepEqual(kat.herkunftKatalog('19999', '31928', 'Nußdorf ob der Traisen'), { gebiet: 'Traisental', grosslage: null, dacOrtswein: 'Nußdorf ob der Traisen', imDacGebiet: true, riedenwein: true })
    assert.equal(kat.herkunftKatalog('1', '30201', 'St. Pölten').dacOrtswein, 'St. Pölten')
    assert.equal(kat.herkunftKatalog('1', '32132', 'Sitzenberg-Reidling').imDacGebiet, true)
    assert.equal(kat.herkunftKatalog('1', '32135', 'Tulln an der Donau').gebiet, 'Wagram', 'übriger Bezirk Tulln gehört zum Wagram')
  })

  test('Großlage nur Wölblinger Urgestein; Venusberg/Parapluiberg bleiben leer', () => {
    assert.equal(kat.herkunftKatalog('1', '31948', 'Wölbling').grosslage, 'Wölblinger Urgestein')
    assert.equal(kat.herkunftKatalog('1', '31930', 'Obritzberg-Rust').grosslage, 'Wölblinger Urgestein')
    assert.equal(kat.herkunftKatalog('1', '31943', 'Traismauer').grosslage, null)
  })

  test('Zeile: Gemeindename aus der KG-Nr. als Ortswein', { skip: !hooksMoeglich }, () => {
    const z = wg.weingartenZeile(ried(), gst({ katastralgemeinde: '19116', trauben_herkunft_code: null }))
    assert.deepEqual([z.gemeinde, z.dacOrtswein, z.grosslage], ['Traismauer', 'Traismauer', null])
  })
})

describe('KAN-47 Schritt 2: Katalog Carnuntum (K11)', () => {
  test('ortsübergreifende Gemeinden: je Gemeinde bzw. je KG (Hollern, Wildungsmauer, Regelsbrunn, Trautmannsdorfer KGs)', () => {
    const o = (kg, gkz) => kat.herkunftKatalog(kg, gkz).dacOrtswein
    assert.deepEqual([o('5001', '30708'), o('5104', '30710'), o('5116', '30728'), o('5011', '30712'), o('5113', '30719'), o('5107', '30715')],
      ['Göttlesbrunn', 'Hainburg', 'Hainburg', 'Höflein', 'Prellenkirchen', 'Prellenkirchen'])
    assert.deepEqual([o('5023', '30721'), o('5115', '30722'), o('5108', '30711'), o('5109', '30718')], Array(4).fill('Petronell-Carnuntum'))
    assert.deepEqual([o('5005', '30706'), o('5018', '30726'), o('5006', '30726'), o('5020', '30726')], Array(4).fill('Stixneusiedl'))
  })

  test('übriges Gebiet (Bezirk Bruck an der Leitha samt Schwechat) ohne Ortswein, ohne Großlage', () => {
    assert.deepEqual(kat.herkunftKatalog('5021', '30726'), { gebiet: 'Carnuntum', grosslage: null, dacOrtswein: null, imDacGebiet: true, riedenwein: false })   // KG Trautmannsdorf
    assert.equal(kat.herkunftKatalog('1', '30704').imDacGebiet, true)                                  // Bruck an der Leitha
    assert.equal(kat.herkunftKatalog('1', '30740').gebiet, 'Carnuntum')                                // Schwechat
    assert.equal(kat.herkunftKatalog('1', '30721').dacOrtswein, null, 'Rohrau außer KG Hollern')
  })
})

describe('KAN-47 Schritt 2: Katalog Weinviertel (K12)', () => {
  test('Gebiet: fünf Bezirke ohne Stetteldorf und Gerasdorf; Ortswein = Gemeindename', () => {
    assert.deepEqual(kat.herkunftKatalog('1', '31644', 'Poysdorf'), { gebiet: 'Weinviertel', grosslage: 'Falkensteiner Hügelland', dacOrtswein: 'Poysdorf', imDacGebiet: true, riedenwein: true })
    assert.equal(kat.herkunftKatalog('1', '31120', 'Röschitz').dacOrtswein, 'Röschitz')     // Bezirk Horn
    assert.equal(kat.herkunftKatalog('1', '31228', 'Stetteldorf am Wagram').gebiet, 'Wagram')
    assert.equal(kat.herkunftKatalog('1', '31235', 'Gerasdorf bei Wien').gebiet, 'Wagram')
  })

  test('Großlagen: Liste je Gemeinde vor Bezirk (Pulkautal vor Retzer Land), Bisamberg-Kreuzenstein, ohne Großlage', () => {
    const gl = gkz => kat.herkunftKatalog('1', gkz).grosslage
    assert.deepEqual([gl('30838'), gl('31655'), gl('31037'), gl('31120'), gl('31022'), gl('31213'), gl('30817')],
      ['Matzner Hügel', 'Wolkersdorfer Hochleiten', 'Pulkautal', 'Retzer Land', 'Retzer Land', 'Bisamberg-Kreuzenstein', null])
  })

  test('Riedenwein nur mit Ortswein (K3): Kremstal-KG ohne Ortsangabe leer, Kamptal auch ohne', { skip: !hooksMoeglich }, () => {
    const lage = { lage: { amtliche_ried: 'Hochrain' } }
    assert.equal(wg.weingartenZeile(ried(lage), gst({ katastralgemeinde: '12125', trauben_herkunft_code: null })).dacRiedenwein, null)   // Reichaueramt
    assert.equal(wg.weingartenZeile(ried(lage), gst({ katastralgemeinde: '12234', trauben_herkunft_code: null })).dacRiedenwein, 'Hochrain')   // Grunddorf
  })
})

describe('KAN-47 Schritt 2: Katalog Wagram (K13)', () => {
  test('Ortsangaben je KG nördlich der Donau, Absdorf je Gemeinde, „Klosterneuburg“ südlich der Donau', () => {
    const o = (kg, gkz) => kat.herkunftKatalog(kg, gkz).dacOrtswein
    assert.deepEqual([o('20009', '32106'), o('20036', '32107'), o('20018', '32114'), o('11139', '31228'), o('20001', '32101')],
      ['Fels', 'Wagram', 'Kirchberg', 'Starnwörth', 'Absdorf'])
    assert.deepEqual([o('1705', '32144'), o('20189', '32135'), o('20104', '32142')], ['Klosterneuburg', 'Klosterneuburg', 'Klosterneuburg'])
    assert.equal(o('20021', '32114'), null, 'KG Mallon (Kirchberg) ohne Ortsangabe')
  })

  test('Gebiet ohne die drei Traisental-Gemeinden, mit Gerasdorf; Großlagen Tullnerfeld und Klosterneuburg', () => {
    assert.equal(kat.herkunftKatalog('20108', '32104').gebiet, 'Traisental')           // Atzenbrugg
    assert.equal(kat.herkunftKatalog('1', '31235').gebiet, 'Wagram')                   // Gerasdorf bei Wien
    assert.equal(kat.herkunftKatalog('20189', '32135').grosslage, 'Tullnerfeld')
    assert.equal(kat.herkunftKatalog('1704', '32144').grosslage, 'Klosterneuburg')
    assert.equal(kat.herkunftKatalog('20009', '32106').grosslage, null)
  })
})

describe('KAN-47 Schritt 2: Katalog Wien (K14)', () => {
  test('Großlagen je KG, kein Ortswein, Riedenwein möglich', () => {
    assert.deepEqual(kat.herkunftKatalog('01616', '90001'), { gebiet: 'Wien', grosslage: 'Bisamberg-Wien', dacOrtswein: null, imDacGebiet: true, riedenwein: true })
    assert.deepEqual(['1607', '1505', '1507', '1807', '1105', '1104'].map(k => kat.herkunftKatalog(k, '90001').grosslage),
      ['Bisamberg-Wien', 'Kahlenberg', 'Nußberg', 'Maurerberg', 'Laaerberg', null])
  })
})

describe('KAN-47 Schritt 2: Kataloge Burgenland (K15)', () => {
  test('Leithaberg: Bezirk Eisenstadt-Umgebung, Eisenstadt, Rust, Jois, Winden; Neusiedl am See nur mit vier Rieden', () => {
    assert.deepEqual(kat.herkunftKatalog('1', '10312', 'Purbach am Neusiedler See'), { gebiet: 'Leithaberg', grosslage: 'Sonnenberg', dacOrtswein: 'Purbach am Neusiedler See', imDacGebiet: true, riedenwein: true })
    assert.equal(kat.herkunftKatalog('1', '10201', 'Rust').grosslage, 'Rusterberg')
    assert.equal(kat.herkunftKatalog('1', '10710', 'Jois').gebiet, 'Leithaberg')
    assert.equal(kat.herkunftKatalog('1', '10713', 'Neusiedl am See', 'Ried Hausberg').gebiet, 'Leithaberg')
    assert.equal(kat.herkunftKatalog('1', '10713', 'Neusiedl am See', 'Kirchberg').gebiet, 'Neusiedlersee')
  })

  test('Neusiedlersee: ohne Orts- und Riedenwein; Heideboden ohne Parndorfer Platte', () => {
    assert.deepEqual(kat.herkunftKatalog('1', '10707', 'Gols'), { gebiet: 'Neusiedlersee', grosslage: 'Heideboden', dacOrtswein: null, imDacGebiet: true, riedenwein: false })
    assert.equal(kat.herkunftKatalog('1', '10717', 'Parndorf').grosslage, null)
  })

  test('Mittelburgenland, Rosalia: Gemeindename; Eisenberg nach § 7 Abs. 2, Großlage Südburgenland', () => {
    assert.deepEqual([kat.herkunftKatalog('1', '10801', 'Deutschkreutz').dacOrtswein, kat.herkunftKatalog('1', '10801').grosslage], ['Deutschkreutz', 'Goldbachtal'])
    assert.equal(kat.herkunftKatalog('1', '10606', 'Mattersburg').gebiet, 'Rosalia')
    const o = (kg, gkz) => kat.herkunftKatalog(kg, gkz).dacOrtswein
    assert.deepEqual([o('34017', '10903'), o('34012', '10903'), o('34062', '10919'), o('34046', '10913'), o('31029', '10428'), o('1', '10917')],
      ['Eisenberg a. d. P.', 'Deutsch Schützen', 'Rechnitz', 'Rechnitz', 'Gaas', null])
    assert.equal(kat.herkunftKatalog('1', '10504').grosslage, 'Südburgenland')
    assert.equal(kat.herkunftKatalog('1', '10917').riedenwein, false, 'Oberwart ohne Ortsangabe → kein Riedenwein')
  })
})

describe('KAN-47 Schritt 2: Kataloge Steiermark (K16)', () => {
  test('Südsteiermark: Ortsangaben je Gemeinde bzw. KG, Ausnahmen (Sulz → Ehrenhausen, Fresing ohne), Riedenwein auch ohne', () => {
    const o = (kg, gkz) => kat.herkunftKatalog(kg, gkz).dacOrtswein
    assert.deepEqual([o('66114', '61050'), o('66180', '61050'), o('66186', '61049'), o('66038', '61035'), o('66105', '61019'), o('66022', '61002')],
      ['Gamlitz', 'Ehrenhausen', 'Gamlitz', 'Kitzeck-Sausal', 'Kitzeck-Sausal', 'Eichberg'])
    assert.deepEqual(kat.herkunftKatalog('66112', '61019'), { gebiet: 'Südsteiermark', grosslage: null, dacOrtswein: null, imDacGebiet: true, riedenwein: true })   // Fresing
  })

  test('Flussufer-Gemeinden (Leibnitz, Heimschuh …) und KG Trössing: Ortswein leer mit Hinweis', () => {
    const l = kat.herkunftKatalog('1', '61053')
    assert.deepEqual([l.gebiet, l.dacOrtswein], ['Südsteiermark', null])
    assert.match(l.hinweis, /Lage zum Fluss/)
    assert.match(kat.herkunftKatalog('66236', '62380').hinweis, /Fluss bzw\. Bach/)
    assert.equal(kat.herkunftKatalog('66114', '61050').hinweis, undefined)
  })

  test('Vulkanland: Gemeinden und KGs der Anlage, sonst Oststeiermark (Großlage Oststeiermark in Hartberg-Fürstenfeld und Weiz)', () => {
    const o = (kg, gkz) => kat.herkunftKatalog(kg, gkz).dacOrtswein
    assert.deepEqual([o('66318', '62335'), o('62024', '62381'), o('62032', '62381'), o('1', '62273'), o('1', '62267'), o('1', '62239')],
      ['Klöch', 'Kapfenstein', 'Riegersburg', 'Riegersburg', 'Riegersburg', 'Oststeiermark'])
    assert.equal(kat.herkunftKatalog('1', '62239').grosslage, 'Oststeiermark')
    assert.equal(kat.herkunftKatalog('1', '62335').grosslage, null, 'Südoststeiermark ohne Großlage')
    assert.equal(kat.herkunftKatalog('1', '61057').gebiet, 'Vulkanland Steiermark', 'Schwarzautal (Bezirk Leibnitz) über die St.-Peter-Liste')
  })

  test('Weststeiermark: KGs der Anlage, übrige Bezirke Deutschlandsberg/Voitsberg ohne Ortswein; Graz-Umgebung leer', () => {
    const o = (kg, gkz) => kat.herkunftKatalog(kg, gkz).dacOrtswein
    assert.deepEqual([o('61127', '60344'), o('61245', '60346')], ['Eibiswald', 'Stainz'])
    assert.deepEqual(kat.herkunftKatalog('61011', '60349'), { gebiet: 'Weststeiermark', grosslage: null, dacOrtswein: null, imDacGebiet: true, riedenwein: true })   // Garanas
    assert.equal(kat.herkunftKatalog('1', '60611').gebiet, null)
  })
})

describe('KAN-47: KG-Verzeichnis vollständig (BEV, Stichtag 24.01.2022)', () => {
  test('alle 7.850 KGs mit Namen, auch die bisher fehlenden steirischen', async () => {
    const v = await import('../../src/lib/wein/katastralgemeinden.ts')
    assert.equal(Object.keys(v.KATASTRALGEMEINDEN).length, 7850)
    assert.deepEqual(['66112', '66236', '61011', '5020', '5018'].map(v.getKgBezeichnung), ['Fresing', 'Trössing', 'Garanas', 'Stixneusiedl', 'Sarasdorf'])
  })
})
