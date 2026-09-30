// KAN-145: Prüfskript „Stornieren statt Löschen“ (scripts/check-storno.js)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const c = require('../check-storno.js')

test('App: .delete() auf gelisteter Tabelle ist ein Fund, nicht gelistete Tabelle nicht', () => {
  const t = `const x = await (supabase.from('keller_umzuege') as any).delete().eq('id', id)\nawait supabase.from('kontakte').delete().eq('id', 1)`
  const r = c.pruefeText(t, 'app', 'src/x.ts')
  assert.deepEqual(r.funde.map(f => [f.regel, f.tabelle]), [['DELETE_APP', 'keller_umzuege']])
})

test('App: .from(<Variable>).delete() ist ein eigener Fund (Tabelle nicht erkennbar)', () => {
  const r = c.pruefeText(`await (supabase.from(tabelle) as any).delete().eq('id', id)`, 'app', 'src/y.ts')
  assert.deepEqual(r.funde.map(f => f.regel), ['DELETE_VAR'])
})

test('Ausnahme mit Grund ≥ 15 Zeichen in der Zeile davor; zu kurz ist ein Fund; Kommentare zählen nicht', () => {
  const ok = c.pruefeText(`// storno-ausnahme: technischer Rückbau vor dem Commit\nawait supabase.from('fuellungen').delete().eq('id', 1)`, 'app', 'src/z.ts')
  assert.equal(ok.funde.length, 0)
  assert.equal(ok.ausnahmen.length, 1)
  const kurz = c.pruefeText(`await supabase.from('fuellungen').delete() // storno-ausnahme: kurz`, 'app', 'src/z.ts')
  assert.match(kurz.funde[0].text, /ohne ausreichenden Grund/)
  assert.equal(c.pruefeText(`// await supabase.from('fuellungen').delete()`, 'app', 'src/z.ts').funde.length, 0)
})

test('SQL: DELETE FROM auf gelisteter Tabelle (auch public. und in DO-Rümpfen), Altfälle je Datei', () => {
  const r = c.pruefeText(`DO $$ BEGIN DELETE FROM public.verschneidungen WHERE id = x; END $$;\nDELETE FROM kontakte;`, 'sql', 'sql/neu.sql')
  assert.deepEqual(r.funde.map(f => [f.regel, f.tabelle]), [['DELETE_SQL', 'verschneidungen']])
  const alt = c.pruefeText(`DELETE FROM zukauf_posten WHERE tenant_id = x;`, 'sql', 'sql/cleanup_gebeshuber_kompletter_reset.sql')
  assert.equal(alt.funde.length, 0)
  assert.equal(alt.altfaelle.length, 1)
})

test('ganzes Projekt ohne Fund; Migrationen erst ab dem Stichtag; im prebuild', () => {
  assert.equal(c.pruefeWurzel().funde.length, 0)
  assert.ok(c.STICHTAG_MIGRATION > '20260930083012')
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.match(pkg.scripts.prebuild, /check-storno\.js/)
  assert.ok(c.TABELLEN.includes('keller_umzuege') && c.TABELLEN.includes('ea_transaktionen'))
})
