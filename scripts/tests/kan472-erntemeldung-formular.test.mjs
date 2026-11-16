// KAN-472 (16.11.2026, BKI-Sitzung): Weinerntemeldung im Aufbau des BKI-Formulars „Erntemeldung“.
// Vorgabe: Menge in Litern = kg × 0,75 (nie hl, nie kg ÷ 130); je Rebsorte und Qualitätsstufe eine Zeile mit
// „selbst eingefüllt“, „verkaufte Trauben“ und Summe; Flächen in ha/ar; Beitragserklärung über 3.000 Liter.
// Das Musterblatt des Tickets (erm_muster.pdf, Erntejahr 2013) ist hier als Beispiel nachgerechnet.
//
// Aufruf:  npm run -s test:csv   (Node ≥ 22.15 wegen module.registerHooks)
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const quelle = p => readFileSync(path.join(WURZEL, p), 'utf8').replace(/\r\n/g, '\n')
const m = hooksMoeglich ? await laden('lib/behoerden/erntemeldungFormular.ts') : null

const kg = liter => liter / 0.75
const L = (rebsorte, qualitaetsstufe, liter, flaechenKey, flaecheHa, kmw = 17) => ({ rebsorte, qualitaetsstufe, mengeKg: kg(liter), kmw, flaechenKey, flaecheHa })
// Musterblatt: GV RSW 1000 · BP RSW 1500 · GV LDW 3000 + 1000 verkauft · ZW LDW 2000 · GV QUW 6000 · ZW QUW 4000 · WB KAB 3000
const MUSTER = [
  L('Grüner Veltliner', 'wein', 1000, 'g1', 0.5), L('Blauer Portugieser', 'wein', 1500, 'g2', 0.5),
  L('Grüner Veltliner', 'landwein', 4000, 'g1', 0.5), L('Zweigelt', 'landwein', 2000, 'g3', 1),
  L('Grüner Veltliner', 'qualitaetswein', 6000, 'g4', 1), L('Zweigelt', 'qualitaetswein', 4000, 'g3', 1),
  L('Weißburgunder', 'kabinett', 3000, 'g5', 1.5),
  // Wein ohne Sorte und Jahrgang: 10.000 l auf 1 ha 10 ar
  L(null, 'wein', 10000, 'g6', 1.1),
]
const VERKAUF = [{ rebsorte: 'Grüner Veltliner', qualitaetsstufe: 'landwein', mengeKg: kg(1000) }]

describe('KAN-472: Rechnung', nurMitHooks, () => {
  test('Liter = kg × 0,75 auf ganze Liter – nie kg ÷ 130', () => {
    assert.equal(m.LITER_JE_KG, 0.75)
    assert.equal(m.literAusKg(1000), 750)
    assert.equal(m.literAusKg(1333), 1000)   // 999,75 → 1000
    assert.equal(m.literAusKg(250), 188)     // 187,5 → kaufmännisch 188
    assert.equal(m.literAusKg(0), 0)
  })
  test('Fläche in ha und ar, ohne „100 ar“', () => {
    assert.deepEqual(m.haAr(4.5), { ha: 4, ar: 50 })
    assert.deepEqual(m.haAr(1.1), { ha: 1, ar: 10 })
    assert.deepEqual(m.haAr(5.6), { ha: 5, ar: 60 })
    assert.deepEqual(m.haAr(0.999), { ha: 1, ar: 0 })
    assert.deepEqual(m.haAr(null), { ha: 0, ar: 0 })
  })
  test('Stufe am Formular: Wein mit Rebsorte = RSW (oberer Block), ohne Rebsorte = Wein ohne Sorte (unterer Block)', () => {
    assert.deepEqual(m.formularStufe('wein', true), { kuerzel: 'RSW', block: 'rlqp' })
    assert.deepEqual(m.formularStufe('wein', false), { kuerzel: 'WEI', block: 'wein' })
    assert.deepEqual(m.formularStufe('landwein', true), { kuerzel: 'LDW', block: 'rlqp' })
    assert.deepEqual(m.formularStufe('qualitaetswein', true), { kuerzel: 'QUW', block: 'rlqp' })
    assert.deepEqual(m.formularStufe('kabinett', true), { kuerzel: 'KAB', block: 'rlqp' })
    assert.deepEqual(m.formularStufe(null, true), { kuerzel: null, block: 'rlqp' })
  })
  test('Beitrag: erst über 3.000 Liter, 1,10 € je 100 Liter', () => {
    assert.deepEqual(m.amaBeitrag(31500), { pflichtig: true, mengeLiter: 31500, satz: 1.1, betrag: 346.5 })
    assert.deepEqual(m.amaBeitrag(3000), { pflichtig: false, mengeLiter: 3000, satz: 1.1, betrag: 0 })
    assert.equal(m.amaBeitrag(3001).betrag, 33.01)
  })
})

