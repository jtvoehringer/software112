// Sweep 103 (10.10.2026): Inhalt einer Anfrage nie ungeschützt lesen.
// Befund: 8 Route-Handler lasen req.json() bzw. req.formData() außerhalb eines try – bei leerem oder kaputtem Inhalt
// antwortete Next.js mit einer HTML-Fehlerseite (500), der Client scheiterte an res.json(). Jetzt jsonBody/formBody
// (src/lib/api/body.ts) → 400 mit Meldung. Wächter: scripts/check-anfrage.js (prebuild).
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { hooksRegistrieren, laden, nurMitHooks, hooksMoeglich } from './buchung-attrappe.mjs'

hooksRegistrieren()
const body = hooksMoeglich ? await laden('lib/api/body.ts') : null
const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { pruefeText, pruefeWurzel } = require(path.join(HIER, '..', 'check-anfrage.js'))
const zeilen = t => pruefeText(t).funde.map(f => f.zeile)
const anfrage = (inhalt, typ = 'application/json') => new Request('http://x/api', { method: 'POST', body: inhalt, headers: { 'content-type': typ } })

describe('jsonBody / formBody', nurMitHooks, () => {
  test('gültiges JSON-Objekt', async () => {
    assert.deepEqual(await body.jsonBody(anfrage('{"a":1}')), { a: 1 })
  })
  test('leer, kaputt, Array, Zahl → null', async () => {
    assert.equal(await body.jsonBody(anfrage('')), null)
    assert.equal(await body.jsonBody(anfrage('{kaputt')), null)
    assert.equal(await body.jsonBody(anfrage('[1,2]')), null)
    assert.equal(await body.jsonBody(anfrage('42')), null)
  })
  test('formBody: kein Formular → null; Formular → FormData', async () => {
    assert.equal(await body.formBody(anfrage('{"a":1}')), null)
    const fd = new FormData(); fd.set('art', 'flasche')
    const r = await body.formBody(new Request('http://x/api', { method: 'POST', body: fd }))
    assert.equal(r.get('art'), 'flasche')
  })
  test('ungueltigeAnfrage: 400 mit Meldung unter dem gewünschten Schlüssel', async () => {
    const a = body.ungueltigeAnfrage('error')
    assert.equal(a.status, 400)
    assert.match((await a.json()).error, /nicht gelesen werden/)
  })
})

describe('Wächter', () => {
  test('Erkennung', () => {
    assert.deepEqual(zeilen('export async function POST(req) {\n  const b = await req.json()\n}'), [2])
    assert.deepEqual(zeilen('export async function POST(req) {\n  const fd = await req.formData()\n}'), [2])
    assert.deepEqual(zeilen('export async function POST(req) {\n  try { const b = await req.json() } catch { return x }\n}'), [])
    assert.deepEqual(zeilen('export async function POST(req) {\n  const b = await req.json().catch(() => null)\n}'), [])
    assert.deepEqual(zeilen('export async function POST(req) {\n  const b = await jsonBody(req)\n}'), [])
    assert.deepEqual(zeilen('export async function POST(req) {\n  // anfrage-ok: Webhook mit Signatur, Inhalt immer gesetzt\n  const b = await req.json()\n}'), [])
  })

  test('Projekt: alle Lesestellen geschützt', () => {
    const e = pruefeWurzel(ROOT)
    assert.ok(e.stellen >= 20, `zu wenige Lesestellen (${e.stellen})`)
    assert.deepEqual(e.funde, [])
    assert.match(readFileSync(path.join(ROOT, 'src/app/api/buchhaltung/belege/route.ts'), 'utf8'), /const formData = await formBody\(req\)/)
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    assert.match(pkg.scripts.prebuild, /check-anfrage\.js/)
  })
})
