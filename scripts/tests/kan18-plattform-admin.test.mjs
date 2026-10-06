// KAN-18 (06.10.2026) – „Super-Admin einladen“ = Plattform-Admin (Entscheidung Jörgen: Ja)
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)
//
// Geprüft: plattformAdminMitgliedschaften() (fehlende Betriebe anlegen, andere Rollen hochstufen, nichts doppelt) und die
// Verdrahtung in inviteSystemAdmin (alle Betriebe statt nur des ältesten) sowie die Beschriftung der Seite.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { plattformAdminMitgliedschaften } = await import('../../src/lib/auth/plattformAdminMitglied.ts')
const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

describe('plattformAdminMitgliedschaften()', () => {
  test('ohne Mitgliedschaft → in jedem Betrieb neu', () => {
    assert.deepEqual(plattformAdminMitgliedschaften(['a', 'b', 'c'], []), { neu: ['a', 'b', 'c'], hochstufen: [] })
  })
  test('vorhandene system_admin bleiben, andere Rollen werden hochgestuft', () => {
    const r = plattformAdminMitgliedschaften(['a', 'b', 'c'], [
      { id: 'm1', tenant_id: 'a', role: 'system_admin' },
      { id: 'm2', tenant_id: 'b', role: 'winzer' },
    ])
    assert.deepEqual(r, { neu: ['c'], hochstufen: ['m2'] })
  })
  test('doppelte Betriebe nur einmal, Mitgliedschaften fremder Betriebe ignoriert', () => {
    const r = plattformAdminMitgliedschaften(['a', 'a'], [{ id: 'm9', tenant_id: 'z', role: 'leser' }])
    assert.deepEqual(r, { neu: ['a'], hochstufen: [] })
  })
})

describe('Verdrahtung inviteSystemAdmin', () => {
  const a = quelle('src/app/(dashboard)/admin/benutzer/systemAdminActions.ts')
  test('lädt alle Betriebe (nicht nur den ältesten) und legt fehlende Mitgliedschaften an', () => {
    assert.doesNotMatch(a, /order\('created_at'\)\.limit\(1\)/)
    assert.match(a, /plattformAdminMitgliedschaften\(tenantIds, /)
    assert.match(a, /\.insert\(neu\.map\(tenantId => \(\{ tenant_id: tenantId, user_id: userId, role: 'system_admin' \}\)\)\)/)
  })
  test('plattform_admins wird vor den Mitgliedschaften gepflegt', () => {
    assert.ok(a.indexOf("from('plattform_admins')") < a.indexOf('plattformAdminMitgliedschaften(tenantIds'))
  })
  test('Seite beschriftet die Einladung als Plattform-Admin in allen Betrieben', () => {
    const c = quelle('src/app/(dashboard)/admin/benutzer/SystemAdminClient.tsx')
    assert.match(c, /Plattform-Admin einladen/)
    assert.match(c, /allen bestehenden und künftigen Betrieben/)
  })
})