describe('KAN-472: Musterblatt des Tickets', nurMitHooks, () => {
  test('Zeilen je Rebsorte und Qualitätsstufe mit selbst eingefüllt, verkauft und Summe', () => {
    const f = m.ernteFormular(MUSTER, VERKAUF, 5.6)
    const zeile = z => [z.kuerzel, z.stufeKuerzel, z.selbstLiter, z.verkauftLiter, z.summeLiter].join(' ')
    assert.deepEqual(f.zeilen.filter(z => z.block === 'rlqp').map(zeile).sort(), [
      'BP RSW 1500 0 1500', 'WB KAB 3000 0 3000', 'GV LDW 3000 1000 4000', 'GV QUW 6000 0 6000',
      'GV RSW 1000 0 1000', 'ZW LDW 2000 0 2000', 'ZW QUW 4000 0 4000',
    ].sort())
    assert.equal(f.zeilen.filter(z => z.block === 'wein').length, 1)
  })
  test('Summen, Flächen und Beitrag wie am Musterblatt: 21.500 l · 4 ha 50 ar · 10.000 l · 1 ha 10 ar · 5 ha 60 ar · 346,50 €', () => {
    const f = m.ernteFormular(MUSTER, VERKAUF, 5.6)
    assert.deepEqual(f.rlqp, { flaeche: { ha: 4, ar: 50 }, liter: 21500 })
    assert.equal(f.wein.liter, 10000)
    assert.deepEqual(f.wein.flaeche, { ha: 1, ar: 10 })
    assert.deepEqual(f.betrieb, { ha: 5, ar: 60 })
    assert.deepEqual(f.beitrag, { pflichtig: true, mengeLiter: 31500, satz: 1.1, betrag: 346.5 })
    assert.equal(f.leer, false)
    assert.deepEqual(f.warnungen, [])
  })
  test('Summe = Summe der gerundeten Zeilen (Druck und CSV zeigen dieselben Werte)', () => {
    const f = m.ernteFormular([L('Zweigelt', 'landwein', 0, 'a', 1), { rebsorte: 'Zweigelt', qualitaetsstufe: 'qualitaetswein', mengeKg: 333, kmw: null, flaechenKey: 'a', flaecheHa: 1 },
      { rebsorte: 'Grüner Veltliner', qualitaetsstufe: 'qualitaetswein', mengeKg: 333, kmw: null, flaechenKey: 'b', flaecheHa: 1 }], [], 2)
    assert.equal(f.rlqp.liter, f.zeilen.reduce((s, z) => s + z.summeLiter, 0))
    assert.equal(f.rlqp.liter, 500)   // 2 × 250 (249,75), nicht 499,5
    assert.deepEqual(f.rlqp.flaeche, { ha: 2, ar: 0 }, 'Fläche a zählt nur einmal, obwohl zwei Stufen dort gelesen wurden')
  })
})

