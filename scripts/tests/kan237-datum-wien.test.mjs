// KAN-237 (08.10.2026): „heute“ und Kalendertage in Wiener Zeit statt UTC – vorher lieferte
// new Date().toISOString().slice(0, 10) bis 1 Uhr (Winter) bzw. 2 Uhr (Sommer) den Vortag: Vorbelegungen von Buchungs-,
// Verkaufs-, Kellerbuch- und CRM-Formularen, Standarddaten in Server Actions, das E-Mail-Datum aus Microsoft Graph.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import * as w from '../../src/lib/datum/wien.ts'

describe('KAN-237: Datum nach Europe/Vienna', () => {
  test('heuteWien: nach Mitternacht in Wien schon der neue Tag (Sommer- und Winterzeit), auf jedem Server', () => {
    const tz = process.env.TZ
    try {
      for (const zone of ['UTC', 'Europe/Vienna', 'America/New_York']) {
        process.env.TZ = zone
        // Sommerzeit: 08.10.2026 00:30 Wien = 07.10.2026 22:30 UTC
        assert.equal(w.heuteWien(new Date('2026-10-07T22:30:00Z')), '2026-10-08', zone)
        // Winterzeit: 01.01.2027 00:30 Wien = 31.12.2026 23:30 UTC
        assert.equal(w.heuteWien(new Date('2026-12-31T23:30:00Z')), '2027-01-01', zone)
        // kurz vor Mitternacht in Wien: noch der alte Tag
        assert.equal(w.heuteWien(new Date('2026-10-08T21:59:59Z')), '2026-10-08', zone)
      }
    } finally {
      if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz
    }
    // Regression: der UTC-Schnitt lieferte hier den Vortag
    assert.equal(new Date('2026-10-07T22:30:00Z').toISOString().slice(0, 10), '2026-10-07')
  })

  test('wienTag: Kalendertag eines Zeitpunkts (E-Mail um 00:30 Wiener Zeit gehört zum neuen Tag)', () => {
    assert.equal(w.wienTag('2026-10-07T22:30:00Z'), '2026-10-08')
    assert.equal(w.wienTag('2026-10-08T10:00:00Z'), '2026-10-08')
    assert.equal(w.wienTag(new Date('2026-12-31T23:30:00Z')), '2027-01-01')
  })

  test('kein „heute“ mehr aus UTC im Programmcode (new Date().toISOString().slice(0, 10) bzw. split(\'T\')[0])', () => {
    let treffer = ''
    try {
      treffer = execSync(`git grep -n -E "new Date\\(\\)\\.toISOString\\(\\)\\.(slice\\(0, ?10\\)|split\\('T'\\)\\[0\\])" -- src`, { encoding: 'utf8' })
    } catch { treffer = '' }   // git grep ohne Treffer endet mit Exit 1
    const zeilen = treffer.split('\n').filter(z => z && !z.startsWith('src/lib/datum/wien.ts:'))
    assert.deepEqual(zeilen, [], 'heuteWien() bzw. wienTag() aus @/lib/datum/wien verwenden')
  })
})
