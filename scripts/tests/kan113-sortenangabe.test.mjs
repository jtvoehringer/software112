// KAN-113 (07.10.2026) – Cuvée: Rebsorten absteigend nach Menge, Vorschlag und Prüfung der Sortenangabe
// (Charge, Blend-Protokoll, Füllung, Etikett). Entscheidung Jörgen 06.10.2026: „Cuvée“ und „Gemischter Satz“ mit anbieten.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  sortenAnteilText, sortenAngabeVorschlag, sortenAngabePruefen, istSortenfreieAngabe, weinartAusSortenverschnitt,
  sortenBezeichnung, CUVEE, GEMISCHTER_SATZ,
} from '../../src/lib/wein/sortenangabe.ts'
import { merkmaleAusCharge } from '../../src/lib/wein/fuellungMerkmale.ts'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const D = 'src/app/(dashboard)'

// 600 L Zweigelt + 300 L Blaufränkisch + 100 L St. Laurent (Akzeptanzkriterium 1)
const CUV = [
  { wert: 'Blaufränkisch', liter: 300, anteil_pct: 30 },
  { wert: 'St. Laurent', liter: 100, anteil_pct: 10 },
  { wert: 'Zweigelt', liter: 600, anteil_pct: 60 },
]
// „Zweigelt Klassik“ 85,9 % (Akzeptanzkriterium 3)
const KLASSIK = [{ wert: 'Zweigelt', liter: 859, anteil_pct: 85.9 }, { wert: 'St. Laurent', liter: 141, anteil_pct: 14.1 }]

describe('KAN-113: Sorten absteigend', () => {
  test('Anteil-Text überall gleich, absteigend', () => {
    assert.equal(sortenAnteilText(CUV), 'Zweigelt 60 % · Blaufränkisch 30 % · St. Laurent 10 %')
    assert.equal(sortenAnteilText(KLASSIK), 'Zweigelt 85,9 % · St. Laurent 14,1 %')
    assert.equal(sortenAnteilText([{ wert: 'Riesling', liter: 900, anteil_pct: 90 }, { wert: 'unbekannt', liter: 100, anteil_pct: 10 }]),
      'Riesling 90 % · ohne Rebsorte 10 %')
    assert.equal(sortenAnteilText([{ wert: 'unbekannt', liter: 5, anteil_pct: 100 }]), null)
    // ohne Liter zählt der Prozentanteil
    assert.equal(sortenAnteilText([{ wert: 'A', anteil_pct: 20 }, { wert: 'B', anteil_pct: 80 }]), 'B 80 % · A 20 %')
  })
  test('die Charge heißt weiterhin „Sortenverschnitt rot“ (keine eigene 85-%-Logik)', () => {
    const r = sortenBezeichnung(CUV.map(({ wert, liter }) => ({ wert, liter })), [], { rebsorte: 'Zweigelt', jahrgang: null, weinart: 'rot' })
    assert.equal(r.rebsorte, 'Sortenverschnitt rot')
  })
})

describe('KAN-113: Vorschlag der Sortenangabe', () => {
  test('unter 85 %: alle Sorten absteigend, Alternativen ohne Sorte', () => {
    const v = sortenAngabeVorschlag(CUV, 'rot')
    assert.equal(v.vorschlag, 'Zweigelt – Blaufränkisch – St. Laurent')
    assert.deepEqual(v.alternativen, ['Sortenverschnitt rot', CUVEE, GEMISCHTER_SATZ])
    assert.equal(v.hinweis, null)
  })
  test('ab 85 %: Einzelsorte, Aufzählung als Alternative', () => {
    const v = sortenAngabeVorschlag(KLASSIK, 'rot')
    assert.equal(v.vorschlag, 'Zweigelt')
    assert.equal(v.alternativen[0], 'Zweigelt – St. Laurent')
  })
  test('Anteile ohne Rebsorte: keine Aufzählung (ergäbe keine 100 %), Sortenverschnitt mit Hinweis', () => {
    const v = sortenAngabeVorschlag([...CUV, { wert: 'unbekannt', liter: 50, anteil_pct: 5 }], 'rot')
    assert.equal(v.vorschlag, 'Sortenverschnitt rot')
    assert.match(v.hinweis, /keine bekannte Rebsorte/)
    assert.equal(sortenAngabeVorschlag([], 'rot').vorschlag, null)
  })
  test('Farbe aus der Bezeichnung „Sortenverschnitt …“', () => {
    assert.equal(weinartAusSortenverschnitt('Sortenverschnitt rot'), 'rot')
    assert.equal(weinartAusSortenverschnitt('Sortenverschnitt weiß'), 'weiss')
    assert.equal(weinartAusSortenverschnitt('Sortenverschnitt Rosé'), 'rose')
    assert.equal(weinartAusSortenverschnitt('Sortenverschnitt'), null)
    assert.equal(weinartAusSortenverschnitt('Zweigelt'), null)
  })
})

