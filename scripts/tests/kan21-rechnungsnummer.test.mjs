// KAN-21 (06.10.2026) – Lückenlose Rechnungsnummern: die Datenbank vergibt die Nummer beim Insert (Trigger
// a_rechnungsnummer). Die App schickt keine Nummer mit und ruft get_next_rechnungsnummer nicht mehr auf.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const quelle = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

test('kein Aufruf von get_next_rechnungsnummer mehr in src/', () => {
  const treffer = []
  const lauf = d => { for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) lauf(p)
    else if (/\.tsx?$/.test(e.name) && /rpc[^\n]*\(\s*'get_next_rechnungsnummer'/.test(readFileSync(p, 'utf8'))) treffer.push(p)
  } }
  lauf(fileURLToPath(new URL('../../src', import.meta.url)))
  assert.deepEqual(treffer, [])
})

test('Verkauf: Beleg ohne Nummer anlegen, Nummer aus dem Insert zurücklesen; keine Eingabe aus dem Formular', () => {
  const a = quelle('src/app/(dashboard)/weinhandel/verkauf/actions.ts')
  assert.doesNotMatch(a, /formData\.get\('rechnungsnummer'\)/)
  const insert = a.slice(a.indexOf("from('verkaufsposten') as any).insert({"), a.indexOf("}).select('rechnungsnummer').single()"))
  assert.ok(insert.length > 0, 'Insert mit select(rechnungsnummer)')
  assert.doesNotMatch(insert, /\brechnungsnummer\b/)
  assert.doesNotMatch(quelle('src/app/(dashboard)/weinhandel/verkauf/neu/page.tsx'), /formData\.set\('rechnungsnummer'/)
})

test('Traubenverkauf: Beleg ohne Nummer', () => {
  const t = quelle('src/app/(dashboard)/weinhandel/traubenverkauf/actions.ts')
  const insert = t.slice(t.indexOf("from('verkaufsposten') as any).insert({"), t.indexOf('if (postenErr)'))
  assert.ok(insert.length > 0)
  assert.doesNotMatch(insert, /\brechnungsnummer\b/)
})