describe('KAN-472: Traubenverkauf und Sonderfälle', nurMitHooks, () => {
  test('Verkauf in der Zeile seiner Sorte und Stufe; ohne passende Stufe in den übrigen Zeilen der Sorte', () => {
    const lese = [L('Zweigelt', 'landwein', 750, 'a', 1), L('Zweigelt', 'qualitaetswein', 1500, 'b', 1)]
    const f = m.ernteFormular(lese, [{ rebsorte: 'Zweigelt', qualitaetsstufe: 'kabinett', mengeKg: 2500 }], 2)
    const je = Object.fromEntries(f.zeilen.map(z => [z.stufeKuerzel, [z.selbstLiter, z.verkauftLiter, z.summeLiter]]))
    assert.deepEqual(je, { QUW: [0, 1500, 1500], LDW: [375, 375, 750] })   // größte Zeile zuerst, Rest in die nächste
    assert.deepEqual(f.warnungen, [])
  })
  test('mehr verkauft als gelesen: Zeile wird nicht negativ, der Rest steht als Hinweis da', () => {
    const f = m.ernteFormular([L('Zweigelt', 'landwein', 750, 'a', 1)], [{ rebsorte: 'Zweigelt', qualitaetsstufe: 'landwein', mengeKg: 1500 }, { rebsorte: 'Riesling', qualitaetsstufe: 'landwein', mengeKg: 100 }], 1)
    assert.deepEqual([f.zeilen[0].selbstLiter, f.zeilen[0].verkauftLiter], [0, 750])
    assert.equal(f.warnungen.length, 2)
    assert.match(f.warnungen[0], /Traubenverkauf „Zweigelt“: 500 kg sind durch keine Lese dieser Rebsorte gedeckt/)
    assert.match(f.warnungen[1], /Traubenverkauf „Riesling“: 100 kg/)
  })
  test('Wein ohne Sorte: weiß und rot nur, wenn die Farbe bekannt ist; keine Ernte = Leermeldung ohne Beitrag', () => {
    const f = m.ernteFormular([L(null, 'wein', 900, 'a', 1)], [], 1)
    assert.deepEqual(f.wein, { flaeche: { ha: 1, ar: 0 }, liter: 900, weissLiter: 0, rotLiter: 0 })
    assert.equal(f.beitrag.pflichtig, false)
    const leer = m.ernteFormular([], [], 3.2)
    assert.equal(leer.leer, true)
    assert.deepEqual(leer.betrieb, { ha: 3, ar: 20 })
    assert.deepEqual(leer.beitrag, { pflichtig: false, mengeLiter: 0, satz: 1.1, betrag: 0 })
  })
  test('Mostgewicht je Zeile mengengewichtet in °KMW; ohne Stufe erfasst → Hinweis', () => {
    const f = m.ernteFormular([L('Zweigelt', 'qualitaetswein', 750, 'a', 1, 16), L('Zweigelt', 'qualitaetswein', 2250, 'b', 1, 18), L('Riesling', null, 750, 'c', 1, null)], [], 3)
    const zw = f.zeilen.find(z => z.rebsorte === 'Zweigelt')
    assert.equal(zw.kmw, 17.5)
    assert.ok(zw.oechsle > 80)
    assert.equal(f.zeilen.find(z => z.rebsorte === 'Riesling').kmw, null)
    assert.match(f.warnungen.join(' '), /Ohne Qualitätsstufe erfasst.*Riesling/)
  })
})

describe('KAN-472: CSV und Verdrahtung', nurMitHooks, () => {
  test('CSV-Spalten: Liter wie am Formular, kein hl; kg, Fläche und Mostgewicht zusätzlich', () => {
    const koepfe = m.SPALTEN_ERNTE_FORMULAR.map(s => s.kopf)
    assert.deepEqual(koepfe, ['Rebsorte', 'BKI-Kürzel', 'Qualitätsstufe', 'Kürzel Qualitätsstufe', 'Selbst eingefüllter Wein (l)', 'Verkaufte Trauben (l)', 'Summe (l)',
      'Menge (kg)', 'davon als Trauben verkauft (kg)', 'Fläche (ha)', 'Mostgewicht (°KMW)', 'Mostgewicht (°Oe)', 'Block'])
    assert.ok(!koepfe.some(k => /\(hl\)/.test(k)))
    const z = m.ernteFormular(MUSTER, VERKAUF, 5.6).zeilen.find(z => z.kuerzel === 'GV' && z.stufeKuerzel === 'LDW')
    assert.deepEqual(m.SPALTEN_ERNTE_FORMULAR.slice(0, 9).map(s => s.wert(z)), ['Grüner Veltliner', 'GV', 'Landwein', 'LDW', 3000, 1000, 4000, 5333, 1333])
  })
  test('Register: die CSV der Erntemeldung liefert die Formularzeilen; Druckseite nutzt dieselbe Ladefunktion', () => {
    const r = quelle('src/lib/behoerden/register/ernte.ts')
    assert.match(r, /return \{ zeilen: daten\.formular\.zeilen, warnungen: daten\.warnungen \}/)
    assert.match(r, /spalten: SPALTEN_ERNTE_FORMULAR,/)
    const p = quelle('src/app/(dashboard)/reports/(pflicht)/ama/page.tsx')
    assert.match(p, /ladeErntemeldung\(/)
    assert.match(p, /<ErntemeldungFormular /)
    const l = quelle('src/lib/behoerden/erntemeldung.ts')
    assert.match(l, /const formular = ernteFormular\(\n\s+stichtag\.bis\.map\(/, 'nur Lesegut bis zum Stichtag 30.11.')
    assert.match(l, /verkaufRes\.einzeln, flaecheBetrieb\)/)
  })
})
