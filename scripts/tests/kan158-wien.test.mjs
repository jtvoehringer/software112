// KAN-158 (29.09.2026) – „heute“ in Wiener Zeit für Dashboards (src/lib/datum/wien.ts)
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { wienJetzt, lokalerTag, tageSeit } = await import('../../src/lib/datum/wien.ts')
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const TZ_VORHER = process.env.TZ

describe('wienJetzt / lokalerTag / tageSeit', () => {
  afterEach(() => { if (TZ_VORHER === undefined) delete process.env.TZ; else process.env.TZ = TZ_VORHER })

  const faelle = [
    // [Zeitpunkt UTC, Wiener Tag, Wiener Stunde]
    ['2026-09-27T22:30:00.000Z', '2026-09-28', 0],   // Sommerzeit: 00:30 in Wien
    ['2026-12-31T23:30:00.000Z', '2027-01-01', 0],   // Winterzeit: Jahreswechsel
    ['2026-06-15T10:59:00.000Z', '2026-06-15', 12],  // Begrüßung: 12:59 in Wien ist nicht mehr „Morgen“
    ['2026-03-29T00:59:00.000Z', '2026-03-29', 1],   // vor der Umstellung auf Sommerzeit
    ['2026-03-29T01:00:00.000Z', '2026-03-29', 3],   // nach der Umstellung (2 Uhr gibt es nicht)
  ]
  for (const zone of ['UTC', 'Europe/Vienna', 'America/New_York']) {
    test(`Wiener Tag und Stunde unabhängig von der Serverzone (${zone})`, () => {
      process.env.TZ = zone
      for (const [utc, tag, stunde] of faelle) {
        const w = wienJetzt(new Date(utc))
        assert.equal(lokalerTag(w), tag, `${zone} ${utc}`)
        assert.equal(w.getHours(), stunde, `${zone} ${utc}`)
      }
    })
  }

  test('lokalerTag aus lokal gebildeten Daten – der 15. bleibt der 15. (auch in Wien)', () => {
    for (const zone of ['UTC', 'Europe/Vienna']) {
      process.env.TZ = zone
      assert.equal(lokalerTag(new Date(2026, 9, 15)), '2026-10-15', zone)
      assert.equal(lokalerTag(new Date(2027, 1, 0)), '2027-01-31', zone)
    }
  })

  test('tageSeit zählt Kalendertage – Uhrzeit und Serverzone egal', () => {
    for (const zone of ['UTC', 'Europe/Vienna']) {
      process.env.TZ = zone
      const heute = wienJetzt(new Date('2026-09-27T22:30:00.000Z'))   // 28.09. 00:30 in Wien
      assert.equal(tageSeit('2026-08-28', heute), 31, zone)
      assert.equal(tageSeit('2026-08-29', heute), 30, zone)
      assert.equal(tageSeit('2026-09-28T00:00:00+00:00', heute), 0, zone)
    }
  })
})

describe('Verdrahtung', () => {
  test('getCtx bildet heute als Wiener Wandzeit, toDateStr über die lokalen Felder', () => {
    const d = quelle('src/app/(dashboard)/dashboard/_shared/data.ts')
    assert.match(d, /const heute = wienJetzt\(\)/)
    assert.match(d, /export function toDateStr\(d: Date\) \{\s*return lokalerTag\(d\)/)
    // KAN-374: offene Posten über ladeOffenePostenListe mit dem Wiener Kalendertag (Verzug ab Fälligkeit)
    assert.match(d, /ladeOffenePostenListe\(ctx\.supabase, ctx\.tenantId, ctx\.heuteStr\)/)
    assert.doesNotMatch(d, /toISOString\(\)\.split\('T'\)/)
  })

  test('Begrüßung nach der Stunde von ctx.heute (Wien)', () => {
    assert.match(quelle('src/app/(dashboard)/dashboard/page.tsx'), /const stunde = ctx\.heute\.getHours\(\)/)
  })

  test('Verkaufs-Dashboard: Monatsgrenzen nach Wiener Uhr, nicht über toISOString', () => {
    const v = quelle('src/app/(dashboard)/dashboard/_shared/VerkaufCrmSicht.tsx')
    assert.match(v, /const heute = wienJetzt\(\)/)
    assert.doesNotMatch(v, /toISOString\(\)\.split\('T'\)/)
  })
})
