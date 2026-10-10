// Sweep 104 (10.10.2026): keine toten internen Links.
// Alle festen Pfade in href=, router.push/replace, redirect() und location.href zeigen auf eine Route unter src/app.
// Befund: /signup verlinkte auf /agb und /datenschutz, die es nicht gibt – Einrichtung offen (KAN-300, In Abklärung),
// bis dahin begründete Ausnahme. Wächter: scripts/check-links.js (prebuild).
//
// Aufruf:  npm run -s test:csv

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HIER, '..', '..')
const require = createRequire(import.meta.url)
const { routenAus, pruefeText, pruefeWurzel } = require(path.join(HIER, '..', 'check-links.js'))

const routen = routenAus([
  '(dashboard)/crm/kontakte/[id]/page.tsx', '(dashboard)/crm/firmen/[id]/page.tsx', '(dashboard)/kellerbuch/page.tsx',
  '(auth)/login/page.tsx', 'hilfe/[[...pfad]]/page.tsx', 'api/x/route.ts',
])
const zeilen = t => pruefeText(t, routen).funde.map(f => f.zeile)

describe('Erkennung', () => {
  test('vorhandene Routen (auch mit Gruppe, Parameter, Platzhalter, Catch-all) → kein Fund', () => {
    assert.deepEqual(zeilen('<Link href="/kellerbuch">x</Link>'), [])
    assert.deepEqual(zeilen("router.push('/login')"), [])
    assert.deepEqual(zeilen('<a href={`/crm/kontakte/${k.id}`}>x</a>'), [])
    assert.deepEqual(zeilen('<a href={`/crm/${typ}/${id}`}>x</a>'), [])
    assert.deepEqual(zeilen("redirect('/hilfe/a/b')"), [])
    assert.deepEqual(zeilen('<a href="/api/export/kontakte">x</a>'), [])
    assert.deepEqual(zeilen('<a href="/handbuch.pdf">x</a>'), [])
  })
  test('nicht vorhandene Route → Fund', () => {
    assert.deepEqual(zeilen('<a href="/agb">AGB</a>'), [1])
    assert.deepEqual(zeilen("x\nrouter.push('/kellerbuch/gibtsnicht')"), [2])
    assert.deepEqual(zeilen('<a href={`/weinhandel/${id}`}>x</a>'), [1])
  })
  test('Ausnahme nur mit Begründung', () => {
    assert.deepEqual(zeilen('{/* link-ok: Seite wird noch eingerichtet (KAN-300) */}\n<a href="/agb">AGB</a>'), [])
    assert.deepEqual(zeilen('{/* link-ok: kurz */}\n<a href="/agb">AGB</a>'), [2])
  })
})

describe('Projekt', () => {
  test('keine toten Links; die zwei offenen (KAN-300) sind begründet', () => {
    const e = pruefeWurzel(ROOT)
    assert.ok(e.routen > 200 && e.pfade > 300, `zu wenig gefunden (${e.routen} Routen, ${e.pfade} Pfade)`)
    assert.deepEqual(e.funde, [])
    assert.ok(e.ausnahmen <= 2, `neue link-ok-Ausnahme? (${e.ausnahmen})`)
    assert.match(readFileSync(path.join(ROOT, 'src/app/signup/SignupClient.tsx'), 'utf8'), /link-ok: AGB und Datenschutzerklärung sind noch einzurichten \(KAN-300/)
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    assert.match(pkg.scripts.prebuild, /check-links\.js/)
  })
})
