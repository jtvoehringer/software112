// Sweep 121 (10.10.2026): Textfelder für Zahlen mit inputMode – am Handy der Ziffernblock statt der Buchstabentastatur.
// Befund: 71 Zahlen-Textfelder hatten inputMode, 16 nicht – Menge und Alkoholgehalt der Transportbescheinigung,
// SVS-Einkünfte (decimal) sowie Ziffern-Codes wie AMA-Feldstück- und Schlagnr., KG-Nr., Betriebsnummern, PLZ,
// Debitor- und Kontonummer (numeric; Textfeld, damit führende Nullen bleiben). Wächter check-zahl-eingabe, Regel 3.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefeText } = require(path.join(HIER, '..', 'check-zahl-eingabe.js'))
const lies = (p) => readFileSync(path.join(ROOT, p), 'utf8')
const textFunde = (jsx) => pruefeText(jsx).funde.filter(f => f.text.startsWith('Textfeld'))

describe('check-zahl-eingabe: Textfelder für Zahlen', () => {
  test('gemeldet: numerischer Platzhalter bzw. Mengen-/Betragsbeschriftung ohne inputMode', () => {
    assert.equal(textFunde('<input aria-label="KGNr." placeholder="z.B. 12105" />').length, 1)
    assert.equal(textFunde('<input type="text" placeholder="0,00" />').length, 1)
    assert.equal(textFunde('<input placeholder="z. B. 28.500" />').length, 1)
    assert.equal(textFunde('<input aria-label={`Menge Position ${i + 1}`} value={m} />').length, 1)
  })
  test('in Ordnung: mit inputMode, Zahlenfeld, Version, Freitext, Spread', () => {
    assert.equal(textFunde('<input inputMode="numeric" placeholder="z.B. 12105" />').length, 0)
    assert.equal(textFunde('<input type="number" step="1" placeholder="12" />').length, 0)
    assert.equal(textFunde('<input aria-label="Version" placeholder="2.2.0" />').length, 0)
    assert.equal(textFunde('<input aria-label="Begründung" placeholder="z. B. Verdunstung" />').length, 0)
    assert.equal(textFunde('<input {...feld} placeholder="12" />').length, 0)
    assert.equal(textFunde('<input type="date" placeholder="1" />').length, 0)
  })
})

describe('Sweep 121: Stellen', () => {
  test('Transportbescheinigung und SVS mit decimal, Codes mit numeric', () => {
    const tb = lies('src/app/(dashboard)/weinhandel/verkauf/[id]/transportbescheinigung/TBFormular.tsx')
    assert.match(tb, /<input inputMode="decimal" className=\{inputCls\} aria-label=\{`Menge Position/)
    assert.match(tb, /<input inputMode="decimal" className=\{inputCls\} aria-label=\{`Alkoholgehalt Position/)
    assert.match(lies('src/app/(dashboard)/buchhaltung/svs/SvsClient.tsx'), /<input inputMode="decimal" aria-label="Einkünfte aus Land- und Forstwirtschaft \(Jahr\)"/)
    assert.match(lies('src/components/weingarten/WeingartenForm.tsx'), /<input inputMode="numeric" aria-label="AMA-Feldstücknr\."/)
    const gst = lies('src/app/(dashboard)/weingarten/GrundstueckePanel.tsx')
    assert.match(gst, /<input inputMode="numeric" aria-label="KGNr\."/)
    assert.match(gst, /<input inputMode="numeric" aria-label="AMA-Schlagnr\."/)
  })
  test('ganzer Quellbaum ohne Fund', () => {
    const { pruefeWurzel } = require(path.join(HIER, '..', 'check-zahl-eingabe.js'))
    assert.deepEqual(pruefeWurzel(ROOT).funde, [])
  })
})
