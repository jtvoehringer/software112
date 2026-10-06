// KAN-22 (06.10.2026) – KI-Zähler nur per Service-Role: check_und_increment_ki_abfrage und increment_ki_tokens laufen in
// /api/ki-abfrage über den Admin-Client, und zwar erst nach den Prüfungen der Route (Mitgliedschaft, Nur-Lesen-Modus,
// Auswertungsrecht). Kein Aufruf der beiden RPCs mit einem Benutzer-Client.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

test('Route: beide Zähler über den Admin-Client', () => {
  const r = quelle('src/app/api/ki-abfrage/route.ts')
  assert.match(r, /const kiZaehler = createSupabaseAdminClient\(\)/)
  assert.match(r, /\(kiZaehler\.rpc as any\)\('check_und_increment_ki_abfrage'/)
  assert.match(r, /\(kiZaehler\.rpc as any\)\('increment_ki_tokens'/)
  assert.doesNotMatch(r, /\(supabase\.rpc as any\)\('(check_und_increment_ki_abfrage|increment_ki_tokens)'/)
})

test('Route: Admin-Client erst nach Mitgliedschaft, Nur-Lesen-Modus und Auswertungsrecht', () => {
  const r = quelle('src/app/api/ki-abfrage/route.ts')
  const admin = r.indexOf('const kiZaehler = createSupabaseAdminClient()')
  for (const pruefung of ['getCurrentMembership()', "schreibSperreKonflikt(membership, 'ki')", 'canSeeAuswertungen(membership)']) {
    const i = r.indexOf(pruefung)
    assert.ok(i > 0 && i < admin, `${pruefung} vor dem Admin-Client`)
  }
})

test('Morgenbericht ruft mit dem Admin-Client (Cron/Service)', () => {
  assert.match(quelle('src/lib/morgenbericht/erstellen.ts'), /fasseZusammen\(admin, /)
})
