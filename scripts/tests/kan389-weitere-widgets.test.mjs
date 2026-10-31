// KAN-389 (Epic KAN-386): weitere Widgets aus den Sichten Verkauf, Kellerbuch, Weingarten und Fristen – nicht im
// Standard, nur über „Dashboard anpassen“. Sicht und Widget nutzen dieselben Bausteine (dashboard/_shared/bausteine.tsx)
// und Ladefunktionen, damit beide dieselben Zahlen zeigen. Top-Kunden: umsatzJeKunde (lib/verkauf/umsatz.ts).
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// @ts-expect-error TS5097 – node:test lädt die .ts-Datei direkt
import * as W from '../../src/lib/dashboard/widgets.ts'
// @ts-expect-error TS5097 – node:test lädt die .ts-Datei direkt
import { umsatzJeKunde, umsatzNetto } from '../../src/lib/verkauf/umsatz.ts'

const quelle = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const D = 'src/app/(dashboard)/dashboard'
const ALLES = { modulEa: true, schnellaktionen: true, modulWeingarten: true }
const NEU = ['umsatz-trend', 'top-kunden', 'ueberfaellige-rechnungen', 'gebinde-belegt', 'aktive-gaerungen', 'fuellfertig', 'gaerkontrolle', 'wartefristen', 'meldefristen']
const ids = l => l.map(e => e.id)

describe('Register', () => {
  test('die neun Widgets gibt es, keines im Standard, jedes mit Bereich aus einer Sicht', () => {
    const def = Object.fromEntries(W.WIDGETS.map(w => [w.id, w]))
    for (const id of NEU) {
      assert.ok(def[id], id)
      assert.equal(def[id].standard, false, id)
      assert.notEqual(def[id].bereich, 'uebersicht', id)
      assert.ok(!W.STANDARD_LAYOUT.some(e => e.id === id), id)
    }
    assert.ok(W.WIDGETS.every(w => w.bereich in W.BEREICH_TITEL))
  })

  test('Quellen: Umsatz-Trend und Top-Kunden laden die Rechnungen, die übrigen die Quelle ihrer Sicht', () => {
    const q = id => [...W.benoetigteQuellen(W.sichtbareWidgets([{ id }], ALLES))]
    assert.deepEqual(q('umsatz-trend'), ['umsatz'])
    assert.deepEqual(q('top-kunden'), ['umsatz'])
    assert.deepEqual(q('ueberfaellige-rechnungen'), ['offenePosten'])
    for (const id of ['gebinde-belegt', 'aktive-gaerungen', 'fuellfertig', 'gaerkontrolle']) assert.deepEqual(q(id), ['keller'])
    assert.deepEqual(q('wartefristen'), ['weingarten'])
    assert.deepEqual(q('meldefristen'), ['fristen'])
    assert.ok(!W.benoetigteQuellen(W.sichtbareWidgets(W.STANDARD_LAYOUT, ALLES)).has('umsatz'), 'Standard lädt keine Rechnungen zusätzlich')
  })

  test('Wartefristen nur mit Weingarten-Modul – ohne nicht angeboten, aber gespeichert', () => {
    const ohne = { ...ALLES, modulWeingarten: false }
    assert.deepEqual(ids(W.sichtbareWidgets([{ id: 'wartefristen' }], ohne)), [])
    assert.ok(!ids(W.editorEintraege(null, ohne)).includes('wartefristen'))
    const e = W.editorEintraege([{ id: 'wartefristen' }, { id: 'kellerbestand' }], ohne)
    assert.equal(e.find(x => x.id === 'wartefristen').verfuegbar, false)
    assert.deepEqual(W.layoutAusEditor(e), [{ id: 'wartefristen' }, { id: 'kellerbestand' }])
  })
})

describe('Fenster: ein- und ausblenden', () => {
  test('Anhaken setzt ans Ende der eingeblendeten, Abhaken an den Anfang der ausgeblendeten', () => {
    const start = W.editorEintraege([{ id: 'kellerbestand' }, { id: 'finanzen' }], ALLES)
    const an = W.umschalten(start, 'top-kunden', true)
    assert.deepEqual(ids(an).slice(0, 3), ['kellerbestand', 'finanzen', 'top-kunden'])
    assert.deepEqual(W.layoutAusEditor(an), [{ id: 'kellerbestand' }, { id: 'finanzen' }, { id: 'top-kunden' }])
    const aus = W.umschalten(an, 'kellerbestand', false)
    assert.deepEqual(ids(aus).slice(0, 3), ['finanzen', 'top-kunden', 'kellerbestand'])
    assert.equal(aus[2].an, false)
    assert.equal(aus.length, start.length)
  })
  test('Verschieben bleibt innerhalb der eingeblendeten', () => {
    const l = W.editorEintraege([{ id: 'kellerbestand' }, { id: 'finanzen' }], ALLES)
    assert.deepEqual(ids(W.verschieben(l, 'finanzen', 1)), ids(l))
    assert.deepEqual(ids(W.verschiebenNach(l, 'finanzen', 'top-kunden')), ids(l))
    assert.deepEqual(ids(W.verschieben(l, 'finanzen', -1)).slice(0, 2), ['finanzen', 'kellerbestand'])
  })
})

