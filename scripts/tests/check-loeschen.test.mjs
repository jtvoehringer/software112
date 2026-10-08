// Tests für den Wächter scripts/check-loeschen.js (KAN-243, 09.10.2026): jedes .delete() einer Supabase-Abfrage in src/
// holt die gelöschten Zeilen zurück (.select(…)) oder ist mit „loeschen-ohne-pruefung: <Grund>“ begründet – ein DELETE,
// das die RLS nicht zulässt, löscht sonst still 0 Zeilen und die App meldet Erfolg.
//
// Aufruf:  npm run -s test:csv   (alle scripts/tests/*.test.mjs)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HIER, '..', '..')
const SKRIPT = path.join(ROOT, 'scripts', 'check-loeschen.js')
const require = createRequire(import.meta.url)
const { pruefeText, pruefeWurzel } = require(SKRIPT)

const D = '.delete' + '()'   // nicht ausgeschrieben – diese Datei liegt nicht unter src/, aber lesbar bleibt es so
const M = 'loeschen-ohne-' + 'pruefung'
const zeilen = text => pruefeText(text).funde.map(f => f.zeile)

describe('check-loeschen: Erkennung', () => {
  test('ohne .select in der Kette → Fund; mit .select (auch in Folgezeilen) → geprüft', () => {
    assert.deepEqual(zeilen(`const { error } = await s.from('t')${D}.eq('id', id)\n`), [1])
    assert.deepEqual(zeilen(`const { data, error } = await s.from('t')${D}.eq('id', id).select('id')\n`), [])
    const mehrzeilig = `const { data } = await (s.from('t') as any)\n  ${D}\n  .eq('id', id)\n  .select('id')\nif (x) {}\n`
    assert.deepEqual(pruefeText(mehrzeilig), { funde: [], ausnahmen: 0, geprueft: 1 })
  })

  test('ein .select erst in der NÄCHSTEN Anweisung zählt nicht', () => {
    assert.deepEqual(zeilen(`await s.from('t')${D}.eq('id', id)\nconst { data } = await s.from('t').select('id')\n`), [1])
  })

  test('Map/Set/URLSearchParams.delete(x), Kommentare und Strings schlagen nicht an', () => {
    assert.deepEqual(zeilen(`m.delete(k)\nparams.delete('x')\n// s.from('t')${D}\nconst t = "s.from('t')${D}"\n/* ${D} */\n`), [])
  })

  test('Ausnahme mit Begründung ≥ 15 Zeichen – in derselben Zeile oder bis zu vier Zeilen davor', () => {
    assert.deepEqual(pruefeText(`// ${M}: Service-Role, keine RLS\n// eslint-disable-next-line\nawait admin.from('t')${D}.eq('id', id)\n`), { funde: [], ausnahmen: 1, geprueft: 0 })
    assert.deepEqual(zeilen(`// ${M}: kurz\nawait admin.from('t')${D}.eq('id', id)\n`), [2])
    assert.deepEqual(zeilen(`// ${M}: Service-Role, keine RLS\n\n\n\n\nawait admin.from('t')${D}.eq('id', id)\n`), [6])
  })
})

describe('check-loeschen: Zeilen bleiben erhalten', () => {
  test('nicht geschlossenes Anführungszeichen (Apostroph in einer Regex) verschluckt keinen Zeilenumbruch', async () => {
    const { ohneKommentare } = require(SKRIPT)
    const text = `const re = /[^']/g\nconst x = 1\n// Kommentar\nconst y = "a'b"\n`
    const aus = ohneKommentare(text)
    assert.equal(aus.split('\n').length, text.split('\n').length)
    assert.equal(aus.length, text.length)
    assert.equal(aus.split('\n')[1], 'const x = 1')
  })
})

