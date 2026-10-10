// KAN-46 Etappe 1 (10.10.2026): BKI-Blätter „RV zum Eingang“ (Charge oder Grundstück) und „RV zum Ausgang“ (Charge oder
// Füllung) auf den vorhandenen Rechenkernen (Mischungsrechnung KAN-76, Rückruf-Liste KAN-109). Annahmen R1–R4 im Kopf von
// src/lib/behoerden/bki-rv.ts.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const rv = hooksMoeglich ? await laden('lib/behoerden/bki-rv.ts') : null
const reg = hooksMoeglich ? await laden('lib/behoerden/register.ts') : null
const bs = hooksMoeglich ? await laden('lib/behoerden/bki-schnittstelle.ts') : null
const quelle = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const charge = { id: 'c1', name: 'GV Kirchberg', chargennummer: '2026/07', erzeugnis: 'WEINGU', land_iso: 'AT', qualitaetsstufe: 'qualitaetswein', rebsorte: 'Grüner Veltliner', jahrgang: 2026, weinart: 'weiss', herkunft_code: 'WLTH', zusatzbezeichnung: null, behaelter: { name: 'Tank 3', volumen_liter: 2000 } }
const anteil = (x) => ({ key: x.key ?? 'k', typ: 'pressung', rebsorte: 'Grüner Veltliner', jahrgang: 2026, weingarten_name: 'Kirchberg', ried: 'Kreuzweingarten', gst_nr: '1234/5', katastralgemeinde: '04034', ernte_datum: '2026-09-20', kmw: 19.5, zukauf_von: null, liter: 800, anteil_pct: 80, ...x })

describe('RV zum Eingang', nurMitHooks, () => {
  test('eine Zeile je Herkunft: Merkmale der Charge, Sorte/JG/KMW/Menge der Herkunft, Kataloge aus der KG (R1)', () => {
    const z = rv.rvEingangZeilen(charge, [
      anteil({ feldstueck: 'FS 12', schlag: '3' }),
      anteil({ key: 'z', typ: 'zukauf', rebsorte: 'Welschriesling', jahrgang: 2025, ried: null, gst_nr: null, katastralgemeinde: null, ernte_datum: null, kmw: null, zukauf_von: 'Weingut X', liter: 200, anteil_pct: 20 }),
      anteil({ key: 'leer', liter: 0, anteil_pct: 0 }),
    ])
    assert.equal(z.length, 2, 'Herkünfte ohne Menge entfallen')
    const [a, b] = z
    assert.deepEqual([a.erzeugnis, a.qualitaet, a.chargenNr, a.gebinde, a.nennvolumen], ['WEINGU', 'QUW', '2026/07', 'Tank 3', 2000])
    assert.deepEqual([a.quelle, a.datum, a.herkunftSorte, a.herkunftJahrgang, a.liter, a.anteilPct, a.kmw], ['Lese', '2026-09-20', 'GV', 2026, 800, 80, 19.5])
    assert.deepEqual([a.feldstueck, a.schlag, a.kgNr, a.gemeinde, a.ried, a.grosslage, a.ortswein], ['12', '3', '04034', 'Traiskirchen', 'Kreuzweingarten', 'Badener Berg', 'Gumpoldskirchen'])
    assert.deepEqual([b.quelle, b.lieferant, b.herkunftSorte], ['Zukauf', 'Weingut X', 'WR'])
    assert.deepEqual([a.anteilFremdSorte, a.anteilFremdJg], [20, 20], 'Welschriesling 2025 = 20 % fremd')
  })

  test('Fremdanteile ohne Sorte/Jahrgang der Charge leer', () => {
    assert.deepEqual(rv.fremdAnteile([anteil({})], null, null), { sorte: null, jahrgang: null })
    assert.deepEqual(rv.fremdAnteile([], 'Grüner Veltliner', 2026), { sorte: null, jahrgang: null })
  })

  test('Parameter: genau Charge oder Grundstück, Zeitraum optional', () => {
    const p = q => reg.meldungFinden('bki-rv-eingang').parameter(new URLSearchParams(q))
    assert.match(p('').fehler, /genau eine Charge/)
    assert.match(p('charge=00000000-0000-4000-8000-000000000001&gst=00000000-0000-4000-8000-000000000002').fehler, /genau eine Charge/)
    assert.deepEqual(p('charge=00000000-0000-4000-8000-000000000001&bis=2026-07-31'), { charge: '00000000-0000-4000-8000-000000000001', gst: null, von: null, bis: '2026-07-31' })
  })
})

