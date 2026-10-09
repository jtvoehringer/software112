// KAN-255 (09.10.2026): Kalendertage nie über toISOString() eines lokal gebauten Datums bzw. „heute“ in UTC.
// Befund: Die BMD-Übergabe schlug im Browser (Wien) als Vormonat den 31.08.–29.09. statt 01.09.–30.09. vor; Assistent und
// KI-Abfrage hielten zwischen 0 und 2 Uhr „gestern“ für heute; der IMAP-Abruf datierte Mails nach Mitternacht auf den Vortag.
// Hier: der Wächter scripts/check-datum.js und die Zeitzonen-Rechnung unter TZ=Europe/Vienna (wie im Browser).
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { lokalerTag, wienJetzt, wienTag, heuteWien } from '../../src/lib/datum/wien.ts'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { pruefeText, pruefeWurzel } = require(path.join(HIER, '..', 'check-datum.js'))
const ISO = '.toISO' + 'String()'
const zeilen = t => pruefeText(t).funde.map(f => f.zeile)

describe('check-datum: Erkennung', () => {
  test('lokal gebautes Datum über toISOString → Fund (wie die alte BMD-Vorbelegung)', () => {
    assert.deepEqual(zeilen(`const von = new Date(h.getFullYear(), h.getMonth() - 1, 1)${ISO}.slice(0, 10)\n`), [1])
    assert.deepEqual(zeilen(`const d = new Date(j, m, 0)${ISO}.split('T')[0]\n`), [1])
  })
  test('„heute“ in UTC → Fund; alle Schreibweisen', () => {
    for (const ende of [`.slice(0, 10)`, `.substring(0, 10)`, `.split('T')[0]`, `.split("T")[0]`]) {
      assert.deepEqual(zeilen(`const heute = new Date()${ISO}${ende}\n`), [1], ende)
    }
  })
  test('richtig und nicht gemeldet: Date.UTC, UTC-Mitternacht, ein Argument, Zeitstempel', () => {
    assert.deepEqual(zeilen(`const a = new Date(Date.UTC(j, m - 1, t + 1))${ISO}.slice(0, 10)\n`), [])
    assert.deepEqual(zeilen(`const b = new Date(\`\${datum}T00:00:00Z\`)${ISO}.slice(0, 10)\n`), [])
    assert.deepEqual(zeilen(`const c = new Date(ms)${ISO}\nconst d = new Date()${ISO}\n`), [], 'Zeitstempel ohne Abschneiden ist in Ordnung')
    assert.deepEqual(zeilen(`// new Date(j, m, 1)${ISO}.slice(0, 10)\nconst s = "new Date(j, m, 1)${ISO}"\n`), [], 'Kommentare und Strings zählen nicht')
  })
  test('Ausnahme „datum-ok“ mit Begründung ≥ 15 Zeichen', () => {
    assert.equal(pruefeText(`// datum-ok: Server läuft in UTC, Wert nur für das Protokoll\nconst x = new Date()${ISO}.slice(0, 10)\n`).ausnahmen, 1)
    assert.match(pruefeText(`// datum-ok: kurz\nconst x = new Date()${ISO}.slice(0, 10)\n`).funde[0].text, /ohne ausreichende Begründung/)
  })
  test('das Projekt ist sauber', () => {
    assert.deepEqual(pruefeWurzel(path.resolve(HIER, '..', '..')).funde, [])
  })
})

describe('Zeitzonen-Rechnung wie im Browser (TZ=Europe/Vienna)', () => {
  test('lokalerTag hält den Kalendertag, toISOString verschiebt ihn – das war der BMD-Befund', () => {
    const alt = process.env.TZ
    process.env.TZ = 'Europe/Vienna'
    try {
      const erster = new Date(2026, 8, 1), letzter = new Date(2026, 9, 0)
      assert.equal(lokalerTag(erster), '2026-09-01')
      assert.equal(lokalerTag(letzter), '2026-09-30')
      assert.equal(erster.toISOString().slice(0, 10), '2026-08-31', 'so rechnete die alte Vorbelegung')
      assert.equal(letzter.toISOString().slice(0, 10), '2026-09-29')
    } finally { if (alt === undefined) delete process.env.TZ; else process.env.TZ = alt }
  })

  test('nach Mitternacht in Wien: heuteWien/wienJetzt/wienTag liefern den neuen Tag, UTC noch den alten', () => {
    const t = new Date('2026-10-09T22:30:00Z')   // 10.10.2026, 00:30 Wiener Sommerzeit
    assert.equal(heuteWien(t), '2026-10-10')
    assert.equal(lokalerTag(wienJetzt(t)), '2026-10-10')
    assert.equal(wienTag(t), '2026-10-10')
    assert.equal(t.toISOString().slice(0, 10), '2026-10-09')
  })
})
