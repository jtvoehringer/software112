// KAN-373 (UAT 27.10.2026): Druckformulare laufen nicht über und drucken Inhalte einzeilig – Klasse druck-formular
// in globals.css; angewendet auf AMA-Erntemeldung (Querformat), Rückruf-Liste (KAN-361: Druckkopf mit Betrieb,
// Betriebsnummer und Stand, Links schwarz) und BKI-Schnittstelle (KAN-369).
//
// Aufruf:  npm run -s test:csv   bzw.  node --test scripts/tests/kan373-druckformular.test.mjs

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const lies = rel => readFileSync(path.join(ROOT, rel), 'utf8')

/** Inhalt des @media-print-Blocks aus globals.css */
function druckBlock() {
  const css = lies('src/app/globals.css')
  const start = css.indexOf('@media print {')
  assert.ok(start >= 0, '@media print fehlt')
  let tiefe = 0
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') tiefe++
    else if (css[i] === '}' && --tiefe === 0) return css.slice(start, i + 1)
  }
  throw new Error('@media print nicht geschlossen')
}

describe('KAN-373 Druckklasse druck-formular', () => {
  const block = druckBlock()

  test('Zellen einzeilig, schlägt den globalen Umbruch (höhere Spezifität, !important)', () => {
    assert.match(block, /th, td \{ white-space: normal !important/)
    assert.match(block, /\.druck-formular td \{ white-space: nowrap !important; \}/)
  })

  test('Spaltenköpfe dürfen weiter umbrechen', () => {
    assert.doesNotMatch(block, /\.druck-formular th[^{]*\{[^}]*nowrap/)
  })

  test('kleine Druckschrift und knappe Abstände, auch für verschachtelte Elemente', () => {
    assert.match(block, /\.druck-formular th, \.druck-formular td \{[^}]*font-size: 8pt !important/)
    assert.match(block, /\.druck-formular th \*, \.druck-formular td \* \{ font-size: inherit !important; \}/)
  })

  test('KAN-361: Links schwarz', () => {
    assert.match(block, /\.druck-formular a \{ color: #000 !important; \}/)
  })
})

describe('Seiten mit druck-formular', () => {
  const ama = lies('src/app/(dashboard)/reports/(pflicht)/ama/page.tsx')
  const rueckruf = lies('src/app/(dashboard)/kellerbuch/rueckverfolgung/vorwaerts/page.tsx')
  const bki = lies('src/app/(dashboard)/kellerbuch/bki-schnittstelle/page.tsx')

  test('AMA-Erntemeldung: Dokument mit Klasse, Standard Querformat', () => {
    assert.match(ama, /className="card [^"]*druck-formular"/)
    assert.match(ama, /<PrintButton standard="quer" \/>/)
  })

  test('AMA-Erntemeldung: Weinbaugebiet in derselben Zeile wie die Rebsorte (kein block)', () => {
    const zeile = ama.split('\n').find(l => l.includes('z.weinbaugebiet ??'))
    assert.ok(zeile, 'Weinbaugebiet-Zeile fehlt')
    assert.doesNotMatch(zeile, /className="block/)
  })

  test('PrintButton reicht das Standardformat weiter', () => {
    assert.match(lies('src/app/(dashboard)/reports/PrintButton.tsx'), /<DruckFormatKnopf standard=\{standard\} \/>/)
  })

  test('KAN-361 Rückruf-Liste: Klasse, Druckkopf mit Betrieb, Betriebsnummer und Stand (Wiener Zeit)', () => {
    assert.match(rueckruf, /className="max-w-6xl space-y-6 druck-formular"/)
    assert.match(rueckruf, /hidden print:block[\s\S]{0,200}Betriebsnummer \{betrieb\?\.betriebsnummer[\s\S]{0,40}Stand \{stand\}/)
    assert.match(rueckruf, /timeZone: 'Europe\/Vienna'/)
  })

  test('KAN-369 BKI-Schnittstelle: Klasse', () => {
    assert.match(bki, /className="space-y-6 druck-formular"/)
  })
})