describe('RV zum Ausgang', nurMitHooks, () => {
  test('Buchungsart BSM je Rückruf-Art (R3)', () => {
    assert.deepEqual(['Tankverkauf', 'Export', 'Verkauf', 'Endverbraucher (summiert)', 'Verarbeitung', 'Verkauf Produkt'].map(rv.bsmAusgang),
      ['VK_FA_AT', 'VK_FL_AU', 'VK_FL_AT', 'VK_FL_AT', 'AB_VERAR', null])
  })

  test('Spalten: Spezifikation zuerst, Abnehmer dahinter; Liter bzw. Stück je Einheit', () => {
    const k = rv.SPALTEN_RV_AUSGANG.map(s => s.kopf)
    assert.deepEqual(k.slice(-6), ['Buchungsart BSM', 'Buchungsart', 'Anmerkungen', 'Abnehmer', 'Adresse Abnehmer', 'Betriebsnummer Abnehmer'])
    const st = rv.SPALTEN_RV_AUSGANG.find(s => s.kopf === 'IST-Menge in St.'), lt = rv.SPALTEN_RV_AUSGANG.find(s => s.kopf === 'IST-Menge in lt.')
    assert.deepEqual([st.wert({ einheit: 'Fl', menge: 12 }), lt.wert({ einheit: 'Fl', menge: 12 })], [12, null])
    assert.deepEqual([st.wert({ einheit: 'L', menge: 500 }), lt.wert({ einheit: 'L', menge: 500 })], [null, 500])
  })

  test('Parameter: genau Charge oder Füllung', () => {
    assert.match(reg.meldungFinden('bki-rv-ausgang').parameter(new URLSearchParams('')).fehler, /genau eine Charge \(charge\) oder eine Füllung/)
  })
})

describe('Gesamtexport und Verdrahtung', nurMitHooks, () => {
  test('RV-Blätter sind umgesetzt, aber nur einzeln (Auswahl nötig) – Prüfbericht sagt das', () => {
    for (const n of ['RV zum Eingang', 'RV zum Ausgang']) {
      const b = bs.BKI_BLAETTER.find(x => x.blatt === n)
      assert.ok(b.meldung && b.nurEinzeln, n)
    }
    const bericht = bs.pruefbericht(bs.BKI_BLAETTER.map(b => ({ blatt: b, daten: null, hinweise: [] })))
    assert.ok(bericht.some(h => h.blatt === 'RV zum Eingang' && h.art === 'info' && /braucht eine Auswahl/.test(h.text)))
    assert.match(quelle('src/lib/behoerden/bki-schnittstelle-laden.ts'), /if \(!blatt\.meldung \|\| blatt\.nurEinzeln\)/)
  })

  test('Feldstück und Schlag aus dem Bewegungsgraphen; Seite mit Marker und CSV', () => {
    const g = quelle('src/lib/wein/blendKomposition.ts')
    assert.match(g, /weingarten:weingarten_id\(id, name, ama_feldnummer, lage:lage_id\(amtliche_ried\)\), grundstueck:grundstueck_id\(gst_nr, katastralgemeinde, ama_feldnummer\)/)
    const p = quelle('src/app/(dashboard)/kellerbuch/bki-rv/page.tsx')
    assert.match(p, /^\/\/ behoerdenmeldung: bki-rv-eingang, bki-rv-ausgang\n/)
    assert.match(p, /csvPfad\('bki-rv-eingang', \{ \.\.\.ein, \.\.\.zeit \}\)/)
    assert.match(p, /csvPfad\('bki-rv-ausgang', \{ \.\.\.aus, \.\.\.zeit \}\)/)
  })
})