describe('KAN-113: Prüfung der Sortenangabe (Warnungen, keine Sperre)', () => {
  test('Vorschlag und sortenfreie Bezeichnungen ohne Warnung', () => {
    assert.deepEqual(sortenAngabePruefen('Zweigelt – Blaufränkisch – St. Laurent', CUV), [])
    assert.deepEqual(sortenAngabePruefen('Zweigelt, Blaufränkisch, St. Laurent', CUV), [])
    for (const t of ['Sortenverschnitt rot', 'Cuvée', 'Cuvee Reserve', 'Gemischter Satz', '']) {
      assert.deepEqual(sortenAngabePruefen(t, CUV), [], t)
      if (t) assert.equal(istSortenfreieAngabe(t), true, t)
    }
  })
  test('falsche Reihenfolge → Warnung mit richtiger Reihenfolge', () => {
    const w = sortenAngabePruefen('Blaufränkisch – Zweigelt – St. Laurent', CUV)
    assert.deepEqual(w, ['Reihenfolge absteigend nach Menge: Zweigelt – Blaufränkisch – St. Laurent.'])
  })
  test('nur „Zweigelt“ bei 60 % → Warnung', () => {
    const [w] = sortenAngabePruefen('Zweigelt', CUV)
    assert.match(w, /„Zweigelt“ allein erst ab 85 % – hier 60 %/)
  })
  test('Zweigelt Klassik 85,9 %: „Zweigelt“ und „Zweigelt – St. Laurent“ zulässig', () => {
    assert.deepEqual(sortenAngabePruefen('Zweigelt', KLASSIK), [])
    assert.deepEqual(sortenAngabePruefen('Zweigelt – St. Laurent', KLASSIK), [])
    assert.deepEqual(sortenAngabePruefen('zweigelt - st. laurent', KLASSIK), [])
  })
  test('fehlende Sorte (keine 100 %) und fremde Sorte', () => {
    assert.deepEqual(sortenAngabePruefen('Zweigelt – Blaufränkisch', CUV), ['Bei mehreren Sorten alle angeben (100 %) – es fehlt: St. Laurent (10 %).'])
    const w = sortenAngabePruefen('Zweigelt – Merlot', KLASSIK)
    assert.ok(w.includes('„Merlot“ ist laut Zusammensetzung nicht im Wein.'))
  })
  test('Bindestrich im Sortennamen trennt nicht (Muskat-Ottonel)', () => {
    const m = [{ wert: 'Muskat-Ottonel', liter: 900, anteil_pct: 90 }, { wert: 'Riesling', liter: 100, anteil_pct: 10 }]
    assert.deepEqual(sortenAngabePruefen('Muskat-Ottonel', m), [])
  })
})

describe('KAN-113: Füllung übernimmt die Sortenangabe einer Sortenverschnitt-Charge', () => {
  test('Sortenverschnitt-Charge: Eingabe gilt, ohne Hinweis', () => {
    const r = merkmaleAusCharge({ jahrgang: 2025, rebsorte: 'Zweigelt – Blaufränkisch – St. Laurent' }, { jahrgang: 2025, rebsorte: 'Sortenverschnitt rot' })
    assert.equal(r.rebsorte, 'Zweigelt – Blaufränkisch – St. Laurent')
    assert.equal(r.hinweis, null)
    // leer → Bezeichnung der Charge
    assert.equal(merkmaleAusCharge({ jahrgang: 2025, rebsorte: '' }, { jahrgang: 2025, rebsorte: 'Sortenverschnitt rot' }).rebsorte, 'Sortenverschnitt rot')
  })
  test('Charge mit Einzelsorte: weiterhin die Sorte der Charge (KAN-84)', () => {
    const r = merkmaleAusCharge({ jahrgang: 2025, rebsorte: 'Cuvée' }, { jahrgang: 2025, rebsorte: 'Zweigelt' })
    assert.equal(r.rebsorte, 'Zweigelt')
    assert.match(r.hinweis, /Rebsorte „Cuvée“ → „Zweigelt“/)
  })
})

describe('KAN-113: Verdrahtung', () => {
  test('Charge, Blend-Protokoll, Füllung, Etikett, DAC', () => {
    assert.match(quelle(`${D}/kellerbuch/weinausbau/[id]/VerschneidungWidget.tsx`), /sortenAngabeVorschlag\(bestehtAus, zielCharge\.weinart/)
    assert.match(quelle('src/components/kellerbuch/BlendProtokollTeile.tsx'), /export function BlendSortenAbsteigend/)
    for (const art of ['weinausbau', 'fuellung']) {
      assert.match(quelle(`${D}/kellerbuch/${art}/[id]/blend-protokoll/page.tsx`), /<BlendSortenAbsteigend komposition=\{komposition\}/, art)
    }
    const fp = quelle(`${D}/weinhandel/fuellungen/neu/page.tsx`)
    assert.match(fp, /sortenJeCharge\[id\] = sortenAnteile\(/)
    assert.match(fp, /sortenJeCharge=\{sortenJeCharge\}/)
    const fc = quelle(`${D}/weinhandel/fuellungen/neu/FuellungFormClient.tsx`)
    assert.match(fc, /sortenAngabePruefen\(rebsorteVal, sortenWahl\.anteile\)/)
    assert.match(fc, /readOnly=\{!!selectedCharge\?\.rebsorte && !sortenWahl\}/)
    const et = quelle(`${D}/dac/[id]/etikett/page.tsx`)
    assert.match(et, /\['Rebsorte', sorten\?\.vorschlag \?\?/)
    assert.match(quelle(`${D}/dac/neu/page.tsx`), /return sortenAnteilText\(anteile\)/)
  })
})
