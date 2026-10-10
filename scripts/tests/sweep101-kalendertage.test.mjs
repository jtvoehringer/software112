// Sweep 101 (10.10.2026): Kalendertage nie über Millisekunden.
// Befund: „(jetzt − new Date('JJJJ-MM-TT')) / 86400000“ mischt einen Zeitpunkt mit UTC-Mitternacht – mit floor/round ist das
// Ergebnis zwischen 0 und 2 Uhr Wiener Zeit einen Tag daneben: Verzug offener Posten und Reports, „seit X Tagen“ (letzte
// Analyse, letzter Kauf, letzter Kontakt), Wartefristen auf dem Dashboard (UTC-Mitternacht des Servers) und das Ende der
// Testphase (wienJetzt() ist verschoben, gegen echten Zeitpunkt gerechnet: 2 Stunden daneben).
// Jetzt tageSeit/tageBis/tageZwischen (src/lib/datum/wien.ts); check-datum meldet die Division durch die Tageslänge.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { tageSeit, tageBis, tageZwischen, wienJetzt } from '../../src/lib/datum/wien.ts'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefeText, pruefeWurzel } = require(path.join(HIER, '..', 'check-datum.js'))
const quelle = d => readFileSync(path.join(ROOT, d), 'utf8')

describe('Kalendertage um Mitternacht', () => {
  // 02.10.2026, 00:30 Uhr Wiener Zeit (Sommerzeit) = 01.10.2026, 22:30 UTC
  const kurzNachMitternacht = new Date('2026-10-01T22:30:00Z')

  test('alte Rechnung lag einen Tag daneben, tageSeit nicht', () => {
    const alt = Math.floor((kurzNachMitternacht.getTime() - new Date('2026-10-01').getTime()) / 86400000)
    assert.equal(alt, 0)                                                     // Rechnung vom 01.10. – „seit 0 Tagen“ (falsch)
    assert.equal(tageSeit('2026-10-01', wienJetzt(kurzNachMitternacht)), 1)  // richtig: 1 Tag
  })

  test('tageBis und tageZwischen', () => {
    const heute = wienJetzt(kurzNachMitternacht)
    assert.equal(tageBis('2026-10-09', heute), 7)
    assert.equal(tageBis('2026-10-01', heute), -1)
    assert.equal(tageZwischen('2026-10-02', '2026-11-01'), 30)
    assert.equal(tageZwischen('2026-03-28', '2026-03-30'), 2)                // über die Zeitumstellung
  })
})

describe('Wächter', () => {
  const zeilen = t => pruefeText(t).funde.map(f => f.zeile)
  test('Erkennung', () => {
    assert.deepEqual(zeilen('const tage = Math.floor((Date.now() - new Date(d).getTime()) / 86400000)'), [1])
    assert.deepEqual(zeilen('x\nconst t = Math.round((a - b) / (1000 * 60 * 60 * 24))'), [2])
    assert.deepEqual(zeilen("const t = Math.round((Date.UTC(j, m, d) - Date.UTC(j2, m2, d2)) / 86400000)"), [])
    assert.deepEqual(zeilen("const t = (new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86400000"), [])
    assert.deepEqual(zeilen('const seit = new Date(Date.now() - 30 * 86400000)'), [])   // Zeitspanne, keine Tageszählung
  })

  test('Projekt: keine Funde; betroffene Stellen nutzen die Helfer', () => {
    assert.deepEqual(pruefeWurzel(ROOT).funde, [])
    assert.match(quelle('src/app/(dashboard)/weinhandel/offene-posten/page.tsx'), /const heute = wienJetzt\(\)[\s\S]*tageSeit\(p\.datum, heute\)/)
    assert.match(quelle('src/lib/morgenbericht/pruefungen.ts'), /tageBis\(wienTag\(t\.stripe_trial_ends_at\), heute\)/)
    assert.match(quelle('src/app/(dashboard)/dashboard/_shared/ui.tsx'), /tageBisTag\(typeof d === 'string' \? d : wienTag\(d\), wienJetzt\(\)\)/)
  })
})
