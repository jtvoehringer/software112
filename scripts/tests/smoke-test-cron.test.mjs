// Nächtlicher Smoke-Test der Zugriffsrechte (12.11.2026): Vercel-Cron /api/cron/smoke-test führt denselben Lauf
// wie der Knopf unter Admin → System aus (lib/system/smokeTest.ts). Hintergrund: der Smoke-Test lief nie automatisch,
// und die Prüf-Sitzung trug kein aal2 – seit KAN-136 scheiterten deshalb alle erwarteten Schreibzugriffe (11/36).
//
// Aufruf:  node --experimental-strip-types --test scripts/tests/smoke-test-cron.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const quelle = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('Route: nur mit CRON_SECRET, nur GET, Lauf über smokeTestLauf mit Quelle „cron/smoke-test“', () => {
  const route = quelle('src/app/api/cron/smoke-test/route.ts')
  assert.match(route, /\/\/ zwei-faktor-ausnahme: .{15,}\nexport async function GET/)
  assert.match(route, /authorization'\) !== `Bearer \$\{cronSecret\}`/)
  assert.match(route, /if \(!cronSecret\) return/)
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/)
  assert.match(route, /const QUELLE = 'cron\/smoke-test'/)
  assert.match(route, /smokeTestLauf\(admin, pruefBenutzer, QUELLE\)/)
})

test('Knopf und Cron teilen denselben Lauf; Quelle enthält „smoke-test“ (Filter des Healthstatus in der Suite)', () => {
  const action = quelle('src/app/(dashboard)/admin/system/actions.ts')
  assert.match(action, /smokeTestLauf\(createSupabaseAdminClient\(\), user\.id, '\/admin\/system\/smoke-test'\)/)
  assert.doesNotMatch(action, /\.rpc\(/)
  const lib = quelle('src/lib/system/smokeTest.ts')
  assert.match(lib, /'s112_smoke_test'/)
  assert.match(lib, /SMOKE_DEMO_TENANT = '33333333-3333-4333-8333-333333333333'/)
  assert.match(lib, /`Smoke-Test: \$\{zeilen\.length - fehler\.length\} von \$\{zeilen\.length\} Prüfungen bestanden/)
})

test('vercel.json: täglicher Cron 50 3 * * * (nach Demo-Reset und Musterhof-Ampel)', () => {
  const v = JSON.parse(quelle('vercel.json'))
  assert.deepEqual(v.crons.filter(c => c.path === '/api/cron/smoke-test'), [{ path: '/api/cron/smoke-test', schedule: '50 3 * * *' }])
})

test('jüngste Fassung von s112_smoke_test simuliert eine 2FA-Sitzung (aal2)', () => {
  const dir = new URL('../../supabase/migrations/', import.meta.url)
  const dateien = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
  const letzte = dateien.filter(f => /create or replace function public\.s112_smoke_test/i.test(quelle(`supabase/migrations/${f}`))).at(-1)
  assert.ok(letzte, 'keine Migration mit s112_smoke_test')
  assert.match(quelle(`supabase/migrations/${letzte}`), /claims := json_build_object\('sub', p_user, 'role', 'authenticated', 'aal', 'aal2'\)/)
})
