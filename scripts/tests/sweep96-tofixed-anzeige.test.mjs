// Sweep 96 (10.10.2026): Zahlenanzeige nie über x.toFixed(n) – das liefert einen Dezimalpunkt.
// Befund: Flächen „0.1234 ha“ (Erntemeldung, Grundstücke/BEV-Abfrage), Ausbeute „72.5 %“ (Pressung), Veränderung
// „+12.3%“ (Reports), „WG-Anteile: 99.5% ≠ 100%“ (Kostenrechnung), „1.5k“ (Kosten je Monat), „1.5 MB“ (Anhänge),
// Koordinaten im Tooltip der Ried. Jetzt über fmtNum/fmtHa/fmtKoord (Dezimalkomma, Tausenderpunkt).
// Wächter: scripts/check-zahl-locale.js (Regel für src/app und src/components).
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { fmtNum, fmtHa } from '../../src/lib/format.ts'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefeText } = require(path.join(HIER, '..', 'check-zahl-locale.js'))
const anzeige = t => pruefeText(t, { anzeige: true }).funde.map(f => f.zeile)
const quelle = d => readFileSync(path.join(ROOT, d), 'utf8')

describe('Helfer', () => {
  test('Dezimalkomma statt Punkt', () => {
    assert.equal((72.54).toFixed(1), '72.5')
    assert.equal(fmtNum(72.54, 1), '72,5')
    assert.equal(fmtHa(0.1234), '0,1234')
    assert.equal(fmtNum(1234.5 / 1000, 1), '1,2')
  })
})

describe('Erkennung (Anzeige-Dateien)', () => {
  test('toFixed(n) → Fund; toFixed(0), .replace(".", ","), Kommentar und Lib-Dateien → kein Fund', () => {
    assert.deepEqual(anzeige('const s = `${x.toFixed(1)} %`'), [1])
    assert.deepEqual(anzeige("a\nconst s = g.flaeche_ha.toFixed(4) + ' ha'"), [2])
    assert.deepEqual(anzeige('const s = `${x.toFixed(0)} %`'), [])
    assert.deepEqual(anzeige("const s = x.toFixed(4).replace('.', ',') + ' ha'"), [])
    assert.deepEqual(anzeige('// x.toFixed(2)'), [])
    assert.deepEqual(pruefeText('const s = `${x.toFixed(1)} %`').funde, [])   // ohne anzeige (src/lib): nicht gemeldet
  })

  test('Ausnahme nur mit Begründung', () => {
    assert.deepEqual(anzeige('// zahl-locale-ok: Gruppierungsschlüssel, nicht angezeigt\nconst k = `${lat.toFixed(5)}`'), [])
    assert.deepEqual(anzeige('// zahl-locale-ok: kurz\nconst k = `${lat.toFixed(5)}`'), [2])
  })
})

describe('Verdrahtung', () => {
  test('betroffene Anzeigen nutzen die Helfer', () => {
    assert.match(quelle('src/app/(dashboard)/erntemeldung/[id]/PressungSection.tsx'), /\{fmtNum\(ausbeute, 1\)\} %/)
    assert.match(quelle('src/app/(dashboard)/erntemeldung/[id]/ErnteDetailClient.tsx'), /fmtHa\(g\.flaeche_ha\)/)
    assert.match(quelle('src/app/(dashboard)/weingarten/GrundstueckePanel.tsx'), /fmtHa\(result\.ha\)/)
    assert.match(quelle('src/app/(dashboard)/reports/ReportsClient.tsx'), /fmtNum\(pct, 1\)/)
  })
})
