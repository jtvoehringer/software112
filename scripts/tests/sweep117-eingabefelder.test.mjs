// Sweep 117 (10.10.2026): Eingabefelder – Mausrad ändert keine Zahlen, Fokus immer sichtbar.
// Befund 1: In Chromium (Chrome, Edge) ändert das Mausrad über einem fokussierten <input type="number"> den Wert statt
//   die Seite zu scrollen – gemessen mit Edge: 5× Mausrad macht aus 12,50 → 12,45, die Seite bleibt stehen. Betraf alle
//   126 Zahlenfelder (Mengen, Preise, Analysen …). Jetzt verliert das Feld beim Mausrad den Fokus (ZahlenfeldMausrad im
//   Root-Layout): Wert bleibt, Seite scrollt.
// Befund 2: Checkbox „Stornierte anzeigen“ mit focus:ring-Farbe ohne Breite – globals.css nimmt sie vom Fokusrahmen aus,
//   beim Tabben war sie unsichtbar. check-a11y Regel 5 FOKUS_UNSICHTBAR.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { zahlenfeldMausrad } from '../../src/lib/ui/zahlenfeld.ts'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { fokusUnsichtbar } = require(path.join(HIER, '..', 'check-a11y.js'))
const lies = (p) => readFileSync(path.join(ROOT, p), 'utf8')

function feld(type, tagName = 'INPUT') {
  return { tagName, type, geblurt: false, blur() { this.geblurt = true } }
}

describe('Mausrad über Zahlenfeldern', () => {
  test('fokussiertes Zahlenfeld unter dem Mauszeiger verliert den Fokus', () => {
    const f = feld('number')
    assert.equal(zahlenfeldMausrad({ target: f }, f), true)
    assert.equal(f.geblurt, true)
  })
  test('unberührt: anderes Feld fokussiert, Textfeld, Mausrad woanders auf der Seite', () => {
    const zahl = feld('number'), text = feld('text'), sel = feld('', 'SELECT')
    assert.equal(zahlenfeldMausrad({ target: zahl }, text), false)
    assert.equal(zahlenfeldMausrad({ target: text }, text), false)
    assert.equal(zahlenfeldMausrad({ target: {} }, zahl), false)
    assert.equal(zahlenfeldMausrad({ target: sel }, sel), false)
    assert.equal(zahlenfeldMausrad({ target: zahl }, null), false)
    assert.equal(zahl.geblurt, false)
  })
  test('im Root-Layout eingebunden, Listener passiv (Scrollen bleibt flüssig)', () => {
    const layout = lies('src/app/layout.tsx')
    assert.match(layout, /import ZahlenfeldMausrad from '@\/components\/ZahlenfeldMausrad'/)
    assert.match(layout, /<ZahlenfeldMausrad \/>/)
    assert.match(lies('src/components/ZahlenfeldMausrad.tsx'), /addEventListener\('wheel', beimMausrad, \{ passive: true \}\)/)
  })
})

describe('check-a11y FOKUS_UNSICHTBAR', () => {
  const funde = (jsx) => fokusUnsichtbar(`const x = (${jsx})`, 'x.tsx').map(f => f.tag)
  test('Ringfarbe ohne Breite bzw. ring-0 wird gemeldet', () => {
    assert.deepEqual(funde('<input type="checkbox" className="text-s112-teal focus:ring-s112-teal/40" />'), ['input'])
    assert.deepEqual(funde('<select className="focus:outline-hidden focus:ring-0" />'), ['select'])
  })
  test('in Ordnung: mit Breite (auch im Vorlagen-String), ohne focus:ring (globaler Rahmen greift)', () => {
    assert.deepEqual(funde('<input className="focus:ring-2 focus:ring-s112-teal" />'), [])
    assert.deepEqual(funde('<input className={`focus:ring-2 ${x ? \'focus:ring-s112-err/30\' : \'focus:ring-s112-teal/40\'}`} />'), [])
    assert.deepEqual(funde('<textarea className="focus:outline-hidden" />'), [])
  })
  test('Regression: „Stornierte anzeigen“ hat jetzt eine Ringbreite', () => {
    assert.match(lies('src/components/StornierteUmschalter.tsx'), /focus:ring-2 focus:ring-s112-teal\/40/)
  })
})
