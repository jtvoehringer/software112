// KAN-387 (Epic KAN-386 „Persönliches Dashboard“): Die Übersicht ist aus Widgets gebaut – Register in
// src/lib/dashboard/widgets.ts, Darstellung je Widget in dashboard/_widgets/. Der Standard entspricht der bisherigen
// Übersicht; geladen werden nur die Daten der sichtbaren Widgets.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// @ts-expect-error TS5097 – node:test lädt die .ts-Datei direkt
import { WIDGETS, STANDARD_LAYOUT, sichtbareWidgets, benoetigteQuellen, abschnitte } from '../../src/lib/dashboard/widgets.ts'

const quelle = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const ALLES = { modulEa: true, schnellaktionen: true }
const ids = ws => ws.map(w => w.def.id)

describe('Register', () => {
  test('ids eindeutig, Standard = alle Widgets in der bisherigen Reihenfolge', () => {
    const alle = WIDGETS.map(w => w.id)
    assert.equal(new Set(alle).size, alle.length)
    assert.deepEqual(STANDARD_LAYOUT.map(e => e.id), [
      'schnellaktionen', 'kellerbestand', 'flaschenlager', 'offene-posten', 'offene-aufgaben',
      'finanzen', 'naechste-schritte', 'morgenbericht', 'aufgaben-termine', 'support-anfragen', 'schnellzugriff',   // KAN-438: + Support-Anfragen
    ])
  })

  test('jede id hat eine Komponente (und keine zusätzliche)', () => {
    const s = quelle('src/app/(dashboard)/dashboard/_widgets/index.tsx')
    const block = s.match(/WIDGET_KOMPONENTEN[^=]*= \{([^}]*)\}/)?.[1] ?? ''
    const inIndex = [...block.matchAll(/'([a-z-]+)':/g)].map(m => m[1])
    assert.deepEqual(inIndex.sort(), WIDGETS.map(w => w.id).sort())
  })
})

describe('Sichtbarkeit', () => {
  test('alles erlaubt: Standard vollständig', () => {
    assert.deepEqual(ids(sichtbareWidgets(STANDARD_LAYOUT, ALLES)), STANDARD_LAYOUT.map(e => e.id))
  })
  test('ohne E&A keine Finanzen, ohne Schreibrecht keine Schnellaktionen', () => {
    const w = ids(sichtbareWidgets(STANDARD_LAYOUT, { modulEa: false, schnellaktionen: false }))
    assert.ok(!w.includes('finanzen'))
    assert.ok(!w.includes('schnellaktionen'))
    assert.ok(w.includes('schnellzugriff'), 'Leser behalten den Schnellzugriff')
  })
  test('unbekannte und doppelte ids fallen weg, Reihenfolge des Layouts bleibt', () => {
    const w = sichtbareWidgets([{ id: 'morgenbericht' }, { id: 'gibt-es-nicht' }, { id: 'kellerbestand' }, { id: 'morgenbericht' }], ALLES)
    assert.deepEqual(ids(w), ['morgenbericht', 'kellerbestand'])
  })
  test('Größe aus dem Layout geht vor, sonst die des Registers', () => {
    const [a, b] = sichtbareWidgets([{ id: 'morgenbericht', groesse: 'breit' }, { id: 'kellerbestand' }], ALLES)
    assert.equal(a.groesse, 'breit')
    assert.equal(b.groesse, 'klein')
  })
})

describe('Quellen', () => {
  test('nicht sichtbare Widgets laden nichts', () => {
    const q = benoetigteQuellen(sichtbareWidgets(STANDARD_LAYOUT, { modulEa: false, schnellaktionen: true }))
    assert.ok(!q.has('finanzen'))
    assert.ok(q.has('keller') && q.has('fristen') && q.has('morgenbericht'))
  })
  test('nur Kellerbestand → nur Keller', () => {
    assert.deepEqual([...benoetigteQuellen(sichtbareWidgets([{ id: 'kellerbestand' }], ALLES))], ['keller'])
  })
  test('Standard braucht alle Quellen (wie die bisherige Seite)', () => {
    assert.equal(benoetigteQuellen(sichtbareWidgets(STANDARD_LAYOUT, ALLES)).size, 9)
  })
})

describe('Abschnitte', () => {
  test('Standard: Handy-Schnellaktionen, Kacheln, Karten', () => {
    const a = abschnitte(sichtbareWidgets(STANDARD_LAYOUT, ALLES))
    assert.deepEqual(a.map(x => [x.art, x.nurHandy, x.widgets.length]), [['karten', true, 1], ['kacheln', false, 4], ['karten', false, 6]])   // KAN-438: sechste Karte „Support-Anfragen“
  })
  test('Kachel zwischen Karten trennt die Abschnitte', () => {
    const a = abschnitte(sichtbareWidgets([{ id: 'morgenbericht' }, { id: 'kellerbestand' }, { id: 'finanzen' }], ALLES))
    assert.deepEqual(a.map(x => x.art), ['karten', 'kacheln', 'karten'])
  })
})

describe('Seite', () => {
  const p = quelle('src/app/(dashboard)/dashboard/page.tsx')
  test('baut aus dem Register und lädt nur benötigte Quellen', () => {
    assert.match(p, /sichtbareWidgets\(eigenesLayout \?\? STANDARD_LAYOUT,/)   // seit KAN-388: ohne eigenes Layout der Standard
    assert.match(p, /ladeWidgetDaten\(ctx, einst, benoetigteQuellen\(widgets\)\)/)
    assert.match(p, /abschnitt\.nurHandy \? 'sm:hidden '/)
  })
  test('Ladefunktion lädt jede Quelle nur, wenn sie gebraucht wird', () => {
    const l = quelle('src/app/(dashboard)/dashboard/_shared/widgetDaten.ts')
    for (const q of ['keller', 'flaschen', 'offenePosten', 'fristen', 'aufgabenTermine', 'weingarten', 'checklisten', 'finanzen', 'morgenbericht']) {
      assert.match(l, new RegExp(`wenn\\('${q}',`), q)
    }
  })
})