describe('umsatzJeKunde', () => {
  const pos = (netto) => [{ preis_brutto: netto * 1.2, menge: 1, ust_satz: 20 }]
  const rechnung = (id, datum, kunde, netto, extra = {}) => ({ id, datum, aktiv: true, storniert: false, verkaufsposten_ids: ['l'], verkauf_positionen: pos(netto), ...kunde, ...extra })
  const FA = { firma: { id: 'fa', name: 'Vinothek Alpha' } }
  const KB = { kontakt: { id: 'kb', vorname: 'Berta', nachname: 'Beispiel' } }
  const FC = { firma: { id: 'fc', name: 'Café Cäsar' }, kontakt: { id: 'kx', vorname: 'X', nachname: 'Y' } }
  const rechnungen = [
    rechnung('1', '2026-01-10', FA, 100), rechnung('2', '2026-02-10', FA, 50),
    rechnung('3', '2026-03-01', KB, 200), rechnung('4', '2026-03-02', FC, 120),
    rechnung('5', '2026-03-03', KB, 10, { aktiv: false }),
  ]

  test('Summe netto je Kunde, Firma vor Kontakt, absteigend, mit Link', () => {
    const k = umsatzJeKunde(rechnungen)
    assert.deepEqual(k.map(x => [x.kunde, x.umsatz, x.anzahl, x.href]), [
      ['Berta Beispiel', 200, 1, '/crm/kontakte/kb'],
      ['Vinothek Alpha', 150, 2, '/crm/firmen/fa'],
      ['Café Cäsar', 120, 1, '/crm/firmen/fc'],
    ])
  })
  test('dieselben Rechnungen wie die Umsatzsumme: Top-Kunden ergeben zusammen den Umsatz', () => {
    const summe = umsatzJeKunde(rechnungen, 99).reduce((s, k) => s + k.umsatz, 0)
    assert.equal(summe, umsatzNetto(rechnungen))
  })
  test('Stornobeleg mindert seinen Kunden, Kunden ohne Umsatz fallen weg, höchstens anzahl', () => {
    const storno = { ...rechnung('6', '2026-03-05', KB, 0), art: 'storno', verkaufsposten_ids: [], verkauf_positionen: [{ preis_brutto: 240, menge: -1, ust_satz: 20 }] }
    const k = umsatzJeKunde([...rechnungen, storno])
    assert.ok(!k.some(x => x.kunde === 'Berta Beispiel'))
    assert.equal(umsatzJeKunde(rechnungen, 1).length, 1)
  })
})

describe('Verdrahtung', () => {
  test('jedes neue Widget hat eine Komponente aus dem gemeinsamen Baustein', () => {
    const s = quelle(`${D}/_widgets/sichten.tsx`)
    for (const k of ['UmsatzTrendKarte', 'TopKundenKarte', 'UeberfaelligeRechnungenKarte', 'GebindeBelegtKachel', 'AktiveGaerungenKachel', 'FuellfertigKachel', 'GaerkontrolleKarte', 'WartefristenKarte', 'MeldefristenKarte']) {
      assert.match(s, new RegExp(`<${k} `), k)
    }
  })
  test('die Sichten verwenden dieselben Bausteine', () => {
    const v = quelle(`${D}/verkauf/page.tsx`)
    assert.match(v, /<UmsatzTrendKarte reihe=\{absatzSeries\}/)
    assert.match(v, /<UeberfaelligeRechnungenKarte belege=\{belege\}/)
    assert.match(v, /<TopKundenKarte kunden=\{topKunden\} \/>/)
    assert.match(v, /const topKunden = umsatzJeKunde\(umsatzRechnungen \?\? \[\]\)/)
    const k = quelle(`${D}/kellerbuch/page.tsx`)
    for (const t of ['GebindeBelegtKachel', 'AktiveGaerungenKachel', 'FuellfertigKachel']) assert.match(k, new RegExp(`<${t} keller=\\{keller\\}`), t)
    assert.match(quelle(`${D}/weingarten/page.tsx`), /<WartefristenKarte wartefristen=\{wg\.wartefristen\} \/>/)
    assert.match(quelle(`${D}/fristen/FristenClient.tsx`), /import \{ FRIST_STATUS as STATUS/)
  })
  test('Widget und Sicht laden die Rechnungen über dasselbe Fenster', () => {
    assert.match(quelle(`${D}/verkauf/page.tsx`), /= umsatzFenster\(heute\)/)
    const w = quelle(`${D}/_shared/widgetDaten.ts`)
    assert.match(w, /wenn\('umsatz',[\s\S]{0,200}umsatzFenster\(ctx\.heute\)[\s\S]{0,200}geladen\(await ladeUmsatzRechnungen\(ctx\.supabase, ctx\.tenantId, von, bis\), 'Umsatzreihe'\)/)
  })
  test('Übersicht gibt das Weingarten-Modul an das Register weiter', () => {
    assert.match(quelle(`${D}/page.tsx`), /modulWeingarten: einst\.modulWeingarten/)
  })
})