describe('check-loeschen: .update() (KAN-248)', () => {
  const U = '.update' + '('
  const MU = 'aenderung-ohne-' + 'pruefung'
  test('ohne .select → Fund; .select nach mehrzeiligem Objekt, count: exact und let q … q.select → geprüft', () => {
    assert.deepEqual(zeilen(`const { error } = await (s.from('t') as any)${U}{ a: 1 }).eq('id', id)\n`), [1])
    const mehrzeilig = `const { data, error } = await (s.from('t') as any)\n  ${U}{\n    a: 1,\n    b: 2,\n  })\n  .eq('id', id)\n  .select('id')\n`
    assert.deepEqual(pruefeText(mehrzeilig), { funde: [], ausnahmen: 0, geprueft: 1 })
    assert.deepEqual(zeilen(`const { count } = await (s.from('t') as any)${U}{ a: 1 }, { count: 'exact' }).eq('id', id)\n`), [])
    const variable = `let q = (s.from('t') as any)\n  ${U}w).eq('id', id)\nq = q.is('menge', null)\nconst { data } = await q.select('id')\n`
    assert.deepEqual(zeilen(variable), [])
  })
  test('keine Supabase-Kette: crypto/Stripe .update(…) ohne .from( davor, Buffer.from in derselben Zeile', () => {
    assert.deepEqual(zeilen(`const h = createHmac('sha256', k)${U}daten).digest()\n`), [])
    assert.deepEqual(zeilen(`await stripe.customers${U}id, { metadata })\n`), [])
    assert.deepEqual(zeilen(`return Buffer.concat([d${U}Buffer.from(x, 'hex')), d.final()])\n`), [])
  })
  test('Service-Role ist ausgenommen (keine RLS)', () => {
    assert.deepEqual(zeilen(`await (admin.from('t') as any)${U}{ a: 1 }).eq('id', id)\n`), [])
    assert.deepEqual(zeilen(`await (supabaseAdmin.from('t') as any)${U}{ a: 1 }).eq('id', id)\n`), [])
    assert.deepEqual(zeilen(`await (createSupabaseAdminClient().from('t') as any)${U}{ a: 1 }).eq('id', id)\n`), [])
  })
  test('Ausnahme mit Begründung in der .update(-Zeile bzw. davor; zu kurz → Fund', () => {
    assert.deepEqual(pruefeText(`await (s.from('t') as any)${U}{ a: 1 }).eq('k', v)   // ${MU}: nur offene, 0 Zeilen in Ordnung\n`).funde, [])
    assert.deepEqual(zeilen(`// ${MU}: kurz\nawait (s.from('t') as any)${U}{ a: 1 }).eq('k', v)\n`), [2])
  })
})

describe('check-loeschen: Projekt', () => {
  test('das Projekt ist sauber (jede Löschung geprüft oder begründet)', () => {
    const e = pruefeWurzel(ROOT)
    assert.deepEqual(e.funde, [])
    assert.ok(e.geprueft >= 20, `geprueft: ${e.geprueft}`)
  })

  test('als Skript: Exit 1 bei Fund, Exit 0 ohne', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 's112-loeschen-'))
    try {
      mkdirSync(path.join(dir, 'src', 'app'), { recursive: true })
      writeFileSync(path.join(dir, 'src', 'app', 'a.ts'), `await s.from('t')${D}.eq('id', 1)\n`)
      const rot = spawnSync(process.execPath, [SKRIPT], { env: { ...process.env, S112_GUARD_ROOT: dir }, encoding: 'utf8' })
      assert.equal(rot.status, 1)
      assert.match(rot.stderr, /src\/app\/a\.ts:1/)
      writeFileSync(path.join(dir, 'src', 'app', 'a.ts'), `await s.from('t')${D}.eq('id', 1).select('id')\n`)
      const gruen = spawnSync(process.execPath, [SKRIPT], { env: { ...process.env, S112_GUARD_ROOT: dir }, encoding: 'utf8' })
      assert.equal(gruen.status, 0, gruen.stderr)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
