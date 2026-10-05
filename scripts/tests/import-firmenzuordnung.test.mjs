// Regressionstest (05.10.2026): Datenimport ordnet Kontakte allen Firmen zu, nicht nur den ersten 1.000.
// Befund Gebeshuber: 4.652 Firmen, die Zuordnung lud sie mit einer einzigen Abfrage (PostgREST liefert höchstens
// 1.000 Zeilen) – 4.164 Kontakte blieben „nicht zugeordnet“. Ebenso der Duplikat-Abgleich des Lead-Imports.
//
// Aufruf:  npm run -s test:csv

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const route = readFileSync(path.join(WURZEL, 'src/app/api/import/route.ts'), 'utf8').replace(/\r\n/g, '\n')

function rumpf(text, kopf) {
  const a = text.indexOf(kopf)
  assert.ok(a >= 0, `${kopf} nicht gefunden`)
  return text.slice(a, a + 1200)
}

test('findFirmaId lädt alle Firmen seitenweise (alle() mit .order) und bricht bei Fehlern ab', () => {
  const r = rumpf(route, 'async function findFirmaId(')
  assert.match(r, /await alle\(\(supabase\.from\('firmen'\) as any\)\s*\.select\('id, name'\)\.eq\('tenant_id', tenantId\)\.order\('id'\)\)/)
  assert.match(r, /if \(error\) throw new Error\(/)
})

test('Duplikat-Abgleich des Lead-Imports lädt Kontakte und Firmen seitenweise', () => {
  const r = rumpf(route, 'if (leadImport && (typ === \'kontakte\' || typ === \'firmen\')) {')
  assert.match(r, /await alle\(\(supabase\.from\('kontakte'\) as any\)[\s\S]*?\.order\('id'\)\)/)
  assert.match(r, /await alle\(\(supabase\.from\('firmen'\) as any\)[\s\S]*?\.order\('id'\)\)/)
})
