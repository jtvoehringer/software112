// Sweep 79 (09.10.2026): „jetzt“ in Server-Code nie über new Date().getFullYear()/getMonth()/… – Vercel läuft in UTC,
// am Monats- bzw. Jahreswechsel galt bis 1 bzw. 2 Uhr Wiener Zeit noch der alte Monat bzw. das alte Jahr. Befunde:
// Rechnungszähler-Jahr beim Anlegen eines Betriebs (Neujahrsnacht → altes Jahr), Monatsabschluss („Zukunft“-Sperre und
// Jahresvorwahl), Umsatzbericht (letzte 12 Monate), Vorwahl des Jahres bei Zukauf, Gebinde und Kostenrechnung.
// Richtig: wienJetzt() aus src/lib/datum/wien.ts. Hier: Rechnung unter TZ=UTC, Wächter (check-datum Regel 4), Verdrahtung.
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { wienJetzt } from '../../src/lib/datum/wien.ts'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefeText, pruefeWurzel } = require(path.join(HIER, '..', 'check-datum.js'))
const quelle = p => readFileSync(path.join(ROOT, p), 'utf8')

function unterUtc(fn) {
  const alt = process.env.TZ
  process.env.TZ = 'UTC'
  try { return fn() } finally { if (alt === undefined) delete process.env.TZ; else process.env.TZ = alt }
}

describe('Neujahrs- und Monatswechsel auf einem UTC-Server', () => {
  test('1.1.2027, 00:30 Wiener Zeit: new Date() sagt 2026, wienJetzt() 2027', () => {
    unterUtc(() => {
      const t = new Date('2026-12-31T23:30:00Z')
      assert.equal(t.getFullYear(), 2026, 'Gegenprobe: alter Code (Rechnungszähler-Jahr)')
      assert.equal(wienJetzt(t).getFullYear(), 2027)
      assert.equal(wienJetzt(t).getMonth(), 0)
    })
  })
  test('1.11., 01:30 Wiener Zeit (Winterzeit): Monat November, nicht Oktober', () => {
    unterUtc(() => {
      const t = new Date('2026-11-01T00:30:00Z')
      assert.equal(t.getMonth(), 10)
      const s = new Date('2026-10-31T23:30:00Z')   // 1.11., 00:30 in Wien
      assert.equal(s.getMonth(), 9, 'Gegenprobe: UTC noch Oktober')
      assert.equal(wienJetzt(s).getMonth(), 10)
    })
  })
})

describe('check-datum Regel 4: „jetzt“ über new Date().get…() in Server-Code', () => {
  test('Fund: direkt und über eine Variable', () => {
    assert.equal(pruefeText('const j = new Date().getFullYear()\n').funde.length, 1)
    assert.equal(pruefeText('const heute = new Date()\nconst m = heute.getMonth() + 1\n').funde.length, 1)
  })
  test('kein Fund: wienJetzt(), Zeitpunkt-Rechnung mit Begründung, Client, Datum aus Wert', () => {
    assert.equal(pruefeText('const j = wienJetzt().getFullYear()\n').funde.length, 0)
    assert.equal(pruefeText("'use client'\nconst j = new Date().getFullYear()\n").funde.length, 0)
    assert.equal(pruefeText('const d = new Date(x.datum)\nconst j = d.getFullYear()\n').funde.length, 0)
    assert.deepEqual(pruefeText('// datum-ok: Zeitpunkt minus 7 Tage für den IMAP-Filter\nconst seit = new Date(); seit.setDate(seit.getDate() - 7)\n'),
      { funde: [], ausnahmen: 1 })
  })
  test('ganzes Projekt ohne Fund; Rechnungszähler-Jahr und Monatsabschluss über wienJetzt()', () => {
    assert.deepEqual(pruefeWurzel(ROOT).funde, [])
    assert.match(quelle('src/app/(dashboard)/admin/mandanten/[id]/actions.ts'), /rechnung_zaehler_jahr: wienJetzt\(\)\.getFullYear\(\)/)
    const m = quelle('src/app/(dashboard)/buchhaltung/monatsabschluss/page.tsx')
    assert.match(m, /const heute = wienJetzt\(\)/)
    assert.doesNotMatch(m, /new Date\(\)\.getFullYear\(\)/)
  })
})
